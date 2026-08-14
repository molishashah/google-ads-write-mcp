import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, services } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import {
  extractRequestId,
  extractResourceNames,
  toResourceName,
} from "@/lib/google-ads-utils";
import { mcpJsonError, mcpSuccess, mcpText, mcpError } from "@/lib/mcp-helpers";
import {
  jsonRecordSchema,
  mutateOptionSchema,
  mutateOptions,
  registerCollectionMutateTool,
} from "@/tools/tool-utils";

const TYPED_EXPERIMENT_TYPES = [
  "AD_VARIATION",
  "SEARCH_CUSTOM",
  "DISPLAY_CUSTOM",
  "DISPLAY_AUTOMATED_BIDDING_STRATEGY",
  "SEARCH_AUTOMATED_BIDDING_STRATEGY",
  "SHOPPING_AUTOMATED_BIDDING_STRATEGY",
  "OPTIMIZE_ASSETS",
  "ADOPT_AI_MAX",
  "ADOPT_BROAD_MATCH_KEYWORDS",
  "PMAX_REPLACEMENT_SHOPPING",
] as const;

// ──────────────────────────────────────────────────────────────────────
// Ad Variation experiment tools
//
// Divergence from the PRD
// -----------------------
// The PRD's example code was written against a simplified API that
// doesn't match the generated google-ads-api client: no `experiments.mutate({operations})`,
// no `trafficSplitPercent` on Experiment, no boolean `inDesign` on
// ExperimentArm, camelCase vs snake_case, etc. What IS real in the generated client:
//
//   1. experiments.create([{name, type=AD_VARIATION, status=SETUP, suffix}])
//   2. experimentArms.create([control, treatment], response_content_type=
//      MUTABLE_RESOURCE) — Google auto-creates a draft campaign for the
//      treatment and returns it via `treatment.in_design_campaigns[0]`.
//   3. Query the draft campaign to find the copy of the base ad group
//      (matched by name).
//   4. Create the new RSA in the draft ad group.
//   5. Pause any pre-existing ads in the draft ad group so only the new
//      treatment copy runs.
//   6. experiments.scheduleExperiment({resource_name}) — begins serving.
//
// This mirrors the flow in Google's own Python sample:
//   https://github.com/googleads/google-ads-python/blob/main/examples/
//   campaign_management/create_experiment.py
// ──────────────────────────────────────────────────────────────────────

export function registerExperimentTools(server: McpServer) {
  registerCreateAdVariation(server);
  registerGetExperimentStatus(server);
  registerGraduateExperiment(server);
  registerExperimentAdminTools(server);
}

function registerExperimentAdminTools(server: McpServer) {
  registerTypedExperimentCreationTools(server);
  server.registerTool(
    "list_experiments",
    {
      title: "List Experiments",
      description: "List experiments and lifecycle metadata.",
      inputSchema: {
        customer_id: z.string(),
        limit: z.number().int().positive().max(10000).optional(),
      },
    },
    async (params) => {
      const tool = "list_experiments";
      try {
        const customer = getAdsClient(params.customer_id);
        const query = `
          SELECT
            experiment.resource_name,
            experiment.id,
            experiment.name,
            experiment.type,
            experiment.status,
            experiment.start_date,
            experiment.end_date,
            experiment.suffix
          FROM experiment
          ORDER BY experiment.id DESC
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

  registerExperimentRpcTool(
    server,
    "schedule_experiment",
    "scheduleExperiment",
    "Schedule an experiment."
  );
  registerExperimentRpcTool(
    server,
    "end_experiment",
    "endExperiment",
    "End an experiment."
  );
  registerExperimentRpcTool(
    server,
    "promote_experiment",
    "promoteExperiment",
    "Promote an experiment."
  );
  registerExperimentRpcTool(
    server,
    "list_experiment_async_errors",
    "listExperimentAsyncErrors",
    "List asynchronous experiment errors."
  );
  registerCollectionMutateTool({
    server,
    name: "remove_experiment",
    title: "Remove Experiment",
    description: "Irreversibly remove experiments.",
    collection: "experiments",
    action: "remove",
    resourceLabel: "Experiment",
  });
  registerCollectionMutateTool({
    server,
    name: "update_experiment",
    title: "Update Experiment",
    description: "Update raw experiment fields.",
    collection: "experiments",
    action: "update",
    resourceLabel: "Experiment",
  });
}

function registerTypedExperimentCreationTools(server: McpServer) {
  server.registerTool(
    "create_experiment",
    {
      title: "Create Experiment",
      description:
        "Create a typed experiment shell in SETUP status. Add arms before scheduling.",
      inputSchema: {
        customer_id: z.string(),
        name: z.string().min(1).max(64),
        type: z.enum(TYPED_EXPERIMENT_TYPES),
        suffix: z.string().max(64).optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        fields: jsonRecordSchema.optional(),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_experiment";
      try {
        const resource = buildExperimentResource(params);
        const result = await getAdsClient(params.customer_id).experiments.create(
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
    "create_experiment_arms",
    {
      title: "Create Experiment Arms",
      description:
        "Create control and treatment arms with validated traffic splits. Treatment draft campaigns are returned when supported.",
      inputSchema: {
        customer_id: z.string(),
        experiment_id: z.string(),
        arms: z
          .array(
            z.object({
              name: z.string().min(1),
              control: z.boolean(),
              traffic_split: z.number().int().min(1).max(99),
              campaign_ids: z.array(z.string()).optional(),
              fields: jsonRecordSchema.optional(),
            })
          )
          .min(2),
        ...mutateOptionSchema,
      },
    },
    async (params) => {
      const tool = "create_experiment_arms";
      try {
        const resources = buildExperimentArms(params);
        const result = await getAdsClient(
          params.customer_id
        ).experimentArms.create(resources as never[], {
          ...mutateOptions(params),
          response_content_type: enums.ResponseContentType.MUTABLE_RESOURCE,
        });
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
}

export function buildExperimentResource(params: {
  name: string;
  type: (typeof TYPED_EXPERIMENT_TYPES)[number];
  suffix?: string;
  start_date?: string;
  end_date?: string;
  fields?: Record<string, unknown>;
}) {
  return {
    name: params.name,
    type: enums.ExperimentType[params.type],
    status: enums.ExperimentStatus.SETUP,
    suffix: params.suffix ?? ` [${params.name}]`,
    ...(params.start_date ? { start_date: params.start_date } : {}),
    ...(params.end_date ? { end_date: params.end_date } : {}),
    ...(params.fields ?? {}),
  };
}

export function buildExperimentArms(params: {
  customer_id: string;
  experiment_id: string;
  arms: Array<{
    name: string;
    control: boolean;
    traffic_split: number;
    campaign_ids?: string[];
    fields?: Record<string, unknown>;
  }>;
}) {
  const controls = params.arms.filter((arm) => arm.control);
  if (controls.length !== 1) {
    throw new Error("Exactly one experiment arm must be the control.");
  }
  const split = params.arms.reduce(
    (total, arm) => total + arm.traffic_split,
    0
  );
  if (split !== 100) {
    throw new Error(`Experiment arm traffic splits must total 100, got ${split}.`);
  }
  if (!controls[0].campaign_ids?.length) {
    throw new Error("The control arm must include at least one campaign_id.");
  }
  const experiment = toResourceName(
    params.customer_id,
    "experiments",
    params.experiment_id
  );
  return params.arms.map((arm) => ({
    experiment,
    name: arm.name,
    control: arm.control,
    traffic_split: arm.traffic_split,
    ...(arm.campaign_ids?.length
      ? {
          campaigns: arm.campaign_ids.map((id) =>
            toResourceName(params.customer_id, "campaigns", id)
          ),
        }
      : {}),
    ...(arm.fields ?? {}),
  }));
}

function registerExperimentRpcTool(
  server: McpServer,
  toolName: string,
  methodName:
    | "scheduleExperiment"
    | "endExperiment"
    | "promoteExperiment"
    | "listExperimentAsyncErrors",
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
        experiment_id: z
          .string()
          .optional()
          .describe("Experiment resource name or numeric ID for the common lifecycle call."),
        request: jsonRecordSchema
          .optional()
          .describe("Raw ExperimentService request object. Overrides experiment_id when provided."),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
        const request = buildExperimentLifecycleRequest(params, methodName);
        const result = await customer.experiments[methodName](request as never);
        return mcpSuccess({
          tool: toolName,
          customer_id: params.customer_id,
          resource_names: extractResourceNames(result),
          results: result,
          request_id: extractRequestId(result),
        });
      } catch (err) {
        return mcpJsonError(toolName, err, { customer_id: params.customer_id });
      }
    }
  );
}

export function buildExperimentLifecycleRequest(
  params: {
    customer_id: string;
    experiment_id?: string;
    request?: Record<string, unknown>;
  },
  _methodName:
    | "scheduleExperiment"
    | "endExperiment"
    | "promoteExperiment"
    | "listExperimentAsyncErrors"
) {
  if (params.request) return params.request;
  if (!params.experiment_id) {
    throw new Error("Provide experiment_id or raw request.");
  }
  return {
    resource_name: toResourceName(
      params.customer_id,
      "experiments",
      params.experiment_id
    ),
  };
}

// ── create_ad_variation ──────────────────────────────────────────────
function registerCreateAdVariation(server: McpServer) {
  server.registerTool(
    "create_ad_variation",
    {
      title: "Create Ad Variation Experiment",
      description:
        "Register a copy hypothesis as a Google Ad Variation experiment. " +
        "Creates an Experiment + control/treatment arms, adds a new RSA " +
        "with the provided headlines/descriptions to the auto-generated " +
        "draft ad group, pauses existing ads in that draft group so only " +
        "the new treatment runs, and schedules the experiment. Google " +
        "then runs a 50/50 split and delivers a statistical verdict. Use " +
        "this when testing a new creative angle against a working baseline;" +
        " use create_responsive_search_ad + pause_ad for clearly broken ads.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens"),
        campaign_id: z
          .string()
          .describe("Base campaign resource name (e.g. 'customers/123/campaigns/789')"),
        ad_group_id: z
          .string()
          .describe("Base ad group resource name (e.g. 'customers/123/adGroups/456')"),
        variation_name: z
          .string()
          .max(64)
          .describe("Human-readable label (e.g. 'capability-framing-apr8')"),
        final_url: z.string().url().describe("Landing page URL for the treatment ad"),
        headlines: z
          .array(z.string().max(30))
          .min(3)
          .max(15)
          .describe("3–15 treatment headlines, each max 30 characters"),
        descriptions: z
          .array(z.string().max(90))
          .min(2)
          .max(4)
          .describe("2–4 treatment descriptions, each max 90 characters"),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, validate inputs and confirm the base ad group exists, " +
              "then return without creating the experiment, arms, or any " +
              "draft ads. The 8-step experiment flow cannot be passed " +
              "through to the API's native validate_only because each step " +
              "depends on the previous one having persisted, so this is an " +
              "application-layer dry run. Default: false."
          ),
      },
    },
    async (params) => createAdVariation(params)
  );
}

// ── get_experiment_status ─────────────────────────────────────────────
function registerGetExperimentStatus(server: McpServer) {
  server.registerTool(
    "get_experiment_status",
    {
      title: "Get Ad Variation Experiment Status",
      description:
        "Check the status of an Ad Variation experiment AND fetch " +
        "per-arm performance metrics so the agent can score winner / " +
        "loser / inconclusive. Returns the experiment lifecycle state " +
        "(SETUP, INITIATED, RUNNING, GRADUATED, HALTED, PROMOTED, " +
        "REMOVED) plus metrics (impressions, clicks, conversions, " +
        "conversion_rate) aggregated per arm (control vs. treatment) " +
        "across the experiment's campaigns over the last 30 days. " +
        "Used by autoresearch-ads Step 3 to score launched ad_variation " +
        "experiments. Returns JSON for downstream parsing.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens"),
        experiment_id: z
          .string()
          .describe(
            "Experiment resource name (e.g. 'customers/123/experiments/456')"
          ),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);

        // Step 1: experiment metadata
        const expRows = await customer.query<
          { experiment: ExperimentRow }[]
        >(
          `SELECT
             experiment.resource_name,
             experiment.name,
             experiment.status,
             experiment.start_date,
             experiment.end_date
           FROM experiment
           WHERE experiment.resource_name = '${escapeGaql(
             params.experiment_id
           )}'`
        );

        if (!expRows.length) {
          return mcpError(
            "fetching experiment",
            new Error(`Experiment not found: ${params.experiment_id}`)
          );
        }
        const exp = expRows[0].experiment;
        const status = normalizeExperimentStatus(exp.status);

        // Step 2: per-arm metadata (control flag + campaigns list)
        const armRows = await customer.query<
          {
            experiment_arm: {
              resource_name?: string | null;
              name?: string | null;
              control?: boolean | null;
              campaigns?: string[] | null;
              traffic_split?: number | null;
            };
          }[]
        >(
          `SELECT
             experiment_arm.resource_name,
             experiment_arm.name,
             experiment_arm.control,
             experiment_arm.campaigns,
             experiment_arm.traffic_split
           FROM experiment_arm
           WHERE experiment_arm.experiment = '${escapeGaql(
             params.experiment_id
           )}'`
        );

        const arms = armRows.map((r) => ({
          resource_name: r.experiment_arm?.resource_name ?? "",
          name: r.experiment_arm?.name ?? "",
          control: !!r.experiment_arm?.control,
          campaigns: r.experiment_arm?.campaigns ?? [],
          traffic_split: r.experiment_arm?.traffic_split ?? 0,
        }));

        // Step 3: aggregate metrics per arm by summing each arm's
        // campaigns. We do this with a single campaign query and
        // bucket results in JS, rather than N queries.
        const allCampaigns = Array.from(
          new Set(arms.flatMap((a) => a.campaigns))
        );

        type CampaignMetrics = {
          impressions: number;
          clicks: number;
          conversions: number;
        };
        const metricsByCampaign = new Map<string, CampaignMetrics>();

        if (allCampaigns.length > 0) {
          const inClause = allCampaigns
            .map((c) => `'${escapeGaql(c)}'`)
            .join(", ");
          const campRows = await customer.query<
            {
              campaign: { resource_name?: string | null };
              metrics: {
                impressions?: number | null;
                clicks?: number | null;
                conversions?: number | null;
              };
            }[]
          >(
            `SELECT
               campaign.resource_name,
               metrics.impressions,
               metrics.clicks,
               metrics.conversions
             FROM campaign
             WHERE campaign.resource_name IN (${inClause})
               AND segments.date DURING LAST_30_DAYS`
          );
          for (const row of campRows) {
            const rn = row.campaign?.resource_name;
            if (!rn) continue;
            const prev = metricsByCampaign.get(rn) ?? {
              impressions: 0,
              clicks: 0,
              conversions: 0,
            };
            metricsByCampaign.set(rn, {
              impressions: prev.impressions + (row.metrics?.impressions ?? 0),
              clicks: prev.clicks + (row.metrics?.clicks ?? 0),
              conversions: prev.conversions + (row.metrics?.conversions ?? 0),
            });
          }
        }

        const armResults = arms.map((arm) => {
          let impressions = 0;
          let clicks = 0;
          let conversions = 0;
          for (const camp of arm.campaigns) {
            const m = metricsByCampaign.get(camp);
            if (m) {
              impressions += m.impressions;
              clicks += m.clicks;
              conversions += m.conversions;
            }
          }
          const conversion_rate = clicks > 0 ? conversions / clicks : 0;
          return {
            name: arm.name,
            role: arm.control ? "control" : "treatment",
            traffic_split: arm.traffic_split,
            campaigns: arm.campaigns,
            metrics: {
              impressions,
              clicks,
              conversions,
              conversion_rate: Number(conversion_rate.toFixed(6)),
            },
          };
        });

        // Compute the verdict comparison the agent needs for Step 3.
        const control = armResults.find((a) => a.role === "control");
        const treatment = armResults.find((a) => a.role === "treatment");
        let lift_vs_control: number | null = null;
        if (
          control &&
          treatment &&
          control.metrics.conversion_rate > 0
        ) {
          lift_vs_control = Number(
            (
              (treatment.metrics.conversion_rate -
                control.metrics.conversion_rate) /
              control.metrics.conversion_rate
            ).toFixed(4)
          );
        }

        // Status hint mirrors the actual Google Ads enum values.
        let hint = "";
        if (status === "GRADUATED") {
          hint =
            "Google has reached a verdict. Call graduate_experiment to " +
            "promote the winner, or do nothing to keep the control.";
        } else if (status === "PROMOTED") {
          hint =
            "Already promoted — the treatment is now the permanent ad. " +
            "No further action needed.";
        } else if (status === "RUNNING") {
          hint =
            "Still running — check back later. Typical maturity: 2–4 weeks.";
        } else if (status === "SETUP" || status === "INITIATED") {
          hint =
            "Not yet collecting data. Call scheduleExperiment if SETUP.";
        } else if (status === "HALTED" || status === "REMOVED") {
          hint = "Experiment is no longer collecting data.";
        }

        const result = {
          experiment: {
            resource_name: exp.resource_name ?? params.experiment_id,
            name: exp.name ?? null,
            status: status ?? "UNKNOWN",
            start_date: exp.start_date ?? null,
            end_date: exp.end_date ?? null,
          },
          arms: armResults,
          comparison: {
            control_conversion_rate:
              control?.metrics.conversion_rate ?? null,
            treatment_conversion_rate:
              treatment?.metrics.conversion_rate ?? null,
            lift_vs_control,
          },
          hint,
        };

        return mcpText(JSON.stringify(result, null, 2));
      } catch (err) {
        return mcpError("fetching experiment status", err);
      }
    }
  );
}

// ── graduate_experiment ───────────────────────────────────────────────
function registerGraduateExperiment(server: McpServer) {
  server.registerTool(
    "graduate_experiment",
    {
      title: "Graduate Ad Variation Experiment",
      description:
        "Promote the winning treatment variant to the base campaign. " +
        "This permanently replaces the control ad. Only call this after " +
        "a human has reviewed the get_experiment_status verdict and " +
        "confirmed. Cannot be undone without manually creating a new ad.",
      inputSchema: {
        customer_id: z
          .string()
          .describe("Google Ads customer ID, no hyphens"),
        experiment_id: z
          .string()
          .describe("Experiment resource name from get_experiment_status"),
        validate_only: z
          .boolean()
          .optional()
          .describe(
            "If true, look up the experiment and confirm it exists and is " +
              "in a graduateable state, but do NOT actually graduate it. " +
              "Useful for testing the call shape without permanently " +
              "modifying the campaign. The Ads API's graduateExperiment " +
              "RPC does not natively support validate_only, so this is " +
              "an application-layer dry run. Default: false."
          ),
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);

        // ── validate_only short-circuit ─────────────────────────────
        // graduateExperiment is an RPC, not a mutate, so the proto
        // does not expose validate_only. We approximate it by
        // querying the experiment to confirm it exists and reporting
        // its current status, then returning without graduating.
        if (params.validate_only) {
          const rows = await customer.query<{
            experiment: { name?: string | null; status?: string | number | null };
          }[]>(
            `SELECT experiment.name, experiment.status
             FROM experiment
             WHERE experiment.resource_name = '${escapeGaql(
               params.experiment_id
             )}'`
          );
          if (!rows.length) {
            return mcpError(
              "graduating experiment (validate_only)",
              new Error(`Experiment not found: ${params.experiment_id}`)
            );
          }
          const exp = rows[0].experiment;
          const expStatus = normalizeExperimentStatus(exp.status);
          return mcpText(
            [
              "✅ validate_only: experiment exists and is reachable.",
              "",
              `  Experiment:  ${params.experiment_id}`,
              `  Name:        ${exp.name ?? "(unnamed)"}`,
              `  Status:      ${expStatus ?? "UNKNOWN"}`,
              "",
              expStatus === "GRADUATED" || expStatus === "PROMOTED"
                ? "⚠️  Already graduated/promoted."
                : "Re-run with validate_only=false to actually graduate.",
            ].join("\n")
          );
        }

        // campaign_budget_mappings is required by the API but can be an
        // empty array — the graduated campaign then inherits whatever
        // budget Google's draft copy is using.
        //
        // We build a real GraduateExperimentRequest instance (not a
        // plain object) because the service method is typed against the
        // generated class, which has methods like toJSON() that a
        // literal lacks.
        await customer.experiments.graduateExperiment(
          services.GraduateExperimentRequest.create({
            experiment: params.experiment_id,
            campaign_budget_mappings: [],
          })
        );
        return mcpText(
          `Experiment ${params.experiment_id} graduated.\n` +
            "The treatment variant is now live as the permanent ad in the " +
            "base campaign."
        );
      } catch (err) {
        return mcpError("graduating experiment", err);
      }
    }
  );
}

// ── helpers ───────────────────────────────────────────────────────────

interface ExperimentRow {
  resource_name?: string | null;
  name?: string | null;
  status?: string | number | null;
  start_date?: string | null;
  end_date?: string | null;
}

/**
 * Normalise an ExperimentStatus value into the canonical string. The
 * TypeScript google-ads-api package can return enum fields as either
 * the integer value or the string label depending on the protobuf
 * accessor used. The agent expects strings ("RUNNING", "GRADUATED",
 * etc.) so we always coerce.
 */
function normalizeExperimentStatus(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const map = enums.ExperimentStatus as unknown as Record<number, string>;
    return map[value] ?? String(value);
  }
  return String(value);
}

/**
 * Escape a string for safe interpolation into a single-quoted GAQL
 * literal. GAQL does not document an official escape sequence, but
 * backslash-escaping quotes is the de-facto standard used by the
 * google-ads-api package itself.
 */
function escapeGaql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── create_ad_variation implementation ──────────────────────────────
interface CreateAdVariationParams {
  customer_id: string;
  campaign_id: string;
  ad_group_id: string;
  variation_name: string;
  final_url: string;
  headlines: string[];
  descriptions: string[];
  validate_only?: boolean;
}

async function createAdVariation(params: CreateAdVariationParams) {
  try {
    const customer = getAdsClient(params.customer_id);

    // Step 1: Look up the base ad group's name so we can find the draft
    // copy Google creates inside the treatment arm's draft campaign.
    const baseAdGroupRows = await customer.query<{
      ad_group: { name?: string | null };
    }[]>(
      `SELECT ad_group.name
       FROM ad_group
       WHERE ad_group.resource_name = '${escapeGaql(params.ad_group_id)}'`
    );
    const baseAdGroupName = baseAdGroupRows[0]?.ad_group?.name;
    if (!baseAdGroupName) {
      return mcpError(
        "creating ad variation",
        new Error(
          `Base ad group not found: ${params.ad_group_id}. Check the ` +
            "resource name and that the customer has access to it."
        )
      );
    }

    // ── validate_only short-circuit ─────────────────────────────────
    // We CANNOT thread validate_only through the 8-step flow because
    // each step depends on the previous one having actually persisted.
    // Instead we treat it as a strict dry-run: confirm inputs are
    // sane, the base ad group resolves, and the schema validates,
    // then return without ANY mutates. This is enough to catch the
    // common failure modes (wrong customer_id, wrong ad_group_id,
    // headline/description count out of range) without spending or
    // creating draft resources Google would have to garbage-collect.
    if (params.validate_only) {
      return mcpText(
        [
          "✅ validate_only: inputs validated, base ad group resolved.",
          "",
          `  Base ad group:    ${params.ad_group_id} ("${baseAdGroupName}")`,
          `  Variation name:   ${params.variation_name}`,
          `  Headlines:        ${params.headlines.length}`,
          `  Descriptions:     ${params.descriptions.length}`,
          `  Final URL:        ${params.final_url}`,
          "",
          "No experiment, arms, or ads were created. Re-run with " +
            "validate_only=false to actually launch the experiment.",
        ].join("\n")
      );
    }

    // Step 2: Create the Experiment shell.
    const expResult = await customer.experiments.create([
      {
        name: params.variation_name,
        type: enums.ExperimentType.AD_VARIATION,
        suffix: ` [${params.variation_name}]`,
        status: enums.ExperimentStatus.SETUP,
      },
    ]);
    const experimentResourceName = expResult.results?.[0]?.resource_name;
    if (!experimentResourceName) {
      return mcpError(
        "creating ad variation",
        new Error("experiments.create succeeded but returned no resource_name")
      );
    }

    // Step 3: Create control + treatment arms in one call.
    // MUTABLE_RESOURCE response lets us read the auto-generated draft
    // campaign for the treatment arm.
    const armsResult = await customer.experimentArms.create(
      [
        {
          experiment: experimentResourceName,
          name: "control",
          control: true,
          campaigns: [params.campaign_id],
          traffic_split: 50,
        },
        {
          experiment: experimentResourceName,
          name: "treatment",
          control: false,
          traffic_split: 50,
        },
      ],
      { response_content_type: enums.ResponseContentType.MUTABLE_RESOURCE }
    );
    const treatmentArm = armsResult.results?.[1]?.experiment_arm;
    const draftCampaign = treatmentArm?.in_design_campaigns?.[0];
    if (!draftCampaign) {
      return mcpError(
        "creating ad variation",
        new Error(
          "experimentArms.create succeeded but no draft campaign was " +
            "returned for the treatment arm. Check MUTABLE_RESOURCE support."
        )
      );
    }

    // Step 4: Find the draft copy of the base ad group (matched by name).
    const draftAdGroupRows = await customer.query<{
      ad_group: { resource_name?: string | null };
    }[]>(
      `SELECT ad_group.resource_name
       FROM ad_group
       WHERE ad_group.campaign = '${escapeGaql(draftCampaign)}'
         AND ad_group.name = '${escapeGaql(baseAdGroupName)}'`
    );
    const draftAdGroup = draftAdGroupRows[0]?.ad_group?.resource_name;
    if (!draftAdGroup) {
      return mcpError(
        "creating ad variation",
        new Error(
          `Could not find draft copy of ad group "${baseAdGroupName}" in ` +
            `draft campaign ${draftCampaign}.`
        )
      );
    }

    // Step 5: Query existing draft ads so we can pause them after creating
    // the new treatment RSA.
    const existingDraftAdsRows = await customer.query<{
      ad_group_ad: { resource_name?: string | null; status?: string | null };
    }[]>(
      `SELECT ad_group_ad.resource_name, ad_group_ad.status
       FROM ad_group_ad
       WHERE ad_group_ad.ad_group = '${escapeGaql(draftAdGroup)}'`
    );

    // Step 6: Create the new treatment RSA in the draft ad group.
    const newAdResult = await customer.adGroupAds.create([
      {
        ad_group: draftAdGroup,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [params.final_url],
          responsive_search_ad: {
            headlines: params.headlines.map((text) => ({ text })),
            descriptions: params.descriptions.map((text) => ({ text })),
          },
        },
      },
    ]);
    const newAdResourceName = newAdResult.results?.[0]?.resource_name;
    if (!newAdResourceName) {
      return mcpError(
        "creating ad variation",
        new Error("adGroupAds.create succeeded but returned no resource_name")
      );
    }

    // Step 7: Pause any pre-existing ads in the draft ad group so only
    // the new treatment copy runs.
    const toPause = existingDraftAdsRows
      .map((row) => row.ad_group_ad)
      .filter(
        (ad): ad is { resource_name: string; status?: string | null } =>
          !!ad?.resource_name && ad.status !== "PAUSED"
      );
    if (toPause.length > 0) {
      await customer.adGroupAds.update(
        toPause.map((ad) => ({
          resource_name: ad.resource_name,
          status: enums.AdGroupAdStatus.PAUSED,
        }))
      );
    }

    // Step 8: Schedule the experiment to start serving traffic.
    await customer.experiments.scheduleExperiment(
      services.ScheduleExperimentRequest.create({
        resource_name: experimentResourceName,
      })
    );

    return mcpText(
      [
        `Experiment created: ${experimentResourceName}`,
        `Draft campaign:    ${draftCampaign}`,
        `Draft ad group:    ${draftAdGroup}`,
        `New treatment ad:  ${newAdResourceName}`,
        `Paused ${toPause.length} original ad(s) in the draft group.`,
        "",
        "Google will run a 50/50 control vs. treatment split.",
        "Check status in 2–4 weeks with get_experiment_status.",
      ].join("\n")
    );
  } catch (err) {
    return mcpError("creating ad variation", err);
  }
}
