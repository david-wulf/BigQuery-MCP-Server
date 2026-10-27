# CLAUDE.md — BigQuery-MCP-Server

## Zweck
MCP-Server für Google BigQuery mit SEO-Analysen auf dem GSC-Bulk-Export (und GA4-Export). Fork von `Suganthan-Mohanadasan/Suganthans-BigQuery-MCP-Server`, Fork-Version 4.4.0 auf Basis upstream v4.1.1, 43 Tools.

## Aufbau
- Einstieg: `src/index.ts` — `McpServer`, alle Tools per `server.registerTool()` (zod-`inputSchema`)
- Tool-Logik: je Tool eine Datei in `src/tools/` (`gsc-*.ts`, `ga4-gsc-*.ts`, `query.ts`, `list-*.ts` …); gemeinsame Helfer `gsc-shared.ts`, `ga4-shared.ts`, `url-normalise.ts`
- `src/client.ts` — BigQuery-Client, Config aus Env, Location pro Dataset
- `src/guardrails.ts` — `GUARDRAIL_SUFFIX`, `VISUAL_SUFFIX`, `POSITION_CAVEAT`, `withMeta()`
- `query.ts` — `sanitiseSQL()` (nur SELECT, kein Multi-Statement), `maximumBytesBilled` 10 GB (ML: 50 GB), `dryRunQuery()`
- Herkunft/Git:
  - Remotes: `origin` = `david-wulf/BigQuery-MCP-Server`, `hs` = `homeandsmart-gmbh/bigquery-mcp-server`, `upstream` = Suganthan
  - Eigene Anpassungen (README-Kopf): 5 Zusatz-Tools (`gsc_query_count`, `gsc_discover`, `gsc_shopping`, `gsc_image_search`, `gsc_click_curve`), CTR gegen eigene Klickkurve, device-/country-Filter; SDK 1.30 + `registerTool`-Migration
  - Upstream ziehen: `git fetch upstream && git checkout -b merge-upstream-vX && git merge upstream/main`, dann nach `main` mergen (Muster: `22dee8c`); README-Fork-Hinweis nachziehen

## Tools
- Basis: `query` (lesend, **kostenpflichtig** nach gescannten Bytes), `query_cost_estimate` (Dry-Run, kostenlos), `list_datasets`, `list_tables`, `describe_table`, `sample_rows` (lesend, `sample_rows` scannt Bytes)
- GSC-Analysen (lesend, kostenpflichtig je Scan): `gsc_quick_wins`, `gsc_ctr_opportunities`, `gsc_content_gaps`, `gsc_site_snapshot`, `gsc_content_decay`, `gsc_cannibalisation`, `gsc_traffic_drops`, `gsc_topic_cluster`, `gsc_ctr_benchmark`, `gsc_alerts`, `gsc_content_recommendations`, `gsc_report`, `gsc_anonymous_traffic`, `gsc_seasonal`, `gsc_device_split`, `gsc_intent_breakdown`, `gsc_ngrams`, `gsc_new_keywords`, `gsc_genai_conversation_queries`, `gsc_query_count`, `gsc_discover`, `gsc_click_curve`, `gsc_shopping`, `gsc_image_search`
- ML (**schreibend + kostenpflichtig**: `CREATE OR REPLACE MODEL` im Dataset): `gsc_forecast`, `gsc_anomalies`
- GA4 × GSC (lesend, kostenpflichtig): `ga4_gsc_page_performance`, `ga4_gsc_query_revenue`, `ga4_gsc_content_roi`, `ga4_gsc_snippet_mismatch`, `ga4_gsc_position_value`, `ga4_gsc_branded_performance`
- YouTube (lesend, kostenpflichtig je Scan, Dataset winzig): `youtube_channel_trend`, `youtube_top_videos`, `youtube_traffic_sources`, `youtube_audience`, `youtube_video_detail` — alle in `src/tools/youtube.ts`, lesen nur die Sichten `v_*` im Dataset `youtube_channel` (Definition im Repo `data-warehouse`, `db/bigquery/youtube_channel.sql`). `youtube_top_videos`/`youtube_video_detail` holen Titel über den öffentlichen oEmbed-Endpunkt (ohne Schlüssel). Kein Umsatz: die Kanalberichte enthalten keinen

## Lokal starten & prüfen
```bash
npm install
npm run build        # tsc -> dist/
npm start            # node dist/index.js
```
Keine Tests/Lint im Repo; `npm run build` ist die Typprüfung.

## Einbindung in Claude
Als `bigquery` in `%APPDATA%\Claude\claude_desktop_config.json`: `node C:/Users/david/Claude-Code-Projekte/BigQuery-MCP-Server/dist/index.js`. In `~/.claude.json` nicht registriert. Nach Änderungen `npm run build`, Claude neu starten.

## Konfiguration
`BIGQUERY_KEY_FILE` (oder `GOOGLE_APPLICATION_CREDENTIALS`), `BIGQUERY_PROJECT_ID`, `BIGQUERY_DEFAULT_DATASET`, `BIGQUERY_LOCATION` (Standard `US`), `BIGQUERY_GA4_DATASET`, `BIGQUERY_YOUTUBE_DATASET` (Standard `youtube_channel`), optional `BIGQUERY_GA4_PROJECT`, `BIGQUERY_GA4_LOCATION`, `BIGQUERY_DATASET_LOCATIONS`

## Neues Tool hinzufügen
1. `src/tools/<name>.ts` mit exportierter async-Funktion; SQL über die Helfer in `gsc-shared.ts`/`query.ts`, nie eigener Client
2. In `src/index.ts` importieren und `server.registerTool("<name>", { description: "…" + GUARDRAIL_SUFFIX (+ VISUAL_SUFFIX, + POSITION_CAVEAT bei Positionen), inputSchema: { … zod … } }, async (args) => …)` — Ergebnis in `withMeta()` wickeln, Fehler über `errorResponse()` (Muster: `gsc_quick_wins`)
3. Tool-Zahl in README-Einleitung und Fork-Hinweis anpassen, `npm run build`

## Grenzen
- Key-Datei nie öffnen, ausgeben oder committen.
- Query-Kosten: vor neuen/großen Abfragen `query_cost_estimate`; Live-Läufe nur mit Davids Freigabe. `gsc_forecast`/`gsc_anomalies` legen Modelle an — nur auf ausdrückliche Anfrage.
- Die Sperren in `sanitiseSQL()` und `maximumBytesBilled` nicht lockern.
