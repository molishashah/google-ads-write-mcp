import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import { buildSearchCampaignBundleOperations } from "./campaign-admin";

describe("buildSearchCampaignBundleOperations", () => {
  it("builds one atomic Search campaign bundle with temp resource names", () => {
    const operations = buildSearchCampaignBundleOperations({
      customer_id: "123",
      name: "Test Search",
      daily_budget: 25,
      initial_status: "ENABLED",
      cpc_bid_ceiling: 3,
      include_search_partners: false,
      include_display_network: true,
      ad_groups: [
        {
          name: "Core",
          final_url: "https://example.com",
          headlines: ["One", "Two", "Three"],
          descriptions: ["First description", "Second description"],
          path1: "core",
          keywords: [{ text: "google ads mcp", match_type: "PHRASE" }],
        },
      ],
      negative_keywords: [{ text: "free", match_type: "BROAD" }],
      geo_target_constant_ids: ["2840"],
      language_constant_ids: ["1000"],
    });

    expect(operations.map((operation) => operation.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "ad_group_ad",
      "ad_group_criterion",
      "campaign_criterion",
      "campaign_criterion",
      "campaign_criterion",
    ]);

    expect(operations[0].resource).toMatchObject({
      resource_name: "customers/123/campaignBudgets/-1",
      name: "Test Search budget",
      amount_micros: 25_000_000,
    });
    expect(operations[1].resource).toMatchObject({
      resource_name: "customers/123/campaigns/-2",
      campaign_budget: "customers/123/campaignBudgets/-1",
      status: enums.CampaignStatus.ENABLED,
    });
    expect(operations[2].resource).toMatchObject({
      resource_name: "customers/123/adGroups/-10",
      campaign: "customers/123/campaigns/-2",
    });
    expect(operations[3].resource).toMatchObject({
      ad_group: "customers/123/adGroups/-10",
      ad: {
        final_urls: ["https://example.com"],
        responsive_search_ad: {
          path1: "core",
        },
      },
    });
  });
});
