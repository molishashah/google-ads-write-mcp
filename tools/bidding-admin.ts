import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, toMicros } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  enumValue,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
  toResourceName,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import {
  buildSearchCampaignBiddingStrategy,
  TARGET_IMPRESSION_SHARE_LOCATIONS,
  type TargetImpressionShareLocation,
} from "@/tools/campaign-bidding";
import {
  jsonRecordSchema,
  mutateOptionSchema,
  mutateOptions,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

const PORTFOLIO_STRATEGIES = [
  "MAXIMIZE_CLICKS",
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_CPA",
  "TARGET_ROAS",
  "TARGET_IMPRESSION_SHARE",
  "ENHANCED_CPC",
] as const;

type PortfolioBiddingInput = {
  name: string;
  strategy: (typeof PORTFOLIO_STRATEGIES)[number];
  cpc_bid_ceiling?: number;
  cpc_bid_floor?: number;
  target_cpa?: number;
  target_roas?: number;
  target_impression_share_location?: TargetImpressionShareLocation;
  target_impression_share_percentage?: number;
  fields?: JsonRecord;
};

type SmartBiddingEventInput = {
  customer_id: string;
  name: string;
  start_date_time: string;
  end_date_time: string;
  scope?: "CUSTOMER" | "CAMPAIGN" | "CHANNEL";
  campaign_ids?: string[];
  advertising_channel_types?: Array<
    "SEARCH" | "DISPLAY" | "SHOPPING" | "PERFORMANCE_MAX" | "DEMAND_GEN"
  >;
  devices?: Array<"MOBILE" | "TABLET" | "DESKTOP">;
  description?: string;
  fields?: JsonRecord;
};

export function registerBiddingAdminTools(server: McpServer) {
  registerBiddingStrategyTools(server);
  registerCampaignBudgetReadTools(server);
  registerSmartBiddingEventTools(server);
}

function registerBiddingStrategyTools(server: McpServer) {
  server.registerTool(
    "list_bidding_strategies",
    {
      title: "List Portfolio Bidding Strategies",
      description: "List portfolio bidding strategies and their effective targets.",
      inputSchema: {
        customer_id: z.string(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_bidding_strategies";
      try {
        const customer = getAdsClient(params.customer_id);
        const where = params.include_removed
          ? ""
          : "WHERE bidding_strategy.status != REMOVED";
        const query = `
          SELECT
            bidding_strategy.resource_name,
            bidding_strategy.id,
            bidding_strategy.name,
            bidding_strategy.status,
            bidding_strategy.type,
            bidding_strategy.currency_code,
            bidding_strategy.effective_currency_code,
            bidding_strategy.aligned_campaign_budget_id,
            bidding_strategy.campaign_count,
            bidding_strategy.non_removed_campaign_count,
            bidding_strategy.maximize_conversions.target_cpa_micros,
            bidding_strategy.maximize_conversion_value.target_roas,
            bidding_strategy.target_cpa.target_cpa_micros,
            bidding_strategy.target_roas.target_roas,
            bidding_strategy.target_spend.cpc_bid_ceiling_micros,
            bidding_strategy.target_impression_share.location,
            bidding_strategy.target_impression_share.location_fraction_micros,
            bidding_strategy.target_impression_share.cpc_bid_ceiling_micros
          FROM bidding_strategy
          ${where}
          ORDER BY bidding_strategy.name
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

  server.registerTool(
    "create_portfolio_bidding_strategy",
    {
      title: "Create Portfolio Bidding Strategy",
      description:
        "Create a typed portfolio strategy for use across eligible campaigns.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        strategy: z.enum(PORTFOLIO_STRATEGIES),
        cpc_bid_ceiling: z.number().positive().optional(),
        cpc_bid_floor: z.number().positive().optional(),
        target_cpa: z.number().positive().optional(),
        target_roas: z.number().positive().optional(),
        target_impression_share_location: z
          .enum(TARGET_IMPRESSION_SHARE_LOCATIONS)
          .optional(),
        target_impression_share_percentage: z
          .number()
          .positive()
          .max(100)
          .optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_portfolio_bidding_strategy";
      try {
        const customer = getAdsClient(params.customer_id);
        const resource = buildPortfolioBiddingStrategy(params);
        const result = await customer.biddingStrategies.create(
          [resource] as never[],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: { resource, response: result },
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
          validate_only: params.validate_only,
        });
      }
    }
  );

  registerCollectionMutateTool({
    server,
    name: "update_portfolio_bidding_strategy",
    title: "Update Portfolio Bidding Strategy",
    description: "Update mutable portfolio bidding strategy fields.",
    collection: "biddingStrategies",
    action: "update",
    resourceLabel: "Portfolio bidding strategy",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_portfolio_bidding_strategy",
    title: "Remove Portfolio Bidding Strategy",
    description: "Remove portfolio bidding strategies by resource name.",
    collection: "biddingStrategies",
    action: "remove",
    resourceLabel: "Portfolio bidding strategy",
  });
}

export function buildPortfolioBiddingStrategy(params: PortfolioBiddingInput) {
  const limits = {
    ...(params.cpc_bid_ceiling != null
      ? { cpc_bid_ceiling_micros: toMicros(params.cpc_bid_ceiling) }
      : {}),
    ...(params.cpc_bid_floor != null
      ? { cpc_bid_floor_micros: toMicros(params.cpc_bid_floor) }
      : {}),
  };

  let scheme: JsonRecord;
  switch (params.strategy) {
    case "MAXIMIZE_CLICKS":
      scheme = buildSearchCampaignBiddingStrategy({
        bidding_strategy: "MAXIMIZE_CLICKS",
        cpc_bid_ceiling: params.cpc_bid_ceiling,
      });
      break;
    case "MAXIMIZE_CONVERSIONS":
      scheme = {
        maximize_conversions: {
          ...limits,
          ...(params.target_cpa != null
            ? { target_cpa_micros: toMicros(params.target_cpa) }
            : {}),
        },
      };
      break;
    case "MAXIMIZE_CONVERSION_VALUE":
      scheme = {
        maximize_conversion_value: {
          ...limits,
          ...(params.target_roas != null ? { target_roas: params.target_roas } : {}),
        },
      };
      break;
    case "TARGET_CPA":
      if (params.target_cpa == null) throw new Error("target_cpa is required");
      scheme = {
        target_cpa: {
          target_cpa_micros: toMicros(params.target_cpa),
          ...limits,
        },
      };
      break;
    case "TARGET_ROAS":
      if (params.target_roas == null) throw new Error("target_roas is required");
      scheme = { target_roas: { target_roas: params.target_roas, ...limits } };
      break;
    case "TARGET_IMPRESSION_SHARE":
      scheme = buildSearchCampaignBiddingStrategy({
        bidding_strategy: "TARGET_IMPRESSION_SHARE",
        cpc_bid_ceiling: params.cpc_bid_ceiling,
        target_impression_share_location:
          params.target_impression_share_location,
        target_impression_share_percentage:
          params.target_impression_share_percentage,
      });
      break;
    case "ENHANCED_CPC":
      scheme = { enhanced_cpc: {} };
      break;
  }

  return { name: params.name, ...scheme, ...(params.fields ?? {}) };
}

function registerCampaignBudgetReadTools(server: McpServer) {
  server.registerTool(
    "list_campaign_budgets",
    {
      title: "List Campaign Budgets",
      description: "List daily and campaign-total budgets with sharing metadata.",
      inputSchema: {
        customer_id: z.string(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_campaign_budgets";
      try {
        const customer = getAdsClient(params.customer_id);
        const where = params.include_removed
          ? ""
          : "WHERE campaign_budget.status != REMOVED";
        const query = `
          SELECT
            campaign_budget.resource_name,
            campaign_budget.id,
            campaign_budget.name,
            campaign_budget.status,
            campaign_budget.amount_micros,
            campaign_budget.total_amount_micros,
            campaign_budget.period,
            campaign_budget.delivery_method,
            campaign_budget.explicitly_shared,
            campaign_budget.reference_count,
            campaign_budget.aligned_bidding_strategy_id
          FROM campaign_budget
          ${where}
          ORDER BY campaign_budget.name
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

  server.registerTool(
    "get_campaign_budget",
    {
      title: "Get Campaign Budget",
      description: "Fetch a campaign budget by resource name or numeric ID.",
      inputSchema: { customer_id: z.string(), campaign_budget_id: z.string() },
    },
    async (params) => {
      const tool = "get_campaign_budget";
      try {
        const resourceName = toResourceName(
          params.customer_id,
          "campaignBudgets",
          params.campaign_budget_id
        );
        const customer = getAdsClient(params.customer_id);
        const query = `SELECT campaign_budget.resource_name, campaign_budget.id, campaign_budget.name, campaign_budget.status, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period, campaign_budget.delivery_method, campaign_budget.explicitly_shared, campaign_budget.reference_count, campaign_budget.aligned_bidding_strategy_id FROM campaign_budget WHERE campaign_budget.resource_name = '${escapeGaql(resourceName)}' LIMIT 1`;
        const rows = await customer.query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [resourceName],
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerSmartBiddingEventTools(server: McpServer) {
  registerSmartBiddingCreateTool(server, {
    name: "create_bidding_data_exclusion",
    title: "Create Bidding Data Exclusion",
    collection: "biddingDataExclusions",
    extraSchema: {},
  });
  registerSmartBiddingCreateTool(server, {
    name: "create_bidding_seasonality_adjustment",
    title: "Create Bidding Seasonality Adjustment",
    collection: "biddingSeasonalityAdjustments",
    extraSchema: {
      conversion_rate_modifier: z.number().positive(),
    },
  });

  for (const config of [
    ["bidding_data_exclusion", "biddingDataExclusions"],
    ["bidding_seasonality_adjustment", "biddingSeasonalityAdjustments"],
  ] as const) {
    registerCollectionMutateTool({
      server,
      name: `update_${config[0]}`,
      title: `Update ${config[0].split("_").join(" ")}`,
      description: "Update Smart Bidding event fields.",
      collection: config[1],
      action: "update",
      resourceLabel: config[0],
    });
    registerCollectionMutateTool({
      server,
      name: `remove_${config[0]}`,
      title: `Remove ${config[0].split("_").join(" ")}`,
      description: "Remove Smart Bidding events by resource name.",
      collection: config[1],
      action: "remove",
      resourceLabel: config[0],
    });
  }
}

function registerSmartBiddingCreateTool(
  server: McpServer,
  config: {
    name: string;
    title: string;
    collection: "biddingDataExclusions" | "biddingSeasonalityAdjustments";
    extraSchema: Record<string, z.ZodTypeAny>;
  }
) {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: "Create a scoped Smart Bidding event with typed dates and targeting.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        start_date_time: z.string().min(1),
        end_date_time: z.string().min(1),
        scope: z.enum(["CUSTOMER", "CAMPAIGN", "CHANNEL"]).optional(),
        campaign_ids: z.array(z.string()).optional(),
        advertising_channel_types: z
          .array(
            z.enum([
              "SEARCH",
              "DISPLAY",
              "SHOPPING",
              "PERFORMANCE_MAX",
              "DEMAND_GEN",
            ])
          )
          .optional(),
        devices: z
          .array(z.enum(["MOBILE", "TABLET", "DESKTOP"]))
          .optional(),
        description: z.string().optional(),
        fields: jsonRecordSchema.optional(),
        ...config.extraSchema,
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const collection = customer[config.collection];
        const resource = buildSmartBiddingEvent(params);
        const result = await collection.create(
          [resource] as never[],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool: config.name,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: { resource, response: result },
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(config.name, err, {
          customer_id: params.customer_id,
          validate_only: params.validate_only,
        });
      }
    }
  );
}

export function buildSmartBiddingEvent(
  params: SmartBiddingEventInput & { conversion_rate_modifier?: number }
) {
  const scope =
    params.scope ??
    (params.campaign_ids?.length
      ? "CAMPAIGN"
      : params.advertising_channel_types?.length
        ? "CHANNEL"
        : "CUSTOMER");
  return {
    name: params.name,
    start_date_time: params.start_date_time,
    end_date_time: params.end_date_time,
    scope: enumValue(enums.SeasonalityEventScope, scope),
    ...(params.description ? { description: params.description } : {}),
    ...(params.devices?.length
      ? { devices: params.devices.map((device) => enumValue(enums.Device, device)) }
      : {}),
    ...(params.campaign_ids?.length
      ? {
          campaigns: params.campaign_ids.map((id) =>
            toResourceName(params.customer_id, "campaigns", id)
          ),
        }
      : {}),
    ...(params.advertising_channel_types?.length
      ? {
          advertising_channel_types: params.advertising_channel_types.map(
            (channel) => enumValue(enums.AdvertisingChannelType, channel)
          ),
        }
      : {}),
    ...(params.conversion_rate_modifier != null
      ? { conversion_rate_modifier: params.conversion_rate_modifier }
      : {}),
    ...(params.fields ?? {}),
  };
}
