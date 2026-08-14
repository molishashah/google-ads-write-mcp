import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, ResourceNames } from "google-ads-api";
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
  jsonRecordSchema,
  mutateOptions,
  mutateOptionSchema,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

export function registerAssetAndAdTools(server: McpServer) {
  registerAssetTools(server);
  registerAdFormatTools(server);
  registerPolicyTools(server);
}

export type ResponsiveDisplayAdInput = {
  customer_id: string;
  ad_group_id: string;
  final_urls: string[];
  final_mobile_urls?: string[];
  headlines: string[];
  long_headline: string;
  descriptions: string[];
  business_name: string;
  marketing_image_asset_ids: string[];
  square_marketing_image_asset_ids?: string[];
  logo_image_asset_ids?: string[];
  square_logo_image_asset_ids?: string[];
  youtube_video_asset_ids?: string[];
  main_color?: string;
  accent_color?: string;
  allow_flexible_color?: boolean;
  call_to_action_text?: string;
  price_prefix?: string;
  promo_text?: string;
  format_setting?: "ALL_FORMATS" | "NON_NATIVE" | "NATIVE";
  enable_asset_enhancements?: boolean;
  enable_autogen_video?: boolean;
  tracking_url_template?: string;
  final_url_suffix?: string;
  url_custom_parameters?: Array<{ key: string; value: string }>;
  ad_fields?: JsonRecord;
  responsive_display_ad_fields?: JsonRecord;
  status?: "ENABLED" | "PAUSED";
};

export type DynamicSearchAdInput = {
  customer_id: string;
  ad_group_id: string;
  description: string;
  description2?: string;
  status?: "ENABLED" | "PAUSED";
  tracking_url_template?: string;
  final_url_suffix?: string;
  url_custom_parameters?: Array<{ key: string; value: string }>;
  ad_fields?: JsonRecord;
  expanded_dynamic_search_ad_fields?: JsonRecord;
};

export type ShoppingProductAdInput = {
  customer_id: string;
  ad_group_id: string;
  status?: "ENABLED" | "PAUSED";
  ad_fields?: JsonRecord;
};

export type DemandGenMultiAssetAdInput = {
  customer_id: string;
  ad_group_id: string;
  final_urls: string[];
  status?: "ENABLED" | "PAUSED";
  headlines: string[];
  descriptions: string[];
  business_name: string;
  marketing_image_asset_ids: string[];
  square_marketing_image_asset_ids?: string[];
  portrait_marketing_image_asset_ids?: string[];
  tall_portrait_marketing_image_asset_ids?: string[];
  logo_image_asset_ids?: string[];
  classic_display_image_asset_ids?: string[];
  call_to_action_text?: string;
  tracking_url_template?: string;
  final_url_suffix?: string;
  url_custom_parameters?: Array<{ key: string; value: string }>;
  ad_fields?: JsonRecord;
  demand_gen_multi_asset_ad_fields?: JsonRecord;
};

export type AppAdInput = {
  customer_id: string;
  ad_group_id: string;
  status?: "ENABLED" | "PAUSED";
  final_urls?: string[];
  mandatory_ad_text?: string[];
  headlines?: string[];
  descriptions?: string[];
  image_asset_ids?: string[];
  youtube_video_asset_ids?: string[];
  html5_media_bundle_asset_ids?: string[];
  app_deep_link_asset_id?: string;
  ad_fields?: JsonRecord;
  app_ad_fields?: JsonRecord;
};

export type AssetGroupSignalInput = {
  customer_id: string;
  asset_group_id: string;
  search_themes?: string[];
  audience_ids?: string[];
};

export type AssetGroupListingFilterInput = {
  customer_id: string;
  asset_group_id: string;
  type: "SUBDIVISION" | "UNIT_INCLUDED" | "UNIT_EXCLUDED";
  listing_source?: "SHOPPING" | "WEBPAGE" | "RETAIL";
  parent_listing_group_filter_id?: string;
  dimension?: {
    type:
      | "PRODUCT_BRAND"
      | "PRODUCT_CATEGORY"
      | "PRODUCT_CHANNEL"
      | "PRODUCT_CONDITION"
      | "PRODUCT_CUSTOM_ATTRIBUTE"
      | "PRODUCT_ITEM_ID"
      | "PRODUCT_TYPE"
      | "WEBPAGE_URL_CONTAINS"
      | "WEBPAGE_CUSTOM_LABEL";
    value?: string;
    category_id?: number;
    level?: "LEVEL1" | "LEVEL2" | "LEVEL3" | "LEVEL4" | "LEVEL5";
    channel?: "ONLINE" | "LOCAL";
    condition?: "NEW" | "REFURBISHED" | "USED";
    index?: "INDEX0" | "INDEX1" | "INDEX2" | "INDEX3" | "INDEX4";
  };
  raw_case_value?: JsonRecord;
  fields?: JsonRecord;
};

export type AssetGroupAssetLinkInput = {
  customer_id: string;
  asset_group_id: string;
  assets: Array<{
    asset_id: string;
    field_type:
      | "HEADLINE"
      | "LONG_HEADLINE"
      | "DESCRIPTION"
      | "BUSINESS_NAME"
      | "MARKETING_IMAGE"
      | "SQUARE_MARKETING_IMAGE"
      | "PORTRAIT_MARKETING_IMAGE"
      | "LOGO"
      | "LANDSCAPE_LOGO"
      | "YOUTUBE_VIDEO"
      | "CALL_TO_ACTION_SELECTION";
  }>;
};

export type PmaxCreativeCoverageInput = {
  campaign_mode?: "STANDARD" | "RETAIL";
  assets: Array<{ field_type: AssetGroupAssetLinkInput["assets"][number]["field_type"] }>;
};

function registerAssetTools(server: McpServer) {
  server.registerTool(
    "list_assets",
    {
      title: "List Assets",
      description: "List assets with optional type filtering.",
      inputSchema: {
        customer_id: z.string(),
        asset_type: z.string().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_assets";
      try {
        const customer = getAdsClient(params.customer_id);
        const where = params.asset_type
          ? `WHERE asset.type = ${params.asset_type}`
          : "";
        const query = `
          SELECT
            asset.resource_name,
            asset.id,
            asset.name,
            asset.type,
            asset.text_asset.text,
            asset.image_asset.full_size.url,
            asset.youtube_video_asset.youtube_video_id
          FROM asset
          ${where}
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
    "get_asset",
    {
      title: "Get Asset",
      description: "Fetch one asset by resource name or numeric ID.",
      inputSchema: {
        customer_id: z.string(),
        asset_id: z.string(),
      },
    },
    async (params) => {
      const tool = "get_asset";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "assets",
          params.asset_id
        );
        const query = `
          SELECT
            asset.resource_name,
            asset.id,
            asset.name,
            asset.type,
            asset.text_asset.text,
            asset.image_asset.full_size.url,
            asset.image_asset.mime_type,
            asset.youtube_video_asset.youtube_video_id,
            asset.policy_summary.approval_status,
            asset.policy_summary.review_status
          FROM asset
          WHERE asset.resource_name = '${escapeGaql(resourceName)}'
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

  registerCollectionMutateTool({
    server,
    name: "create_asset",
    title: "Create Asset",
    description:
      "Create one or more raw Asset resources. Supports images, text, YouTube videos, logos, and other AssetService-supported payloads.",
    collection: "assets",
    action: "create",
    resourceLabel: "Asset",
  });

  registerCollectionMutateTool({
    server,
    name: "remove_asset",
    title: "Remove Asset",
    description: "Irreversibly remove one or more assets.",
    collection: "assets",
    action: "remove",
    resourceLabel: "Asset",
  });

  registerAttachmentTool(server, "attach_campaign_asset", "campaignAssets", "campaign", "campaigns");
  registerAttachmentTool(server, "detach_campaign_asset", "campaignAssets", "campaign", "campaigns", true);
  registerAttachmentTool(server, "attach_ad_group_asset", "adGroupAssets", "ad_group", "adGroups");
  registerAttachmentTool(server, "detach_ad_group_asset", "adGroupAssets", "ad_group", "adGroups", true);
  registerAttachmentTool(server, "attach_customer_asset", "customerAssets", undefined, undefined);
  registerAttachmentTool(server, "detach_customer_asset", "customerAssets", undefined, undefined, true);

  registerCollectionMutateTool({
    server,
    name: "create_pmax_asset_group",
    title: "Create Performance Max Asset Group",
    description: "Create one or more raw AssetGroup resources for Performance Max.",
    collection: "assetGroups",
    action: "create",
    resourceLabel: "Asset group",
  });

  registerPmaxAssetGroupLifecycleTools(server);

  registerPmaxAssetGroupSignalTools(server);
  registerPmaxListingGroupFilterTools(server);
}

function registerPmaxAssetGroupLifecycleTools(server: McpServer) {
  server.registerTool(
    "list_pmax_asset_groups",
    {
      title: "List Performance Max Asset Groups",
      description:
        "List Performance Max asset groups, their campaign, URLs, status, and ad strength.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().optional(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_pmax_asset_groups";
      try {
        const conditions = [
          ...(params.include_removed
            ? []
            : ["asset_group.status != 'REMOVED'"]),
          ...(params.campaign_id
            ? [
                `asset_group.campaign = '${escapeGaql(
                  toResourceName(
                    params.customer_id,
                    "campaigns",
                    params.campaign_id
                  )
                )}'`,
              ]
            : []),
        ];
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const query = `
          SELECT
            asset_group.resource_name,
            asset_group.id,
            asset_group.campaign,
            asset_group.name,
            asset_group.status,
            asset_group.final_urls,
            asset_group.final_mobile_urls,
            asset_group.path1,
            asset_group.path2,
            asset_group.ad_strength
          FROM asset_group
          ${where}
          ORDER BY asset_group.name
          LIMIT ${params.limit ?? 1000}`;
        const rows = await getAdsClient(params.customer_id).query(query);
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
    "get_pmax_asset_group",
    {
      title: "Get Performance Max Asset Group",
      description: "Fetch an asset group and all of its linked creative assets.",
      inputSchema: {
        customer_id: z.string(),
        asset_group_id: z.string(),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async (params) => {
      const tool = "get_pmax_asset_group";
      try {
        const resourceName = toResourceName(
          params.customer_id,
          "assetGroups",
          params.asset_group_id
        );
        const groupQuery = `SELECT asset_group.resource_name, asset_group.id, asset_group.campaign, asset_group.name, asset_group.status, asset_group.final_urls, asset_group.final_mobile_urls, asset_group.path1, asset_group.path2, asset_group.ad_strength FROM asset_group WHERE asset_group.resource_name = '${escapeGaql(resourceName)}' LIMIT 1`;
        const assetsQuery = `SELECT asset_group_asset.resource_name, asset_group_asset.asset_group, asset_group_asset.asset, asset_group_asset.field_type, asset_group_asset.status, asset_group_asset.performance_label, asset_group_asset.primary_status, asset_group_asset.primary_status_reasons, asset.resource_name, asset.name, asset.type FROM asset_group_asset WHERE asset_group_asset.asset_group = '${escapeGaql(resourceName)}' AND asset_group_asset.status != 'REMOVED' LIMIT ${params.limit ?? 1000}`;
        const customer = getAdsClient(params.customer_id);
        const [groups, assets] = await Promise.all([
          customer.query(groupQuery),
          customer.query(assetsQuery),
        ]);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [resourceName],
          results: { group: groups[0] ?? null, assets, group_query: groupQuery, assets_query: assetsQuery },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );

  registerCollectionMutateTool({
    server,
    name: "update_pmax_asset_group",
    title: "Update Performance Max Asset Group",
    description: "Update mutable asset-group fields such as name, status, and URLs.",
    collection: "assetGroups",
    action: "update",
    resourceLabel: "Asset group",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_pmax_asset_group",
    title: "Remove Performance Max Asset Group",
    description: "Remove Performance Max asset groups by resource name.",
    collection: "assetGroups",
    action: "remove",
    resourceLabel: "Asset group",
  });

  server.registerTool(
    "attach_pmax_asset_group_assets",
    {
      title: "Attach Performance Max Asset Group Assets",
      description:
        "Attach existing assets to an asset group with typed field roles.",
      inputSchema: {
        customer_id: z.string(),
        asset_group_id: z.string(),
        assets: z
          .array(
            z.object({
              asset_id: z.string(),
              field_type: z.enum([
                "HEADLINE",
                "LONG_HEADLINE",
                "DESCRIPTION",
                "BUSINESS_NAME",
                "MARKETING_IMAGE",
                "SQUARE_MARKETING_IMAGE",
                "PORTRAIT_MARKETING_IMAGE",
                "LOGO",
                "LANDSCAPE_LOGO",
                "YOUTUBE_VIDEO",
                "CALL_TO_ACTION_SELECTION",
              ]),
            })
          )
          .min(1),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "attach_pmax_asset_group_assets";
      try {
        const resources = buildAssetGroupAssetLinks(params);
        const result = await getAdsClient(
          params.customer_id
        ).assetGroupAssets.create(resources as never[], mutateOptions(params));
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: { resources, response: result },
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
    name: "detach_pmax_asset_group_assets",
    title: "Detach Performance Max Asset Group Assets",
    description: "Detach assets from asset groups by AssetGroupAsset resource name.",
    collection: "assetGroupAssets",
    action: "remove",
    resourceLabel: "Asset group asset link",
  });

  server.registerTool(
    "validate_pmax_creative_coverage",
    {
      title: "Validate Performance Max Creative Coverage",
      description:
        "Preflight an intended asset mix against standard Performance Max minimum creative coverage before mutation.",
      inputSchema: {
        campaign_mode: z.enum(["STANDARD", "RETAIL"]).optional(),
        assets: z
          .array(
            z.object({
              field_type: z.enum([
                "HEADLINE",
                "LONG_HEADLINE",
                "DESCRIPTION",
                "BUSINESS_NAME",
                "MARKETING_IMAGE",
                "SQUARE_MARKETING_IMAGE",
                "PORTRAIT_MARKETING_IMAGE",
                "LOGO",
                "LANDSCAPE_LOGO",
                "YOUTUBE_VIDEO",
                "CALL_TO_ACTION_SELECTION",
              ]),
            })
          ),
      },
    },
    async (params) =>
      mcpSuccess({
        tool: "validate_pmax_creative_coverage",
        results: validatePmaxCreativeCoverage(params),
      })
  );
}

export function buildAssetGroupAssetLinks(params: AssetGroupAssetLinkInput) {
  const assetGroup = toResourceName(
    params.customer_id,
    "assetGroups",
    params.asset_group_id
  );
  const seen = new Set<string>();
  return params.assets.map((entry) => {
    const asset = toResourceName(params.customer_id, "assets", entry.asset_id);
    const key = `${asset}:${entry.field_type}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate asset/field role: ${key}`);
    }
    seen.add(key);
    return {
      asset_group: assetGroup,
      asset,
      field_type: enumValue(enums.AssetFieldType, entry.field_type),
    };
  });
}

export function validatePmaxCreativeCoverage(
  params: PmaxCreativeCoverageInput
) {
  const counts = params.assets.reduce<Record<string, number>>((result, asset) => {
    result[asset.field_type] = (result[asset.field_type] ?? 0) + 1;
    return result;
  }, {});
  const required: Record<string, number> =
    params.campaign_mode === "RETAIL"
      ? {}
      : {
          HEADLINE: 3,
          LONG_HEADLINE: 1,
          DESCRIPTION: 2,
          BUSINESS_NAME: 1,
          MARKETING_IMAGE: 1,
          SQUARE_MARKETING_IMAGE: 1,
          LOGO: 1,
        };
  const missing = Object.entries(required).flatMap(([fieldType, minimum]) =>
    (counts[fieldType] ?? 0) < minimum
      ? [{ field_type: fieldType, minimum, actual: counts[fieldType] ?? 0 }]
      : []
  );
  return {
    valid: missing.length === 0,
    campaign_mode: params.campaign_mode ?? "STANDARD",
    counts,
    missing,
    recommendations: [
      ...(counts.YOUTUBE_VIDEO
        ? []
        : ["Add a YouTube video asset to avoid relying on automatic video generation."]),
      ...(counts.PORTRAIT_MARKETING_IMAGE
        ? []
        : ["Add a portrait image to improve coverage on vertical inventory."]),
    ],
  };
}

function registerAdFormatTools(server: McpServer) {
  registerRawAdTool(server, {
    name: "create_ad_group_ad",
    title: "Create Raw Ad Group Ad",
    description:
      "Create an AdGroupAd using a raw Google Ads ad payload. Use for ad subtypes not covered by a specialized tool.",
  });
  registerCreateResponsiveDisplayAd(server);
  registerCreateDemandGenAd(server);
  registerCreateShoppingProductAd(server);
  registerCreateDynamicSearchAd(server);
  registerCreateAppAd(server);

  server.registerTool(
    "remove_automatically_created_assets",
    {
      title: "Remove Automatically Created Assets",
      description:
        "Call AdGroupAdService.RemoveAutomaticallyCreatedAssets with a raw request object.",
      inputSchema: {
        customer_id: z.string(),
        request: jsonRecordSchema,
      },
    },
    async (params) => {
      const tool = "remove_automatically_created_assets";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.removeAutomaticallyCreatedAssets(
          params.request as never
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerPolicyTools(server: McpServer) {
  server.registerTool(
    "get_policy_summary",
    {
      title: "Get Policy Summary",
      description: "Fetch policy summary for an ad, keyword criterion, or asset.",
      inputSchema: {
        customer_id: z.string(),
        resource_type: z.enum(["AD", "AD_GROUP_CRITERION", "ASSET"]),
        resource_name: z.string(),
      },
    },
    async (params) => {
      const tool = "get_policy_summary";
      try {
        const customer = getAdsClient(params.customer_id);
        const query =
          params.resource_type === "AD"
            ? `SELECT ad_group_ad.resource_name, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE ad_group_ad.resource_name = '${escapeGaql(params.resource_name)}' LIMIT 1`
            : params.resource_type === "ASSET"
              ? `SELECT asset.resource_name, asset.policy_summary.approval_status, asset.policy_summary.review_status, asset.policy_summary.policy_topic_entries FROM asset WHERE asset.resource_name = '${escapeGaql(params.resource_name)}' LIMIT 1`
              : `SELECT ad_group_criterion.resource_name, ad_group_criterion.policy_summary.approval_status, ad_group_criterion.policy_summary.review_status, ad_group_criterion.policy_summary.policy_topic_entries FROM ad_group_criterion WHERE ad_group_criterion.resource_name = '${escapeGaql(params.resource_name)}' LIMIT 1`;
        const rows = await customer.query(query);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [params.resource_name],
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );

  server.registerTool(
    "validate_ad_copy",
    {
      title: "Validate RSA Ad Copy",
      description:
        "Validate an RSA payload with validate_only=true against Google Ads schema and policy checks.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string(),
        final_url: z.string().url(),
        headlines: z.array(z.string()).min(3).max(15),
        descriptions: z.array(z.string()).min(2).max(4),
      },
    },
    async (params) => {
      const tool = "validate_ad_copy";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [
            {
              ad_group: toResourceName(
                params.customer_id,
                "adGroups",
                params.ad_group_id
              ),
              status: enumValue(enums.AdGroupAdStatus, "ENABLED") as never,
              ad: {
                final_urls: [params.final_url],
                responsive_search_ad: {
                  headlines: params.headlines.map((text) => ({ text })),
                  descriptions: params.descriptions.map((text) => ({ text })),
                },
              },
            },
          ],
          { validate_only: true }
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: true,
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: params.customer_id,
          validate_only: true,
        });
      }
    }
  );
}

function registerCreateResponsiveDisplayAd(server: McpServer) {
  server.registerTool(
    "create_responsive_display_ad",
    {
      title: "Create Responsive Display Ad",
      description:
        "Create a Responsive Display Ad from typed copy and asset IDs. Use create_ad_group_ad for raw ad payloads.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        final_urls: z.array(z.string().url()).min(1),
        final_mobile_urls: z.array(z.string().url()).optional(),
        headlines: z.array(z.string().max(30)).min(1).max(5),
        long_headline: z.string().max(90),
        descriptions: z.array(z.string().max(90)).min(1).max(5),
        business_name: z.string().max(25),
        marketing_image_asset_ids: z.array(z.string()).min(1),
        square_marketing_image_asset_ids: z.array(z.string()).optional(),
        logo_image_asset_ids: z.array(z.string()).optional(),
        square_logo_image_asset_ids: z.array(z.string()).optional(),
        youtube_video_asset_ids: z.array(z.string()).optional(),
        main_color: z.string().optional(),
        accent_color: z.string().optional(),
        allow_flexible_color: z.boolean().optional(),
        call_to_action_text: z.string().optional(),
        price_prefix: z.string().optional(),
        promo_text: z.string().optional(),
        format_setting: z.enum(["ALL_FORMATS", "NON_NATIVE", "NATIVE"]).optional(),
        enable_asset_enhancements: z.boolean().optional(),
        enable_autogen_video: z.boolean().optional(),
        tracking_url_template: z.string().optional(),
        final_url_suffix: z.string().optional(),
        url_custom_parameters: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        ad_fields: jsonRecordSchema.optional(),
        responsive_display_ad_fields: jsonRecordSchema.optional(),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_responsive_display_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [buildResponsiveDisplayAdResource(params)],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}

export function buildResponsiveDisplayAdResource(
  params: ResponsiveDisplayAdInput
): JsonRecord {
  const responsiveDisplayAd: JsonRecord = {
    marketing_images: toAssetRefs(
      params.customer_id,
      params.marketing_image_asset_ids
    ),
    headlines: params.headlines.map((text) => ({ text })),
    long_headline: { text: params.long_headline },
    descriptions: params.descriptions.map((text) => ({ text })),
    business_name: params.business_name,
    ...(params.square_marketing_image_asset_ids?.length
      ? {
          square_marketing_images: toAssetRefs(
            params.customer_id,
            params.square_marketing_image_asset_ids
          ),
        }
      : {}),
    ...(params.logo_image_asset_ids?.length
      ? {
          logo_images: toAssetRefs(params.customer_id, params.logo_image_asset_ids),
        }
      : {}),
    ...(params.square_logo_image_asset_ids?.length
      ? {
          square_logo_images: toAssetRefs(
            params.customer_id,
            params.square_logo_image_asset_ids
          ),
        }
      : {}),
    ...(params.youtube_video_asset_ids?.length
      ? {
          youtube_videos: toAssetRefs(
            params.customer_id,
            params.youtube_video_asset_ids
          ),
        }
      : {}),
    ...(params.main_color ? { main_color: params.main_color } : {}),
    ...(params.accent_color ? { accent_color: params.accent_color } : {}),
    ...(params.allow_flexible_color != null
      ? { allow_flexible_color: params.allow_flexible_color }
      : {}),
    ...(params.call_to_action_text
      ? { call_to_action_text: params.call_to_action_text }
      : {}),
    ...(params.price_prefix ? { price_prefix: params.price_prefix } : {}),
    ...(params.promo_text ? { promo_text: params.promo_text } : {}),
    ...(params.format_setting
      ? {
          format_setting: enumValue(
            enums.DisplayAdFormatSetting,
            params.format_setting
          ),
        }
      : {}),
    ...(params.enable_asset_enhancements != null ||
    params.enable_autogen_video != null
      ? {
          control_spec: {
            ...(params.enable_asset_enhancements != null
              ? { enable_asset_enhancements: params.enable_asset_enhancements }
              : {}),
            ...(params.enable_autogen_video != null
              ? { enable_autogen_video: params.enable_autogen_video }
              : {}),
          },
        }
      : {}),
    ...(params.responsive_display_ad_fields ?? {}),
  };

  return {
    ad_group: toResourceName(params.customer_id, "adGroups", params.ad_group_id),
    status: enumValue(enums.AdGroupAdStatus, params.status ?? "ENABLED"),
    ad: {
      final_urls: params.final_urls,
      ...(params.final_mobile_urls ? { final_mobile_urls: params.final_mobile_urls } : {}),
      ...(params.tracking_url_template
        ? { tracking_url_template: params.tracking_url_template }
        : {}),
      ...(params.final_url_suffix
        ? { final_url_suffix: params.final_url_suffix }
        : {}),
      ...(params.url_custom_parameters
        ? { url_custom_parameters: params.url_custom_parameters }
        : {}),
      responsive_display_ad: responsiveDisplayAd,
      ...(params.ad_fields ?? {}),
    },
  };
}

function toAssetRefs(customerId: string, assetIds: string[]) {
  return assetIds.map((assetId) => ({
    asset: toResourceName(customerId, "assets", assetId),
  }));
}

function registerCreateShoppingProductAd(server: McpServer) {
  server.registerTool(
    "create_shopping_product_ad",
    {
      title: "Create Shopping Product Ad",
      description:
        "Create a Shopping product ad in a Shopping ad group. Listing/product targeting is controlled by product groups.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        ad_fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_shopping_product_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [buildShoppingProductAdResource(params)],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}

export function buildShoppingProductAdResource(
  params: ShoppingProductAdInput
): JsonRecord {
  return {
    ad_group: toResourceName(params.customer_id, "adGroups", params.ad_group_id),
    status: enumValue(enums.AdGroupAdStatus, params.status ?? "ENABLED"),
    ad: {
      shopping_product_ad: {},
      ...(params.ad_fields ?? {}),
    },
  };
}

function registerCreateDemandGenAd(server: McpServer) {
  server.registerTool(
    "create_demand_gen_ad",
    {
      title: "Create Demand Gen Multi Asset Ad",
      description:
        "Create a typed Demand Gen multi-asset ad from copy and asset IDs.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        final_urls: z.array(z.string().url()).min(1),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        headlines: z.array(z.string().max(40)).min(1).max(5),
        descriptions: z.array(z.string().max(90)).min(1).max(5),
        business_name: z.string().max(25),
        marketing_image_asset_ids: z.array(z.string()).min(1),
        square_marketing_image_asset_ids: z.array(z.string()).optional(),
        portrait_marketing_image_asset_ids: z.array(z.string()).optional(),
        tall_portrait_marketing_image_asset_ids: z.array(z.string()).optional(),
        logo_image_asset_ids: z.array(z.string()).optional(),
        classic_display_image_asset_ids: z.array(z.string()).optional(),
        call_to_action_text: z.string().optional(),
        tracking_url_template: z.string().optional(),
        final_url_suffix: z.string().optional(),
        url_custom_parameters: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        ad_fields: jsonRecordSchema.optional(),
        demand_gen_multi_asset_ad_fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_demand_gen_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [buildDemandGenMultiAssetAdResource(params)],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}

export function buildDemandGenMultiAssetAdResource(
  params: DemandGenMultiAssetAdInput
): JsonRecord {
  return {
    ad_group: toResourceName(params.customer_id, "adGroups", params.ad_group_id),
    status: enumValue(enums.AdGroupAdStatus, params.status ?? "ENABLED"),
    ad: {
      final_urls: params.final_urls,
      ...(params.tracking_url_template
        ? { tracking_url_template: params.tracking_url_template }
        : {}),
      ...(params.final_url_suffix
        ? { final_url_suffix: params.final_url_suffix }
        : {}),
      ...(params.url_custom_parameters
        ? { url_custom_parameters: params.url_custom_parameters }
        : {}),
      demand_gen_multi_asset_ad: {
        marketing_images: toAssetRefs(
          params.customer_id,
          params.marketing_image_asset_ids
        ),
        headlines: params.headlines.map((text) => ({ text })),
        descriptions: params.descriptions.map((text) => ({ text })),
        business_name: params.business_name,
        ...(params.square_marketing_image_asset_ids?.length
          ? {
              square_marketing_images: toAssetRefs(
                params.customer_id,
                params.square_marketing_image_asset_ids
              ),
            }
          : {}),
        ...(params.portrait_marketing_image_asset_ids?.length
          ? {
              portrait_marketing_images: toAssetRefs(
                params.customer_id,
                params.portrait_marketing_image_asset_ids
              ),
            }
          : {}),
        ...(params.tall_portrait_marketing_image_asset_ids?.length
          ? {
              tall_portrait_marketing_images: toAssetRefs(
                params.customer_id,
                params.tall_portrait_marketing_image_asset_ids
              ),
            }
          : {}),
        ...(params.logo_image_asset_ids?.length
          ? {
              logo_images: toAssetRefs(
                params.customer_id,
                params.logo_image_asset_ids
              ),
            }
          : {}),
        ...(params.classic_display_image_asset_ids?.length
          ? {
              classic_display_images: toAssetRefs(
                params.customer_id,
                params.classic_display_image_asset_ids
              ),
            }
          : {}),
        ...(params.call_to_action_text
          ? { call_to_action_text: params.call_to_action_text }
          : {}),
        ...(params.demand_gen_multi_asset_ad_fields ?? {}),
      },
      ...(params.ad_fields ?? {}),
    },
  };
}

function registerCreateAppAd(server: McpServer) {
  server.registerTool(
    "create_app_ad",
    {
      title: "Create App Ad",
      description: "Create a typed App ad from text and asset IDs.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        final_urls: z.array(z.string().url()).optional(),
        mandatory_ad_text: z.array(z.string().max(90)).optional(),
        headlines: z.array(z.string().max(30)).optional(),
        descriptions: z.array(z.string().max(90)).optional(),
        image_asset_ids: z.array(z.string()).optional(),
        youtube_video_asset_ids: z.array(z.string()).optional(),
        html5_media_bundle_asset_ids: z.array(z.string()).optional(),
        app_deep_link_asset_id: z.string().optional(),
        ad_fields: jsonRecordSchema.optional(),
        app_ad_fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_app_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [buildAppAdResource(params)],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}

export function buildAppAdResource(params: AppAdInput): JsonRecord {
  return {
    ad_group: toResourceName(params.customer_id, "adGroups", params.ad_group_id),
    status: enumValue(enums.AdGroupAdStatus, params.status ?? "ENABLED"),
    ad: {
      ...(params.final_urls ? { final_urls: params.final_urls } : {}),
      app_ad: {
        ...(params.mandatory_ad_text?.length
          ? {
              mandatory_ad_text: params.mandatory_ad_text.map((text) => ({
                text,
              })),
            }
          : {}),
        ...(params.headlines?.length
          ? { headlines: params.headlines.map((text) => ({ text })) }
          : {}),
        ...(params.descriptions?.length
          ? { descriptions: params.descriptions.map((text) => ({ text })) }
          : {}),
        ...(params.image_asset_ids?.length
          ? { images: toAssetRefs(params.customer_id, params.image_asset_ids) }
          : {}),
        ...(params.youtube_video_asset_ids?.length
          ? {
              youtube_videos: toAssetRefs(
                params.customer_id,
                params.youtube_video_asset_ids
              ),
            }
          : {}),
        ...(params.html5_media_bundle_asset_ids?.length
          ? {
              html5_media_bundles: toAssetRefs(
                params.customer_id,
                params.html5_media_bundle_asset_ids
              ),
            }
          : {}),
        ...(params.app_deep_link_asset_id
          ? {
              app_deep_link: {
                asset: toResourceName(
                  params.customer_id,
                  "assets",
                  params.app_deep_link_asset_id
                ),
              },
            }
          : {}),
        ...(params.app_ad_fields ?? {}),
      },
      ...(params.ad_fields ?? {}),
    },
  };
}

function registerPmaxAssetGroupSignalTools(server: McpServer) {
  server.registerTool(
    "create_pmax_asset_group_signals",
    {
      title: "Create PMax Asset Group Signals",
      description:
        "Create Performance Max asset group search-theme and audience signals.",
      inputSchema: {
        customer_id: z.string(),
        asset_group_id: z.string().describe("Asset group resource name or numeric ID."),
        search_themes: z.array(z.string().min(1)).optional(),
        audience_ids: z
          .array(z.string())
          .optional()
          .describe("Audience resource names or numeric IDs."),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_pmax_asset_group_signals";
      try {
        const resources = buildAssetGroupSignalResources(params);
        if (!resources.length) {
          throw new Error("Provide at least one search theme or audience ID.");
        }
        const customer = getAdsClient(params.customer_id);
        const result = await customer.assetGroupSignals.create(
          resources as never[],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            resources,
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

  registerCollectionMutateTool({
    server,
    name: "remove_pmax_asset_group_signals",
    title: "Remove PMax Asset Group Signals",
    description: "Remove Performance Max asset group signals by resource name.",
    collection: "assetGroupSignals",
    action: "remove",
    resourceLabel: "Asset group signal",
  });
}

export function buildAssetGroupSignalResources(
  params: AssetGroupSignalInput
): JsonRecord[] {
  const assetGroup = toResourceName(
    params.customer_id,
    "assetGroups",
    params.asset_group_id
  );
  return [
    ...(params.search_themes ?? []).map((text) => ({
      asset_group: assetGroup,
      search_theme: { text },
    })),
    ...(params.audience_ids ?? []).map((audienceId) => ({
      asset_group: assetGroup,
      audience: {
        audience: toResourceName(params.customer_id, "audiences", audienceId),
      },
    })),
  ];
}

function registerPmaxListingGroupFilterTools(server: McpServer) {
  server.registerTool(
    "create_pmax_listing_group_filter",
    {
      title: "Create PMax Listing Group Filter",
      description:
        "Create a Performance Max asset group listing group filter for Shopping/Webpage/Retail product partitions.",
      inputSchema: {
        customer_id: z.string(),
        asset_group_id: z.string().describe("Asset group resource name or numeric ID."),
        type: z.enum(["SUBDIVISION", "UNIT_INCLUDED", "UNIT_EXCLUDED"]),
        listing_source: z.enum(["SHOPPING", "WEBPAGE", "RETAIL"]).optional(),
        parent_listing_group_filter_id: z
          .string()
          .optional()
          .describe("Parent listing filter resource name or numeric ID."),
        dimension: z
          .object({
            type: z.enum([
              "PRODUCT_BRAND",
              "PRODUCT_CATEGORY",
              "PRODUCT_CHANNEL",
              "PRODUCT_CONDITION",
              "PRODUCT_CUSTOM_ATTRIBUTE",
              "PRODUCT_ITEM_ID",
              "PRODUCT_TYPE",
              "WEBPAGE_URL_CONTAINS",
              "WEBPAGE_CUSTOM_LABEL",
            ]),
            value: z.string().optional(),
            category_id: z.number().int().optional(),
            level: z.enum(["LEVEL1", "LEVEL2", "LEVEL3", "LEVEL4", "LEVEL5"]).optional(),
            channel: z.enum(["ONLINE", "LOCAL"]).optional(),
            condition: z.enum(["NEW", "REFURBISHED", "USED"]).optional(),
            index: z.enum(["INDEX0", "INDEX1", "INDEX2", "INDEX3", "INDEX4"]).optional(),
          })
          .optional(),
        raw_case_value: jsonRecordSchema.optional(),
        fields: jsonRecordSchema.optional(),
        validate_only: z.boolean().optional(),
      },
    },
    async (params) => {
      const tool = "create_pmax_listing_group_filter";
      try {
        const customer = getAdsClient(params.customer_id);
        const resource = buildAssetGroupListingFilterResource(params);
        const result = await customer.assetGroupListingGroupFilters.create(
          [resource] as never[],
          { validate_only: params.validate_only ?? false }
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
          resource_names: extractResourceNames(result),
          results: {
            resource,
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

  registerCollectionMutateTool({
    server,
    name: "remove_pmax_listing_group_filter",
    title: "Remove PMax Listing Group Filter",
    description: "Remove Performance Max listing group filters by resource name.",
    collection: "assetGroupListingGroupFilters",
    action: "remove",
    resourceLabel: "Asset group listing group filter",
  });
}

export function buildAssetGroupListingFilterResource(
  params: AssetGroupListingFilterInput
): JsonRecord {
  const assetGroup = toResourceName(
    params.customer_id,
    "assetGroups",
    params.asset_group_id
  );
  const caseValue = params.raw_case_value ?? buildListingFilterCaseValue(params);
  return {
    asset_group: assetGroup,
    type: enumValue(enums.ListingGroupFilterType, params.type),
    listing_source: enumValue(
      enums.ListingGroupFilterListingSource,
      params.listing_source ?? "SHOPPING"
    ),
    ...(caseValue ? { case_value: caseValue } : {}),
    ...(params.parent_listing_group_filter_id
      ? {
          parent_listing_group_filter: toAssetGroupListingFilterResourceName(
            params.customer_id,
            params.asset_group_id,
            params.parent_listing_group_filter_id
          ),
        }
      : {}),
    ...(params.fields ?? {}),
  };
}

function buildListingFilterCaseValue(params: AssetGroupListingFilterInput) {
  const dimension = params.dimension;
  if (!dimension) return undefined;
  switch (dimension.type) {
    case "PRODUCT_BRAND":
      return { product_brand: { value: requireDimensionValue(dimension) } };
    case "PRODUCT_CATEGORY":
      if (dimension.category_id == null) {
        throw new Error("dimension.category_id is required for PRODUCT_CATEGORY.");
      }
      return {
        product_category: {
          category_id: dimension.category_id,
          level: enumValue(
            enums.ListingGroupFilterProductCategoryLevel,
            dimension.level ?? "LEVEL1"
          ),
        },
      };
    case "PRODUCT_CHANNEL":
      return {
        product_channel: {
          channel: enumValue(
            enums.ListingGroupFilterProductChannel,
            dimension.channel ?? "ONLINE"
          ),
        },
      };
    case "PRODUCT_CONDITION":
      return {
        product_condition: {
          condition: enumValue(
            enums.ListingGroupFilterProductCondition,
            dimension.condition ?? "NEW"
          ),
        },
      };
    case "PRODUCT_CUSTOM_ATTRIBUTE":
      return {
        product_custom_attribute: {
          value: requireDimensionValue(dimension),
          index: enumValue(
            enums.ListingGroupFilterCustomAttributeIndex,
            dimension.index ?? "INDEX0"
          ),
        },
      };
    case "PRODUCT_ITEM_ID":
      return { product_item_id: { value: requireDimensionValue(dimension) } };
    case "PRODUCT_TYPE":
      return {
        product_type: {
          value: requireDimensionValue(dimension),
          level: enumValue(
            enums.ListingGroupFilterProductTypeLevel,
            dimension.level ?? "LEVEL1"
          ),
        },
      };
    case "WEBPAGE_URL_CONTAINS":
      return {
        webpage: {
          conditions: [{ url_contains: requireDimensionValue(dimension) }],
        },
      };
    case "WEBPAGE_CUSTOM_LABEL":
      return {
        webpage: {
          conditions: [{ custom_label: requireDimensionValue(dimension) }],
        },
      };
  }
}

function requireDimensionValue(
  dimension: NonNullable<AssetGroupListingFilterInput["dimension"]>
) {
  if (!dimension.value) {
    throw new Error(`dimension.value is required for ${dimension.type}.`);
  }
  return dimension.value;
}

function toAssetGroupListingFilterResourceName(
  customerId: string,
  assetGroupIdOrName: string,
  filterIdOrName: string
) {
  if (filterIdOrName.startsWith("customers/")) return filterIdOrName;
  return ResourceNames.assetGroupListingGroupFilter(
    customerId,
    resourceId(assetGroupIdOrName, "assetGroups"),
    filterIdOrName
  );
}

function registerCreateDynamicSearchAd(server: McpServer) {
  server.registerTool(
    "create_dynamic_search_ad",
    {
      title: "Create Dynamic Search Ad",
      description:
        "Create an Expanded Dynamic Search Ad in a DSA ad group. Configure domain/page targets separately.",
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        description: z.string().max(90),
        description2: z.string().max(90).optional(),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        tracking_url_template: z.string().optional(),
        final_url_suffix: z.string().optional(),
        url_custom_parameters: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        ad_fields: jsonRecordSchema.optional(),
        expanded_dynamic_search_ad_fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_dynamic_search_ad";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [buildDynamicSearchAdResource(params)],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}

export function buildDynamicSearchAdResource(
  params: DynamicSearchAdInput
): JsonRecord {
  return {
    ad_group: toResourceName(params.customer_id, "adGroups", params.ad_group_id),
    status: enumValue(enums.AdGroupAdStatus, params.status ?? "ENABLED"),
    ad: {
      ...(params.tracking_url_template
        ? { tracking_url_template: params.tracking_url_template }
        : {}),
      ...(params.final_url_suffix
        ? { final_url_suffix: params.final_url_suffix }
        : {}),
      ...(params.url_custom_parameters
        ? { url_custom_parameters: params.url_custom_parameters }
        : {}),
      expanded_dynamic_search_ad: {
        description: params.description,
        ...(params.description2 ? { description2: params.description2 } : {}),
        ...(params.expanded_dynamic_search_ad_fields ?? {}),
      },
      ...(params.ad_fields ?? {}),
    },
  };
}

function resourceId(idOrName: string, collection: string) {
  const trimmed = idOrName.trim();
  const match = new RegExp(`/${collection}/(-?\\d+)$`).exec(trimmed);
  return match?.[1] ?? trimmed;
}

function registerRawAdTool(
  server: McpServer,
  config: { name: string; title: string; description: string }
) {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: {
        customer_id: z.string(),
        ad_group_id: z.string().describe("Ad group resource name or numeric ID."),
        ad: jsonRecordSchema.describe("Raw ad payload."),
        status: z.enum(["ENABLED", "PAUSED"]).optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = config.name;
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.adGroupAds.create(
          [
            {
              ad_group: toResourceName(
                params.customer_id,
                "adGroups",
                params.ad_group_id
              ),
              status: enumValue(
                enums.AdGroupAdStatus,
                params.status ?? "ENABLED"
              ) as never,
              ad: params.ad,
            },
          ],
          mutateOptions(params)
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}

function registerAttachmentTool(
  server: McpServer,
  name: string,
  collectionName: "campaignAssets" | "adGroupAssets" | "customerAssets",
  parentField?: "campaign" | "ad_group",
  parentCollection?: "campaigns" | "adGroups",
  remove = false
) {
  server.registerTool(
    name,
    {
      title: name
        .split("_")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" "),
      description: remove
        ? "Detach asset links by resource name."
        : "Attach assets to a campaign, ad group, or customer.",
      inputSchema: {
        customer_id: z.string(),
        parent_id: z
          .string()
          .optional()
          .describe("Parent resource name or numeric ID when attaching below customer."),
        asset_id: z
          .string()
          .optional()
          .describe("Asset resource name or numeric ID for attach actions."),
        field_type: z.string().optional(),
        resource_names: z
          .array(z.string())
          .optional()
          .describe("Attachment resource names for detach actions."),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = name;
      try {
        const customer = getAdsClient(params.customer_id);
        const collection = (
          customer as unknown as Record<
            string,
            {
              create: (resources: unknown[], options?: unknown) => Promise<unknown>;
              remove: (resourceNames: string[], options?: unknown) => Promise<unknown>;
            }
          >
        )[collectionName];
        const options = mutateOptions(params);
        const result = remove
          ? await collection.remove(params.resource_names ?? [], options)
          : await collection.create(
              [
                {
                  ...(parentField && parentCollection
                    ? {
                        [parentField]: toResourceName(
                          params.customer_id,
                          parentCollection,
                          params.parent_id ?? ""
                        ),
                      }
                    : {}),
                  asset: toResourceName(
                    params.customer_id,
                    "assets",
                    params.asset_id ?? ""
                  ),
                  ...(params.field_type ? { field_type: params.field_type } : {}),
                },
              ],
              options
            );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: params.validate_only ?? false,
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
}
