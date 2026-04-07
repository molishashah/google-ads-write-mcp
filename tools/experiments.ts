import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enums, services } from "google-ads-api";
import { z } from "zod";
import { getAdsClient } from "@/lib/ads-client";
import { mcpText, mcpError } from "@/lib/mcp-helpers";

// ──────────────────────────────────────────────────────────────────────
// Ad Variation experiment tools
//
// Divergence from the PRD
// -----------------------
// The PRD's example code was written against a simplified API that
// doesn't match google-ads-api v23: no `experiments.mutate({operations})`,
// no `trafficSplitPercent` on Experiment, no boolean `inDesign` on
// ExperimentArm, camelCase vs snake_case, etc. What IS real in v23:
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

// ── create_ad_variation implementation ──────────────────────────────
interface CreateAdVariationParams {
  customer_id: string;
  campaign_id: string;
  ad_group_id: string;
  variation_name: string;
  final_url: string;
  headlines: string[];
  descriptions: string[];
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


