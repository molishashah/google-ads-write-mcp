import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, ResourceNames, services } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  customerScopedConstant,
  escapeGaql,
  extractRequestId,
  extractResourceNames,
  toResourceName,
} from "@/lib/google-ads-utils";
import {
  formatError,
  mcpError,
  mcpJsonError,
  mcpSuccess,
  mcpText,
} from "@/lib/mcp-helpers";
import {
  jsonRecordSchema,
  mutateOptions,
  mutateOptionSchema,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

const CUSTOMER_ID_RE = /^\d+$/;
const CONVERSION_ACTION_RE = /^customers\/(\d+)\/conversionActions\/(\d+)$/;
const GOOGLE_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const SHA256_HEX_ANY_CASE_RE = /^[a-fA-F0-9]{64}$/;
const ENUM_RE = /^[A-Z][A-Z0-9_]*$/;
const DEFAULT_CONVERSION_WINDOW_DAYS = 90;
const CONVERSION_ACTION_CATEGORIES = [
  "DEFAULT",
  "PAGE_VIEW",
  "PURCHASE",
  "SIGNUP",
  "DOWNLOAD",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "SUBSCRIBE_PAID",
  "PHONE_CALL_LEAD",
  "IMPORTED_LEAD",
  "SUBMIT_LEAD_FORM",
  "BOOK_APPOINTMENT",
  "REQUEST_QUOTE",
  "GET_DIRECTIONS",
  "OUTBOUND_CLICK",
  "CONTACT",
  "ENGAGEMENT",
  "STORE_VISIT",
  "STORE_SALE",
  "QUALIFIED_LEAD",
  "CONVERTED_LEAD",
  "YOUTUBE_FOLLOW_ON_VIEWS",
] as const;
const CONVERSION_GOAL_ORIGINS = [
  "WEBSITE",
  "GOOGLE_HOSTED",
  "APP",
  "CALL_FROM_ADS",
  "STORE",
  "YOUTUBE_HOSTED",
] as const;
const CONVERSION_ACTION_TYPES = [
  "WEBPAGE",
  "UPLOAD_CLICKS",
  "UPLOAD_CALLS",
  "AD_CALL",
  "CLICK_TO_CALL",
  "WEBSITE_CALL",
  "STORE_SALES",
  "STORE_SALES_DIRECT_UPLOAD",
  "GOOGLE_HOSTED",
  "LEAD_FORM_SUBMIT",
] as const;
const CONVERSION_CUSTOM_VARIABLE_STATUSES = [
  "ACTIVATION_NEEDED",
  "ENABLED",
  "PAUSED",
] as const;
const CONVERSION_VALUE_RULE_STATUSES = ["ENABLED", "PAUSED", "REMOVED"] as const;
const VALUE_RULE_OPERATIONS = ["ADD", "MULTIPLY", "SET"] as const;
const VALUE_RULE_DEVICE_TYPES = ["MOBILE", "DESKTOP", "TABLET"] as const;
const VALUE_RULE_GEO_MATCH_TYPES = ["ANY", "LOCATION_OF_PRESENCE"] as const;

type ErrorClass =
  | "config"
  | "config/auth"
  | "data"
  | "duplicate"
  | "retryable"
  | "warning/data"
  | "unknown";

type ValidationIssue = {
  index: number;
  field: string;
  class: ErrorClass;
  message: string;
};

type NormalizedClickConversion = {
  conversionAction: string;
  conversionDateTime: string;
  orderId: string;
  hashedEmail: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  currencyCode?: string;
  conversionValue?: number;
  consent?: {
    adUserData?: "GRANTED" | "DENIED" | "UNSPECIFIED";
    adPersonalization?: "GRANTED" | "DENIED" | "UNSPECIFIED";
  };
  conversionEnvironment?: "APP" | "WEB" | "UNSPECIFIED" | "UNKNOWN";
  customerType?: "NEW" | "RETURNING" | "UNSPECIFIED" | "UNKNOWN";
};

type RawClickConversion = {
  conversionAction?: string;
  conversion_action?: string;
  conversionDateTime?: string;
  conversion_date_time?: string;
  orderId?: string;
  order_id?: string;
  hashedEmail?: string;
  hashed_email?: string;
  emailSha256?: string;
  email_sha256?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  currencyCode?: string;
  currency_code?: string;
  conversionValue?: number;
  conversion_value?: number;
  consent?: NormalizedClickConversion["consent"];
  conversionEnvironment?: NormalizedClickConversion["conversionEnvironment"];
  conversion_environment?: NormalizedClickConversion["conversionEnvironment"];
  customerType?: NormalizedClickConversion["customerType"];
  customer_type?: NormalizedClickConversion["customerType"];
};

export type ConversionActionSetupInput = {
  name: string;
  type: (typeof CONVERSION_ACTION_TYPES)[number];
  category?: (typeof CONVERSION_ACTION_CATEGORIES)[number];
  status?: "ENABLED" | "REMOVED" | "HIDDEN";
  include_in_conversions_metric?: boolean;
  counting_type?: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  primary_for_goal?: boolean;
  default_value?: number;
  currency_code?: string;
  always_use_default_value?: boolean;
  click_through_lookback_window_days?: number;
  view_through_lookback_window_days?: number;
  fields?: Record<string, unknown>;
};

export type ConversionCustomVariableInput = {
  name: string;
  tag?: string;
  status?: (typeof CONVERSION_CUSTOM_VARIABLE_STATUSES)[number];
  fields?: Record<string, unknown>;
};

export type ConversionValueRuleInput = {
  customer_id: string;
  operation: (typeof VALUE_RULE_OPERATIONS)[number];
  value: number;
  status?: (typeof CONVERSION_VALUE_RULE_STATUSES)[number];
  geo_target_constant_ids?: string[];
  excluded_geo_target_constant_ids?: string[];
  geo_match_type?: (typeof VALUE_RULE_GEO_MATCH_TYPES)[number];
  excluded_geo_match_type?: (typeof VALUE_RULE_GEO_MATCH_TYPES)[number];
  device_types?: Array<(typeof VALUE_RULE_DEVICE_TYPES)[number]>;
  user_list_ids?: string[];
  user_interest_ids?: string[];
  fields?: Record<string, unknown>;
};

type GoogleAdsFailureLike = {
  errors?: GoogleAdsErrorLike[];
  request_id?: string;
  requestId?: string;
};

type GoogleAdsErrorLike = {
  error_code?: Record<string, string | number | null | undefined>;
  errorCode?: Record<string, string | number | null | undefined>;
  message?: string;
  location?: {
    field_path_elements?: FieldPathElementLike[];
    fieldPathElements?: FieldPathElementLike[];
  };
  trigger?: unknown;
};

type FieldPathElementLike = {
  field_name?: string;
  fieldName?: string;
  index?: number | string | null;
};

type ParsedGoogleAdsError = {
  index: number | null;
  codeCategory: string | null;
  code: string | null;
  class: ErrorClass;
  message: string;
  fieldPath: string;
};

const consentSchema = z
  .object({
    adUserData: z.enum(["GRANTED", "DENIED", "UNSPECIFIED"]).optional(),
    adPersonalization: z.enum(["GRANTED", "DENIED", "UNSPECIFIED"]).optional(),
  })
  .optional();

const clickConversionSchema = z.object({
  conversionAction: z.string().optional(),
  conversion_action: z.string().optional(),
  conversionDateTime: z.string().optional(),
  conversion_date_time: z.string().optional(),
  orderId: z.string().optional(),
  order_id: z.string().optional(),
  hashedEmail: z.string().optional(),
  hashed_email: z.string().optional(),
  emailSha256: z.string().optional(),
  email_sha256: z.string().optional(),
  gclid: z.string().optional(),
  gbraid: z.string().optional(),
  wbraid: z.string().optional(),
  currencyCode: z.string().length(3).optional(),
  currency_code: z.string().length(3).optional(),
  conversionValue: z.number().finite().optional(),
  conversion_value: z.number().finite().optional(),
  consent: consentSchema,
  conversionEnvironment: z
    .enum(["APP", "WEB", "UNSPECIFIED", "UNKNOWN"])
    .optional(),
  conversion_environment: z
    .enum(["APP", "WEB", "UNSPECIFIED", "UNKNOWN"])
    .optional(),
  customerType: z.enum(["NEW", "RETURNING", "UNSPECIFIED", "UNKNOWN"]).optional(),
  customer_type: z.enum(["NEW", "RETURNING", "UNSPECIFIED", "UNKNOWN"]).optional(),
});

export function registerConversionTools(server: McpServer) {
  registerGetConversionCustomer(server);
  registerListConversionActions(server);
  registerGetConversionAction(server);
  registerCreateConversionAction(server);
  registerTypedConversionSetupTools(server);
  registerConversionActionAdminTools(server);
  registerGoalTools(server);
  registerConversionValueTools(server);
  registerValidateOfflineConversionPayload(server);
  registerUploadClickConversions(server);
  registerAdditionalUploadTools(server);
  registerGetOfflineConversionDiagnostics(server);
  registerConversionDiagnostics(server);
}

function registerGetConversionCustomer(server: McpServer) {
  server.registerTool(
    "get_conversion_customer",
    {
      title: "Get Conversion Customer",
      description:
        "Return the effective Google Ads conversion customer for an account, " +
        "plus customer data terms and enhanced conversions for leads status.",
      inputSchema: {
        customerId: z
          .string()
          .optional()
          .describe("Google Ads customer ID, no hyphens."),
        customer_id: z
          .string()
          .optional()
          .describe("Alias for customerId, kept for this MCP's older tools."),
      },
    },
    async (params) => {
      const customerId = requireCustomerId(params);
      if (!customerId.ok) return customerId.error;

      try {
        const requested = await fetchConversionTrackingSetting(customerId.value);
        const conversionCustomerId = parseCustomerId(
          requested.conversion_customer_resource_name
        );

        let conversionCustomer = requested;
        if (conversionCustomerId && conversionCustomerId !== customerId.value) {
          try {
            conversionCustomer =
              await fetchConversionTrackingSetting(conversionCustomerId);
          } catch (err) {
            return mcpText(
              JSON.stringify(
                {
                  requested_customer: requested,
                  conversion_customer_lookup_error: formatError(err),
                },
                null,
                2
              )
            );
          }
        }

        return mcpText(
          JSON.stringify(
            {
              requested_customer: requested,
              conversion_customer: conversionCustomer,
            },
            null,
            2
          )
        );
      } catch (err) {
        return mcpError("fetching conversion customer", err);
      }
    }
  );
}

function registerListConversionActions(server: McpServer) {
  server.registerTool(
    "list_conversion_actions",
    {
      title: "List Conversion Actions",
      description:
        "List conversion actions for a Google Ads conversion customer. " +
        "Use type=UPLOAD_CLICKS to discover actions eligible for offline " +
        "click conversions and enhanced conversions for leads.",
      inputSchema: {
        customerId: z.string().optional().describe("Google Ads customer ID."),
        customer_id: z.string().optional().describe("Alias for customerId."),
        status: z
          .string()
          .optional()
          .describe("Optional enum filter, e.g. ENABLED or HIDDEN."),
        type: z
          .string()
          .optional()
          .describe("Optional enum filter, e.g. UPLOAD_CLICKS."),
      },
    },
    async (params) => {
      const customerId = requireCustomerId(params);
      if (!customerId.ok) return customerId.error;

      try {
        const conditions: string[] = [];
        if (params.status) {
          conditions.push(
            `conversion_action.status = ${sanitizeEnum(params.status)}`
          );
        }
        if (params.type) {
          conditions.push(`conversion_action.type = ${sanitizeEnum(params.type)}`);
        }

        const customer = getAdsClient(customerId.value);
        const rows = await customer.query<
          {
            conversion_action: {
              resource_name?: string | null;
              id?: number | string | null;
              name?: string | null;
              status?: string | number | null;
              type?: string | number | null;
              category?: string | number | null;
              include_in_conversions_metric?: boolean | null;
              counting_type?: string | number | null;
            };
          }[]
        >(
          `SELECT
             conversion_action.resource_name,
             conversion_action.id,
             conversion_action.name,
             conversion_action.status,
             conversion_action.type,
             conversion_action.category,
             conversion_action.include_in_conversions_metric,
             conversion_action.counting_type
           FROM conversion_action` +
            (conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "") +
            ` ORDER BY conversion_action.name`
        );

        const actions = rows.map((row) => {
          const action = row.conversion_action;
          return {
            resource_name: action.resource_name ?? null,
            id: action.id != null ? String(action.id) : null,
            name: action.name ?? null,
            status: normalizeEnumLabel(action.status),
            type: normalizeEnumLabel(action.type),
            category: normalizeEnumLabel(action.category),
            include_in_conversions: action.include_in_conversions_metric ?? null,
            counting_type: normalizeEnumLabel(action.counting_type),
          };
        });

        return mcpText(JSON.stringify({ conversion_actions: actions }, null, 2));
      } catch (err) {
        return mcpError("listing conversion actions", err);
      }
    }
  );
}

function registerGetConversionAction(server: McpServer) {
  server.registerTool(
    "get_conversion_action",
    {
      title: "Get Conversion Action",
      description: "Fetch one conversion action by resource name or numeric ID.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        conversion_action_id: z
          .string()
          .describe("Conversion action resource name or numeric ID."),
      },
    },
    async (params) => {
      const tool = "get_conversion_action";
      try {
        const customer = getAdsClient(params.customer_id);
        const resourceName = toResourceName(
          params.customer_id,
          "conversionActions",
          params.conversion_action_id
        );
        const query = `
          SELECT
            conversion_action.resource_name,
            conversion_action.id,
            conversion_action.name,
            conversion_action.status,
            conversion_action.type,
            conversion_action.category,
            conversion_action.origin,
            conversion_action.primary_for_goal,
            conversion_action.include_in_conversions_metric,
            conversion_action.counting_type,
            conversion_action.value_settings.default_value,
            conversion_action.value_settings.always_use_default_value,
            conversion_action.attribution_model_settings.attribution_model,
            conversion_action.tag_snippets
          FROM conversion_action
          WHERE conversion_action.resource_name = '${escapeGaql(resourceName)}'
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

function registerCreateConversionAction(server: McpServer) {
  server.registerTool(
    "create_conversion_action",
    {
      title: "Create Conversion Action",
      description:
        "Create a conversion action. Defaults to UPLOAD_CLICKS for offline " +
        "conversions / EC4L, but type and raw fields can be supplied for other actions.",
      inputSchema: {
        customerId: z.string().optional().describe("Google Ads customer ID."),
        customer_id: z.string().optional().describe("Alias for customerId."),
        name: z.string().min(1).describe("Conversion action name."),
        type: z
          .string()
          .optional()
          .describe("ConversionActionType enum. Default: UPLOAD_CLICKS."),
        category: z
          .string()
          .optional()
          .describe("ConversionActionCategory enum. Default: IMPORTED_LEAD."),
        status: z
          .string()
          .optional()
          .describe("ConversionActionStatus enum. Default: ENABLED."),
        includeInConversions: z
          .boolean()
          .optional()
          .describe("Include in Conversions metric. Default: true."),
        countingType: z
          .string()
          .optional()
          .describe("ONE_PER_CLICK or MANY_PER_CLICK. Default: ONE_PER_CLICK."),
        defaultValue: z
          .number()
          .finite()
          .optional()
          .describe("Optional default conversion value."),
        currencyCode: z
          .string()
          .length(3)
          .optional()
          .describe("Default value currency code, e.g. USD."),
        alwaysUseDefaultValue: z
          .boolean()
          .optional()
          .describe("Default: false."),
        primary_for_goal: z.boolean().optional(),
        fields: jsonRecordSchema
          .optional()
          .describe("Additional raw ConversionAction fields."),
        validateOnly: z
          .boolean()
          .optional()
          .describe("Validate against Google without creating. Default: false."),
        validate_only: z.boolean().optional().describe("Alias for validateOnly."),
      },
    },
    async (params) => {
      const customerId = requireCustomerId(params);
      if (!customerId.ok) return customerId.error;

      try {
        const customer = getAdsClient(customerId.value);
        const conversionAction = {
          name: params.name,
          type: enumValue(
            enums.ConversionActionType,
            params.type ?? "UPLOAD_CLICKS"
          ),
          category: enumValue(
            enums.ConversionActionCategory,
            params.category ?? "IMPORTED_LEAD"
          ),
          status: enumValue(
            enums.ConversionActionStatus,
            params.status ?? "ENABLED"
          ),
          include_in_conversions_metric: params.includeInConversions ?? true,
          counting_type: enumValue(
            enums.ConversionActionCountingType,
            params.countingType ?? "ONE_PER_CLICK"
          ),
          ...(params.primary_for_goal != null
            ? { primary_for_goal: params.primary_for_goal }
            : {}),
          ...(params.defaultValue != null || params.currencyCode
            ? {
                value_settings: {
                  default_value: params.defaultValue ?? 0,
                  default_currency_code: params.currencyCode ?? "USD",
                  always_use_default_value:
                    params.alwaysUseDefaultValue ?? false,
                },
              }
            : {}),
          ...(params.fields ?? {}),
        };

        const result = await customer.conversionActions.create(
          [conversionAction] as never[],
          { validate_only: params.validateOnly ?? params.validate_only ?? false }
        );

        const validateOnly = params.validateOnly ?? params.validate_only ?? false;
        if (validateOnly) {
          return mcpSuccess({
            tool: "create_conversion_action",
            customer_id: customerId.value,
            validate_only: true,
            results: {
              validated: true,
              conversion_action: conversionAction,
            },
          });
        }

        return mcpSuccess({
          tool: "create_conversion_action",
          customer_id: customerId.value,
          validate_only: false,
          resource_names: extractResourceNames(result),
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpError("creating conversion action", err);
      }
    }
  );
}

function registerTypedConversionSetupTools(server: McpServer) {
  registerTypedConversionActionTool(server, {
    name: "create_offline_conversion_action",
    title: "Create Offline Conversion Action",
    description:
      "Create an offline click conversion action for UploadClickConversions / enhanced conversions for leads.",
    type: "UPLOAD_CLICKS",
    defaultCategory: "IMPORTED_LEAD",
  });
  registerTypedConversionActionTool(server, {
    name: "create_website_conversion_action",
    title: "Create Website Conversion Action",
    description: "Create a website conversion action for Google tag / webpage tracking.",
    type: "WEBPAGE",
    defaultCategory: "PAGE_VIEW",
  });
}

function registerTypedConversionActionTool(
  server: McpServer,
  config: {
    name: string;
    title: string;
    description: string;
    type: (typeof CONVERSION_ACTION_TYPES)[number];
    defaultCategory: (typeof CONVERSION_ACTION_CATEGORIES)[number];
  }
) {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        category: z.enum(CONVERSION_ACTION_CATEGORIES).optional(),
        status: z.enum(["ENABLED", "REMOVED", "HIDDEN"]).optional(),
        include_in_conversions_metric: z.boolean().optional(),
        counting_type: z.enum(["ONE_PER_CLICK", "MANY_PER_CLICK"]).optional(),
        primary_for_goal: z.boolean().optional(),
        default_value: z.number().finite().optional(),
        currency_code: z.string().length(3).optional(),
        always_use_default_value: z.boolean().optional(),
        click_through_lookback_window_days: z.number().int().positive().optional(),
        view_through_lookback_window_days: z.number().int().positive().optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = config.name;
      try {
        const customer = getAdsClient(params.customer_id);
        const options = mutateOptions(params);
        const conversionAction = buildConversionActionResource({
          ...params,
          type: config.type,
          category: params.category ?? config.defaultCategory,
        });
        const result = await customer.conversionActions.create(
          [conversionAction] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: {
            conversion_action: conversionAction,
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

export function buildConversionActionResource(
  params: ConversionActionSetupInput
) {
  return {
    name: params.name,
    type: enumValue(enums.ConversionActionType, params.type),
    category: enumValue(
      enums.ConversionActionCategory,
      params.category ?? "DEFAULT"
    ),
    status: enumValue(enums.ConversionActionStatus, params.status ?? "ENABLED"),
    include_in_conversions_metric:
      params.include_in_conversions_metric ?? true,
    counting_type: enumValue(
      enums.ConversionActionCountingType,
      params.counting_type ?? "ONE_PER_CLICK"
    ),
    primary_for_goal: params.primary_for_goal ?? true,
    ...(params.default_value != null || params.currency_code
      ? {
          value_settings: {
            default_value: params.default_value ?? 0,
            default_currency_code: params.currency_code ?? "USD",
            always_use_default_value:
              params.always_use_default_value ?? false,
          },
        }
      : {}),
    ...(params.click_through_lookback_window_days != null
      ? {
          click_through_lookback_window_days:
            params.click_through_lookback_window_days,
        }
      : {}),
    ...(params.view_through_lookback_window_days != null
      ? {
          view_through_lookback_window_days:
            params.view_through_lookback_window_days,
        }
      : {}),
    ...(params.fields ?? {}),
  };
}

function registerConversionActionAdminTools(server: McpServer) {
  registerCollectionMutateTool({
    server,
    name: "update_conversion_action",
    title: "Update Conversion Action",
    description: "Update raw mutable ConversionAction fields.",
    collection: "conversionActions",
    action: "update",
    resourceLabel: "Conversion action",
  });

  registerCollectionMutateTool({
    server,
    name: "remove_conversion_action",
    title: "Remove Conversion Action",
    description: "Irreversibly remove conversion actions.",
    collection: "conversionActions",
    action: "remove",
    resourceLabel: "Conversion action",
  });
}

function registerGoalTools(server: McpServer) {
  registerGoalQueryTool(
    server,
    "list_customer_conversion_goals",
    "customer_conversion_goal",
    [
      "customer_conversion_goal.resource_name",
      "customer_conversion_goal.category",
      "customer_conversion_goal.origin",
      "customer_conversion_goal.biddable",
    ]
  );
  registerCollectionMutateTool({
    server,
    name: "update_customer_conversion_goal",
    title: "Update Customer Conversion Goal",
    description: "Update customer conversion goals.",
    collection: "customerConversionGoals",
    action: "update",
    resourceLabel: "Customer conversion goal",
  });
  registerSetCustomerConversionGoalBiddable(server);
  registerGoalQueryTool(
    server,
    "list_campaign_conversion_goals",
    "campaign_conversion_goal",
    [
      "campaign_conversion_goal.resource_name",
      "campaign_conversion_goal.campaign",
      "campaign_conversion_goal.category",
      "campaign_conversion_goal.origin",
      "campaign_conversion_goal.biddable",
    ]
  );
  registerCollectionMutateTool({
    server,
    name: "set_campaign_conversion_goals",
    title: "Set Campaign Conversion Goals",
    description: "Update campaign conversion goals.",
    collection: "campaignConversionGoals",
    action: "update",
    resourceLabel: "Campaign conversion goal",
  });
  registerSetCampaignConversionGoalBiddable(server);
  registerCollectionMutateTool({
    server,
    name: "create_custom_conversion_goal",
    title: "Create Custom Conversion Goal",
    description: "Create custom conversion goals.",
    collection: "customConversionGoals",
    action: "create",
    resourceLabel: "Custom conversion goal",
  });
  registerCollectionMutateTool({
    server,
    name: "update_conversion_goal_campaign_config",
    title: "Update Conversion Goal Campaign Config",
    description: "Update conversion goal campaign configs.",
    collection: "conversionGoalCampaignConfigs",
    action: "update",
    resourceLabel: "Conversion goal campaign config",
  });
}

function registerSetCustomerConversionGoalBiddable(server: McpServer) {
  server.registerTool(
    "set_customer_conversion_goal_biddable",
    {
      title: "Set Customer Conversion Goal Biddable",
      description:
        "Enable or disable bidding for a customer conversion goal by category and origin.",
      inputSchema: {
        customer_id: z.string(),
        category: z.enum(CONVERSION_ACTION_CATEGORIES),
        origin: z.enum(CONVERSION_GOAL_ORIGINS).default("WEBSITE"),
        biddable: z.boolean(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "set_customer_conversion_goal_biddable";
      try {
        const customer = getAdsClient(params.customer_id);
        const options = mutateOptions(params);
        const resourceName = buildCustomerConversionGoalResourceName(
          params.customer_id,
          params.category,
          params.origin
        );
        const result = await customer.customerConversionGoals.update(
          [{ resource_name: resourceName, biddable: params.biddable }] as never[],
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
}

function registerSetCampaignConversionGoalBiddable(server: McpServer) {
  server.registerTool(
    "set_campaign_conversion_goal_biddable",
    {
      title: "Set Campaign Conversion Goal Biddable",
      description:
        "Enable or disable bidding for a campaign conversion goal by campaign, category, and origin.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string().describe("Campaign resource name or numeric ID."),
        category: z.enum(CONVERSION_ACTION_CATEGORIES),
        origin: z.enum(CONVERSION_GOAL_ORIGINS).default("WEBSITE"),
        biddable: z.boolean(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "set_campaign_conversion_goal_biddable";
      try {
        const customer = getAdsClient(params.customer_id);
        const options = mutateOptions(params);
        const resourceName = buildCampaignConversionGoalResourceName(
          params.customer_id,
          params.campaign_id,
          params.category,
          params.origin
        );
        const result = await customer.campaignConversionGoals.update(
          [{ resource_name: resourceName, biddable: params.biddable }] as never[],
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
}

export function buildCustomerConversionGoalResourceName(
  customerId: string,
  category: (typeof CONVERSION_ACTION_CATEGORIES)[number],
  origin: (typeof CONVERSION_GOAL_ORIGINS)[number]
) {
  return ResourceNames.customerConversionGoal(
    customerId,
    enumValue(enums.ConversionActionCategory, category),
    enumValue(enums.ConversionOrigin, origin)
  );
}

export function buildCampaignConversionGoalResourceName(
  customerId: string,
  campaignId: string,
  category: (typeof CONVERSION_ACTION_CATEGORIES)[number],
  origin: (typeof CONVERSION_GOAL_ORIGINS)[number]
) {
  return ResourceNames.campaignConversionGoal(
    customerId,
    resourceId(campaignId, "campaigns"),
    enumValue(enums.ConversionActionCategory, category),
    enumValue(enums.ConversionOrigin, origin)
  );
}

function registerConversionValueTools(server: McpServer) {
  registerCreateConversionCustomVariable(server);
  registerCollectionMutateTool({
    server,
    name: "update_conversion_custom_variable",
    title: "Update Conversion Custom Variable",
    description: "Update conversion custom variables.",
    collection: "conversionCustomVariables",
    action: "update",
    resourceLabel: "Conversion custom variable",
  });
  registerCreateConversionValueRule(server);
  registerCollectionMutateTool({
    server,
    name: "update_conversion_value_rule",
    title: "Update Conversion Value Rule",
    description: "Update conversion value rules.",
    collection: "conversionValueRules",
    action: "update",
    resourceLabel: "Conversion value rule",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_conversion_value_rule",
    title: "Remove Conversion Value Rule",
    description: "Remove conversion value rules.",
    collection: "conversionValueRules",
    action: "remove",
    resourceLabel: "Conversion value rule",
  });
}

function registerCreateConversionCustomVariable(server: McpServer) {
  server.registerTool(
    "create_conversion_custom_variable",
    {
      title: "Create Conversion Custom Variable",
      description:
        "Create a conversion custom variable from typed fields. Use mutate_google_ads_resources for raw create payloads.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1),
        tag: z.string().optional(),
        status: z.enum(CONVERSION_CUSTOM_VARIABLE_STATUSES).optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_conversion_custom_variable";
      try {
        const customer = getAdsClient(params.customer_id);
        const options = mutateOptions(params);
        const resource = buildConversionCustomVariableResource(params);
        const result = await customer.conversionCustomVariables.create(
          [resource] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: {
            conversion_custom_variable: resource,
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

export function buildConversionCustomVariableResource(
  params: ConversionCustomVariableInput
) {
  return {
    name: params.name,
    ...(params.tag ? { tag: params.tag } : {}),
    ...(params.status
      ? {
          status: enumValue(
            enums.ConversionCustomVariableStatus,
            params.status
          ),
        }
      : {}),
    ...(params.fields ?? {}),
  };
}

function registerCreateConversionValueRule(server: McpServer) {
  server.registerTool(
    "create_conversion_value_rule",
    {
      title: "Create Conversion Value Rule",
      description:
        "Create a conversion value rule with typed action and common geo/device/audience conditions.",
      inputSchema: {
        customer_id: z.string(),
        operation: z.enum(VALUE_RULE_OPERATIONS),
        value: z.number().finite(),
        status: z.enum(CONVERSION_VALUE_RULE_STATUSES).optional(),
        geo_target_constant_ids: z.array(z.string()).optional(),
        excluded_geo_target_constant_ids: z.array(z.string()).optional(),
        geo_match_type: z.enum(VALUE_RULE_GEO_MATCH_TYPES).optional(),
        excluded_geo_match_type: z.enum(VALUE_RULE_GEO_MATCH_TYPES).optional(),
        device_types: z.array(z.enum(VALUE_RULE_DEVICE_TYPES)).optional(),
        user_list_ids: z.array(z.string()).optional(),
        user_interest_ids: z.array(z.string()).optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_conversion_value_rule";
      try {
        const customer = getAdsClient(params.customer_id);
        const options = mutateOptions(params);
        const resource = buildConversionValueRuleResource(params);
        const result = await customer.conversionValueRules.create(
          [resource] as never[],
          options
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: {
            conversion_value_rule: resource,
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

export function buildConversionValueRuleResource(
  params: ConversionValueRuleInput
) {
  const resource = {
    action: {
      operation: enumValue(enums.ValueRuleOperation, params.operation),
      value: params.value,
    },
    status: enumValue(
      enums.ConversionValueRuleStatus,
      params.status ?? "ENABLED"
    ),
    ...buildConversionValueRuleConditions(params),
    ...(params.fields ?? {}),
  };
  const hasCondition =
    "geo_location_condition" in resource ||
    "device_condition" in resource ||
    "audience_condition" in resource ||
    params.fields != null;
  if (!hasCondition) {
    throw new Error(
      "Provide at least one geo/device/audience condition or raw fields for the value rule."
    );
  }
  return resource;
}

function buildConversionValueRuleConditions(params: ConversionValueRuleInput) {
  const conditions: Record<string, unknown> = {};
  if (
    params.geo_target_constant_ids?.length ||
    params.excluded_geo_target_constant_ids?.length ||
    params.geo_match_type ||
    params.excluded_geo_match_type
  ) {
    conditions.geo_location_condition = {
      ...(params.geo_target_constant_ids?.length
        ? {
            geo_target_constants: params.geo_target_constant_ids.map((id) =>
              customerScopedConstant("geoTargetConstants", id)
            ),
          }
        : {}),
      ...(params.excluded_geo_target_constant_ids?.length
        ? {
            excluded_geo_target_constants:
              params.excluded_geo_target_constant_ids.map((id) =>
                customerScopedConstant("geoTargetConstants", id)
              ),
          }
        : {}),
      ...(params.geo_match_type
        ? {
            geo_match_type: enumValue(
              enums.ValueRuleGeoLocationMatchType,
              params.geo_match_type
            ),
          }
        : {}),
      ...(params.excluded_geo_match_type
        ? {
            excluded_geo_match_type: enumValue(
              enums.ValueRuleGeoLocationMatchType,
              params.excluded_geo_match_type
            ),
          }
        : {}),
    };
  }
  if (params.device_types?.length) {
    conditions.device_condition = {
      device_types: params.device_types.map((deviceType) =>
        enumValue(enums.ValueRuleDeviceType, deviceType)
      ),
    };
  }
  if (params.user_list_ids?.length || params.user_interest_ids?.length) {
    conditions.audience_condition = {
      ...(params.user_list_ids?.length
        ? {
            user_lists: params.user_list_ids.map((id) =>
              toResourceName(params.customer_id, "userLists", id)
            ),
          }
        : {}),
      ...(params.user_interest_ids?.length
        ? {
            user_interests: params.user_interest_ids.map((id) =>
              customerScopedConstant("userInterests", id)
            ),
          }
        : {}),
    };
  }
  return conditions;
}

function registerValidateOfflineConversionPayload(server: McpServer) {
  server.registerTool(
    "validate_offline_conversion_payload",
    {
      title: "Validate Offline Conversion Payload",
      description:
        "Perform local validation for Google Ads offline conversion / EC4L " +
        "payloads. This does not call Google Ads.",
      inputSchema: {
        conversions: z
          .array(clickConversionSchema)
          .min(1)
          .describe("Batch of conversion events to validate."),
        conversionWindowDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Platform conversion window. Default: 90 days."),
        now: z
          .string()
          .optional()
          .describe("Optional ISO timestamp used as validation clock."),
      },
    },
    async (params) => {
      const validation = validateConversions(params.conversions, {
        conversionWindowDays: params.conversionWindowDays,
        now: params.now,
      });
      return mcpText(JSON.stringify(validation, null, 2));
    }
  );
}

function registerUploadClickConversions(server: McpServer) {
  server.registerTool(
    "upload_click_conversions",
    {
      title: "Upload Click Conversions",
      description:
        "Upload Google Ads offline click conversions / enhanced conversions " +
        "for leads. partialFailure is always sent as true. Use validateOnly " +
        "to ask Google to validate without executing.",
      inputSchema: {
        customerId: z
          .string()
          .optional()
          .describe("Conversion customer ID, no hyphens."),
        customer_id: z.string().optional().describe("Alias for customerId."),
        conversions: z
          .array(clickConversionSchema)
          .min(1)
          .describe("Batch of EC4L/offline conversion events."),
        partialFailure: z
          .boolean()
          .optional()
          .describe("Accepted for spec compatibility; the request always uses true."),
        partial_failure: z
          .boolean()
          .optional()
          .describe("Alias for partialFailure; the request always uses true."),
        validateOnly: z
          .boolean()
          .optional()
          .describe("If true, Google validates but does not execute."),
        validate_only: z.boolean().optional().describe("Alias for validateOnly."),
        jobId: z
          .number()
          .int()
          .nonnegative()
          .max(2147483647)
          .optional()
          .describe("Optional job ID for diagnostics."),
        job_id: z
          .number()
          .int()
          .nonnegative()
          .max(2147483647)
          .optional()
          .describe("Alias for jobId."),
        debugEnabled: z
          .boolean()
          .optional()
          .describe(
            "Ignored. debug_enabled was removed from current Google Ads API versions."
          ),
        conversionWindowDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Local validation conversion window. Default: 90 days."),
      },
    },
    async (params) => {
      const customerId = requireCustomerId(params);
      if (!customerId.ok) return customerId.error;

      const validation = validateConversions(params.conversions, {
        conversionWindowDays: params.conversionWindowDays,
      });
      if (!validation.valid) {
        return mcpJson(
          {
            ok: false,
            phase: "local_validation",
            ...validation,
          },
          true
        );
      }

      const conversions = validation.normalized_conversions.map((conversion) =>
        toGoogleClickConversion(conversion)
      );
      const validateOnly = params.validateOnly ?? params.validate_only ?? false;
      const jobId = params.jobId ?? params.job_id;

      try {
        const customer = getAdsClient(customerId.value);
        const request = new services.UploadClickConversionsRequest({
          customer_id: customerId.value,
          conversions,
          partial_failure: true,
          validate_only: validateOnly,
          ...(jobId != null ? { job_id: jobId } : {}),
        });

        const response = await customer.conversionUploads.uploadClickConversions(
          request
        );
        const decodedResponse = decodePartialFailure(customer, response);
        const partialFailures = parseGoogleAdsFailure(
          getPartialFailure(decodedResponse)
        );

        const warnings = [
          ...validation.warnings,
          ...partialFailures
            .filter((failure) => failure.class === "warning/data")
            .map((failure) => ({
              index: failure.index ?? -1,
              field: failure.fieldPath,
              class: failure.class,
              message: failure.message,
            })),
          ...(params.debugEnabled
            ? [
                {
                  index: -1,
                  field: "debugEnabled",
                  class: "config" as ErrorClass,
                  message:
                    "debugEnabled was ignored because current Google Ads API versions do not support debug_enabled on UploadClickConversionsRequest.",
                },
              ]
            : []),
        ];

        const hardFailures = partialFailures.filter(
          (failure) => failure.class !== "warning/data"
        );
        const results = getResults(decodedResponse);

        return mcpJson({
          ok: hardFailures.length === 0,
          validate_only: validateOnly,
          partial_failure: true,
          job_id: getJobId(decodedResponse),
          received_count: validation.normalized_conversions.length,
          result_count: results.length,
          successful_result_count: countNonEmptyResults(results),
          warning_count: warnings.length,
          error_count: hardFailures.length,
          warnings,
          errors: hardFailures,
          results,
        });
      } catch (err) {
        const parsed = parseGoogleAdsFailure(err);
        return mcpJson(
          {
            ok: false,
            phase: "google_upload",
            error_class: classifyThrownError(err, parsed),
            message: formatError(err),
            errors: parsed,
          },
          true
        );
      }
    }
  );
}

function registerAdditionalUploadTools(server: McpServer) {
  registerUploadRpcTool(
    server,
    "upload_call_conversions",
    "uploadCallConversions",
    "Upload call conversions through ConversionUploadService."
  );

  server.registerTool(
    "upload_conversion_adjustments",
    {
      title: "Upload Conversion Adjustments",
      description: "Upload conversion adjustments through ConversionAdjustmentUploadService.",
      inputSchema: {
        customer_id: z.string(),
        request: jsonRecordSchema,
      },
    },
    async (params) => {
      const tool = "upload_conversion_adjustments";
      try {
        const customer = getAdsClient(params.customer_id);
        const result =
          await customer.conversionAdjustmentUploads.uploadConversionAdjustments({
            customer_id: params.customer_id,
            ...params.request,
          } as never);
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

  server.registerTool(
    "check_offline_conversion_upload_capability",
    {
      title: "Check Offline Conversion Upload Capability",
      description:
        "Return the current Google offline-click upload cutoff warning and next integration step.",
      inputSchema: {
        customer_id: z.string(),
      },
    },
    async (params) =>
      mcpSuccess({
        tool: "check_offline_conversion_upload_capability",
        customer_id: params.customer_id,
        warnings: [
          "Since 2026-06-15, Google may reject new UploadClickConversions users with CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE. New integrations should use Data Manager API for offline/enhanced lead imports.",
        ],
        results: {
          capability: "unknown_until_upload_or_google_allowlist_check",
          recommended_path_for_new_offline_click_imports: "Data Manager API",
          upload_tools_available: [
            "upload_click_conversions",
            "upload_call_conversions",
            "upload_conversion_adjustments",
          ],
        },
      })
  );
}

function registerGetOfflineConversionDiagnostics(server: McpServer) {
  server.registerTool(
    "get_offline_conversion_diagnostics",
    {
      title: "Get Offline Conversion Diagnostics",
      description:
        "Read Google Ads offline conversion upload diagnostics at client " +
        "level and, optionally, conversion-action level.",
      inputSchema: {
        customerId: z.string().optional().describe("Google Ads customer ID."),
        customer_id: z.string().optional().describe("Alias for customerId."),
        conversionAction: z
          .string()
          .optional()
          .describe(
            "Optional conversion action resource name or numeric ID for action-level diagnostics."
          ),
        client: z
          .string()
          .optional()
          .describe("Offline upload client enum. Default: GOOGLE_ADS_API."),
      },
    },
    async (params) => {
      const customerId = requireCustomerId(params);
      if (!customerId.ok) return customerId.error;

      try {
        const client = sanitizeEnum(params.client ?? "GOOGLE_ADS_API");
        const customer = getAdsClient(customerId.value);
        const clientRows = await customer.query(
          `SELECT
             offline_conversion_upload_client_summary.resource_name,
             offline_conversion_upload_client_summary.client,
             offline_conversion_upload_client_summary.status,
             offline_conversion_upload_client_summary.total_event_count,
             offline_conversion_upload_client_summary.successful_event_count,
             offline_conversion_upload_client_summary.pending_event_count,
             offline_conversion_upload_client_summary.success_rate,
             offline_conversion_upload_client_summary.pending_rate,
             offline_conversion_upload_client_summary.last_upload_date_time,
             offline_conversion_upload_client_summary.alerts,
             offline_conversion_upload_client_summary.daily_summaries,
             offline_conversion_upload_client_summary.job_summaries
           FROM offline_conversion_upload_client_summary
           WHERE offline_conversion_upload_client_summary.client = ${client}
           LIMIT 10`
        );

        let conversionActionRows: unknown[] = [];
        if (params.conversionAction) {
          const conversionActionId =
            parseConversionActionId(params.conversionAction) ??
            params.conversionAction;
          if (!/^\d+$/.test(conversionActionId)) {
            throw new Error(
              "conversionAction must be a resource name or numeric conversion action ID."
            );
          }

          conversionActionRows = await customer.query(
            `SELECT
               offline_conversion_upload_conversion_action_summary.resource_name,
               offline_conversion_upload_conversion_action_summary.client,
               offline_conversion_upload_conversion_action_summary.conversion_action_id,
               offline_conversion_upload_conversion_action_summary.conversion_action_name,
               offline_conversion_upload_conversion_action_summary.status,
               offline_conversion_upload_conversion_action_summary.total_event_count,
               offline_conversion_upload_conversion_action_summary.successful_event_count,
               offline_conversion_upload_conversion_action_summary.pending_event_count,
               offline_conversion_upload_conversion_action_summary.last_upload_date_time,
               offline_conversion_upload_conversion_action_summary.alerts,
               offline_conversion_upload_conversion_action_summary.daily_summaries,
               offline_conversion_upload_conversion_action_summary.job_summaries
             FROM offline_conversion_upload_conversion_action_summary
             WHERE offline_conversion_upload_conversion_action_summary.client = ${client}
               AND offline_conversion_upload_conversion_action_summary.conversion_action_id = ${conversionActionId}
             LIMIT 10`
          );
        }

        return mcpText(
          JSON.stringify(
            {
              client_summaries: clientRows,
              conversion_action_summaries: conversionActionRows,
            },
            null,
            2
          )
        );
      } catch (err) {
        return mcpError("fetching offline conversion diagnostics", err);
      }
    }
  );
}

function registerConversionDiagnostics(server: McpServer) {
  server.registerTool(
    "conversion_diagnostics_report",
    {
      title: "Conversion Diagnostics Report",
      description:
        "Report conversion action health, goal/bidding status, conversion metrics, and upload readiness.",
      inputSchema: {
        customer_id: z.string(),
        date_range: z.string().optional().default("LAST_30_DAYS"),
      },
    },
    async (params) => {
      const tool = "conversion_diagnostics_report";
      try {
        const customer = getAdsClient(params.customer_id);
        const conversionActions = await customer.query(`
          SELECT
            conversion_action.resource_name,
            conversion_action.name,
            conversion_action.status,
            conversion_action.type,
            conversion_action.category,
            conversion_action.origin,
            conversion_action.primary_for_goal,
            conversion_action.include_in_conversions_metric,
            conversion_action.counting_type,
            metrics.conversions,
            metrics.conversions_value
          FROM conversion_action
          WHERE segments.date DURING ${sanitizeEnum(params.date_range)}`);
        const customerGoals = await customer.query(`
          SELECT
            customer_conversion_goal.resource_name,
            customer_conversion_goal.category,
            customer_conversion_goal.origin,
            customer_conversion_goal.biddable
          FROM customer_conversion_goal`);
        const conversionCustomer = await fetchConversionTrackingSetting(
          params.customer_id
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: {
            date_range: params.date_range,
            conversion_customer: conversionCustomer,
            conversion_actions: conversionActions,
            customer_goals: customerGoals,
          },
          warnings: [
            "For offline click uploads, use get_offline_conversion_diagnostics for client/action-level upload summaries.",
          ],
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerGoalQueryTool(
  server: McpServer,
  name: string,
  resource: string,
  fields: string[]
) {
  server.registerTool(
    name,
    {
      title: name
        .split("_")
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" "),
      description: `List ${resource} rows.`,
      inputSchema: {
        customer_id: z.string(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const query = `SELECT ${fields.join(", ")} FROM ${resource} LIMIT ${
          params.limit ?? 1000
        }`;
        const rows = await customer.query(query);
        return mcpSuccess({
          tool: name,
          customer_id: params.customer_id,
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError(name, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerUploadRpcTool(
  server: McpServer,
  toolName: string,
  method: "uploadCallConversions",
  description: string
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
        request: jsonRecordSchema,
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.conversionUploads[method]({
          customer_id: params.customer_id,
          ...params.request,
        } as never);
        return mcpSuccess({
          tool: toolName,
          customer_id: params.customer_id,
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(toolName, err, { customer_id: params.customer_id });
      }
    }
  );
}

async function fetchConversionTrackingSetting(customerId: string) {
  const customer = getAdsClient(customerId);
  const rows = await customer.query<
    {
      customer: {
        id?: number | string | null;
        conversion_tracking_setting?: {
          google_ads_conversion_customer?: string | null;
          accepted_customer_data_terms?: boolean | null;
          enhanced_conversions_for_leads_enabled?: boolean | null;
          conversion_tracking_status?: string | number | null;
          conversion_tracking_id?: number | string | null;
          cross_account_conversion_tracking_id?: number | string | null;
        } | null;
      };
    }[]
  >(
    `SELECT
       customer.id,
       customer.conversion_tracking_setting.google_ads_conversion_customer,
       customer.conversion_tracking_setting.accepted_customer_data_terms,
       customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled,
       customer.conversion_tracking_setting.conversion_tracking_status,
       customer.conversion_tracking_setting.conversion_tracking_id,
       customer.conversion_tracking_setting.cross_account_conversion_tracking_id
     FROM customer
     LIMIT 1`
  );

  const row = rows[0]?.customer;
  if (!row) {
    throw new Error(`No customer row returned for customer ${customerId}`);
  }

  const setting = row.conversion_tracking_setting;
  return {
    customer_id: row.id != null ? String(row.id) : customerId,
    conversion_customer_resource_name:
      setting?.google_ads_conversion_customer ?? null,
    conversion_customer_id:
      parseCustomerId(setting?.google_ads_conversion_customer ?? null) ?? null,
    customer_data_terms_accepted:
      setting?.accepted_customer_data_terms ?? null,
    enhanced_conversions_for_leads_enabled:
      setting?.enhanced_conversions_for_leads_enabled ?? null,
    conversion_tracking_status: normalizeEnumLabel(
      setting?.conversion_tracking_status
    ),
    conversion_tracking_id:
      setting?.conversion_tracking_id != null
        ? String(setting.conversion_tracking_id)
        : null,
    cross_account_conversion_tracking_id:
      setting?.cross_account_conversion_tracking_id != null
        ? String(setting.cross_account_conversion_tracking_id)
        : null,
  };
}

function validateConversions(
  rawConversions: RawClickConversion[],
  options: { conversionWindowDays?: number; now?: string } = {}
) {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const normalized: NormalizedClickConversion[] = [];
  const orderIds = new Set<string>();
  const now = options.now ? new Date(options.now) : new Date();
  const conversionWindowDays =
    options.conversionWindowDays ?? DEFAULT_CONVERSION_WINDOW_DAYS;

  if (Number.isNaN(now.getTime())) {
    errors.push({
      index: -1,
      field: "now",
      class: "data",
      message: "`now` must be a valid ISO timestamp when provided.",
    });
  }

  rawConversions.forEach((raw, index) => {
    const conversion = normalizeInputConversion(raw);
    normalized.push(conversion);

    if (!conversion.conversionAction) {
      errors.push({
        index,
        field: "conversionAction",
        class: "config",
        message: "conversionAction is required.",
      });
    } else if (!CONVERSION_ACTION_RE.test(conversion.conversionAction)) {
      errors.push({
        index,
        field: "conversionAction",
        class: "config",
        message:
          "conversionAction must look like customers/{customer_id}/conversionActions/{conversion_action_id}.",
      });
    }

    if (!conversion.conversionDateTime) {
      errors.push({
        index,
        field: "conversionDateTime",
        class: "data",
        message: "conversionDateTime is required.",
      });
    } else if (!GOOGLE_DATE_TIME_RE.test(conversion.conversionDateTime)) {
      errors.push({
        index,
        field: "conversionDateTime",
        class: "data",
        message:
          'Use Google Ads format "yyyy-mm-dd hh:mm:ss+|-hh:mm", for example "2026-06-24 09:15:00-07:00".',
      });
    } else {
      const date = parseGoogleDateTime(conversion.conversionDateTime);
      if (!date) {
        errors.push({
          index,
          field: "conversionDateTime",
          class: "data",
          message: "conversionDateTime could not be parsed.",
        });
      } else if (!Number.isNaN(now.getTime())) {
        const ageMs = now.getTime() - date.getTime();
        const windowMs = conversionWindowDays * 24 * 60 * 60 * 1000;
        if (ageMs < -5 * 60 * 1000) {
          errors.push({
            index,
            field: "conversionDateTime",
            class: "data",
            message: "conversionDateTime is in the future.",
          });
        } else if (ageMs > windowMs) {
          errors.push({
            index,
            field: "conversionDateTime",
            class: "data",
            message: `conversionDateTime is outside the ${conversionWindowDays}-day conversion window.`,
          });
        }
      }
    }

    if (!conversion.orderId) {
      errors.push({
        index,
        field: "orderId",
        class: "data",
        message: "orderId is required for event-level dedupe.",
      });
    } else {
      const dedupeKey = `${conversion.conversionAction}|${conversion.orderId}`;
      if (orderIds.has(dedupeKey)) {
        errors.push({
          index,
          field: "orderId",
          class: "duplicate",
          message:
            "Duplicate orderId in this batch for the same conversionAction.",
        });
      }
      orderIds.add(dedupeKey);
    }

    if (!conversion.hashedEmail) {
      errors.push({
        index,
        field: "hashedEmail",
        class: "data",
        message: "hashedEmail/emailSha256 is required for EC4L uploads.",
      });
    } else if (!SHA256_HEX_RE.test(conversion.hashedEmail)) {
      if (SHA256_HEX_ANY_CASE_RE.test(conversion.hashedEmail)) {
        warnings.push({
          index,
          field: "hashedEmail",
          class: "data",
          message: "hashedEmail was normalized to lowercase SHA-256 hex.",
        });
        conversion.hashedEmail = conversion.hashedEmail.toLowerCase();
      } else {
        errors.push({
          index,
          field: "hashedEmail",
          class: "data",
          message:
            "hashedEmail must be a 64-character SHA-256 hex digest, not a raw email.",
        });
      }
    }

    const clickIds = ["gclid", "gbraid", "wbraid"].filter(
      (field) => !!conversion[field as "gclid" | "gbraid" | "wbraid"]
    );
    if (clickIds.length > 1) {
      errors.push({
        index,
        field: clickIds.join(","),
        class: "data",
        message: "Provide at most one click ID: gclid, gbraid, or wbraid.",
      });
    } else if (clickIds.length === 0) {
      warnings.push({
        index,
        field: "gclid/gbraid/wbraid",
        class: "warning/data",
        message:
          "No click ID provided. This is valid for EC4L/email-only rows, but Google may surface CLICK_NOT_FOUND-style diagnostics for non-Google traffic.",
      });
    }

    for (const field of clickIds) {
      const value = conversion[field as "gclid" | "gbraid" | "wbraid"];
      if (value && /\s/.test(value)) {
        errors.push({
          index,
          field,
          class: "data",
          message: `${field} must not contain whitespace.`,
        });
      }
    }

    if (
      conversion.currencyCode &&
      !/^[A-Z]{3}$/.test(conversion.currencyCode)
    ) {
      errors.push({
        index,
        field: "currencyCode",
        class: "data",
        message: "currencyCode must be an uppercase ISO 4217 code like USD.",
      });
    }

    if (
      conversion.conversionValue != null &&
      conversion.conversionValue < 0
    ) {
      errors.push({
        index,
        field: "conversionValue",
        class: "data",
        message: "conversionValue must be non-negative.",
      });
    }
  });

  return {
    valid: errors.length === 0,
    conversion_window_days: conversionWindowDays,
    checked_count: rawConversions.length,
    error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
    normalized_conversions: normalized,
  };
}

function normalizeInputConversion(raw: RawClickConversion) {
  return {
    conversionAction: (raw.conversionAction ?? raw.conversion_action ?? "").trim(),
    conversionDateTime: (
      raw.conversionDateTime ??
      raw.conversion_date_time ??
      ""
    ).trim(),
    orderId: (raw.orderId ?? raw.order_id ?? "").trim(),
    hashedEmail: (
      raw.hashedEmail ??
      raw.hashed_email ??
      raw.emailSha256 ??
      raw.email_sha256 ??
      ""
    ).trim(),
    gclid: trimOptional(raw.gclid),
    gbraid: trimOptional(raw.gbraid),
    wbraid: trimOptional(raw.wbraid),
    currencyCode: trimOptional(raw.currencyCode ?? raw.currency_code),
    conversionValue: raw.conversionValue ?? raw.conversion_value,
    consent: raw.consent,
    conversionEnvironment:
      raw.conversionEnvironment ?? raw.conversion_environment,
    customerType: raw.customerType ?? raw.customer_type,
  };
}

function toGoogleClickConversion(conversion: NormalizedClickConversion) {
  return {
    conversion_action: conversion.conversionAction,
    conversion_date_time: conversion.conversionDateTime,
    order_id: conversion.orderId,
    user_identifiers: [{ hashed_email: conversion.hashedEmail }],
    ...(conversion.gclid ? { gclid: conversion.gclid } : {}),
    ...(conversion.gbraid ? { gbraid: conversion.gbraid } : {}),
    ...(conversion.wbraid ? { wbraid: conversion.wbraid } : {}),
    ...(conversion.currencyCode ? { currency_code: conversion.currencyCode } : {}),
    ...(conversion.conversionValue != null
      ? { conversion_value: conversion.conversionValue }
      : {}),
    ...(conversion.consent
      ? {
          consent: {
            ...(conversion.consent.adUserData
              ? {
                  ad_user_data: enumValue(
                    enums.ConsentStatus,
                    conversion.consent.adUserData
                  ),
                }
              : {}),
            ...(conversion.consent.adPersonalization
              ? {
                  ad_personalization: enumValue(
                    enums.ConsentStatus,
                    conversion.consent.adPersonalization
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(conversion.conversionEnvironment
      ? {
          conversion_environment: enumValue(
            enums.ConversionEnvironment,
            conversion.conversionEnvironment
          ),
        }
      : {}),
    ...(conversion.customerType
      ? {
          customer_type: enumValue(
            enums.ConversionCustomerType,
            conversion.customerType
          ),
        }
      : {}),
  };
}

function decodePartialFailure(
  customer: ReturnType<typeof getAdsClient>,
  response: unknown
) {
  const decoder = customer as unknown as {
    decodePartialFailureError?: (response: unknown) => unknown;
  };
  return decoder.decodePartialFailureError
    ? decoder.decodePartialFailureError(response)
    : response;
}

function parseGoogleAdsFailure(value: unknown): ParsedGoogleAdsError[] {
  const failure = extractGoogleAdsFailure(value);
  if (!failure?.errors?.length) return [];

  return failure.errors.map((error) => {
    const codeInfo = extractCodeInfo(error);
    const fieldPath = formatFieldPath(error);
    const message = error.message ?? "(no message)";
    return {
      index: extractRowIndex(error),
      codeCategory: codeInfo.category,
      code: codeInfo.code,
      class: classifyGoogleAdsError(codeInfo.category, codeInfo.code, message),
      message,
      fieldPath,
    };
  });
}

function extractGoogleAdsFailure(value: unknown): GoogleAdsFailureLike | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.errors)) {
    return candidate as GoogleAdsFailureLike;
  }

  const partial =
    candidate.partial_failure_error ?? candidate.partialFailureError;
  if (partial && typeof partial === "object") {
    const partialCandidate = partial as Record<string, unknown>;
    if (Array.isArray(partialCandidate.errors)) {
      return partialCandidate as GoogleAdsFailureLike;
    }
  }

  return null;
}

function getPartialFailure(response: unknown) {
  if (!response || typeof response !== "object") return undefined;
  const object = response as Record<string, unknown>;
  return object.partial_failure_error ?? object.partialFailureError;
}

function getResults(response: unknown): unknown[] {
  if (!response || typeof response !== "object") return [];
  const results = (response as Record<string, unknown>).results;
  return Array.isArray(results) ? results : [];
}

function getJobId(response: unknown): string | number | null {
  if (!response || typeof response !== "object") return null;
  const object = response as Record<string, unknown>;
  const jobId = object.job_id ?? object.jobId;
  return typeof jobId === "string" || typeof jobId === "number" ? jobId : null;
}

function extractCodeInfo(error: GoogleAdsErrorLike) {
  const errorCode = error.error_code ?? error.errorCode ?? {};
  const entry = Object.entries(errorCode).find(([, value]) => value != null);
  if (!entry) return { category: null, code: null };
  const [category, code] = entry;
  return {
    category,
    code: code != null ? String(code) : null,
  };
}

function formatFieldPath(error: GoogleAdsErrorLike) {
  const elements =
    error.location?.field_path_elements ??
    error.location?.fieldPathElements ??
    [];
  return elements
    .map((element) => {
      const field = element.field_name ?? element.fieldName ?? "?";
      return element.index != null ? `${field}[${element.index}]` : field;
    })
    .join(".");
}

function extractRowIndex(error: GoogleAdsErrorLike) {
  const elements =
    error.location?.field_path_elements ??
    error.location?.fieldPathElements ??
    [];
  for (const element of elements) {
    const field = element.field_name ?? element.fieldName;
    if (
      (field === "conversions" || field === "operations") &&
      element.index != null
    ) {
      return Number(element.index);
    }
  }
  const indexed = elements.find((element) => element.index != null);
  return indexed?.index != null ? Number(indexed.index) : null;
}

function classifyGoogleAdsError(
  category: string | null,
  code: string | null,
  message: string
): ErrorClass {
  const combined = `${category ?? ""}:${code ?? ""}:${message}`.toUpperCase();

  if (combined.includes("CLICK_NOT_FOUND")) return "warning/data";
  if (combined.includes("DUPLICATE_ORDER_ID")) return "duplicate";
  if (
    combined.includes("INVALID_CONVERSION_ACTION_TYPE") ||
    combined.includes("CONVERSION_ACTION_NOT_FOUND") ||
    combined.includes("NO CONVERSION ACTION") ||
    (combined.includes("RESOURCE_NOT_FOUND") &&
      combined.includes("CONVERSION"))
  ) {
    return "config";
  }
  if (
    combined.includes("CUSTOMER_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS") ||
    combined.includes("CUSTOMER_NOT_ACCEPTED_CUSTOMER_DATA_TERMS") ||
    combined.includes("CUSTOMER_NOT_ENABLED")
  ) {
    return "config";
  }
  if (
    combined.includes("AUTHENTICATION") ||
    combined.includes("AUTHORIZATION") ||
    combined.includes("PERMISSION") ||
    combined.includes("ACCESS_DENIED") ||
    combined.includes("DEVELOPER_TOKEN")
  ) {
    return "config/auth";
  }
  if (
    combined.includes("QUOTA") ||
    combined.includes("RATE") ||
    combined.includes("RESOURCE_EXHAUSTED") ||
    combined.includes("TRANSIENT") ||
    combined.includes("DEADLINE") ||
    combined.includes("INTERNAL_ERROR") ||
    combined.includes("UNAVAILABLE")
  ) {
    return "retryable";
  }
  if (
    combined.includes("USER_IDENTIFIER") ||
    combined.includes("HASH") ||
    combined.includes("EMAIL") ||
    combined.includes("DATE") ||
    combined.includes("TIME") ||
    combined.includes("TOO_RECENT") ||
    combined.includes("TOO_OLD") ||
    combined.includes("INVALID_VALUE")
  ) {
    return "data";
  }

  return "unknown";
}

function classifyThrownError(
  err: unknown,
  parsed: ParsedGoogleAdsError[]
): ErrorClass {
  const parsedClass = parsed.find((error) => error.class !== "unknown")?.class;
  if (parsedClass) return parsedClass;

  if (err && typeof err === "object") {
    const code = String((err as { code?: unknown }).code ?? "");
    if (["8", "13", "14"].includes(code)) return "retryable";
    if (["7", "16"].includes(code)) return "config/auth";
  }

  const message = formatError(err).toUpperCase();
  if (message.includes("5XX") || message.includes("UNAVAILABLE")) {
    return "retryable";
  }
  if (message.includes("PERMISSION") || message.includes("AUTH")) {
    return "config/auth";
  }
  return "unknown";
}

function countNonEmptyResults(results: unknown[]) {
  return results.filter((result) => {
    if (!result || typeof result !== "object") return false;
    return Object.keys(result as Record<string, unknown>).length > 0;
  }).length;
}

function requireCustomerId(params: { customerId?: string; customer_id?: string }):
  | { ok: true; value: string }
  | { ok: false; error: ReturnType<typeof mcpError> } {
  const value = (params.customerId ?? params.customer_id ?? "").trim();
  if (!value) {
    return {
      ok: false,
      error: mcpError(
        "validating customer ID",
        new Error("customerId is required.")
      ),
    };
  }
  if (!CUSTOMER_ID_RE.test(value)) {
    return {
      ok: false,
      error: mcpError(
        "validating customer ID",
        new Error("customerId must be digits only, with no hyphens.")
      ),
    };
  }
  return { ok: true, value };
}

function sanitizeEnum(value: string) {
  const enumValueString = value.trim().toUpperCase();
  if (!ENUM_RE.test(enumValueString)) {
    throw new Error(`Invalid enum value: ${value}`);
  }
  return enumValueString;
}

function enumValue<T extends Record<string, string | number>>(
  enumObject: T,
  value: string
) {
  const key = sanitizeEnum(value);
  const matched = enumObject[key];
  if (matched == null || typeof matched === "string") {
    throw new Error(`Unsupported enum value: ${value}`);
  }
  return matched;
}

function normalizeEnumLabel(value: string | number | null | undefined) {
  return value == null ? null : String(value);
}

function parseCustomerId(resourceName: string | null) {
  if (!resourceName) return null;
  const match = /^customers\/(\d+)$/.exec(resourceName);
  return match?.[1] ?? null;
}

function parseConversionActionId(value: string) {
  const match = CONVERSION_ACTION_RE.exec(value.trim());
  return match?.[2] ?? null;
}

function resourceId(idOrName: string, collection: string) {
  const trimmed = idOrName.trim();
  const match = new RegExp(`/${collection}/(\\d+)$`).exec(trimmed);
  return match?.[1] ?? trimmed;
}

function parseGoogleDateTime(value: string) {
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mcpJson(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}
