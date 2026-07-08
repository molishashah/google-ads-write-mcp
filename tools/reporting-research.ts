import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  buildGaqlQuery,
  extractRequestId,
  summarizeMetricRows,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import { jsonRecordSchema } from "@/tools/tool-utils";

export function registerReportingAndResearchTools(server: McpServer) {
  registerReportTools(server);
  registerKeywordPlanningTools(server);
  registerRecommendationTools(server);
  registerAllowlistInsightTools(server);
}

function registerReportTools(server: McpServer) {
  for (const template of REPORTS) {
    server.registerTool(
      template.name,
      {
        title: template.title,
        description: template.description,
        inputSchema: {
          customer_id: z.string(),
          date_range: z.string().optional().default(template.defaultDateRange),
          conditions: z.array(z.string()).optional(),
          orderings: z.array(z.string()).optional(),
          limit: z.number().int().positive().max(100000).optional(),
        },
      },
      async (params) => {
        const tool = template.name;
        try {
          const customer = getAdsClient(params.customer_id);
          const defaultDateCondition = template.dateField
            ? [`${template.dateField} DURING ${params.date_range}`]
            : [];
          const query = buildGaqlQuery({
            fields: template.fields,
            resource: template.resource,
            conditions: [...defaultDateCondition, ...(params.conditions ?? [])],
            orderings: params.orderings ?? template.orderings,
            limit: params.limit ?? template.limit,
          });
          const rows = await customer.query(query);
          return mcpSuccess({
            tool,
            customer_id: params.customer_id,
            results: {
              query,
              row_count: Array.isArray(rows) ? rows.length : null,
              summary: Array.isArray(rows) ? summarizeMetricRows(rows) : null,
              rows,
            },
          });
        } catch (err) {
          return mcpJsonError(tool, err, { customer_id: params.customer_id });
        }
      }
    );
  }
}

function registerKeywordPlanningTools(server: McpServer) {
  registerRpcTool(
    server,
    "generate_keyword_ideas",
    "keywordPlanIdeas",
    "generateKeywordIdeas",
    "Generate keyword ideas with KeywordPlanIdeaService."
  );
  registerRpcTool(
    server,
    "generate_keyword_historical_metrics",
    "keywordPlanIdeas",
    "generateKeywordHistoricalMetrics",
    "Generate keyword historical metrics."
  );
  registerRpcTool(
    server,
    "generate_keyword_forecast",
    "keywordPlanIdeas",
    "generateKeywordForecastMetrics",
    "Generate keyword forecast metrics."
  );
  registerRpcTool(
    server,
    "generate_ad_group_themes",
    "keywordPlanIdeas",
    "generateAdGroupThemes",
    "Generate ad group themes."
  );
}

function registerRecommendationTools(server: McpServer) {
  server.registerTool(
    "list_recommendations",
    {
      title: "List Recommendations",
      description: "List current recommendations with impact and type.",
      inputSchema: {
        customer_id: z.string(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_recommendations";
      try {
        const customer = getAdsClient(params.customer_id);
        const query = `
          SELECT
            recommendation.resource_name,
            recommendation.type,
            recommendation.impact.base_metrics.impressions,
            recommendation.impact.base_metrics.clicks,
            recommendation.impact.base_metrics.cost_micros,
            recommendation.impact.potential_metrics.impressions,
            recommendation.impact.potential_metrics.clicks,
            recommendation.impact.potential_metrics.cost_micros
          FROM recommendation
          LIMIT ${params.limit ?? 1000}`;
        const rows = await customer.query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
  registerRpcTool(
    server,
    "generate_recommendations",
    "recommendations",
    "generateRecommendations",
    "Generate recommendations on demand."
  );
  registerRpcTool(
    server,
    "apply_recommendation",
    "recommendations",
    "applyRecommendation",
    "Apply recommendations."
  );
  registerRpcTool(
    server,
    "dismiss_recommendation",
    "recommendations",
    "dismissRecommendation",
    "Dismiss recommendations."
  );
}

function registerAllowlistInsightTools(server: McpServer) {
  registerRpcTool(
    server,
    "generate_audience_insights",
    "audienceInsights",
    "generateInsightsFinderReport",
    "Generate audience insights. This Google API may require allowlisting.",
    true
  );
  registerRpcTool(
    server,
    "generate_creator_insights",
    "contentCreatorInsights",
    "generateCreatorInsights",
    "Generate creator insights. This Google API may require allowlisting.",
    true
  );
  registerRpcTool(
    server,
    "generate_trending_insights",
    "contentCreatorInsights",
    "generateTrendingInsights",
    "Generate trending insights. This Google API may require allowlisting.",
    true
  );
  registerRpcTool(
    server,
    "generate_reach_forecast",
    "reachPlans",
    "generateReachForecast",
    "Generate reach forecasts. This Google API may require allowlisting.",
    true
  );
}

function registerRpcTool(
  server: McpServer,
  toolName: string,
  serviceName: string,
  methodName: string,
  description: string,
  allowlistAware = false
) {
  server.registerTool(
    toolName,
    {
      title: toolName
        .split("_")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" "),
      description,
      inputSchema: {
        customer_id: z.string(),
        request: jsonRecordSchema.describe("Raw Google Ads API request object."),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const service = (customer as unknown as Record<string, Record<string, unknown>>)[
          serviceName
        ];
        const fn = service?.[methodName];
        if (typeof fn !== "function") {
          throw new Error(`${serviceName}.${methodName} is not available`);
        }
        const result = await fn.call(service, {
          customer_id: params.customer_id,
          ...params.request,
        });
        return mcpSuccess({
          tool: toolName,
          customer_id: params.customer_id,
          warnings: allowlistAware
            ? ["This endpoint may require Google allowlisting for the customer or developer token."]
            : undefined,
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(toolName, err, {
          customer_id: params.customer_id,
          warnings: allowlistAware
            ? ["If this is an authorization/allowlist error, request access from Google before retrying."]
            : undefined,
        });
      }
    }
  );
}

const BASE_METRICS = [
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.ctr",
  "metrics.average_cpc",
];

const REPORTS = [
  {
    name: "account_overview_report",
    title: "Account Overview Report",
    description: "Account-level spend, traffic, and conversion overview.",
    resource: "customer",
    fields: ["customer.id", "customer.descriptive_name", "customer.currency_code", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "campaign_report",
    title: "Campaign Report",
    description: "Campaign performance report.",
    resource: "campaign",
    fields: [
      "campaign.resource_name",
      "campaign.name",
      "campaign.status",
      "campaign.advertising_channel_type",
      ...BASE_METRICS,
    ],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    orderings: ["metrics.cost_micros DESC"],
    limit: 1000,
  },
  {
    name: "ad_group_report",
    title: "Ad Group Report",
    description: "Ad group performance report.",
    resource: "ad_group",
    fields: ["campaign.name", "ad_group.resource_name", "ad_group.name", "ad_group.status", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    orderings: ["metrics.cost_micros DESC"],
    limit: 1000,
  },
  {
    name: "keyword_report",
    title: "Keyword Report",
    description: "Keyword performance report.",
    resource: "keyword_view",
    fields: [
      "campaign.name",
      "ad_group.name",
      "ad_group_criterion.resource_name",
      "ad_group_criterion.keyword.text",
      "ad_group_criterion.keyword.match_type",
      "ad_group_criterion.status",
      ...BASE_METRICS,
    ],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    orderings: ["metrics.cost_micros DESC"],
    limit: 1000,
  },
  {
    name: "search_terms_report",
    title: "Search Terms Report",
    description: "Search term performance report.",
    resource: "search_term_view",
    fields: ["campaign.name", "ad_group.name", "search_term_view.search_term", "search_term_view.status", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    orderings: ["metrics.cost_micros DESC"],
    limit: 1000,
  },
  {
    name: "ads_report",
    title: "Ads Report",
    description: "Ad performance report.",
    resource: "ad_group_ad",
    fields: [
      "campaign.name",
      "ad_group.name",
      "ad_group_ad.resource_name",
      "ad_group_ad.status",
      "ad_group_ad.ad.id",
      "ad_group_ad.ad.type",
      ...BASE_METRICS,
    ],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    orderings: ["metrics.cost_micros DESC"],
    limit: 1000,
  },
  {
    name: "rsa_asset_report",
    title: "RSA Asset Report",
    description: "Responsive Search Ad asset performance labels.",
    resource: "ad_group_ad_asset_view",
    fields: [
      "campaign.name",
      "ad_group.name",
      "ad_group_ad_asset_view.field_type",
      "ad_group_ad_asset_view.performance_label",
      "asset.text_asset.text",
      ...BASE_METRICS,
    ],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "asset_performance_report",
    title: "Asset Performance Report",
    description: "Asset performance by field type.",
    resource: "asset_field_type_view",
    fields: ["asset.resource_name", "asset.type", "asset_field_type_view.field_type", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "landing_page_report",
    title: "Landing Page Report",
    description: "Landing page performance report.",
    resource: "landing_page_view",
    fields: ["landing_page_view.unexpanded_final_url", "segments.device", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    orderings: ["metrics.cost_micros DESC"],
    limit: 1000,
  },
  {
    name: "geo_report",
    title: "Geo Report",
    description: "Geographic performance report.",
    resource: "geographic_view",
    fields: ["geographic_view.country_criterion_id", "segments.geo_target_region", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "device_report",
    title: "Device Report",
    description: "Device performance report.",
    resource: "campaign",
    fields: ["campaign.name", "segments.device", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "hourly_report",
    title: "Hourly Report",
    description: "Day-of-week and hour performance report.",
    resource: "campaign",
    fields: ["campaign.name", "segments.day_of_week", "segments.hour", ...BASE_METRICS],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "conversion_report",
    title: "Conversion Report",
    description: "Conversion action performance report.",
    resource: "conversion_action",
    fields: [
      "conversion_action.resource_name",
      "conversion_action.name",
      "conversion_action.status",
      "conversion_action.type",
      "conversion_action.category",
      "conversion_action.primary_for_goal",
      "metrics.conversions",
      "metrics.conversions_value",
    ],
    dateField: "segments.date",
    defaultDateRange: "LAST_30_DAYS",
    limit: 1000,
  },
  {
    name: "change_history_report",
    title: "Change History Report",
    description: "Recent change history report.",
    resource: "change_event",
    fields: [
      "change_event.resource_name",
      "change_event.change_date_time",
      "change_event.change_resource_type",
      "change_event.client_type",
      "change_event.user_email",
      "change_event.resource_change_operation",
    ],
    dateField: "change_event.change_date_time",
    defaultDateRange: "LAST_14_DAYS",
    orderings: ["change_event.change_date_time DESC"],
    limit: 1000,
  },
] satisfies Array<{
  name: string;
  title: string;
  description: string;
  resource: string;
  fields: string[];
  dateField?: string;
  defaultDateRange: string;
  orderings?: string[];
  limit?: number;
}>;
