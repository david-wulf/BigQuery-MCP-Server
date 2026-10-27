import { runQuery } from "./query.js";
import { validateIdentifier } from "../client.js";
import { escapeSQLString } from "./gsc-shared.js";

/**
 * YouTube channel analyses on the BigQuery Data Transfer for YouTube Channel.
 *
 * All tools read the unified views in the YouTube dataset (default
 * `youtube_channel`, env BIGQUERY_YOUTUBE_DATASET), never the raw report tables:
 *
 *   v_kanal_tag   datum, views, watchtime_minuten, likes, kommentare, shares,
 *                 abonnenten_gewinn, abonnenten_verlust, herkunft
 *   v_video_tag   the same per video_id
 *   v_quelle_tag  datum, quelle, bezeichnung, views, watchtime_minuten, herkunft
 *   v_land_tag    datum, land, views, watchtime_minuten, herkunft
 *   v_geraet_tag  datum, geraet, views, watchtime_minuten, herkunft
 *   v_abo_tag     datum, abo_status, views, watchtime_minuten (reports only)
 *
 * The views join the transfer's Reporting API reports with a one-off history
 * from the YouTube Analytics API for the time before the transfer started;
 * `herkunft` says which one a day comes from. The channel reports carry no
 * revenue - revenue is only available through the Analytics API.
 */

export type YoutubeGranularity = "day" | "week" | "month";

const TRUNC: Record<YoutubeGranularity, string> = {
  day: "DAY",
  week: "WEEK(MONDAY)",
  month: "MONTH",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function youtubeDataset(dataset?: string): string {
  const ds = dataset || process.env.BIGQUERY_YOUTUBE_DATASET || "youtube_channel";
  validateIdentifier(ds, "dataset");
  return ds;
}

/**
 * Window CTE: either an explicit date range or the last `days` days up to the
 * latest day in v_kanal_tag, plus the equally long period right before it.
 */
function windowCTE(ds: string, days: number, startDate?: string, endDate?: string): string {
  for (const [label, value] of [["start_date", startDate], ["end_date", endDate]] as const) {
    if (value !== undefined && !ISO_DATE.test(value)) {
      throw new Error(`${label} must be YYYY-MM-DD, got "${value}"`);
    }
  }
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("days must be an integer between 1 and 3650");
  }
  const bis = endDate
    ? `DATE '${endDate}'`
    : `(SELECT MAX(datum) FROM \`${ds}.v_kanal_tag\`)`;
  const von = startDate ? `DATE '${startDate}'` : `DATE_SUB(bis, INTERVAL ${days - 1} DAY)`;
  return `
    grenze AS (SELECT ${bis} AS bis),
    fenster AS (
      SELECT ${von} AS von, bis,
             DATE_DIFF(bis, ${von}, DAY) + 1 AS tage
        FROM grenze
    ),
    vorher AS (
      SELECT DATE_SUB(von, INTERVAL tage DAY) AS von, DATE_SUB(von, INTERVAL 1 DAY) AS bis
        FROM fenster
    )`;
}

const METRICS_SQL = `
  SUM(views) AS views,
  ROUND(SUM(watchtime_minuten) / 60, 1) AS watchtime_hours,
  ROUND(SAFE_DIVIDE(SUM(watchtime_minuten) * 60, SUM(views)), 1) AS avg_view_duration_s,
  SUM(likes) AS likes,
  SUM(kommentare) AS comments,
  SUM(shares) AS shares,
  SUM(abonnenten_gewinn) AS subscribers_gained,
  SUM(abonnenten_verlust) AS subscribers_lost,
  SUM(abonnenten_gewinn) - SUM(abonnenten_verlust) AS subscribers_net`;

function pctChange(now: string, before: string): string {
  return `ROUND(SAFE_DIVIDE(${now} - ${before}, ${before}) * 100, 1)`;
}

/** Channel totals for the window vs the previous period, plus a time series. */
export async function youtubeChannelTrend(
  days: number = 28,
  granularity: YoutubeGranularity = "day",
  startDate?: string,
  endDate?: string,
  dataset?: string
) {
  const ds = youtubeDataset(dataset);
  const w = windowCTE(ds, days, startDate, endDate);

  const summarySQL = `
    WITH ${w},
    jetzt AS (SELECT ${METRICS_SQL}, COUNT(DISTINCT datum) AS days_with_data,
                     STRING_AGG(DISTINCT herkunft) AS source
                FROM \`${ds}.v_kanal_tag\`, fenster WHERE datum BETWEEN fenster.von AND fenster.bis),
    davor AS (SELECT ${METRICS_SQL}, COUNT(DISTINCT datum) AS days_with_data
                FROM \`${ds}.v_kanal_tag\`, vorher WHERE datum BETWEEN vorher.von AND vorher.bis)
    SELECT f.von AS start_date, f.bis AS end_date, v.von AS previous_start, v.bis AS previous_end,
           j.*,
           d.views AS previous_views,
           IF(d.days_with_data < f.tage, NULL, ${pctChange("j.views", "d.views")}) AS views_change_pct,
           d.watchtime_hours AS previous_watchtime_hours,
           IF(d.days_with_data < f.tage, NULL, ${pctChange("j.watchtime_hours", "d.watchtime_hours")}) AS watchtime_change_pct,
           d.subscribers_net AS previous_subscribers_net,
           d.days_with_data AS previous_days_with_data
      FROM fenster f, vorher v, jetzt j, davor d`;

  const seriesSQL = `
    WITH ${w}
    SELECT DATE_TRUNC(datum, ${TRUNC[granularity]}) AS period, ${METRICS_SQL},
           COUNT(DISTINCT datum) AS days_with_data
      FROM \`${ds}.v_kanal_tag\`, fenster
     WHERE datum BETWEEN fenster.von AND fenster.bis
     GROUP BY period
     ORDER BY period`;

  const [summary, series] = await Promise.all([runQuery(summarySQL, 1), runQuery(seriesSQL, 1000)]);
  return { summary: summary.rows[0] ?? null, series: series.rows, bytesProcessed: [summary.bytesProcessed, series.bytesProcessed] };
}

/** Best-effort titles over YouTube's public oEmbed endpoint (no key needed). */
async function fetchTitles(ids: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const body = (await res.json()) as { title?: string };
          if (body.title) titles.set(id, body.title);
        }
      } catch {
        // private, deleted or unreachable - the row keeps its video_id
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  return titles;
}

const SORT_COLUMNS = {
  views: "views",
  watchtime: "watchtime_hours",
  subscribers: "subscribers_net",
  likes: "likes",
} as const;

/** Top videos in the window with the change against the previous period. */
export async function youtubeTopVideos(
  days: number = 28,
  limit: number = 25,
  sortBy: keyof typeof SORT_COLUMNS = "views",
  startDate?: string,
  endDate?: string,
  withTitles: boolean = true,
  dataset?: string
) {
  const ds = youtubeDataset(dataset);
  const w = windowCTE(ds, days, startDate, endDate);
  const n = Math.min(Math.max(Math.trunc(limit), 1), 200);

  const sql = `
    WITH ${w},
    jetzt AS (SELECT video_id, ${METRICS_SQL}
                FROM \`${ds}.v_video_tag\`, fenster WHERE datum BETWEEN fenster.von AND fenster.bis
               GROUP BY video_id),
    davor AS (SELECT video_id, SUM(views) AS views, ROUND(SUM(watchtime_minuten) / 60, 1) AS watchtime_hours
                FROM \`${ds}.v_video_tag\`, vorher WHERE datum BETWEEN vorher.von AND vorher.bis
               GROUP BY video_id),
    gesamt AS (SELECT SUM(views) AS views FROM jetzt)
    SELECT j.*,
           ROUND(SAFE_DIVIDE(j.views, g.views) * 100, 2) AS share_of_views_pct,
           d.views AS previous_views, ${pctChange("j.views", "d.views")} AS views_change_pct,
           d.watchtime_hours AS previous_watchtime_hours,
           CONCAT('https://youtu.be/', j.video_id) AS url
      FROM jetzt j CROSS JOIN gesamt g LEFT JOIN davor d USING (video_id)
     ORDER BY j.${SORT_COLUMNS[sortBy]} DESC
     LIMIT ${n}`;

  const result = await runQuery(sql, n);
  if (withTitles && result.rows.length) {
    const titles = await fetchTitles(result.rows.map((r) => String(r.video_id)));
    result.rows = result.rows.map((r) => ({ title: titles.get(String(r.video_id)) ?? null, ...r }));
  }
  return result;
}

/** Traffic sources (channel level) with share and change vs the previous period. */
export async function youtubeTrafficSources(
  days: number = 28,
  startDate?: string,
  endDate?: string,
  dataset?: string
) {
  const ds = youtubeDataset(dataset);
  const w = windowCTE(ds, days, startDate, endDate);
  const sql = `
    WITH ${w},
    jetzt AS (SELECT quelle, ANY_VALUE(bezeichnung) AS label, SUM(views) AS views,
                     ROUND(SUM(watchtime_minuten) / 60, 1) AS watchtime_hours
                FROM \`${ds}.v_quelle_tag\`, fenster WHERE datum BETWEEN fenster.von AND fenster.bis
               GROUP BY quelle),
    davor AS (SELECT quelle, SUM(views) AS views
                FROM \`${ds}.v_quelle_tag\`, vorher WHERE datum BETWEEN vorher.von AND vorher.bis
               GROUP BY quelle),
    gesamt AS (SELECT SUM(views) AS views FROM jetzt)
    SELECT j.quelle AS traffic_source, j.label, j.views, j.watchtime_hours,
           ROUND(SAFE_DIVIDE(j.watchtime_hours * 3600, j.views), 1) AS avg_view_duration_s,
           ROUND(SAFE_DIVIDE(j.views, g.views) * 100, 1) AS share_pct,
           d.views AS previous_views, ${pctChange("j.views", "d.views")} AS views_change_pct
      FROM jetzt j CROSS JOIN gesamt g LEFT JOIN davor d USING (quelle)
     ORDER BY j.views DESC`;
  return runQuery(sql, 100);
}

const AUDIENCE = {
  country: { view: "v_land_tag", column: "land" },
  device: { view: "v_geraet_tag", column: "geraet" },
  subscribed_status: { view: "v_abo_tag", column: "abo_status" },
} as const;

/** Audience split by country, device or subscription status. */
export async function youtubeAudience(
  dimension: keyof typeof AUDIENCE = "country",
  days: number = 28,
  limit: number = 30,
  startDate?: string,
  endDate?: string,
  dataset?: string
) {
  const ds = youtubeDataset(dataset);
  const w = windowCTE(ds, days, startDate, endDate);
  const { view, column } = AUDIENCE[dimension];
  const n = Math.min(Math.max(Math.trunc(limit), 1), 300);
  const sql = `
    WITH ${w},
    jetzt AS (SELECT ${column} AS segment, SUM(views) AS views,
                     ROUND(SUM(watchtime_minuten) / 60, 1) AS watchtime_hours,
                     COUNT(DISTINCT datum) AS days_with_data
                FROM \`${ds}.${view}\`, fenster WHERE datum BETWEEN fenster.von AND fenster.bis
               GROUP BY segment),
    davor AS (SELECT ${column} AS segment, SUM(views) AS views
                FROM \`${ds}.${view}\`, vorher WHERE datum BETWEEN vorher.von AND vorher.bis
               GROUP BY segment),
    -- Nicht jede Aufteilung reicht gleich weit zurueck (Abo-Status nur aus den
    -- Transfer-Berichten): ohne vollstaendige Vorperiode keine Veraenderung.
    vorher_tage AS (SELECT COUNT(DISTINCT datum) AS tage
                      FROM \`${ds}.${view}\`, vorher WHERE datum BETWEEN vorher.von AND vorher.bis),
    gesamt AS (SELECT SUM(views) AS views FROM jetzt)
    SELECT j.segment, j.views, j.watchtime_hours,
           ROUND(SAFE_DIVIDE(j.views, g.views) * 100, 1) AS share_pct,
           d.views AS previous_views,
           IF(t.tage < (SELECT tage FROM fenster), NULL, ${pctChange("j.views", "d.views")}) AS views_change_pct,
           t.tage AS previous_days_with_data,
           j.days_with_data
      FROM jetzt j CROSS JOIN gesamt g CROSS JOIN vorher_tage t LEFT JOIN davor d USING (segment)
     ORDER BY j.views DESC
     LIMIT ${n}`;
  return runQuery(sql, n);
}

/** One video: totals, time series and (from the transfer reports) traffic sources. */
export async function youtubeVideoDetail(
  videoId: string,
  days: number = 90,
  granularity: YoutubeGranularity = "day",
  startDate?: string,
  endDate?: string,
  dataset?: string
) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error(`video_id must be the 11-character YouTube ID, got "${videoId}"`);
  }
  const ds = youtubeDataset(dataset);
  const w = windowCTE(ds, days, startDate, endDate);
  const id = escapeSQLString(videoId);

  const summarySQL = `
    WITH ${w},
    jetzt AS (SELECT ${METRICS_SQL}, MIN(datum) AS first_day_with_views
                FROM \`${ds}.v_video_tag\`, fenster
               WHERE video_id = '${id}' AND datum BETWEEN fenster.von AND fenster.bis),
    davor AS (SELECT SUM(views) AS views FROM \`${ds}.v_video_tag\`, vorher
               WHERE video_id = '${id}' AND datum BETWEEN vorher.von AND vorher.bis)
    SELECT f.von AS start_date, f.bis AS end_date, j.*, d.views AS previous_views,
           ${pctChange("j.views", "d.views")} AS views_change_pct
      FROM fenster f, jetzt j, davor d`;

  const seriesSQL = `
    WITH ${w}
    SELECT DATE_TRUNC(datum, ${TRUNC[granularity]}) AS period, ${METRICS_SQL}
      FROM \`${ds}.v_video_tag\`, fenster
     WHERE video_id = '${id}' AND datum BETWEEN fenster.von AND fenster.bis
     GROUP BY period ORDER BY period`;

  const sourcesSQL = `
    WITH ${w}
    SELECT quelle AS traffic_source, ANY_VALUE(bezeichnung) AS label, SUM(views) AS views,
           ROUND(SUM(watchtime_minuten) / 60, 1) AS watchtime_hours,
           MIN(datum) AS from_day, MAX(datum) AS to_day
      FROM \`${ds}.v_video_quelle_tag\`, fenster
     WHERE video_id = '${id}' AND datum BETWEEN fenster.von AND fenster.bis
     GROUP BY quelle ORDER BY views DESC`;

  const [summary, series, sources, titles] = await Promise.all([
    runQuery(summarySQL, 1),
    runQuery(seriesSQL, 1000),
    runQuery(sourcesSQL, 50),
    fetchTitles([videoId]),
  ]);
  return {
    video_id: videoId,
    title: titles.get(videoId) ?? null,
    url: `https://youtu.be/${videoId}`,
    summary: summary.rows[0] ?? null,
    series: series.rows,
    traffic_sources: sources.rows,
    traffic_sources_note:
      "Traffic sources per video exist only in the transfer reports, i.e. from the first transfer day on; earlier days are not covered.",
    bytesProcessed: [summary.bytesProcessed, series.bytesProcessed, sources.bytesProcessed],
  };
}
