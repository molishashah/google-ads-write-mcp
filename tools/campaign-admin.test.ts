import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildListCampaignsQuery,
  buildPerformanceMaxCampaignBundleOperations,
  buildSearchCampaignBundleOperations,
  buildShoppingCampaignBundleOperations,
} from "./campaign-admin";

describe("buildListCampaignsQuery", () => {
  it("omits the removed v24 campaign date fields", () => {
    const query = buildListCampaignsQuery();

    expect(query).not.toContain("campaign.start_date,");
    expect(query).not.toContain("campaign.end_date,");
    expect(query).toContain("WHERE campaign.status != REMOVED");
    expect(query).toContain("LIMIT 1000");
  });

  it("supports removed campaigns and a custom limit", () => {
    const query = buildListCampaignsQuery({
      includeRemoved: true,
      limit: 25,
    });

    expect(query).not.toContain("WHERE campaign.status != REMOVED");
    expect(query).toContain("LIMIT 25");
  });
});

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

  it("builds one atomic Performance Max campaign bundle with asset group links", () => {
    const operations = buildPerformanceMaxCampaignBundleOperations({
      customer_id: "123",
      name: "PMax Test",
      daily_budget: 50,
      initial_status: "PAUSED",
      target_roas: 2.5,
      final_url_expansion_opt_out: true,
      asset_group: {
        name: "Core assets",
        final_urls: ["https://example.com"],
        assets: [
          { asset_id: "111", field_type: "MARKETING_IMAGE" },
          { asset_id: "customers/123/assets/222", field_type: "HEADLINE" },
        ],
      },
      geo_target_constant_ids: ["2840"],
      language_constant_ids: ["1000"],
    });

    expect(operations.map((operation) => operation.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "asset_group",
      "asset_group_asset",
      "asset_group_asset",
      "campaign_criterion",
      "campaign_criterion",
    ]);
    expect(operations[1].resource).toMatchObject({
      resource_name: "customers/123/campaigns/-2",
      advertising_channel_type: enums.AdvertisingChannelType.PERFORMANCE_MAX,
      campaign_budget: "customers/123/campaignBudgets/-1",
      maximize_conversion_value: { target_roas: 2.5 },
      url_expansion_opt_out: true,
    });
    expect(operations[2].resource).toMatchObject({
      resource_name: "customers/123/assetGroups/-3",
      campaign: "customers/123/campaigns/-2",
      final_urls: ["https://example.com"],
      status: enums.AssetGroupStatus.PAUSED,
    });
    expect(operations[3].resource).toMatchObject({
      asset_group: "customers/123/assetGroups/-3",
      asset: "customers/123/assets/111",
      field_type: enums.AssetFieldType.MARKETING_IMAGE,
    });
  });

  it("builds one atomic Shopping campaign bundle with a product ad", () => {
    const operations = buildShoppingCampaignBundleOperations({
      customer_id: "123",
      name: "Shopping Test",
      daily_budget: 80,
      merchant_id: 999,
      feed_label: "US",
      campaign_priority: 1,
      initial_status: "ENABLED",
      bidding_strategy: "MAXIMIZE_CLICKS",
      cpc_bid_ceiling: 2,
      ad_group: {
        name: "Products",
        cpc_bid: 1.5,
      },
      geo_target_constant_ids: ["2840"],
    });

    expect(operations.map((operation) => operation.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "ad_group_ad",
      "campaign_criterion",
    ]);
    expect(operations[1].resource).toMatchObject({
      resource_name: "customers/123/campaigns/-2",
      advertising_channel_type: enums.AdvertisingChannelType.SHOPPING,
      campaign_budget: "customers/123/campaignBudgets/-1",
      shopping_setting: {
        merchant_id: 999,
        feed_label: "US",
        campaign_priority: 1,
      },
      target_spend: { cpc_bid_ceiling_micros: 2_000_000 },
    });
    expect(operations[2].resource).toMatchObject({
      resource_name: "customers/123/adGroups/-3",
      campaign: "customers/123/campaigns/-2",
      type: enums.AdGroupType.SHOPPING_PRODUCT_ADS,
      cpc_bid_micros: 1_500_000,
    });
    expect(operations[3].resource).toMatchObject({
      ad_group: "customers/123/adGroups/-3",
      status: enums.AdGroupAdStatus.ENABLED,
      ad: { shopping_product_ad: {} },
    });
  });
});
