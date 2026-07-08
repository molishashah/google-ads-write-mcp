import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { googleAdsRestFetch } from "@/lib/google-ads-rest";
import { escapeGaql, extractRequestId, extractResourceNames } from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import {
  jsonRecordSchema,
  mutateOptions,
  mutateOptionSchema,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

export function registerAccountAdminTools(server: McpServer) {
  registerAccountReadTools(server);
  registerUserAccessTools(server);
  registerLinkAndBillingTools(server);
  registerPermissionDiagnostics(server);
}

function registerAccountReadTools(server: McpServer) {
  registerQueryTool(server, {
    name: "get_customer",
    title: "Get Customer",
    description: "Read customer/account metadata.",
    resource: "customer",
    fields: [
      "customer.resource_name",
      "customer.id",
      "customer.descriptive_name",
      "customer.currency_code",
      "customer.time_zone",
      "customer.manager",
      "customer.test_account",
      "customer.status",
      "customer.auto_tagging_enabled",
      "customer.tracking_url_template",
      "customer.final_url_suffix",
    ],
  });
  registerQueryTool(server, {
    name: "list_customer_clients",
    title: "List Customer Clients",
    description: "List child accounts in the manager hierarchy.",
    resource: "customer_client",
    fields: [
      "customer_client.resource_name",
      "customer_client.client_customer",
      "customer_client.id",
      "customer_client.descriptive_name",
      "customer_client.currency_code",
      "customer_client.time_zone",
      "customer_client.manager",
      "customer_client.test_account",
      "customer_client.status",
      "customer_client.level",
    ],
  });
  registerQueryTool(server, {
    name: "list_customer_manager_links",
    title: "List Customer Manager Links",
    description: "List manager links.",
    resource: "customer_manager_link",
    fields: [
      "customer_manager_link.resource_name",
      "customer_manager_link.manager_customer",
      "customer_manager_link.manager_link_id",
      "customer_manager_link.status",
    ],
  });

  server.registerTool(
    "update_customer",
    {
      title: "Update Customer",
      description: "Update mutable customer/account fields.",
      inputSchema: {
        customer_id: z.string(),
        fields: jsonRecordSchema,
        validate_only: z.boolean().optional(),
      },
    },
    async (params) => {
      const tool = "update_customer";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.customers.update(
          [
            {
              resource_name: `customers/${params.customer_id}`,
              ...params.fields,
            },
          ],
          { validate_only: params.validate_only ?? false }
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

  server.registerTool(
    "create_customer_client",
    {
      title: "Create Customer Client",
      description: "Create a child account under the current manager customer.",
      inputSchema: {
        customer_id: z.string().describe("Manager customer ID."),
        request: jsonRecordSchema,
      },
    },
    async (params) => {
      const tool = "create_customer_client";
      try {
        const customer = getAdsClient(params.customer_id);
        const result = await customer.customers.createCustomerClient({
          customer_id: params.customer_id,
          ...params.request,
        } as never);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: extractResourceNames(result),
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerUserAccessTools(server: McpServer) {
  registerQueryTool(server, {
    name: "list_customer_user_accesses",
    title: "List Customer User Accesses",
    description: "List users with account access.",
    resource: "customer_user_access",
    fields: [
      "customer_user_access.resource_name",
      "customer_user_access.user_id",
      "customer_user_access.email_address",
      "customer_user_access.access_role",
      "customer_user_access.access_creation_date_time",
      "customer_user_access.inviter_user_email_address",
    ],
  });
  registerQueryTool(server, {
    name: "list_customer_user_access_invitations",
    title: "List Customer User Access Invitations",
    description: "List pending user invitations.",
    resource: "customer_user_access_invitation",
    fields: [
      "customer_user_access_invitation.resource_name",
      "customer_user_access_invitation.invitation_id",
      "customer_user_access_invitation.email_address",
      "customer_user_access_invitation.access_role",
      "customer_user_access_invitation.invitation_status",
      "customer_user_access_invitation.creation_date_time",
    ],
  });
  registerCollectionMutateTool({
    server,
    name: "invite_customer_user",
    title: "Invite Customer User",
    description: "Create customer user access invitations.",
    collection: "customerUserAccessInvitations",
    action: "create",
    resourceLabel: "Customer user access invitation",
  });
  registerCollectionMutateTool({
    server,
    name: "update_customer_user_access",
    title: "Update Customer User Access",
    description: "Update customer user access roles.",
    collection: "customerUserAccesses",
    action: "update",
    resourceLabel: "Customer user access",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_customer_user_access",
    title: "Remove Customer User Access",
    description: "Remove customer user access.",
    collection: "customerUserAccesses",
    action: "remove",
    resourceLabel: "Customer user access",
  });
}

function registerLinkAndBillingTools(server: McpServer) {
  registerCollectionMutateTool({
    server,
    name: "update_customer_manager_link",
    title: "Update Customer Manager Link",
    description: "Update manager link status.",
    collection: "customerManagerLinks",
    action: "update",
    resourceLabel: "Customer manager link",
  });
  registerCollectionMutateTool({
    server,
    name: "create_customer_client_link",
    title: "Create Customer Client Link",
    description: "Create manager-client links.",
    collection: "customerClientLinks",
    action: "create",
    resourceLabel: "Customer client link",
  });
  registerCollectionMutateTool({
    server,
    name: "update_customer_client_link",
    title: "Update Customer Client Link",
    description: "Update manager-client links.",
    collection: "customerClientLinks",
    action: "update",
    resourceLabel: "Customer client link",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_customer_client_link",
    title: "Remove Customer Client Link",
    description: "Remove manager-client links.",
    collection: "customerClientLinks",
    action: "remove",
    resourceLabel: "Customer client link",
  });
  registerCollectionMutateTool({
    server,
    name: "create_product_link",
    title: "Create Product Link",
    description: "Create product links where the API supports it.",
    collection: "productLinks",
    action: "create",
    resourceLabel: "Product link",
  });
  registerCollectionMutateTool({
    server,
    name: "update_product_link",
    title: "Update Product Link",
    description: "Update product links.",
    collection: "productLinks",
    action: "update",
    resourceLabel: "Product link",
  });
  registerCollectionMutateTool({
    server,
    name: "remove_product_link",
    title: "Remove Product Link",
    description: "Remove product links.",
    collection: "productLinks",
    action: "remove",
    resourceLabel: "Product link",
  });
  registerQueryTool(server, {
    name: "list_billing_setups",
    title: "List Billing Setups",
    description: "Read billing setup records.",
    resource: "billing_setup",
    fields: [
      "billing_setup.resource_name",
      "billing_setup.id",
      "billing_setup.status",
      "billing_setup.payments_account",
      "billing_setup.payments_account_info.payments_account_id",
      "billing_setup.payments_account_info.payments_account_name",
      "billing_setup.start_date_time",
      "billing_setup.end_date_time",
    ],
  });
  registerQueryTool(server, {
    name: "list_account_budgets",
    title: "List Account Budgets",
    description: "Read account budgets.",
    resource: "account_budget",
    fields: [
      "account_budget.resource_name",
      "account_budget.id",
      "account_budget.name",
      "account_budget.status",
      "account_budget.approved_spending_limit_micros",
      "account_budget.approved_start_date_time",
      "account_budget.approved_end_date_time",
      "account_budget.billing_setup",
    ],
  });
  registerQueryTool(server, {
    name: "change_status_report",
    title: "Change Status Report",
    description: "Read change status resources for incremental sync.",
    resource: "change_status",
    fields: [
      "change_status.resource_name",
      "change_status.last_change_date_time",
      "change_status.resource_type",
      "change_status.resource_status",
      "change_status.campaign",
      "change_status.ad_group",
      "change_status.ad_group_ad",
      "change_status.ad_group_criterion",
    ],
  });

  server.registerTool(
    "list_invoices",
    {
      title: "List Invoices",
      description: "Call InvoiceService.ListInvoices with a raw request object.",
      inputSchema: {
        customer_id: z.string(),
        request: jsonRecordSchema,
      },
    },
    async (params) => callService(params.customer_id, "invoices", "listInvoices", params.request, "list_invoices")
  );
}

function registerPermissionDiagnostics(server: McpServer) {
  server.registerTool(
    "permission_diagnostics",
    {
      title: "Permission Diagnostics",
      description: "Check accessible customers and basic read access for a target customer.",
      inputSchema: {
        customer_id: z.string(),
      },
    },
    async (params) => {
      const tool = "permission_diagnostics";
      try {
        const accessible = await googleAdsRestFetch("customers:listAccessibleCustomers");
        const customer = getAdsClient(params.customer_id);
        const rows = await customer.query(
          `SELECT customer.resource_name, customer.id, customer.descriptive_name, customer.manager, customer.status FROM customer LIMIT 1`
        );
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          results: { accessible_customers: accessible, target_customer_read: rows },
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

function registerQueryTool(
  server: McpServer,
  config: {
    name: string;
    title: string;
    description: string;
    resource: string;
    fields: string[];
  }
) {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: {
        customer_id: z.string(),
        conditions: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = config.name;
      try {
        const customer = getAdsClient(params.customer_id);
        const where = params.conditions?.length
          ? ` WHERE ${params.conditions.join(" AND ")}`
          : "";
        const query = `SELECT ${config.fields.join(", ")} FROM ${
          config.resource
        }${where} LIMIT ${params.limit ?? 1000}`;
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
}

async function callService(
  customerId: string,
  serviceName: string,
  methodName: string,
  request: Record<string, unknown>,
  tool: string
) {
  try {
    const customer = getAdsClient(customerId);
    const service = (customer as unknown as Record<string, Record<string, unknown>>)[
      serviceName
    ];
    const fn = service?.[methodName];
    if (typeof fn !== "function") {
      throw new Error(`${serviceName}.${methodName} is not available`);
    }
    const result = await fn.call(service, {
      customer_id: customerId,
      ...request,
    });
    return mcpSuccess({
      tool,
      customer_id: customerId,
      resource_names: extractResourceNames(result),
      results: result,
      request_id: extractRequestId(result),
    });
  } catch (err) {
    return mcpJsonError(tool, err, { customer_id: customerId });
  }
}
