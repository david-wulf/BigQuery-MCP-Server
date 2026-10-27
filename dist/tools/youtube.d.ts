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
export declare function youtubeDataset(dataset?: string): string;
/** Channel totals for the window vs the previous period, plus a time series. */
export declare function youtubeChannelTrend(days?: number, granularity?: YoutubeGranularity, startDate?: string, endDate?: string, dataset?: string): Promise<{
    summary: Record<string, unknown>;
    series: Record<string, unknown>[];
    bytesProcessed: string[];
}>;
declare const SORT_COLUMNS: {
    readonly views: "views";
    readonly watchtime: "watchtime_hours";
    readonly subscribers: "subscribers_net";
    readonly likes: "likes";
};
/** Top videos in the window with the change against the previous period. */
export declare function youtubeTopVideos(days?: number, limit?: number, sortBy?: keyof typeof SORT_COLUMNS, startDate?: string, endDate?: string, withTitles?: boolean, dataset?: string): Promise<{
    rows: Record<string, unknown>[];
    totalRows: number;
    bytesProcessed: string;
}>;
/** Traffic sources (channel level) with share and change vs the previous period. */
export declare function youtubeTrafficSources(days?: number, startDate?: string, endDate?: string, dataset?: string): Promise<{
    rows: Record<string, unknown>[];
    totalRows: number;
    bytesProcessed: string;
}>;
declare const AUDIENCE: {
    readonly country: {
        readonly view: "v_land_tag";
        readonly column: "land";
    };
    readonly device: {
        readonly view: "v_geraet_tag";
        readonly column: "geraet";
    };
    readonly subscribed_status: {
        readonly view: "v_abo_tag";
        readonly column: "abo_status";
    };
};
/** Audience split by country, device or subscription status. */
export declare function youtubeAudience(dimension?: keyof typeof AUDIENCE, days?: number, limit?: number, startDate?: string, endDate?: string, dataset?: string): Promise<{
    rows: Record<string, unknown>[];
    totalRows: number;
    bytesProcessed: string;
}>;
/** One video: totals, time series and (from the transfer reports) traffic sources. */
export declare function youtubeVideoDetail(videoId: string, days?: number, granularity?: YoutubeGranularity, startDate?: string, endDate?: string, dataset?: string): Promise<{
    video_id: string;
    title: string | null;
    url: string;
    summary: Record<string, unknown>;
    series: Record<string, unknown>[];
    traffic_sources: Record<string, unknown>[];
    traffic_sources_note: string;
    bytesProcessed: string[];
}>;
export {};
