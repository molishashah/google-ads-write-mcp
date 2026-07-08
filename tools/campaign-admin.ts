import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  enums,
  ResourceNames,
  toMicros,
  type MutateOperation,
} from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  customerScopedConstant,
  enumValue,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
  toResourceName,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import {
  jsonRecordSchema,
  mutateOptions,
  mutateOptionSchema,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = z.enum(["ENABLED", "PAUSED", "REMOVED"]);
const CAMPAIGN_STATUS = z.enum(["ENABLED", "PAUSED"]);

export type SearchCampaignBundleInput = {
  customer_id: string;
  name: string;
  daily_budget: number;
  initial_status?: "PAUSED" | "ENABLED";
  cpc_bid_ceiling?: number;
  include_search_partners?: boolean;
  include_display_network?: boolean;
  start_date?: string;
  end_date?: string;
  ad_groups: Array<{
    name: string;
    cpc_bid?: number;
    final_url: string;
    headlines: string[];
    descriptions: string[];
    path1?: string;
    path2?: string;
    keywords?: Array<{
      text: string;
      match_type: "BROAD" | "PHRASE" | "EXACT";
    }>;
  }>;
  negative_keywords?: Array<{
    text: string;
    match_type: "BROAD" | "PHRASE" | "EXACT";
  }>;
  geo_target_constant_ids?: string[];
  language_constant_ids?: string[];
};

export type PerformanceMaxCampaignBundleInput = {
  customer_id: string;
  name: string;
  daily_budget: number;
  initial_status?: "PAUSED" | "ENABLED";
  bidding_strategy?: "MAXIMIZE_CONVERSIONS" | "MAXIMIZE_CONVERSION_VALUE";
  target_cpa?: number;
  target_roas?: number;
  start_date?: string;
  end_date?: string;
  final_url_expansion_opt_out?: boolean;
  campaign_fields?: JsonRecord;
  asset_group: {
    name: string;
    final_urls: string[];
    final_mobile_urls?: string[];
    status?: "PAUSED" | "ENABLED";
    assets?: Array<{
      asset_id: string;
      field_type: string;
    }>;
    fields?: JsonRecord;
  };
  geo_target_constant_ids?: string[];
  language_constant_ids?: string[];
};

export type ShoppingCampaignBundleInput = {
  customer_id: string;
  name: string;
  daily_budget: number;
  merchant_id: number;
  feed_label?: string;
  campaign_priority?: number;
  enable_local?: boolean;
  use_vehicle_inventory?: boolean;
  disable_product_feed?: boolean;
  initial_status?: "PAUSED" | "ENABLED";
  bidding_strategy?: "MANUAL_CPC" | "MAXIMIZE_CLICKS";
  cpc_bid?: number;
  cpc_bid_ceiling?: number;
  start_date?: string;
  end_date?: string;
  campaign_fields?: JsonRecord;
  ad_group?: {
    name?: string;
    status?: "PAUSED" | "ENABLED";
    cpc_bid?: number;
    final_url_suffix?: string;
    tracking_url_template?: string;
    url_custom_parameters?: Array<{ key: string; value: string }>;
    fields?: JsonRecord;
  };
  create_product_ad?: boolean;
  product_ad_status?: "PAUSED" | "ENABLED";
  geo_target_constant_ids?: string[];
  language_constant_ids?: string[];
};

export function registerCampaignAdminTools(server: McpServer) {
  registerCampaignReadTools(server);
  registerCampaignMutateTools(server);
  registerBudgetTools(server);
  registerAdGroupTools(server);
  registerCampaignTargetingTools(server);
  registerSearchCampaignBundle(server);
  registerChannelCampaignBundleTools(server);
}

function registerCampaignReadTools(server: McpServer) {
  server.registerTool(
    "list_campaigns",
    {
      title: "List Campaigns",
      description: "List campaigns with key status, budget, channel, bidding, and recent metrics.",
      inputSchema: {
        customer_id: z.string(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_campaigns";
      try {
        const customer = getAdsClient(params.customer_id);
        const conditions = params.include_removed
          ? ""
          : "WHERE campaign.status != REMOVED";
        const query = `
          SELECT
            campaign.resource_name,
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.campaign_budget,
            campaign.start_date,
            campaign.end_date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value
          FROM campaign
          ${conditions}
          ORDER BY campaign.name
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
    "get_campaign",
    {
      title: "Get Campaign",
      description: "Fetch a campaign by resource name or numeric campaign ID.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z
          .string()
          .describe("Campaign resource name or numeric campaign ID."),
      },
    },
    async (params) => {
      const tool = "get_campaign";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "campaigns",
          params.campaign_id
        );
        const query = `
          SELECT
            campaign.resource_name,
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.campaign_budget,
            campaign.start_date,
            campaign.end_date,
            campaign.network_settings.target_google_search,
            campaign.network_settings.target_search_network,
            campaign.network_settings.target_content_network,
            campaign.network_settings.target_partner_search_network,
            campaign.tracking_url_template,
            campaign.final_url_suffix,
            campaign.url_custom_parameters,
            campaign.bidding_strategy_type
          FROM campaign
          WHERE campaign.resource_name = '${escapeGaql(resourceName)}'
          LIMIT 1`;
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

function registerCampaignMutateTools(server: McpServer) {
  server.registerTool(
    "update_campaign",
    {
      title: "Update Campaign",
      description:
        "Update arbitrary mutable campaign fields. For common operations prefer " +
        "set_campaign_status, update_campaign_budget, update_bidding_strategy, " +
        "update_campaign_dates, update_network_settings, or set_campaign_url_options.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().describe("Campaign resource name or numeric ID."),
        fields: jsonRecordSchema.describe("Mutable campaign fields to update."),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "update_campaign";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "campaigns",
          params.campaign_id
        );
        const options = mutateOptions(params);
        const result = await customer.campaigns.update(
          [{ resource_name: resourceName, ...params.fields }],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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

  server.registerTool(
    "set_campaign_status",
    {
      title: "Set Campaign Status",
      description: "Set a campaign to ENABLED, PAUSED, or REMOVED.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().describe("Campaign resource name or numeric ID."),
        status: STATUS,
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "set_campaign_status";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "campaigns",
          params.campaign_id
        );
        const options = mutateOptions(params);
        const result = await customer.campaigns.update(
          [
            {
              resource_name: resourceName,
              status: enumValue(enums.CampaignStatus, params.status),
            },
          ] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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
    name: "remove_campaign",
    title: "Remove Campaign",
    description: "Irreversibly remove one or more campaigns.",
    collection: "campaigns",
    action: "remove",
    resourceLabel: "Campaign",
  });
}

function registerBudgetTools(server: McpServer) {
  server.registerTool(
    "create_campaign_budget",
    {
      title: "Create Campaign Budget",
      description: "Create a campaign budget.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        amount: z.number().positive().describe("Budget amount in account currency."),
        explicitly_shared: z.boolean().optional(),
        delivery_method: z.enum(["STANDARD", "ACCELERATED"]).optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_campaign_budget";
      try {
        const customer = getAdsClient(params.customer_id);
        const options = mutateOptions(params);
        const result = await customer.campaignBudgets.create(
          [
            {
              name: params.name,
              amount_micros: toMicros(params.amount),
              explicitly_shared: params.explicitly_shared ?? false,
              delivery_method: enumValue(
                enums.BudgetDeliveryMethod,
                params.delivery_method ?? "STANDARD"
              ) as never,
            },
          ] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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

  server.registerTool(
    "update_campaign_budget",
    {
      title: "Update Campaign Budget",
      description:
        "Update a campaign budget by budget resource name, or resolve it from a campaign.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z
          .string()
          .optional()
          .describe("Campaign resource name or numeric ID used to resolve its budget."),
        campaign_budget_id: z
          .string()
          .optional()
          .describe("Campaign budget resource name or numeric ID."),
        amount: z.number().positive().optional(),
        name: z.string().optional(),
        explicitly_shared: z.boolean().optional(),
        delivery_method: z.enum(["STANDARD", "ACCELERATED"]).optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "update_campaign_budget";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName =
          params.campaign_budget_id != null
            ? toResourceName(
                params.customer_id,
                "campaignBudgets",
                params.campaign_budget_id
              )
            : await resolveCampaignBudget(params.customer_id, params.campaign_id);
        const options = mutateOptions(params);
        const resource: JsonRecord = {
          resource_name: resourceName,
          ...(params.fields ?? {}),
        };
        if (params.amount != null) resource.amount_micros = toMicros(params.amount);
        if (params.name != null) resource.name = params.name;
        if (params.explicitly_shared != null) {
          resource.explicitly_shared = params.explicitly_shared;
        }
        if (params.delivery_method != null) {
          resource.delivery_method = enumValue(
            enums.BudgetDeliveryMethod,
            params.delivery_method
          );
        }
        const result = await customer.campaignBudgets.update([resource], options);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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
    name: "remove_campaign_budget",
    title: "Remove Campaign Budget",
    description: "Irreversibly remove one or more campaign budgets.",
    collection: "campaignBudgets",
    action: "remove",
    resourceLabel: "Campaign budget",
  });

  server.registerTool(
    "update_bidding_strategy",
    {
      title: "Update Campaign Bidding Strategy",
      description:
        "Set a campaign bidding strategy. Supports common campaign-level strategy fields.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().describe("Campaign resource name or numeric ID."),
        strategy: z.enum([
          "MAXIMIZE_CLICKS",
          "MAXIMIZE_CONVERSIONS",
          "MAXIMIZE_CONVERSION_VALUE",
          "TARGET_CPA",
          "TARGET_ROAS",
          "MANUAL_CPC",
        ]),
        cpc_bid_ceiling: z.number().positive().optional(),
        target_cpa: z.number().positive().optional(),
        target_roas: z.number().positive().optional(),
        enhanced_cpc_enabled: z.boolean().optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "update_bidding_strategy";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "campaigns",
          params.campaign_id
        );
        const options = mutateOptions(params);
        const strategy = buildBiddingStrategy(params);
        const result = await customer.campaigns.update(
          [{ resource_name: resourceName, ...strategy }],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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

  registerCampaignFieldTool(server, {
    name: "update_campaign_dates",
    title: "Update Campaign Dates",
    description: "Update campaign start and/or end date.",
    schema: {
      start_date: z.string().regex(DATE_RE).optional(),
      end_date: z.string().regex(DATE_RE).optional(),
    },
    build: (params) => ({
      ...(params.start_date ? { start_date: params.start_date } : {}),
      ...(params.end_date ? { end_date: params.end_date } : {}),
    }),
  });

  registerCampaignFieldTool(server, {
    name: "update_network_settings",
    title: "Update Campaign Network Settings",
    description: "Update campaign network settings.",
    schema: {
      target_google_search: z.boolean().optional(),
      target_search_network: z.boolean().optional(),
      target_content_network: z.boolean().optional(),
      target_partner_search_network: z.boolean().optional(),
    },
    build: (params) => ({
      network_settings: {
        ...(params.target_google_search != null
          ? { target_google_search: params.target_google_search }
          : {}),
        ...(params.target_search_network != null
          ? { target_search_network: params.target_search_network }
          : {}),
        ...(params.target_content_network != null
          ? { target_content_network: params.target_content_network }
          : {}),
        ...(params.target_partner_search_network != null
          ? { target_partner_search_network: params.target_partner_search_network }
          : {}),
      },
    }),
  });

  registerCampaignFieldTool(server, {
    name: "set_campaign_url_options",
    title: "Set Campaign URL Options",
    description: "Set tracking template, final URL suffix, and URL custom parameters.",
    schema: {
      tracking_url_template: z.string().optional(),
      final_url_suffix: z.string().optional(),
      url_custom_parameters: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .optional(),
    },
    build: (params) => ({
      ...(params.tracking_url_template != null
        ? { tracking_url_template: params.tracking_url_template }
        : {}),
      ...(params.final_url_suffix != null
        ? { final_url_suffix: params.final_url_suffix }
        : {}),
      ...(params.url_custom_parameters != null
        ? { url_custom_parameters: params.url_custom_parameters }
        : {}),
    }),
  });
}

function registerAdGroupTools(server: McpServer) {
  server.registerTool(
    "list_ad_groups",
    {
      title: "List Ad Groups",
      description: "List ad groups, optionally filtered to a campaign.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().optional(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_ad_groups";
      try {
        const customer = getAdsClient(params.customer_id);
        const conditions = [];
        if (params.campaign_id) {
          conditions.push(
            `ad_group.campaign = '${escapeGaql(
              toResourceName(params.customer_id, "campaigns", params.campaign_id)
            )}'`
          );
        }
        if (!params.include_removed) conditions.push("ad_group.status != REMOVED");
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const query = `
          SELECT
            campaign.resource_name,
            campaign.name,
            ad_group.resource_name,
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group.type,
            ad_group.cpc_bid_micros,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM ad_group
          ${where}
          ORDER BY campaign.name, ad_group.name
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
    "get_ad_group",
    {
      title: "Get Ad Group",
      description: "Fetch an ad group by resource name or numeric ID.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
      },
    },
    async (params) => {
      const tool = "get_ad_group";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "adGroups",
          params.ad_group_id
        );
        const query = `
          SELECT
            campaign.resource_name,
            campaign.name,
            ad_group.resource_name,
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group.type,
            ad_group.cpc_bid_micros,
            ad_group.final_url_suffix,
            ad_group.tracking_url_template,
            ad_group.url_custom_parameters
          FROM ad_group
          WHERE ad_group.resource_name = '${escapeGaql(resourceName)}'
          LIMIT 1`;
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

  server.registerTool(
    "update_ad_group",
    {
      title: "Update Ad Group",
      description: "Update arbitrary mutable ad group fields.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        fields: jsonRecordSchema,
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "update_ad_group";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "adGroups",
          params.ad_group_id
        );
        const options = mutateOptions(params);
        const result = await customer.adGroups.update(
          [{ resource_name: resourceName, ...params.fields }] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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

  server.registerTool(
    "set_ad_group_status",
    {
      title: "Set Ad Group Status",
      description: "Set an ad group to ENABLED, PAUSED, or REMOVED.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        status: STATUS,
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "set_ad_group_status";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "adGroups",
          params.ad_group_id
        );
        const options = mutateOptions(params);
        const result = await customer.adGroups.update(
          [
            {
              resource_name: resourceName,
              status: enumValue(enums.AdGroupStatus, params.status),
            },
          ] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
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
    name: "remove_ad_group",
    title: "Remove Ad Group",
    description: "Irreversibly remove one or more ad groups.",
    collection: "adGroups",
    action: "remove",
    resourceLabel: "Ad group",
  });
}

function registerCampaignTargetingTools(server: McpServer) {
  registerCriterionTool(server, {
    name: "set_campaign_locations",
    title: "Set Campaign Locations",
    type: "LOCATION",
    build: (params) =>
      (params.geo_target_constant_ids as string[]).map((id) => ({
        location: {
          geo_target_constant: customerScopedConstant("geoTargetConstants", id),
        },
      })),
    schema: {
      geo_target_constant_ids: z
        .array(z.string())
        .min(1)
        .describe("Geo target constant IDs or resource names."),
    },
  });

  registerCriterionTool(server, {
    name: "set_campaign_languages",
    title: "Set Campaign Languages",
    type: "LANGUAGE",
    build: (params) =>
      (params.language_constant_ids as string[]).map((id) => ({
        language: {
          language_constant: customerScopedConstant("languageConstants", id),
        },
      })),
    schema: {
      language_constant_ids: z
        .array(z.string())
        .min(1)
        .describe("Language constant IDs or resource names."),
    },
  });

  registerCriterionTool(server, {
    name: "set_campaign_ad_schedule",
    title: "Set Campaign Ad Schedule",
    type: "AD_SCHEDULE",
    build: (params) => params.schedules as JsonRecord[],
    schema: {
      schedules: z
        .array(
          z.object({
            ad_schedule: z.object({
              day_of_week: z.string(),
              start_hour: z.number().int().min(0).max(23),
              start_minute: z.string(),
              end_hour: z.number().int().min(0).max(24),
              end_minute: z.string(),
            }),
          })
        )
        .min(1)
        .describe("CampaignCriterion ad_schedule objects."),
    },
  });

  registerCriterionTool(server, {
    name: "set_campaign_devices",
    title: "Set Campaign Devices",
    type: "DEVICE",
    build: (params) =>
      (params.devices as Array<{ device: string; bid_modifier?: number }>).map(
        (item) => ({
          device: { type: enumValue(enums.Device, item.device) },
          ...(item.bid_modifier != null ? { bid_modifier: item.bid_modifier } : {}),
        })
      ),
    schema: {
      devices: z
        .array(
          z.object({
            device: z.enum(["MOBILE", "TABLET", "DESKTOP", "CONNECTED_TV", "OTHER"]),
            bid_modifier: z.number().optional(),
          })
        )
        .min(1),
    },
  });

  registerCriterionTool(server, {
    name: "set_campaign_audiences",
    title: "Set Campaign Audiences",
    type: "USER_LIST",
    build: (params) =>
      (params.user_lists as string[]).map((userList) => ({
        user_list: {
          user_list: toResourceName(
            params.customer_id as string,
            "userLists",
            userList
          ),
        },
      })),
    schema: {
      user_lists: z.array(z.string()).min(1),
    },
  });

  registerCriterionTool(server, {
    name: "set_campaign_demographics",
    title: "Set Campaign Demographics",
    type: "AGE_RANGE",
    build: (params) => params.criteria as JsonRecord[],
    schema: {
      criterion_type: z
        .enum(["AGE_RANGE", "GENDER", "INCOME_RANGE", "PARENTAL_STATUS"])
        .default("AGE_RANGE"),
      criteria: z
        .array(jsonRecordSchema)
        .min(1)
        .describe(
          "Raw CampaignCriterion demographic objects, e.g. {age_range:{type:'AGE_RANGE_25_34'}}."
        ),
    },
    typeFromParams: (params) => params.criterion_type as string,
  });
}

function registerSearchCampaignBundle(server: McpServer) {
  server.registerTool(
    "create_search_campaign_bundle",
    {
      title: "Create Search Campaign Bundle",
      description:
        "Atomically create a complete Search campaign: budget, campaign, ad groups, " +
        "RSAs, keywords, negatives, and basic targeting. Defaults to PAUSED but can create ENABLED.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        daily_budget: z.number().positive(),
        initial_status: CAMPAIGN_STATUS.optional(),
        cpc_bid_ceiling: z.number().positive().optional(),
        include_search_partners: z.boolean().optional(),
        include_display_network: z.boolean().optional(),
        start_date: z.string().regex(DATE_RE).optional(),
        end_date: z.string().regex(DATE_RE).optional(),
        ad_groups: z
          .array(
            z.object({
              name: z.string().min(1),
              cpc_bid: z.number().positive().optional(),
              final_url: z.string().url(),
              headlines: z.array(z.string().max(30)).min(3).max(15),
              descriptions: z.array(z.string().max(90)).min(2).max(4),
              path1: z.string().max(15).optional(),
              path2: z.string().max(15).optional(),
              keywords: z
                .array(
                  z.object({
                    text: z.string(),
                    match_type: z.enum(["BROAD", "PHRASE", "EXACT"]),
                  })
                )
                .optional(),
            })
          )
          .min(1),
        negative_keywords: z
          .array(
            z.object({
              text: z.string(),
              match_type: z.enum(["BROAD", "PHRASE", "EXACT"]),
            })
          )
          .optional(),
        geo_target_constant_ids: z.array(z.string()).optional(),
        language_constant_ids: z.array(z.string()).optional(),
        validate_only: z.boolean().optional(),
      },
    },
    async (params) => {
      const tool = "create_search_campaign_bundle";
      try {
        const customer = getAdsClient(params.customer_id);
        const operations = buildSearchCampaignBundleOperations(params);

        const result = await customer.mutateResources(operations, {
          validate_only: params.validate_only ?? false,
        });
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            operation_count: operations.length,
            response: result,
          },
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
}

export function buildSearchCampaignBundleOperations(
  params: SearchCampaignBundleInput
): MutateOperation<unknown>[] {
  const cid = params.customer_id;
  const budgetTmp = ResourceNames.campaignBudget(cid, "-1");
  const campaignTmp = ResourceNames.campaign(cid, "-2");
  const operations: MutateOperation<unknown>[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTmp,
        name: `${params.name} budget`,
        amount_micros: toMicros(params.daily_budget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignTmp,
        name: params.name,
        status: enumValue(enums.CampaignStatus, params.initial_status ?? "PAUSED"),
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        campaign_budget: budgetTmp,
        contains_eu_political_advertising:
          enums.EuPoliticalAdvertisingStatus
            .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        target_spend:
          params.cpc_bid_ceiling != null
            ? { cpc_bid_ceiling_micros: toMicros(params.cpc_bid_ceiling) }
            : {},
        network_settings: {
          target_google_search: true,
          target_search_network: params.include_search_partners ?? true,
          target_content_network: params.include_display_network ?? false,
          target_partner_search_network: false,
        },
        ...(params.start_date ? { start_date: params.start_date } : {}),
        ...(params.end_date ? { end_date: params.end_date } : {}),
      },
    },
  ];

  params.ad_groups.forEach((group, index) => {
    const adGroupTmp = ResourceNames.adGroup(cid, String(-10 - index));
    operations.push({
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: adGroupTmp,
        name: group.name,
        campaign: campaignTmp,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
        ...(group.cpc_bid != null ? { cpc_bid_micros: toMicros(group.cpc_bid) } : {}),
      },
    });
    operations.push({
      entity: "ad_group_ad",
      operation: "create",
      resource: {
        ad_group: adGroupTmp,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [group.final_url],
          responsive_search_ad: {
            headlines: group.headlines.map((text) => ({ text })),
            descriptions: group.descriptions.map((text) => ({ text })),
            ...(group.path1 ? { path1: group.path1 } : {}),
            ...(group.path2 ? { path2: group.path2 } : {}),
          },
        },
      },
    });
    for (const keyword of group.keywords ?? []) {
      operations.push({
        entity: "ad_group_criterion",
        operation: "create",
        resource: {
          ad_group: adGroupTmp,
          status: enums.AdGroupCriterionStatus.ENABLED,
          keyword: {
            text: keyword.text,
            match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
          },
        },
      });
    }
  });

  for (const keyword of params.negative_keywords ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        negative: true,
        keyword: {
          text: keyword.text,
          match_type: enumValue(enums.KeywordMatchType, keyword.match_type),
        },
      },
    });
  }
  for (const id of params.geo_target_constant_ids ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        location: {
          geo_target_constant: customerScopedConstant("geoTargetConstants", id),
        },
      },
    });
  }
  for (const id of params.language_constant_ids ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        language: {
          language_constant: customerScopedConstant("languageConstants", id),
        },
      },
    });
  }

  return operations;
}

function registerChannelCampaignBundleTools(server: McpServer) {
  registerPerformanceMaxCampaignBundle(server);
  registerShoppingCampaignBundle(server);

  const tools = [
    {
      name: "create_demand_gen_campaign_bundle",
      title: "Create Demand Gen Campaign Bundle",
      channel: "DEMAND_GEN",
    },
    {
      name: "create_app_campaign_bundle",
      title: "Create App Campaign Bundle",
      channel: "MULTI_CHANNEL",
    },
  ] as const;

  for (const item of tools) {
    server.registerTool(
      item.name,
      {
        title: item.title,
        description:
          "Create the budget and campaign shell for this channel. Pass channel-specific " +
          "settings in campaign_fields, then use asset/ad/targeting tools to complete setup.",
        inputSchema: {
          customer_id: z.string(),
          name: z.string().min(1),
          daily_budget: z.number().positive(),
          initial_status: CAMPAIGN_STATUS.optional(),
          campaign_fields: jsonRecordSchema.optional(),
          validate_only: z.boolean().optional(),
        },
      },
      async (params) => {
        const tool = item.name;
        try {
          const customer = getAdsClient(params.customer_id);
          const cid = params.customer_id;
          const budgetTmp = ResourceNames.campaignBudget(cid, "-1");
          const operations: MutateOperation<unknown>[] = [
            {
              entity: "campaign_budget",
              operation: "create",
              resource: {
                resource_name: budgetTmp,
                name: `${params.name} budget (${Date.now()})`,
                amount_micros: toMicros(params.daily_budget),
                delivery_method: enums.BudgetDeliveryMethod.STANDARD,
                explicitly_shared: false,
              },
            },
            {
              entity: "campaign",
              operation: "create",
              resource: {
                name: params.name,
                status: enumValue(
                  enums.CampaignStatus,
                  params.initial_status ?? "PAUSED"
                ),
                advertising_channel_type: enumValue(
                  enums.AdvertisingChannelType,
                  item.channel
                ),
                campaign_budget: budgetTmp,
                contains_eu_political_advertising:
                  enums.EuPoliticalAdvertisingStatus
                    .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
                ...(params.campaign_fields ?? {}),
              },
            },
          ];
          const result = await customer.mutateResources(operations, {
            validate_only: params.validate_only ?? false,
          });
          return mcpSuccess({
            tool,
            customer_id: params.customer_id,
            validate_only: params.validate_only ?? false,
            resource_names: extractResourceNames(result),
            results: {
              channel: item.channel,
              operation_count: operations.length,
              response: result,
            },
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
  }
}

function registerShoppingCampaignBundle(server: McpServer) {
  server.registerTool(
    "create_shopping_campaign_bundle",
    {
      title: "Create Shopping Campaign Bundle",
      description:
        "Atomically create a Shopping campaign with budget, shopping setting, ad group, optional product ad, and basic geo/language criteria.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        daily_budget: z.number().positive(),
        merchant_id: z.number().int().positive(),
        feed_label: z.string().optional(),
        campaign_priority: z.number().int().min(0).max(2).optional(),
        enable_local: z.boolean().optional(),
        use_vehicle_inventory: z.boolean().optional(),
        disable_product_feed: z.boolean().optional(),
        initial_status: CAMPAIGN_STATUS.optional(),
        bidding_strategy: z.enum(["MANUAL_CPC", "MAXIMIZE_CLICKS"]).optional(),
        cpc_bid: z.number().positive().optional(),
        cpc_bid_ceiling: z.number().positive().optional(),
        start_date: z.string().regex(DATE_RE).optional(),
        end_date: z.string().regex(DATE_RE).optional(),
        campaign_fields: jsonRecordSchema.optional(),
        ad_group: z
          .object({
            name: z.string().min(1).optional(),
            status: CAMPAIGN_STATUS.optional(),
            cpc_bid: z.number().positive().optional(),
            final_url_suffix: z.string().optional(),
            tracking_url_template: z.string().optional(),
            url_custom_parameters: z
              .array(z.object({ key: z.string(), value: z.string() }))
              .optional(),
            fields: jsonRecordSchema.optional(),
          })
          .optional(),
        create_product_ad: z.boolean().optional(),
        product_ad_status: CAMPAIGN_STATUS.optional(),
        geo_target_constant_ids: z.array(z.string()).optional(),
        language_constant_ids: z.array(z.string()).optional(),
        validate_only: z.boolean().optional(),
      },
    },
    async (params) => {
      const tool = "create_shopping_campaign_bundle";
      try {
        const customer = getAdsClient(params.customer_id);
        const operations = buildShoppingCampaignBundleOperations(params);
        const result = await customer.mutateResources(operations, {
          validate_only: params.validate_only ?? false,
        });
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            operation_count: operations.length,
            response: result,
          },
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
}

export function buildShoppingCampaignBundleOperations(
  params: ShoppingCampaignBundleInput
): MutateOperation<unknown>[] {
  const cid = params.customer_id;
  const budgetTmp = ResourceNames.campaignBudget(cid, "-1");
  const campaignTmp = ResourceNames.campaign(cid, "-2");
  const adGroupTmp = ResourceNames.adGroup(cid, "-3");
  const adGroup = params.ad_group ?? {};
  const operations: MutateOperation<unknown>[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTmp,
        name: `${params.name} budget`,
        amount_micros: toMicros(params.daily_budget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignTmp,
        name: params.name,
        status: enumValue(enums.CampaignStatus, params.initial_status ?? "PAUSED"),
        advertising_channel_type: enums.AdvertisingChannelType.SHOPPING,
        campaign_budget: budgetTmp,
        contains_eu_political_advertising:
          enums.EuPoliticalAdvertisingStatus
            .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        shopping_setting: {
          merchant_id: params.merchant_id,
          ...(params.feed_label ? { feed_label: params.feed_label } : {}),
          ...(params.campaign_priority != null
            ? { campaign_priority: params.campaign_priority }
            : {}),
          ...(params.enable_local != null
            ? { enable_local: params.enable_local }
            : {}),
          ...(params.use_vehicle_inventory != null
            ? { use_vehicle_inventory: params.use_vehicle_inventory }
            : {}),
          ...(params.disable_product_feed != null
            ? { disable_product_feed: params.disable_product_feed }
            : {}),
        },
        ...buildShoppingBiddingStrategy(params),
        ...(params.start_date ? { start_date: params.start_date } : {}),
        ...(params.end_date ? { end_date: params.end_date } : {}),
        ...(params.campaign_fields ?? {}),
      },
    },
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: adGroupTmp,
        name: adGroup.name ?? `${params.name} products`,
        campaign: campaignTmp,
        status: enumValue(
          enums.AdGroupStatus,
          adGroup.status ?? params.initial_status ?? "PAUSED"
        ),
        type: enums.AdGroupType.SHOPPING_PRODUCT_ADS,
        ...(adGroup.cpc_bid ?? params.cpc_bid
          ? { cpc_bid_micros: toMicros(adGroup.cpc_bid ?? params.cpc_bid ?? 0) }
          : {}),
        ...(adGroup.final_url_suffix
          ? { final_url_suffix: adGroup.final_url_suffix }
          : {}),
        ...(adGroup.tracking_url_template
          ? { tracking_url_template: adGroup.tracking_url_template }
          : {}),
        ...(adGroup.url_custom_parameters
          ? { url_custom_parameters: adGroup.url_custom_parameters }
          : {}),
        ...(adGroup.fields ?? {}),
      },
    },
  ];

  if (params.create_product_ad ?? true) {
    operations.push({
      entity: "ad_group_ad",
      operation: "create",
      resource: {
        ad_group: adGroupTmp,
        status: enumValue(
          enums.AdGroupAdStatus,
          params.product_ad_status ?? adGroup.status ?? params.initial_status ?? "PAUSED"
        ),
        ad: {
          shopping_product_ad: {},
        },
      },
    });
  }
  for (const id of params.geo_target_constant_ids ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        location: {
          geo_target_constant: customerScopedConstant("geoTargetConstants", id),
        },
      },
    });
  }
  for (const id of params.language_constant_ids ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        language: {
          language_constant: customerScopedConstant("languageConstants", id),
        },
      },
    });
  }

  return operations;
}

function buildShoppingBiddingStrategy(
  params: Pick<
    ShoppingCampaignBundleInput,
    "bidding_strategy" | "cpc_bid_ceiling"
  >
) {
  if (params.bidding_strategy === "MAXIMIZE_CLICKS") {
    return {
      target_spend:
        params.cpc_bid_ceiling != null
          ? { cpc_bid_ceiling_micros: toMicros(params.cpc_bid_ceiling) }
          : {},
    };
  }
  return {
    manual_cpc: {},
  };
}

function registerPerformanceMaxCampaignBundle(server: McpServer) {
  server.registerTool(
    "create_performance_max_campaign_bundle",
    {
      title: "Create Performance Max Campaign Bundle",
      description:
        "Atomically create a Performance Max campaign with budget, campaign, asset group, asset links, and basic geo/language criteria.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        daily_budget: z.number().positive(),
        initial_status: CAMPAIGN_STATUS.optional(),
        bidding_strategy: z
          .enum(["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE"])
          .optional(),
        target_cpa: z.number().positive().optional(),
        target_roas: z.number().positive().optional(),
        start_date: z.string().regex(DATE_RE).optional(),
        end_date: z.string().regex(DATE_RE).optional(),
        final_url_expansion_opt_out: z.boolean().optional(),
        campaign_fields: jsonRecordSchema.optional(),
        asset_group: z.object({
          name: z.string().min(1),
          final_urls: z.array(z.string().url()).min(1),
          final_mobile_urls: z.array(z.string().url()).optional(),
          status: CAMPAIGN_STATUS.optional(),
          assets: z
            .array(
              z.object({
                asset_id: z.string().describe("Asset resource name or numeric ID."),
                field_type: z
                  .enum([
                    "HEADLINE",
                    "LONG_HEADLINE",
                    "DESCRIPTION",
                    "MARKETING_IMAGE",
                    "SQUARE_MARKETING_IMAGE",
                    "PORTRAIT_MARKETING_IMAGE",
                    "LOGO",
                    "LANDSCAPE_LOGO",
                    "VIDEO",
                    "BUSINESS_NAME",
                    "CALL_TO_ACTION_SELECTION",
                    "SITELINK",
                    "CALLOUT",
                    "PROMOTION",
                    "PRICE",
                    "LEAD_FORM",
                  ])
                  .describe("AssetFieldType used for the AssetGroupAsset link."),
              })
            )
            .optional(),
          fields: jsonRecordSchema.optional(),
        }),
        geo_target_constant_ids: z.array(z.string()).optional(),
        language_constant_ids: z.array(z.string()).optional(),
        validate_only: z.boolean().optional(),
      },
    },
    async (params) => {
      const tool = "create_performance_max_campaign_bundle";
      try {
        const customer = getAdsClient(params.customer_id);
        const operations = buildPerformanceMaxCampaignBundleOperations(params);
        const result = await customer.mutateResources(operations, {
          validate_only: params.validate_only ?? false,
        });
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            operation_count: operations.length,
            response: result,
          },
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
}

export function buildPerformanceMaxCampaignBundleOperations(
  params: PerformanceMaxCampaignBundleInput
): MutateOperation<unknown>[] {
  const cid = params.customer_id;
  const budgetTmp = ResourceNames.campaignBudget(cid, "-1");
  const campaignTmp = ResourceNames.campaign(cid, "-2");
  const assetGroupTmp = ResourceNames.assetGroup(cid, "-3");
  const operations: MutateOperation<unknown>[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTmp,
        name: `${params.name} budget`,
        amount_micros: toMicros(params.daily_budget),
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignTmp,
        name: params.name,
        status: enumValue(enums.CampaignStatus, params.initial_status ?? "PAUSED"),
        advertising_channel_type: enums.AdvertisingChannelType.PERFORMANCE_MAX,
        campaign_budget: budgetTmp,
        contains_eu_political_advertising:
          enums.EuPoliticalAdvertisingStatus
            .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...buildPerformanceMaxBiddingStrategy(params),
        ...(params.final_url_expansion_opt_out != null
          ? { url_expansion_opt_out: params.final_url_expansion_opt_out }
          : {}),
        ...(params.start_date ? { start_date: params.start_date } : {}),
        ...(params.end_date ? { end_date: params.end_date } : {}),
        ...(params.campaign_fields ?? {}),
      },
    },
    {
      entity: "asset_group",
      operation: "create",
      resource: {
        resource_name: assetGroupTmp,
        campaign: campaignTmp,
        name: params.asset_group.name,
        final_urls: params.asset_group.final_urls,
        status: enumValue(
          enums.AssetGroupStatus,
          params.asset_group.status ?? params.initial_status ?? "PAUSED"
        ),
        ...(params.asset_group.final_mobile_urls
          ? { final_mobile_urls: params.asset_group.final_mobile_urls }
          : {}),
        ...(params.asset_group.fields ?? {}),
      },
    },
  ];

  for (const asset of params.asset_group.assets ?? []) {
    operations.push({
      entity: "asset_group_asset",
      operation: "create",
      resource: {
        asset_group: assetGroupTmp,
        asset: toResourceName(cid, "assets", asset.asset_id),
        field_type: enumValue(enums.AssetFieldType, asset.field_type),
      },
    });
  }
  for (const id of params.geo_target_constant_ids ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        location: {
          geo_target_constant: customerScopedConstant("geoTargetConstants", id),
        },
      },
    });
  }
  for (const id of params.language_constant_ids ?? []) {
    operations.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignTmp,
        language: {
          language_constant: customerScopedConstant("languageConstants", id),
        },
      },
    });
  }

  return operations;
}

function buildPerformanceMaxBiddingStrategy(
  params: Pick<
    PerformanceMaxCampaignBundleInput,
    "bidding_strategy" | "target_cpa" | "target_roas"
  >
) {
  const strategy =
    params.bidding_strategy ??
    (params.target_roas != null
      ? "MAXIMIZE_CONVERSION_VALUE"
      : "MAXIMIZE_CONVERSIONS");
  if (strategy === "MAXIMIZE_CONVERSIONS") {
    if (params.target_roas != null) {
      throw new Error("target_roas requires MAXIMIZE_CONVERSION_VALUE bidding.");
    }
    return {
      maximize_conversions:
        params.target_cpa != null
          ? { target_cpa_micros: toMicros(params.target_cpa) }
          : {},
    };
  }
  if (params.target_cpa != null) {
    throw new Error("target_cpa requires MAXIMIZE_CONVERSIONS bidding.");
  }
  return {
    maximize_conversion_value:
      params.target_roas != null ? { target_roas: params.target_roas } : {},
  };
}

async function resolveCampaignBudget(
  customerId: string,
  campaignId: string | undefined
) {
  if (!campaignId) {
    throw new Error("Provide either campaign_budget_id or campaign_id");
  }
  const customer = getAdsClient(customerId);
  const campaignResourceName = toResourceName(customerId, "campaigns", campaignId);
  const rows = await customer.query<
    { campaign: { campaign_budget?: string | null } }[]
  >(
    `SELECT campaign.campaign_budget FROM campaign WHERE campaign.resource_name = '${escapeGaql(
      campaignResourceName
    )}' LIMIT 1`
  );
  const budget = rows[0]?.campaign?.campaign_budget;
  if (!budget) throw new Error(`No budget found for ${campaignResourceName}`);
  return budget;
}

function buildBiddingStrategy(params: {
  strategy: string;
  cpc_bid_ceiling?: number;
  target_cpa?: number;
  target_roas?: number;
  enhanced_cpc_enabled?: boolean;
}) {
  if (params.strategy === "MAXIMIZE_CLICKS") {
    return {
      target_spend:
        params.cpc_bid_ceiling != null
          ? { cpc_bid_ceiling_micros: toMicros(params.cpc_bid_ceiling) }
          : {},
    };
  }
  if (params.strategy === "MAXIMIZE_CONVERSIONS") {
    return {
      maximize_conversions:
        params.target_cpa != null
          ? { target_cpa_micros: toMicros(params.target_cpa) }
          : {},
    };
  }
  if (params.strategy === "MAXIMIZE_CONVERSION_VALUE") {
    return {
      maximize_conversion_value:
        params.target_roas != null ? { target_roas: params.target_roas } : {},
    };
  }
  if (params.strategy === "TARGET_CPA") {
    if (params.target_cpa == null) throw new Error("target_cpa is required");
    return { target_cpa: { target_cpa_micros: toMicros(params.target_cpa) } };
  }
  if (params.strategy === "TARGET_ROAS") {
    if (params.target_roas == null) throw new Error("target_roas is required");
    return { target_roas: { target_roas: params.target_roas } };
  }
  return {
    manual_cpc: {
      enhanced_cpc_enabled: params.enhanced_cpc_enabled ?? false,
    },
  };
}

function registerCampaignFieldTool<T extends Record<string, z.ZodTypeAny>>(
  server: McpServer,
  config: {
    name: string;
    title: string;
    description: string;
    schema: T;
    build: (params: any) => JsonRecord;
  }
) {
  const handler = async (params: any) => {
    const tool = config.name;
    try {
      const customer = getAdsClient(params.customer_id);
      const resourceName = toResourceName(
        params.customer_id,
        "campaigns",
        params.campaign_id
      );
      const options = mutateOptions(params);
      const result = await customer.campaigns.update(
        [{ resource_name: resourceName, ...config.build(params) }] as never[],
        options
      );
      return mcpSuccess({
        tool,
        customer_id: params.customer_id,
        validate_only: options.validate_only,
        resource_names: extractResourceNames(result),
        results: result,
        request_id: extractRequestId(result),
      });
    } catch (err) {
      return mcpJsonError(config.name, err, {
        customer_id: params.customer_id,
        validate_only: params.validate_only,
      });
    }
  };

  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string(),
        ...config.schema,
        ...mutateOptionSchema,
      },
    },
    handler as never
  );
}

function registerCriterionTool<T extends Record<string, z.ZodTypeAny>>(
  server: McpServer,
  config: {
    name: string;
    title: string;
    type: string;
    schema: T;
    build: (params: any) => JsonRecord[];
    typeFromParams?: (params: any) => string;
  }
) {
  const handler = async (params: any) => {
    const tool = config.name;
    try {
      const customer = getAdsClient(params.customer_id);
      const campaign = toResourceName(
        params.customer_id,
        "campaigns",
        params.campaign_id
      );
      const options = mutateOptions(params);
      const type = config.typeFromParams?.(params) ?? config.type;
      const mode = params.mode ?? "REPLACE";
      const removeNames =
        mode === "REMOVE"
          ? params.resource_names ?? []
          : mode === "REPLACE"
            ? await findCampaignCriteria(params.customer_id, campaign, type)
            : [];
      const creates =
        mode === "REMOVE"
          ? []
          : config.build(params).map((criterion) => ({
              campaign,
              negative: params.negative ?? false,
              ...criterion,
            }));
      const operations: MutateOperation<unknown>[] = [
        ...removeNames.map((resourceName: string) => ({
          entity: "campaign_criterion" as const,
          operation: "remove" as const,
          resource: resourceName,
        })),
        ...creates.map((resource) => ({
          entity: "campaign_criterion" as const,
          operation: "create" as const,
          resource,
        })),
      ];
      if (!operations.length) throw new Error("No criteria operations to apply");
      const result = await customer.mutateResources(operations, options);
      return mcpSuccess({
        tool,
        customer_id: params.customer_id,
        validate_only: options.validate_only,
        resource_names: extractResourceNames(result),
        results: {
          campaign,
          type,
          mode,
          removed: removeNames,
          created_count: creates.length,
          response: result,
        },
        request_id: extractRequestId(result),
      });
    } catch (err) {
      return mcpJsonError(config.name, err, {
        customer_id: params.customer_id,
        validate_only: params.validate_only,
      });
    }
  };

  server.registerTool(
    config.name,
    {
      title: config.title,
      description:
        "Set campaign criteria. mode=REPLACE removes existing criteria of this type, " +
        "then creates the provided criteria.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().describe("Campaign resource name or numeric ID."),
        mode: z.enum(["ADD", "REPLACE", "REMOVE"]).optional(),
        resource_names: z
          .array(z.string())
          .optional()
          .describe("Existing CampaignCriterion resource names to remove."),
        negative: z.boolean().optional(),
        ...config.schema,
        ...mutateOptionSchema,
      },
    },
    handler as never
  );
}

async function findCampaignCriteria(
  customerId: string,
  campaign: string,
  type: string
) {
  const customer = getAdsClient(customerId);
  const rows = await customer.query<
    { campaign_criterion: { resource_name?: string | null } }[]
  >(
    `SELECT campaign_criterion.resource_name
     FROM campaign_criterion
     WHERE campaign_criterion.campaign = '${escapeGaql(campaign)}'
       AND campaign_criterion.type = ${type}`
  );
  return rows
    .map((row) => row.campaign_criterion.resource_name)
    .filter((value): value is string => Boolean(value));
}
