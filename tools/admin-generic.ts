import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  extractRequestId,
  extractResourceNames,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import { jsonRecordSchema, mutateOptions, mutateOptionSchema } from "@/tools/tool-utils";

export function registerGenericAdminTools(server: McpServer) {
  registerMutateGoogleAdsResources(server);
  registerCallGoogleAdsServiceMethod(server);
}

function registerMutateGoogleAdsResources(server: McpServer) {
  server.registerTool(
    "mutate_google_ads_resources",
    {
      title: "Mutate Google Ads Resources",
      description:
        "Full-admin escape hatch for Google Ads resource collections. " +
        "Calls a generated google-ads-api collection create/update/remove method, " +
        "for example campaigns.update, assets.create, sharedSets.remove, or " +
        "customerUserAccesses.update. Prefer purpose-built tools for common flows.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        collection: z
          .string()
          .describe("Generated client collection name, e.g. campaigns, assets."),
        action: z.enum(["create", "update", "remove"]),
        resources: z
          .array(jsonRecordSchema)
          .optional()
          .describe("Resources for create/update actions."),
        resource_names: z
          .array(z.string())
          .optional()
          .describe("Resource names for remove actions."),
        ...mutateOptionSchema,
      },
    },
    async (input) => {
      const tool = "mutate_google_ads_resources";
      try {
        const customer = getAdsClient(input.customer_id);
        const collection = (customer as unknown as Record<string, Record<string, unknown>>)[
          input.collection
        ];
        const fn = collection?.[input.action];
        if (typeof fn !== "function") {
          throw new Error(
            `Collection method ${input.collection}.${input.action} is not available`
          );
        }
        const options = mutateOptions(input);
        const payload =
          input.action === "remove"
            ? input.resource_names ?? []
            : input.resources ?? [];
        if (!payload.length) {
          throw new Error(
            input.action === "remove"
              ? "resource_names is required for remove"
              : "resources is required for create/update"
          );
        }
        const result = await fn.call(collection, payload, options);
        return mcpSuccess({
          tool,
          customer_id: input.customer_id,
          validate_only: options.validate_only,
          resource_names: extractResourceNames(result),
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, {
          customer_id: input.customer_id,
          validate_only: input.validate_only,
        });
      }
    }
  );
}

function registerCallGoogleAdsServiceMethod(server: McpServer) {
  server.registerTool(
    "call_google_ads_service_method",
    {
      title: "Call Google Ads Service Method",
      description:
        "Full-admin escape hatch for generated service RPCs that are not simple " +
        "collection mutations, such as keywordPlanIdeas.generateKeywordIdeas, " +
        "conversionUploads.uploadClickConversions, invoices.listInvoices, or " +
        "campaigns.enablePMaxBrandGuidelines. Prefer purpose-built tools when present.",
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        service: z
          .string()
          .describe("Generated service getter, e.g. keywordPlanIdeas."),
        method: z
          .string()
          .describe("Generated method name, e.g. generateKeywordIdeas."),
        request: jsonRecordSchema.describe("Request object passed to the RPC."),
      },
    },
    async (input) => {
      const tool = "call_google_ads_service_method";
      try {
        const customer = getAdsClient(input.customer_id);
        const service = (customer as unknown as Record<string, Record<string, unknown>>)[
          input.service
        ];
        const fn = service?.[input.method];
        if (typeof fn !== "function") {
          throw new Error(
            `Service method ${input.service}.${input.method} is not available`
          );
        }
        const result = await fn.call(service, input.request);
        return mcpSuccess({
          tool,
          customer_id: input.customer_id,
          resource_names: extractResourceNames(result),
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: input.customer_id });
      }
    }
  );
}
