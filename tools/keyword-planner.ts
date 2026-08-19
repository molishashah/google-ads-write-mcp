import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  customerScopedConstant,
  enumName,
  enumValue,
  escapeGaql,
  extractRequestId,
  microsToCurrency,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { formatError, mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import { jsonRecordSchema } from "@/tools/tool-utils";

const NETWORKS = ["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"] as const;
const MATCH_TYPES = ["BROAD", "PHRASE", "EXACT"] as const;
const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

type Network = (typeof NETWORKS)[number];
type MatchType = (typeof MATCH_TYPES)[number];
type Month = (typeof MONTHS)[number];

type HistoricalOptionsInput = {
  start?: { year: number; month: Month };
  end?: { year: number; month: Month };
  include_average_cpc?: boolean;
};

type TargetingInput = {
  language_constant_id?: string;
  geo_target_constant_ids?: string[];
  keyword_plan_network?: Network;
};

export type GenerateKeywordIdeasInput = TargetingInput & {
  customer_id: string;
  keywords?: string[];
  page_url?: string;
  site_url?: string;
  include_adult_keywords?: boolean;
  include_keyword_concepts?: boolean;
  include_device_aggregate_metrics?: boolean;
  historical_metrics?: HistoricalOptionsInput;
  page_size?: number;
  page_token?: string;
  request?: JsonRecord;
};

export type GenerateKeywordHistoricalMetricsInput = TargetingInput & {
  customer_id: string;
  keywords?: string[];
  include_adult_keywords?: boolean;
  include_device_aggregate_metrics?: boolean;
  historical_metrics?: HistoricalOptionsInput;
  request?: JsonRecord;
};

type ForecastBiddingStrategy =
  | {
      type: "MANUAL_CPC";
      max_cpc_bid_micros: number;
      daily_budget_micros?: number;
    }
  | {
      type: "MAXIMIZE_CLICKS";
      daily_target_spend_micros: number;
      max_cpc_bid_ceiling_micros?: number;
    }
  | {
      type: "MAXIMIZE_CONVERSIONS";
      daily_target_spend_micros: number;
    };

export type GenerateKeywordForecastInput = {
  customer_id: string;
  language_constant_ids?: string[];
  geo_target_constant_ids?: string[];
  bidding_strategy?: ForecastBiddingStrategy;
  ad_groups?: Array<{
    keywords: Array<{ text: string; match_type: MatchType }>;
  }>;
  forecast_period?: { start_date: string; end_date: string };
  currency_code?: string;
  request?: JsonRecord;
};

export type GenerateAdGroupThemesInput = {
  customer_id: string;
  keywords?: string[];
  ad_group_ids?: string[];
  request?: JsonRecord;
};

const historicalMetricsSchema = z
  .object({
    start: z
      .object({
        year: z.number().int().min(2000).max(2100),
        month: z.enum(MONTHS),
      })
      .optional(),
    end: z
      .object({
        year: z.number().int().min(2000).max(2100),
        month: z.enum(MONTHS),
      })
      .optional(),
    include_average_cpc: z.boolean().optional(),
  })
  .optional();

const targetingSchema = {
  language_constant_id: z
    .string()
    .optional()
    .describe("Language constant ID or resource name, for example '1000'."),
  geo_target_constant_ids: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Geo target IDs or resource names, for example ['2840']."),
  keyword_plan_network: z.enum(NETWORKS).optional(),
};

export function registerKeywordPlannerTools(server: McpServer) {
  registerGenerateKeywordIdeas(server);
  registerGenerateKeywordHistoricalMetrics(server);
  registerGenerateKeywordForecast(server);
  registerGenerateAdGroupThemes(server);
  registerSuggestGeoTargets(server);
  registerListLanguages(server);
}

function registerGenerateKeywordIdeas(server: McpServer) {
  server.registerTool(
    "generate_keyword_ideas",
    {
      title: "Generate Keyword Ideas",
      description:
        "Generate Google Search keyword ideas from keywords, a page URL, an entire site, or keywords plus a page URL. Returns historical metrics and supports pagination.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keywords: z.array(z.string().min(1)).min(1).max(20).optional(),
        page_url: z.string().url().optional(),
        site_url: z.string().url().optional(),
        ...targetingSchema,
        include_adult_keywords: z.boolean().optional(),
        include_keyword_concepts: z.boolean().optional(),
        include_device_aggregate_metrics: z.boolean().optional(),
        historical_metrics: historicalMetricsSchema,
        page_size: z.number().int().positive().max(10000).optional(),
        page_token: z.string().min(1).optional(),
        request: jsonRecordSchema
          .optional()
          .describe("Raw GenerateKeywordIdeasRequest. Overrides typed fields."),
      },
    },
    async (params) => {
      const tool = "generate_keyword_ideas";
      try {
        const request = buildGenerateKeywordIdeasRequest(params);
        const customer = getAdsClient(params.customer_id);
        const result = await executePlanningRequest(
          params.customer_id,
          tool,
          request,
          1000,
          () => customer.keywordPlanIdeas.generateKeywordIdeas(request as never)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: withNormalized(result, normalizeKeywordIdeasResponse(result)),
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerGenerateKeywordHistoricalMetrics(server: McpServer) {
  server.registerTool(
    "generate_keyword_historical_metrics",
    {
      title: "Generate Keyword Historical Metrics",
      description:
        "Return historical search volume, competition, CPC, bid ranges, monthly volumes, and close variants for known keywords.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keywords: z.array(z.string().min(1)).min(1).max(10000).optional(),
        ...targetingSchema,
        include_adult_keywords: z.boolean().optional(),
        include_device_aggregate_metrics: z.boolean().optional(),
        historical_metrics: historicalMetricsSchema,
        request: jsonRecordSchema
          .optional()
          .describe(
            "Raw GenerateKeywordHistoricalMetricsRequest. Overrides typed fields."
          ),
      },
    },
    async (params) => {
      const tool = "generate_keyword_historical_metrics";
      try {
        const request = buildGenerateKeywordHistoricalMetricsRequest(params);
        const customer = getAdsClient(params.customer_id);
        const result = await executePlanningRequest(
          params.customer_id,
          tool,
          request,
          1000,
          () =>
            customer.keywordPlanIdeas.generateKeywordHistoricalMetrics(
              request as never
            )
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: withNormalized(
            result,
            normalizeKeywordHistoricalMetricsResponse(result)
          ),
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerGenerateKeywordForecast(server: McpServer) {
  const positiveMicros = z.number().int().positive();
  const keywordSchema = z.object({
    text: z.string().min(1),
    match_type: z.enum(MATCH_TYPES),
  });
  const biddingStrategySchema = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("MANUAL_CPC"),
      max_cpc_bid_micros: positiveMicros,
      daily_budget_micros: positiveMicros.optional(),
    }),
    z.object({
      type: z.literal("MAXIMIZE_CLICKS"),
      daily_target_spend_micros: positiveMicros,
      max_cpc_bid_ceiling_micros: positiveMicros.optional(),
    }),
    z.object({
      type: z.literal("MAXIMIZE_CONVERSIONS"),
      daily_target_spend_micros: positiveMicros,
    }),
  ]);

  server.registerTool(
    "generate_keyword_forecast",
    {
      title: "Generate Keyword Forecast",
      description:
        "Forecast campaign-level Google Search performance for proposed ad groups and keywords. Metrics vary by bidding strategy.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        language_constant_ids: z.array(z.string().min(1)).max(20).optional(),
        geo_target_constant_ids: z.array(z.string().min(1)).max(20).optional(),
        bidding_strategy: biddingStrategySchema.optional(),
        ad_groups: z
          .array(
            z.object({
              keywords: z.array(keywordSchema).min(1).max(10000),
            })
          )
          .min(1)
          .max(200)
          .optional(),
        forecast_period: z
          .object({
            start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
          .optional(),
        currency_code: z.string().regex(/^[A-Z]{3}$/).optional(),
        request: jsonRecordSchema
          .optional()
          .describe(
            "Raw GenerateKeywordForecastMetricsRequest. Overrides typed fields."
          ),
      },
    },
    async (params) => {
      const tool = "generate_keyword_forecast";
      try {
        const request = buildGenerateKeywordForecastRequest(params);
        const customer = getAdsClient(params.customer_id);
        const result = await executePlanningRequest(
          params.customer_id,
          tool,
          request,
          1000,
          () =>
            customer.keywordPlanIdeas.generateKeywordForecastMetrics(
              request as never
            )
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: withNormalized(
            result,
            normalizeKeywordForecastResponse(
              result,
              nullableString(request.currency_code) ?? undefined
            )
          ),
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerGenerateAdGroupThemes(server: McpServer) {
  server.registerTool(
    "generate_ad_group_themes",
    {
      title: "Generate Ad Group Themes",
      description:
        "Organize proposed keywords into existing ad groups and return suggested keyword text and match types.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        keywords: z.array(z.string().min(1)).min(1).max(10000).optional(),
        ad_group_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(200)
          .optional()
          .describe("Existing ad group numeric IDs or resource names."),
        request: jsonRecordSchema
          .optional()
          .describe("Raw GenerateAdGroupThemesRequest. Overrides typed fields."),
      },
    },
    async (params) => {
      const tool = "generate_ad_group_themes";
      try {
        const request = buildGenerateAdGroupThemesRequest(params);
        const customer = getAdsClient(params.customer_id);
        const result = await executePlanningRequest(
          params.customer_id,
          tool,
          request,
          500,
          () => customer.keywordPlanIdeas.generateAdGroupThemes(request as never)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: withNormalized(result, normalizeAdGroupThemesResponse(result)),
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerSuggestGeoTargets(server: McpServer) {
  server.registerTool(
    "suggest_keyword_planner_geo_targets",
    {
      title: "Suggest Keyword Planner Geo Targets",
      description:
        "Resolve location names to Google Ads geo target constants suitable for Keyword Planner targeting.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        location_names: z.array(z.string().min(1)).min(1).max(25),
        locale: z.string().min(2).optional().default("en"),
        country_code: z.string().length(2).optional(),
      },
    },
    async (params) => {
      const tool = "suggest_keyword_planner_geo_targets";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.geoTargetConstants.suggestGeoTargetConstants({
          locale: params.locale,
          ...(params.country_code
            ? { country_code: params.country_code.toUpperCase() }
            : {}),
          location_names: { names: params.location_names },
        } as never);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: withNormalized(result, normalizeGeoSuggestions(result)),
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerListLanguages(server: McpServer) {
  server.registerTool(
    "list_keyword_planner_languages",
    {
      title: "List Keyword Planner Languages",
      description:
        "List or search targetable Google Ads language constants for Keyword Planner requests.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        search: z.string().min(1).optional(),
        targetable_only: z.boolean().optional().default(true),
        limit: z.number().int().positive().max(1000).optional().default(1000),
      },
    },
    async (params) => {
      const tool = "list_keyword_planner_languages";
      try {
        const conditions = [
          ...(params.targetable_only
            ? ["language_constant.targetable = TRUE"]
            : []),
          ...(params.search
            ? [
                `language_constant.name LIKE '%${escapeGaql(params.search)}%'`,
              ]
            : []),
        ];
        const query = `SELECT language_constant.resource_name, language_constant.id, language_constant.code, language_constant.name, language_constant.targetable FROM language_constant${
          conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
        } ORDER BY language_constant.name LIMIT ${params.limit}`;
        const customer = getAdsClient(params.customer_id);
        const rows = await customer.query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: {
            query,
            row_count: Array.isArray(rows) ? rows.length : null,
            rows,
          },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

export function buildGenerateKeywordIdeasRequest(
  params: GenerateKeywordIdeasInput
): JsonRecord {
  if (params.request) return { ...params.request, customer_id: params.customer_id };

  const hasKeywords = Boolean(params.keywords?.length);
  const hasPageUrl = Boolean(params.page_url);
  const hasSiteUrl = Boolean(params.site_url);
  if (hasSiteUrl && (hasKeywords || hasPageUrl)) {
    throw new Error("site_url cannot be combined with keywords or page_url.");
  }
  if (!hasKeywords && !hasPageUrl && !hasSiteUrl) {
    throw new Error("Provide keywords, page_url, site_url, or raw request.");
  }

  const request: JsonRecord = {
    customer_id: params.customer_id,
    ...buildTargeting(params),
    include_adult_keywords: params.include_adult_keywords ?? false,
    ...(params.include_keyword_concepts
      ? {
          keyword_annotation: [
            enumValue(enums.KeywordPlanKeywordAnnotation, "KEYWORD_CONCEPT"),
          ],
        }
      : {}),
    ...buildAggregateMetrics(params.include_device_aggregate_metrics),
    ...buildHistoricalOptions(params.historical_metrics),
    ...(params.page_size ? { page_size: params.page_size } : {}),
    ...(params.page_token ? { page_token: params.page_token } : {}),
  };

  if (hasKeywords && hasPageUrl) {
    request.keyword_and_url_seed = {
      keywords: params.keywords,
      url: params.page_url,
    };
  } else if (hasKeywords) {
    request.keyword_seed = { keywords: params.keywords };
  } else if (hasPageUrl) {
    request.url_seed = { url: params.page_url };
  } else {
    request.site_seed = { site: params.site_url };
  }
  return request;
}

export function buildGenerateKeywordHistoricalMetricsRequest(
  params: GenerateKeywordHistoricalMetricsInput
): JsonRecord {
  if (params.request) return { ...params.request, customer_id: params.customer_id };
  if (!params.keywords?.length) {
    throw new Error("Provide at least one keyword or a raw request.");
  }
  return {
    customer_id: params.customer_id,
    keywords: params.keywords,
    ...buildTargeting(params),
    include_adult_keywords: params.include_adult_keywords ?? false,
    ...buildAggregateMetrics(params.include_device_aggregate_metrics),
    ...buildHistoricalOptions(params.historical_metrics),
  };
}

export function buildGenerateKeywordForecastRequest(
  params: GenerateKeywordForecastInput,
  now = new Date()
): JsonRecord {
  if (params.request) return { ...params.request, customer_id: params.customer_id };
  if (!params.bidding_strategy) {
    throw new Error("bidding_strategy is required unless raw request is provided.");
  }
  if (!params.ad_groups?.length) {
    throw new Error("Provide at least one ad group unless raw request is provided.");
  }
  const keywordCount = params.ad_groups.reduce(
    (total, group) => total + group.keywords.length,
    0
  );
  if (keywordCount > 10000) {
    throw new Error("A forecast can contain at most 10,000 keywords.");
  }
  if (params.forecast_period) validateForecastPeriod(params.forecast_period, now);

  return {
    customer_id: params.customer_id,
    ...(params.currency_code ? { currency_code: params.currency_code } : {}),
    ...(params.forecast_period
      ? { forecast_period: params.forecast_period }
      : {}),
    campaign: {
      language_constants: (params.language_constant_ids ?? []).map((id) =>
        customerScopedConstant("languageConstants", id)
      ),
      geo_target_constants: (params.geo_target_constant_ids ?? []).map((id) =>
        customerScopedConstant("geoTargetConstants", id)
      ),
      bidding_strategy: buildForecastBiddingStrategy(params.bidding_strategy),
      ad_groups: params.ad_groups.map((group) => ({
        keywords: group.keywords.map((keyword) => ({
          text: keyword.text,
          match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
        })),
      })),
    },
  };
}

export function buildGenerateAdGroupThemesRequest(
  params: GenerateAdGroupThemesInput
): JsonRecord {
  if (params.request) return { ...params.request, customer_id: params.customer_id };
  if (!params.keywords?.length || !params.ad_group_ids?.length) {
    throw new Error(
      "Provide at least one keyword and one ad_group_id, or a raw request."
    );
  }
  return {
    customer_id: params.customer_id,
    keywords: params.keywords,
    ad_groups: params.ad_group_ids.map((id) =>
      id.startsWith("customers/")
        ? id
        : `customers/${params.customer_id}/adGroups/${id}`
    ),
  };
}

function buildTargeting(params: TargetingInput): JsonRecord {
  return {
    ...(params.language_constant_id
      ? {
          language: customerScopedConstant(
            "languageConstants",
            params.language_constant_id
          ),
        }
      : {}),
    ...(params.geo_target_constant_ids?.length
      ? {
          geo_target_constants: params.geo_target_constant_ids.map((id) =>
            customerScopedConstant("geoTargetConstants", id)
          ),
        }
      : {}),
    keyword_plan_network: enumValue(
      enums.KeywordPlanNetwork,
      params.keyword_plan_network ?? "GOOGLE_SEARCH"
    ),
  };
}

function buildAggregateMetrics(includeDevice?: boolean): JsonRecord {
  return includeDevice
    ? {
        aggregate_metrics: {
          aggregate_metric_types: [
            enumValue(enums.KeywordPlanAggregateMetricType, "DEVICE"),
          ],
        },
      }
    : {};
}

function buildHistoricalOptions(
  options?: HistoricalOptionsInput
): JsonRecord {
  if (!options) return {};
  if (Boolean(options.start) !== Boolean(options.end)) {
    throw new Error("Historical metrics start and end must be provided together.");
  }
  if (options.start && options.end) {
    const start = options.start.year * 100 + MONTHS.indexOf(options.start.month);
    const end = options.end.year * 100 + MONTHS.indexOf(options.end.month);
    if (start > end) {
      throw new Error("Historical metrics start must be before or equal to end.");
    }
  }
  return {
    historical_metrics_options: {
      ...(options.start && options.end
        ? {
            year_month_range: {
              start: {
                year: options.start.year,
                month: enumValue(enums.MonthOfYear, options.start.month),
              },
              end: {
                year: options.end.year,
                month: enumValue(enums.MonthOfYear, options.end.month),
              },
            },
          }
        : {}),
      include_average_cpc: options.include_average_cpc ?? false,
    },
  };
}

function buildForecastBiddingStrategy(
  strategy: ForecastBiddingStrategy
): JsonRecord {
  if (strategy.type === "MANUAL_CPC") {
    return {
      manual_cpc_bidding_strategy: {
        max_cpc_bid_micros: strategy.max_cpc_bid_micros,
        ...(strategy.daily_budget_micros
          ? { daily_budget_micros: strategy.daily_budget_micros }
          : {}),
      },
    };
  }
  if (strategy.type === "MAXIMIZE_CLICKS") {
    return {
      maximize_clicks_bidding_strategy: {
        daily_target_spend_micros: strategy.daily_target_spend_micros,
        ...(strategy.max_cpc_bid_ceiling_micros
          ? {
              max_cpc_bid_ceiling_micros:
                strategy.max_cpc_bid_ceiling_micros,
            }
          : {}),
      },
    };
  }
  return {
    maximize_conversions_bidding_strategy: {
      daily_target_spend_micros: strategy.daily_target_spend_micros,
    },
  };
}

function validateForecastPeriod(
  period: { start_date: string; end_date: string },
  now: Date
) {
  const start = parseDate(period.start_date, "start_date");
  const end = parseDate(period.end_date, "end_date");
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (start <= today) throw new Error("Forecast start_date must be in the future.");
  if (end < start) throw new Error("Forecast end_date must be on or after start_date.");
  const oneYearFromToday = new Date(today);
  oneYearFromToday.setUTCFullYear(oneYearFromToday.getUTCFullYear() + 1);
  if (end > oneYearFromToday.getTime()) {
    throw new Error("Forecast end_date must be within one year from today.");
  }
}

function parseDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD format.`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid calendar date.`);
  }
  return parsed;
}

export function normalizeKeywordIdeasResponse(value: unknown) {
  const response = record(value);
  const items = array(response.results).map((item) => {
    const row = record(item);
    return {
      text: nullableString(row.text),
      close_variants: array(row.close_variants),
      metrics: normalizeHistoricalMetrics(row.keyword_idea_metrics),
      keyword_annotations: row.keyword_annotations ?? null,
    };
  });
  return {
    item_count: items.length,
    total_size: nullableNumber(response.total_size),
    next_page_token: nullableString(response.next_page_token),
    aggregate_metric_results: response.aggregate_metric_results ?? null,
    items,
  };
}

export function normalizeKeywordHistoricalMetricsResponse(value: unknown) {
  const response = record(value);
  const items = array(response.results).map((item) => {
    const row = record(item);
    return {
      text: nullableString(row.text),
      close_variants: array(row.close_variants),
      metrics: normalizeHistoricalMetrics(row.keyword_metrics),
    };
  });
  return {
    item_count: items.length,
    aggregate_metric_results: response.aggregate_metric_results ?? null,
    items,
  };
}

export function normalizeKeywordForecastResponse(
  value: unknown,
  currencyCode?: string
) {
  const response = record(value);
  const metrics = record(response.campaign_forecast_metrics);
  return {
    scope: "CAMPAIGN",
    currency_code: currencyCode ?? null,
    metrics: {
      clicks: nullableNumber(metrics.clicks),
      conversions: nullableNumber(metrics.conversions),
      average_cpc_micros: nullableNumber(metrics.average_cpc_micros),
      average_cpc: nullableMicros(metrics.average_cpc_micros),
      cost_micros: nullableNumber(metrics.cost_micros),
      cost: nullableMicros(metrics.cost_micros),
      average_cpa_micros: nullableNumber(metrics.average_cpa_micros),
      average_cpa: nullableMicros(metrics.average_cpa_micros),
    },
  };
}

export function normalizeAdGroupThemesResponse(value: unknown) {
  const response = record(value);
  const suggestions = array(response.ad_group_keyword_suggestions).map((item) => {
    const suggestion = record(item);
    return {
      keyword_text: nullableString(suggestion.keyword_text),
      suggested_keyword_text: nullableString(suggestion.suggested_keyword_text),
      suggested_match_type: enumName(
        enums.KeywordMatchType,
        suggestion.suggested_match_type
      ),
      suggested_ad_group: nullableString(suggestion.suggested_ad_group),
      suggested_campaign: nullableString(suggestion.suggested_campaign),
    };
  });
  const unusableAdGroups = array(response.unusable_ad_groups);
  return {
    suggestion_count: suggestions.length,
    unusable_ad_group_count: unusableAdGroups.length,
    suggestions,
    unusable_ad_groups: unusableAdGroups,
  };
}

function normalizeGeoSuggestions(value: unknown) {
  const response = record(value);
  const suggestions = array(response.geo_target_constant_suggestions).map(
    (item) => {
      const suggestion = record(item);
      const geo = record(suggestion.geo_target_constant);
      return {
        search_term: nullableString(suggestion.search_term),
        locale: nullableString(suggestion.locale),
        reach: nullableNumber(suggestion.reach),
        resource_name: nullableString(geo.resource_name),
        id: nullableNumber(geo.id),
        name: nullableString(geo.name),
        country_code: nullableString(geo.country_code),
        target_type: nullableString(geo.target_type),
        status: enumName(enums.GeoTargetConstantStatus, geo.status),
        parents: suggestion.geo_target_constant_parents ?? [],
      };
    }
  );
  return { suggestion_count: suggestions.length, suggestions };
}

function normalizeHistoricalMetrics(value: unknown) {
  const metrics = record(value);
  return {
    avg_monthly_searches: nullableNumber(metrics.avg_monthly_searches),
    competition: enumName(
      enums.KeywordPlanCompetitionLevel,
      metrics.competition
    ),
    competition_index: nullableNumber(metrics.competition_index),
    low_top_of_page_bid_micros: nullableNumber(
      metrics.low_top_of_page_bid_micros
    ),
    low_top_of_page_bid: nullableMicros(metrics.low_top_of_page_bid_micros),
    high_top_of_page_bid_micros: nullableNumber(
      metrics.high_top_of_page_bid_micros
    ),
    high_top_of_page_bid: nullableMicros(metrics.high_top_of_page_bid_micros),
    average_cpc_micros: nullableNumber(metrics.average_cpc_micros),
    average_cpc: nullableMicros(metrics.average_cpc_micros),
    monthly_search_volumes: array(metrics.monthly_search_volumes).map((item) => {
      const month = record(item);
      return {
        year: nullableNumber(month.year),
        month: enumName(enums.MonthOfYear, month.month),
        monthly_searches: nullableNumber(month.monthly_searches),
      };
    }),
  };
}

function withNormalized(raw: unknown, normalized: unknown) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as JsonRecord), normalized };
  }
  return { raw, normalized };
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableMicros(value: unknown): number | null {
  const number = nullableNumber(value);
  return number === null ? null : microsToCurrency(number);
}

const planningQueues = new Map<string, Promise<void>>();
const planningLastStart = new Map<string, number>();
const planningInFlight = new Map<string, Promise<unknown>>();

async function executePlanningRequest<T>(
  customerId: string,
  method: string,
  request: JsonRecord,
  minimumIntervalMs: number,
  operation: () => Promise<T>
): Promise<T> {
  const inFlightKey = `${customerId}:${method}:${JSON.stringify(request)}`;
  const existing = planningInFlight.get(inFlightKey);
  if (existing) return existing as Promise<T>;

  const run = (async () => {
    await acquirePlanningSlot(`${customerId}:${method}`, minimumIntervalMs);
    try {
      return await operation();
    } catch (err) {
      if (!isResourceExhausted(err)) throw err;
      await acquirePlanningSlot(`${customerId}:${method}`, minimumIntervalMs + 200);
      return operation();
    }
  })();
  planningInFlight.set(inFlightKey, run);
  try {
    return await run;
  } finally {
    planningInFlight.delete(inFlightKey);
  }
}

async function acquirePlanningSlot(key: string, minimumIntervalMs: number) {
  const prior = planningQueues.get(key) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(async () => {
    const waitMs = Math.max(
      0,
      minimumIntervalMs - (Date.now() - (planningLastStart.get(key) ?? 0))
    );
    if (waitMs) await delay(waitMs);
    planningLastStart.set(key, Date.now());
  });
  planningQueues.set(key, next);
  await next;
}

function isResourceExhausted(err: unknown) {
  const message = formatError(err).toUpperCase();
  if (
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("RESOURCE_TEMPORARILY_EXHAUSTED")
  ) {
    return true;
  }
  if (!err || typeof err !== "object") return false;
  const errors = (err as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((error) => {
    const quotaError = record(record(error).error_code).quota_error;
    return quotaError === 2 || quotaError === 4;
  });
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
