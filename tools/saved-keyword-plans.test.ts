import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildCreateSavedKeywordPlanOperations,
  buildListSavedKeywordPlansQuery,
  buildSavedKeywordPlanQueries,
  buildSavedPlanAdGroupKeywordsQuery,
  buildSavedPlanAdGroupOperations,
  buildSavedPlanKeywordOperations,
} from "./saved-keyword-plans";

describe("saved Keyword Planner composite creation", () => {
  it("builds an atomic parent-first resource graph with unique temporary IDs", () => {
    const operations = buildCreateSavedKeywordPlanOperations({
      customer_id: "123",
      name: "Q4 search plan",
      forecast_period: { date_interval: "NEXT_QUARTER" },
      campaign: {
        name: "Q4 plan campaign",
        cpc_bid_micros: 2_000_000,
        keyword_plan_network: "GOOGLE_SEARCH_AND_PARTNERS",
        language_constant_id: "1000",
        geo_target_constant_ids: ["2840"],
      },
      ad_groups: [
        {
          name: "CRM",
          cpc_bid_micros: 1_500_000,
          keywords: [
            {
              text: "crm software",
              match_type: "PHRASE",
              cpc_bid_micros: 1_250_000,
            },
            {
              text: "free crm",
              match_type: "EXACT",
              cpc_bid_micros: 9_000_000,
              negative: true,
            },
          ],
        },
      ],
      negative_keywords: [{ text: "jobs", match_type: "BROAD" }],
    });

    expect(operations.map((operation) => operation.entity)).toEqual([
      "keyword_plan",
      "keyword_plan_campaign",
      "keyword_plan_ad_group",
      "keyword_plan_ad_group_keyword",
      "keyword_plan_ad_group_keyword",
      "keyword_plan_campaign_keyword",
    ]);

    const resources = operations.map((operation) => operation.resource);
    expect(resources[0]).toMatchObject({
      resource_name: "customers/123/keywordPlans/-1",
      name: "Q4 search plan",
      forecast_period: {
        date_interval: enums.KeywordPlanForecastInterval.NEXT_QUARTER,
      },
    });
    expect(resources[1]).toMatchObject({
      resource_name: "customers/123/keywordPlanCampaigns/-2",
      keyword_plan: "customers/123/keywordPlans/-1",
      keyword_plan_network:
        enums.KeywordPlanNetwork.GOOGLE_SEARCH_AND_PARTNERS,
      language_constants: ["languageConstants/1000"],
      geo_targets: [{ geo_target_constant: "geoTargetConstants/2840" }],
    });
    expect(resources[2]).toMatchObject({
      resource_name: "customers/123/keywordPlanAdGroups/-3",
      keyword_plan_campaign: "customers/123/keywordPlanCampaigns/-2",
    });
    expect(resources[3]).toMatchObject({
      resource_name: "customers/123/keywordPlanAdGroupKeywords/-4",
      keyword_plan_ad_group: "customers/123/keywordPlanAdGroups/-3",
      match_type: enums.KeywordMatchType.PHRASE,
      negative: false,
      cpc_bid_micros: 1_250_000,
    });
    expect(resources[4]).not.toHaveProperty("cpc_bid_micros");
    expect(resources[5]).toMatchObject({
      resource_name: "customers/123/keywordPlanCampaignKeywords/-6",
      keyword_plan_campaign: "customers/123/keywordPlanCampaigns/-2",
      negative: true,
    });

    const temporaryNames = resources
      .map((resource) =>
        resource && typeof resource === "object"
          ? (resource as { resource_name?: unknown }).resource_name
          : undefined
      )
      .filter((name): name is string => typeof name === "string");
    expect(new Set(temporaryNames).size).toBe(temporaryNames.length);
  });

  it("supports creating an empty plan", () => {
    expect(
      buildCreateSavedKeywordPlanOperations({
        customer_id: "123",
        name: "Empty plan",
      })
    ).toEqual([
      {
        entity: "keyword_plan",
        operation: "create",
        resource: {
          resource_name: "customers/123/keywordPlans/-1",
          name: "Empty plan",
        },
      },
    ]);
  });

  it("rejects child resources without the single plan campaign", () => {
    expect(() =>
      buildCreateSavedKeywordPlanOperations({
        customer_id: "123",
        name: "Broken plan",
        ad_groups: [{ name: "Group" }],
      })
    ).toThrow("campaign is required");
  });

  it("rejects reversed custom forecast dates", () => {
    expect(() =>
      buildCreateSavedKeywordPlanOperations({
        customer_id: "123",
        name: "Broken dates",
        forecast_period: {
          date_range: { start_date: "2099-02-02", end_date: "2099-02-01" },
        },
      })
    ).toThrow("start_date must be on or before end_date");
  });
});

describe("saved Keyword Planner incremental mutations", () => {
  it("builds mixed ad-group operations", () => {
    expect(
      buildSavedPlanAdGroupOperations({
        customer_id: "123",
        keyword_plan_campaign: "456",
        create: [{ name: "New group", cpc_bid_micros: 900_000 }],
        update: [{ resource_name: "789", name: "Renamed group" }],
        remove: ["999"],
      })
    ).toEqual([
      {
        entity: "keyword_plan_ad_group",
        operation: "create",
        resource: {
          keyword_plan_campaign: "customers/123/keywordPlanCampaigns/456",
          name: "New group",
          cpc_bid_micros: 900_000,
        },
      },
      {
        entity: "keyword_plan_ad_group",
        operation: "update",
        resource: {
          resource_name: "customers/123/keywordPlanAdGroups/789",
          name: "Renamed group",
        },
      },
      {
        entity: "keyword_plan_ad_group",
        operation: "remove",
        resource: "customers/123/keywordPlanAdGroups/999",
      },
    ]);
  });

  it("builds ad-group and campaign-negative keyword operations", () => {
    const operations = buildSavedPlanKeywordOperations({
      customer_id: "123",
      ad_group_create: [
        {
          keyword_plan_ad_group: "10",
          text: "sales crm",
          match_type: "BROAD",
        },
      ],
      campaign_negative_create: [
        {
          keyword_plan_campaign: "20",
          text: "careers",
          match_type: "PHRASE",
        },
      ],
      campaign_negative_remove: ["30"],
    });

    expect(operations).toHaveLength(3);
    expect(operations[0].resource).toMatchObject({
      keyword_plan_ad_group: "customers/123/keywordPlanAdGroups/10",
      match_type: enums.KeywordMatchType.BROAD,
      negative: false,
    });
    expect(operations[1].resource).toMatchObject({
      keyword_plan_campaign: "customers/123/keywordPlanCampaigns/20",
      match_type: enums.KeywordMatchType.PHRASE,
      negative: true,
    });
    expect(operations[2]).toMatchObject({
      entity: "keyword_plan_campaign_keyword",
      operation: "remove",
      resource: "customers/123/keywordPlanCampaignKeywords/30",
    });
  });

  it("requires at least one mutation", () => {
    expect(() =>
      buildSavedPlanKeywordOperations({ customer_id: "123" })
    ).toThrow("at least one create, update, or remove");
  });
});

describe("saved Keyword Planner queries", () => {
  it("escapes plan name filters", () => {
    const query = buildListSavedKeywordPlansQuery({
      name_contains: "Bob's plan",
      limit: 25,
    });
    expect(query).toContain("keyword_plan.name LIKE '%Bob\\'s plan%'");
    expect(query).toContain("LIMIT 25");
  });

  it("filters full-plan reads by normalized resource name", () => {
    const resourceName = "customers/123/keywordPlans/456";
    const queries = buildSavedKeywordPlanQueries(resourceName);
    expect(queries.plan).toContain(
      "keyword_plan.resource_name = 'customers/123/keywordPlans/456'"
    );
    expect(queries.campaign).toContain(
      "keyword_plan_campaign.keyword_plan = 'customers/123/keywordPlans/456'"
    );
  });

  it("builds an IN query for ad-group keywords", () => {
    expect(
      buildSavedPlanAdGroupKeywordsQuery([
        "customers/123/keywordPlanAdGroups/1",
        "customers/123/keywordPlanAdGroups/2",
      ])
    ).toContain(
      "IN ('customers/123/keywordPlanAdGroups/1', 'customers/123/keywordPlanAdGroups/2')"
    );
  });
});
