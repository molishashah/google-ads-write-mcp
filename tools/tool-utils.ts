import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  extractRequestId,
  extractResourceNames,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";

export const jsonRecordSchema = z.record(z.unknown());

export const mutateOptionSchema = {
  validate_only: z.boolean().optional().describe("Validate but do not mutate."),
  partial_failure: z
    .boolean()
    .optional()
    .describe("Allow valid operations to succeed when some operations fail."),
};

export type MutateOptionsInput = {
  validate_only?: boolean;
  partial_failure?: boolean;
};

export function mutateOptions(params: MutateOptionsInput) {
  return {
    validate_only: params.validate_only ?? false,
    partial_failure: params.partial_failure ?? false,
  };
}

export function registerCollectionMutateTool(params: {
  server: McpServer;
  name: string;
  title: string;
  description: string;
  collection: string;
  action: "create" | "update" | "remove";
  resourceLabel: string;
}) {
  const isRemove = params.action === "remove";
  params.server.registerTool(
    params.name,
    {
      title: params.title,
      description: params.description,
      inputSchema: {
        customer_id: z.string().describe("Google Ads customer ID, no hyphens."),
        ...(isRemove
          ? {
              resource_names: z
                .array(z.string())
                .min(1)
                .describe(`${params.resourceLabel} resource names to remove.`),
            }
          : {
              resources: z
                .array(jsonRecordSchema)
                .min(1)
                .describe(`${params.resourceLabel} resources to ${params.action}.`),
            }),
        ...mutateOptionSchema,
      },
    },
    async (input: any) => {
      const tool = params.name;
      try {
        const customer = getAdsClient(input.customer_id);
        const collection = (customer as unknown as Record<string, CollectionApi>)[
          params.collection
        ];
        if (!collection?.[params.action]) {
          throw new Error(
            `Customer collection ${params.collection}.${params.action} is not available`
          );
        }

        const options = mutateOptions(input);
        const fn = collection[params.action];
        if (!fn) {
          throw new Error(
            `Customer collection ${params.collection}.${params.action} is not available`
          );
        }
        const result = isRemove
          ? await fn.call(collection, input.resource_names, options)
          : await fn.call(collection, input.resources, options);

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

type CollectionApi = {
  create?: (resources: JsonRecord[], options?: JsonRecord) => Promise<unknown>;
  update?: (resources: JsonRecord[], options?: JsonRecord) => Promise<unknown>;
  remove?: (resourceNames: string[], options?: JsonRecord) => Promise<unknown>;
};

export async function runGaql(customerId: string, query: string) {
  const customer = getAdsClient(customerId);
  return customer.query(query);
}

export async function runGaqlStream(
  customerId: string,
  query: string,
  maxRows?: number
) {
  const customer = getAdsClient(customerId);
  const rows: unknown[] = [];
  for await (const row of customer.queryStream(query)) {
    rows.push(row);
    if (maxRows && rows.length >= maxRows) break;
  }
  return rows;
}

export function normalizeResourceInput<T extends JsonRecord>(
  resourceName: string,
  fields: T
) {
  return { resource_name: resourceName, ...fields };
}
