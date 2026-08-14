import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  enumValue,
  extractRequestId,
  extractResourceNames,
  toResourceName,
  type JsonRecord,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess } from "@/lib/mcp-helpers";
import {
  jsonRecordSchema,
  mutateOptionSchema,
  mutateOptions,
} from "@/tools/tool-utils";

const AUTO_APPLY_RECOMMENDATION_TYPES = [
  "CAMPAIGN_BUDGET",
  "KEYWORD",
  "TARGET_CPA_OPT_IN",
  "MAXIMIZE_CONVERSIONS_OPT_IN",
  "SEARCH_PARTNERS_OPT_IN",
  "MAXIMIZE_CLICKS_OPT_IN",
  "OPTIMIZE_AD_ROTATION",
  "KEYWORD_MATCH_TYPE",
  "TARGET_ROAS_OPT_IN",
  "USE_BROAD_MATCH_KEYWORD",
  "DISPLAY_EXPANSION_OPT_IN",
  "PERFORMANCE_MAX_OPT_IN",
  "MAXIMIZE_CONVERSION_VALUE_OPT_IN",
] as const;

export function registerAutomationTools(server: McpServer) {
  registerRecommendationSubscriptionTools(server);
  registerBatchJobTools(server);
}

function registerRecommendationSubscriptionTools(server: McpServer) {
  server.registerTool(
    "list_recommendation_subscriptions",
    {
      title: "List Recommendation Subscriptions",
      description: "List recommendation types configured for automatic application.",
      inputSchema: { customer_id: z.string() },
    },
    async (params) => {
      const tool = "list_recommendation_subscriptions";
      try {
        const query = `SELECT recommendation_subscription.resource_name, recommendation_subscription.type, recommendation_subscription.status, recommendation_subscription.create_date_time, recommendation_subscription.modify_date_time FROM recommendation_subscription ORDER BY recommendation_subscription.type`;
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
    "subscribe_recommendation_type",
    {
      title: "Subscribe Recommendation Type",
      description:
        "Enable automatic application for a supported recommendation type.",
      inputSchema: {
        customer_id: z.string(),
        recommendation_type: z.enum(AUTO_APPLY_RECOMMENDATION_TYPES),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "subscribe_recommendation_type";
      try {
        const resource = buildRecommendationSubscription({
          recommendation_type: params.recommendation_type,
          status: "ENABLED",
        });
        const result = await getAdsClient(
          params.customer_id
        ).recommendationSubscriptions.create(
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

  server.registerTool(
    "set_recommendation_subscription_status",
    {
      title: "Set Recommendation Subscription Status",
      description: "Enable or pause automatic application for a recommendation type.",
      inputSchema: {
        customer_id: z.string(),
        recommendation_type: z.enum(AUTO_APPLY_RECOMMENDATION_TYPES),
        status: z.enum(["ENABLED", "PAUSED"]),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "set_recommendation_subscription_status";
      try {
        const resource = {
          resource_name: toResourceName(
            params.customer_id,
            "recommendationSubscriptions",
            params.recommendation_type
          ),
          status: enumValue(
            enums.RecommendationSubscriptionStatus,
            params.status
          ),
        };
        const result = await getAdsClient(
          params.customer_id
        ).recommendationSubscriptions.update(
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
}

export function buildRecommendationSubscription(params: {
  recommendation_type: (typeof AUTO_APPLY_RECOMMENDATION_TYPES)[number];
  status: "ENABLED" | "PAUSED";
}) {
  return {
    type: enumValue(enums.RecommendationType, params.recommendation_type),
    status: enumValue(enums.RecommendationSubscriptionStatus, params.status),
  };
}

function registerBatchJobTools(server: McpServer) {
  server.registerTool(
    "list_batch_jobs",
    {
      title: "List Batch Jobs",
      description: "List asynchronous batch jobs and their execution state.",
      inputSchema: {
        customer_id: z.string(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_batch_jobs";
      try {
        const query = `SELECT batch_job.resource_name, batch_job.id, batch_job.status, batch_job.metadata.creation_date_time, batch_job.metadata.start_date_time, batch_job.metadata.completion_date_time, batch_job.metadata.estimated_completion_ratio, batch_job.metadata.operation_count, batch_job.metadata.executed_operation_count FROM batch_job ORDER BY batch_job.id DESC LIMIT ${params.limit ?? 1000}`;
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
    "create_batch_job",
    {
      title: "Create Batch Job",
      description: "Create an empty batch job and return its resource name.",
      inputSchema: { customer_id: z.string() },
    },
    async (params) => {
      const tool = "create_batch_job";
      try {
        const result = await getAdsClient(params.customer_id).batchJobs.create([
          {},
        ]);
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

  server.registerTool(
    "add_batch_job_operations",
    {
      title: "Add Batch Job Operations",
      description:
        "Append raw Google Ads mutate operations to a batch job. Use the returned sequence token for subsequent chunks.",
      inputSchema: {
        customer_id: z.string(),
        batch_job_id: z.string(),
        mutate_operations: z.array(jsonRecordSchema).min(1),
        sequence_token: z.string().optional(),
      },
    },
    async (params) => {
      const tool = "add_batch_job_operations";
      try {
        const request = buildBatchJobOperationsRequest(params);
        const result = await getAdsClient(
          params.customer_id
        ).batchJobs.addBatchJobOperations(request as never);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [request.resource_name],
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );

  registerBatchJobRpc(server, "run_batch_job", "runBatchJob");
  registerBatchJobRpc(server, "list_batch_job_results", "listBatchJobResults");

  server.registerTool(
    "remove_batch_job",
    {
      title: "Remove Batch Job",
      description: "Remove a batch job that has not run.",
      inputSchema: { customer_id: z.string(), batch_job_id: z.string() },
    },
    async (params) => {
      const tool = "remove_batch_job";
      try {
        const resourceName = toResourceName(
          params.customer_id,
          "batchJobs",
          params.batch_job_id
        );
        const result = await getAdsClient(params.customer_id).batchJobs.remove([
          resourceName,
        ]);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [resourceName],
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}

export function buildBatchJobOperationsRequest(params: {
  customer_id: string;
  batch_job_id: string;
  mutate_operations: JsonRecord[];
  sequence_token?: string;
}) {
  return {
    resource_name: toResourceName(
      params.customer_id,
      "batchJobs",
      params.batch_job_id
    ),
    mutate_operations: params.mutate_operations,
    ...(params.sequence_token ? { sequence_token: params.sequence_token } : {}),
  };
}

function registerBatchJobRpc(
  server: McpServer,
  tool: "run_batch_job" | "list_batch_job_results",
  method: "runBatchJob" | "listBatchJobResults"
) {
  server.registerTool(
    tool,
    {
      title:
        tool === "run_batch_job" ? "Run Batch Job" : "List Batch Job Results",
      description:
        tool === "run_batch_job"
          ? "Start asynchronous execution of an uploaded batch job."
          : "Page through the per-operation results of a completed batch job.",
      inputSchema: {
        customer_id: z.string(),
        batch_job_id: z.string(),
        page_size: z.number().int().positive().max(1000).optional(),
        page_token: z.string().optional(),
      },
    },
    async (params) => {
      try {
        const resourceName = toResourceName(
          params.customer_id,
          "batchJobs",
          params.batch_job_id
        );
        const request =
          method === "runBatchJob"
            ? { resource_name: resourceName }
            : {
                resource_name: resourceName,
                ...(params.page_size ? { page_size: params.page_size } : {}),
                ...(params.page_token ? { page_token: params.page_token } : {}),
              };
        const api = getAdsClient(params.customer_id).batchJobs as unknown as {
          runBatchJob(request: JsonRecord): Promise<unknown>;
          listBatchJobResults(request: JsonRecord): Promise<unknown>;
        };
        const result = await api[method](request);
        return mcpSuccess({
          tool,
          customer_id: params.customer_id,
          resource_names: [resourceName],
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(tool, err, { customer_id: params.customer_id });
      }
    }
  );
}
