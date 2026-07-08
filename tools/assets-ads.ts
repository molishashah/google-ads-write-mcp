import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
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
}

function registerAdFormatTools(server: McpServer) {
  registerRawAdTool(server, {
    name: "create_ad_group_ad",
    title: "Create Raw Ad Group Ad",
    description:
      "Create an AdGroupAd using a raw Google Ads ad payload. Use for ad subtypes not covered by a specialized tool.",
  });
  registerCreateResponsiveDisplayAd(server);
  registerRawAdTool(server, {
    name: "create_demand_gen_ad",
    title: "Create Demand Gen Ad",
    description:
      "Create a Demand Gen ad. Pass one of the Demand Gen ad payloads under ad.",
  });
  registerRawAdTool(server, {
    name: "create_shopping_product_ad",
    title: "Create Shopping Product Ad",
    description:
      "Create a Shopping/Product ad. Pass the shopping ad payload under ad.",
  });
  registerCreateDynamicSearchAd(server);
  registerRawAdTool(server, {
    name: "create_app_ad",
    title: "Create App Ad",
    description: "Create an App ad. Pass app_ad or app_engagement_ad payload under ad.",
  });

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
