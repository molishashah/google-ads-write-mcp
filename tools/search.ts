import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient, getDeveloperToken, getAuthClientForApi } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

export function registerSearchTools(server: McpServer) {
  registerSearch(server);
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

        // Build GAQL query
        let query = `SELECT ${params.fields.join(", ")} FROM ${params.resource}`;

        if (params.conditions && params.conditions.length > 0) {
          query += ` WHERE ${params.conditions.join(" AND ")}`;
        }

        if (params.orderings && params.orderings.length > 0) {
          query += ` ORDER BY ${params.orderings.join(", ")}`;
        }

        if (params.limit) {
          query += ` LIMIT ${params.limit}`;
        }

        const rows = await customer.query(query);
        return mcpText(JSON.stringify(rows, null, 2));
      } catch (err) {
        return mcpError("executing search query", err);
      }
    }
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
        const authClient = getAuthClientForApi();
        const tokenResponse = await authClient.getAccessToken();
        if (!tokenResponse.token) {
          throw new Error("Failed to get access token for listing customers");
        }

        const res = await fetch(
          "https://googleads.googleapis.com/v19/customers:listAccessibleCustomers",
          {
            headers: {
              Authorization: `Bearer ${tokenResponse.token}`,
              "developer-token": getDeveloperToken(),
            },
          }
        );

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Google Ads API error (${res.status}): ${body}`);
        }

        const data = await res.json();
        return mcpText(JSON.stringify(data, null, 2));
      } catch (err) {
        return mcpError("listing accessible customers", err);
      }
    }
  );
}
