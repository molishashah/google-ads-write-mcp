import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { googleAdsRestFetch } from "@/lib/google-ads-rest";
import { buildGaqlQuery, extractRequestId } from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import { runGaqlStream } from "@/tools/tool-utils";

export function registerSearchTools(server: McpServer) {
  registerSearch(server);
  registerSearchStream(server);
  registerValidateGaql(server);
  registerDiscoverGoogleAdsFields(server);
  registerListReportTemplates(server);
  registerListAccessibleCustomers(server);
}

// ──────────────────────────────────────────────────────────────────────
// search — run an arbitrary GAQL query against a customer account
//
// This mirrors the `search` tool from the official Google Ads MCP
// (googleads/google-ads-mcp). The caller provides structured fields,
// resource, conditions, orderings, and limit — the tool builds and
// executes the GAQL query.
// ──────────────────────────────────────────────────────────────────────

function registerSearch(server: McpServer) {
  server.registerTool(
    "search",
    {
      title: "Search Google Ads",
      description:
        "Run a Google Ads Query Language (GAQL) query against a customer " +
        "account. Provide fields to SELECT, a resource to query FROM, and " +
        "optional conditions (WHERE), orderings (ORDER BY), and a row " +
        "limit. Returns the raw result rows as JSON. Use this for any " +
        "read operation: campaign metrics, ad group performance, keyword " +
        "data, search terms, asset views, etc.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens (e.g. '9232939339')"),
        fields: z
          .array(z.string())
          .describe(
            "Fields to SELECT, e.g. ['campaign.name', 'metrics.impressions']"
          ),
        resource: z
          .string()
          .describe(
            "Resource to query FROM, e.g. 'campaign', 'ad_group', 'keyword_view'"
          ),
        conditions: z
          .array(z.string())
          .optional()
          .describe(
            "Optional WHERE conditions, e.g. ['campaign.status = ENABLED', " +
              "'metrics.impressions > 0']. Combined with AND."
          ),
        orderings: z
          .array(z.string())
          .optional()
          .describe(
            "Optional ORDER BY clauses, e.g. ['metrics.impressions DESC']"
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional maximum number of rows to return"),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const query = buildGaqlQuery(params);
        const rows = await customer.query(query);
        return mcpSuccess({
          tool: "search",
          customer_id: params.customer_id,
          results: { query, rows },
        });
      } catch (err) {
        return mcpJsonError("search", err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerSearchStream(server: McpServer) {
  server.registerTool(
    "search_stream",
    {
      title: "Stream Google Ads Query",
      description:
        "Run a raw GAQL query through GoogleAdsService.SearchStream. Use this " +
        "for large reports; max_rows can cap the returned rows for MCP output.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        query: z.string().min(1).describe("Full GAQL query string."),
        max_rows: z
          .number()
          .int()
          .positive()
          .max(100000)
          .optional()
          .describe("Optional cap for returned rows. Default: no cap."),
      },
    },
    async (params) => {
      try {
        const rows = await runGaqlStream(
          params.customer_id,
          params.query,
          params.max_rows
        );
        return mcpSuccess({
          tool: "search_stream",
          customer_id: params.customer_id,
          results: {
            query: params.query,
            row_count: rows.length,
            rows,
            truncated: params.max_rows ? rows.length >= params.max_rows : false,
          },
        });
      } catch (err) {
        return mcpJsonError("search_stream", err, {
          customer_id: params.customer_id,
        });
      }
    }
  );
}

function registerValidateGaql(server: McpServer) {
  server.registerTool(
    "validate_gaql",
    {
      title: "Validate GAQL",
      description:
        "Validate a GAQL query against the Google Ads API without returning rows.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        query: z.string().min(1).describe("Full GAQL query string."),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        await customer.query(params.query, { validate_only: true } as never);
        return mcpSuccess({
          tool: "validate_gaql",
          customer_id: params.customer_id,
          validate_only: true,
          results: { query: params.query, valid: true },
        });
      } catch (err) {
        return mcpJsonError("validate_gaql", err, {
          customer_id: params.customer_id,
          validate_only: true,
        });
      }
    }
  );
}

function registerDiscoverGoogleAdsFields(server: McpServer) {
  server.registerTool(
    "discover_google_ads_fields",
    {
      title: "Discover Google Ads Fields",
      description:
        "Search GoogleAdsFieldService metadata to find selectable, filterable, " +
        "sortable fields and valid resource combinations for GAQL.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens. Used for auth context."),
        query: z
          .string()
          .optional()
          .describe(
            "GoogleAdsFieldService query. Default lists selectable campaign fields."
          ),
        page_size: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const service = (customer as unknown as {
          googleAdsFields: {
            searchGoogleAdsFields: (request: unknown) => Promise<unknown>;
          };
        }).googleAdsFields;
        const result = await service.searchGoogleAdsFields({
          query:
            params.query ??
            "SELECT name, category, data_type, selectable, filterable, sortable, selectable_with WHERE selectable = true AND name LIKE 'campaign.%' LIMIT 100",
          page_size: params.page_size ?? 1000,
        });
        return mcpSuccess({
          tool: "discover_google_ads_fields",
          customer_id: params.customer_id,
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError("discover_google_ads_fields", err, {
          customer_id: params.customer_id,
        });
      }
    }
  );
}

function registerListReportTemplates(server: McpServer) {
  server.registerTool(
    "list_report_templates",
    {
      title: "List Google Ads Report Templates",
      description:
        "Return curated report templates with GAQL fields/resources for common " +
        "account, campaign, ad, keyword, conversion, and change-history analysis.",
      inputSchema: {},
    },
    async () =>
      mcpSuccess({
        tool: "list_report_templates",
        results: REPORT_TEMPLATES,
      })
  );
}

// ──────────────────────────────────────────────────────────────────────
// list_accessible_customers — return customer IDs the SA can access
//
// The google-ads-api library's listAccessibleCustomers() expects a
// refresh token, which doesn't work with service-account auth. We
// call the REST endpoint directly using the SA's access token.
// ──────────────────────────────────────────────────────────────────────

function registerListAccessibleCustomers(server: McpServer) {
  server.registerTool(
    "list_accessible_customers",
    {
      title: "List Accessible Customers",
      description:
        "Returns the resource names of customers directly accessible by " +
        "the authenticated service account. No customer ID is needed.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await googleAdsRestFetch("customers:listAccessibleCustomers");
        return mcpSuccess({
          tool: "list_accessible_customers",
          results: data,
          request_id: extractRequestId(data),
        });
      } catch (err) {
        return mcpJsonError("list_accessible_customers", err);
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

const REPORT_TEMPLATES = [
  {
    name: "account_overview_report",
    resource: "customer",
    fields: [
      "customer.id",
      "customer.descriptive_name",
      "customer.currency_code",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "campaign_report",
    resource: "campaign",
    fields: [
      "campaign.resource_name",
      "campaign.id",
      "campaign.name",
      "campaign.status",
      "campaign.advertising_channel_type",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "ad_group_report",
    resource: "ad_group",
    fields: [
      "campaign.resource_name",
      "campaign.name",
      "ad_group.resource_name",
      "ad_group.name",
      "ad_group.status",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "keyword_report",
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
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "search_terms_report",
    resource: "search_term_view",
    fields: [
      "campaign.name",
      "ad_group.name",
      "search_term_view.search_term",
      "search_term_view.status",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "ads_report",
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
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "rsa_asset_report",
    resource: "ad_group_ad_asset_view",
    fields: [
      "campaign.name",
      "ad_group.name",
      "ad_group_ad_asset_view.field_type",
      "ad_group_ad_asset_view.performance_label",
      "asset.text_asset.text",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "asset_performance_report",
    resource: "asset_field_type_view",
    fields: [
      "asset.resource_name",
      "asset.type",
      "asset_field_type_view.field_type",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "landing_page_report",
    resource: "landing_page_view",
    fields: [
      "landing_page_view.unexpanded_final_url",
      "segments.device",
      ...BASE_METRICS,
    ],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "geo_report",
    resource: "geographic_view",
    fields: ["geographic_view.country_criterion_id", "segments.geo_target_region", ...BASE_METRICS],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "device_report",
    resource: "campaign",
    fields: ["campaign.name", "segments.device", ...BASE_METRICS],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "hourly_report",
    resource: "campaign",
    fields: ["campaign.name", "segments.day_of_week", "segments.hour", ...BASE_METRICS],
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "conversion_report",
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
    default_conditions: ["segments.date DURING LAST_30_DAYS"],
  },
  {
    name: "change_history_report",
    resource: "change_event",
    fields: [
      "change_event.resource_name",
      "change_event.change_date_time",
      "change_event.change_resource_type",
      "change_event.client_type",
      "change_event.user_email",
      "change_event.resource_change_operation",
    ],
    default_conditions: ["change_event.change_date_time DURING LAST_14_DAYS"],
  },
];
