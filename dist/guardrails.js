"use strict";
/**
 * Hallucination guardrails for BigQuery MCP server.
 *
 * These ensure Claude sticks to the data returned by BigQuery
 * and does not speculate about causes, invent numbers, or fill gaps
 * with assumptions from its training data.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.YOUTUBE_SOURCE = exports.POSITION_CAVEAT = exports.VISUAL_SUFFIX = exports.GUARDRAIL_SUFFIX = void 0;
exports.withMeta = withMeta;
exports.GUARDRAIL_SUFFIX = " IMPORTANT: Base your analysis ONLY on the data returned. Report exact numbers from the results. Do not speculate about causes (e.g. algorithm updates, competitor actions) unless the data explicitly supports it. If the data does not contain enough information to answer a question, say so clearly rather than guessing.";
exports.VISUAL_SUFFIX = " PRESENTATION: Always present these results as a rich, interactive visualization using artifacts. Use summary cards for key metrics, colour-coded indicators for severity or change direction (green for positive, red for negative), bar charts or sparklines for comparisons, and tabbed sections to organise different categories of results. Make the output visually scannable and dashboard-like rather than plain text or raw tables.";
exports.POSITION_CAVEAT = " POSITION: avg_position is an impression-weighted average over real impressions, blended across queries, devices and countries. It is not a rank-tracker rank. Deep positions are only recorded when a user actually reaches that part of the results, so values beyond page one rest on sparse data. Treat absolute positions as directional and prefer position deltas between periods when judging change.";
const GSC_SOURCE = {
    source: "Google BigQuery (GSC bulk export data)",
    note: "All numbers in this response come directly from BigQuery. They are exact values from the GSC bulk data export, not estimates. Base your analysis only on this data. Do not invent or assume additional context.",
};
exports.YOUTUBE_SOURCE = {
    source: "Google BigQuery (YouTube channel data: BigQuery Data Transfer reports, earlier days from a one-off YouTube Analytics API history)",
    note: "All numbers in this response come directly from BigQuery. Days and dates follow YouTube's Pacific time. The data has no revenue - YouTube channel reports do not contain it. The field herkunft/source says whether a day comes from the transfer reports (reporting_api) or the history (analytics_api). Base your analysis only on this data. Do not invent or assume additional context.",
};
function withMeta(data, toolName, params, origin = GSC_SOURCE) {
    return {
        _meta: {
            source: origin.source,
            tool: toolName,
            parameters: params,
            note: origin.note,
        },
        data,
    };
}
