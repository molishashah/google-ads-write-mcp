import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { services } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

// ──────────────────────────────────────────────────────────────────────
// Ad Variation experiment tools
//
// Divergence from the v2 PRD
// --------------------------
// The PRD's `create_ad_variation` was written against a simplified API
// that doesn't match google-ads-api v23:
//   * `IExperiment` has no `campaigns` or `traffic_split_percent` field.
//   * `IExperimentArm.in_design` doesn't exist — the real field is
//     `in_design_campaigns: string[]` and it wants a *draft* campaign,
//     not a boolean.
//   * Creating a full Ad Variation programmatically requires: (a) copying
//     the base campaign into a draft, (b) adding the modified ad to the
//     draft, (c) creating the Experiment, (d) creating control + treatment
//     arms wired to the draft, (e) scheduling the experiment. That's a
//     multi-day build with high error surface.
//
// For v2 we stub `create_ad_variation` with a clear error pointing users
// at the Google Ads UI (which already ergonomically handles all of the
// above in ~2 minutes). `get_experiment_status` and `graduate_experiment`
// still work against experiments created in the UI.
// ──────────────────────────────────────────────────────────────────────

export function registerExperimentTools(server: McpServer) {
  registerCreateAdVariation(server);
  registerGetExperimentStatus(server);
  registerGraduateExperiment(server);
}

// ── create_ad_variation (STUBBED — see module header) ────────────────
function registerCreateAdVariation(server: McpServer) {
  server.registerTool(
    "create_ad_variation",
    {
      title: "Create Ad Variation Experiment (not implemented)",
      description:
        "NOT IMPLEMENTED in v2. Creating an Ad Variation via the API " +
        "requires copying the base campaign into a draft, modifying the " +
        "ad inside the draft, then wiring control + treatment arms — a " +
        "multi-step flow we haven't built yet. For now, create the " +
        "variation in the Google Ads UI (Campaigns → Experiments → New → " +
        "Ad variation), then monitor it with get_experiment_status and " +
        "promote the winner with graduate_experiment.",
      inputSchema: {
        customer_id: z.string(),
        campaign_id: z.string(),
        variation_name: z.string(),
      },
    },
    async () => {
      return mcpError(
        "creating ad variation",
        new Error(
          "create_ad_variation is not implemented in this MCP. Use the " +
            "Google Ads UI to create the variation, then use " +
            "get_experiment_status / graduate_experiment to manage it."
        )
      );
    }
  );
}

// ── get_experiment_status ─────────────────────────────────────────────
function registerGetExperimentStatus(server: McpServer) {
  server.registerTool(
    "get_experiment_status",
    {
      title: "Get Ad Variation Experiment Status",
      description:
        "Check the status and verdict of an Ad Variation experiment " +
        "created in the Google Ads UI (or elsewhere). Returns ENABLED " +
        "(still running), GRADUATED (Google has a verdict), HALTED, or " +
        "other lifecycle states.",
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
        // Parameterised GAQL to avoid string-injection into the query.
        const rows = await customer.query<
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

        if (!rows.length) {
          return mcpError(
            "fetching experiment",
            new Error(`Experiment not found: ${params.experiment_id}`)
          );
        }

        const exp = rows[0].experiment;
        const lines = [
          `Experiment: ${exp.name}`,
          `Status: ${exp.status}`,
          `Started: ${exp.start_date ?? "unknown"}`,
          `Ended: ${exp.end_date ?? "still running"}`,
        ];
        if (exp.status === "GRADUATED") {
          lines.push(
            "",
            "Google has reached a verdict. Call graduate_experiment to " +
              "promote the winner, or do nothing to keep the control."
          );
        } else if (exp.status === "ENABLED") {
          lines.push(
            "",
            "Still running — check back later. Typical maturity: 2–4 weeks."
          );
        }
        return mcpText(lines.join("\n"));
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
      },
    },
    async (params) => {
      try {
        const customer = getAdsClient(params.customer_id);
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
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
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

