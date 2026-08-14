import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildListCampaignsQuery,
  buildBiddingStrategy,
  buildAppCampaignBundleOperations,
  buildDemandGenCampaignBundleOperations,
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

  it("maps Target Impression Share fields for Search bundles", () => {
    const operations = buildSearchCampaignBundleOperations({
      customer_id: "123",
      name: "Brand Search",
      daily_budget: 25,
      bidding_strategy: "TARGET_IMPRESSION_SHARE",
      target_impression_share_location: "ABSOLUTE_TOP_OF_PAGE",
      target_impression_share_percentage: 92.5,
      cpc_bid_ceiling: 3.75,
      ad_groups: [
        {
          name: "Brand",
          final_url: "https://example.com",
          headlines: ["One", "Two", "Three"],
          descriptions: ["First description", "Second description"],
        },
      ],
    });

    expect(operations[1].resource).toMatchObject({
      target_impression_share: {
        location: enums.TargetImpressionShareLocation.ABSOLUTE_TOP_OF_PAGE,
        location_fraction_micros: 925_000,
        cpc_bid_ceiling_micros: 3_750_000,
      },
    });
    expect(operations[1].resource).not.toHaveProperty("target_spend");
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
      asset_automation_settings: [
        {
          asset_automation_type:
            enums.AssetAutomationType
              .FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION,
          asset_automation_status: enums.AssetAutomationStatus.OPTED_OUT,
        },
      ],
    });
    expect(operations[1].resource).not.toHaveProperty("url_expansion_opt_out");
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

  it("builds an atomic Demand Gen campaign and ad-group targeting", () => {
    const operations = buildDemandGenCampaignBundleOperations({
      customer_id: "123",
      name: "Demand Gen",
      daily_budget: 40,
      bidding_strategy: "TARGET_CPA",
      target_cpa: 12,
      ad_group_name: "Prospects",
      geo_target_constant_ids: ["2840"],
      language_constant_ids: ["1000"],
    });

    expect(operations.map((operation) => operation.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "ad_group_criterion",
      "ad_group_criterion",
    ]);
    expect(operations[1].resource).toMatchObject({
      advertising_channel_type: enums.AdvertisingChannelType.DEMAND_GEN,
      target_cpa: { target_cpa_micros: 12_000_000 },
    });
    expect(operations[3].resource).toMatchObject({
      ad_group: "customers/123/adGroups/-3",
      location: { geo_target_constant: "geoTargetConstants/2840" },
    });
  });

  it("builds an atomic App campaign with required settings", () => {
    const operations = buildAppCampaignBundleOperations({
      customer_id: "123",
      name: "App installs",
      daily_budget: 60,
      app_id: "com.example.app",
      app_store: "GOOGLE_APP_STORE",
      bidding_goal: "OPTIMIZE_INSTALLS_TARGET_INSTALL_COST",
      target_cpa: 8,
      ad_group_name: "Installers",
      geo_target_constant_ids: ["2840"],
    });

    expect(operations.map((operation) => operation.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "campaign_criterion",
    ]);
    expect(operations[1].resource).toMatchObject({
      advertising_channel_type: enums.AdvertisingChannelType.MULTI_CHANNEL,
      advertising_channel_sub_type:
        enums.AdvertisingChannelSubType.APP_CAMPAIGN,
      app_campaign_setting: {
        app_id: "com.example.app",
        app_store: enums.AppCampaignAppStore.GOOGLE_APP_STORE,
        bidding_strategy_goal_type:
          enums.AppCampaignBiddingStrategyGoalType
            .OPTIMIZE_INSTALLS_TARGET_INSTALL_COST,
      },
      target_cpa: { target_cpa_micros: 8_000_000 },
    });
  });

  it("adds selective optimization for App engagement", () => {
    const operations = buildAppCampaignBundleOperations({
      customer_id: "123",
      name: "App engagement",
      daily_budget: 60,
      app_id: "com.example.app",
      app_store: "GOOGLE_APP_STORE",
      app_campaign_subtype: "APP_CAMPAIGN_FOR_ENGAGEMENT",
      bidding_goal: "OPTIMIZE_IN_APP_CONVERSIONS_TARGET_CONVERSION_COST",
      target_cpa: 10,
      conversion_action_ids: ["999"],
      ad_group_name: "Returners",
    });

    expect(operations[1].resource).toMatchObject({
      selective_optimization: {
        conversion_actions: ["customers/123/conversionActions/999"],
      },
      target_cpa: { target_cpa_micros: 10_000_000 },
    });
  });
});

describe("buildBiddingStrategy", () => {
  it("builds an absolute-top Target Impression Share update", () => {
    expect(
      buildBiddingStrategy({
        strategy: "TARGET_IMPRESSION_SHARE",
        target_impression_share_location: "ABSOLUTE_TOP_OF_PAGE",
        target_impression_share_percentage: 80,
        cpc_bid_ceiling: 5,
      })
    ).toEqual({
      target_impression_share: {
        location: enums.TargetImpressionShareLocation.ABSOLUTE_TOP_OF_PAGE,
        location_fraction_micros: 800_000,
        cpc_bid_ceiling_micros: 5_000_000,
      },
    });
  });

  it.each([
    [
      {
        strategy: "TARGET_IMPRESSION_SHARE",
        target_impression_share_percentage: 80,
        cpc_bid_ceiling: 5,
      },
      "target_impression_share_location is required",
    ],
    [
      {
        strategy: "TARGET_IMPRESSION_SHARE",
        target_impression_share_location: "TOP_OF_PAGE" as const,
        cpc_bid_ceiling: 5,
      },
      "target_impression_share_percentage is required",
    ],
    [
      {
        strategy: "TARGET_IMPRESSION_SHARE",
        target_impression_share_location: "TOP_OF_PAGE" as const,
        target_impression_share_percentage: 80,
      },
      "cpc_bid_ceiling is required",
    ],
    [
      {
        strategy: "MAXIMIZE_CONVERSIONS",
        target_impression_share_location: "TOP_OF_PAGE" as const,
      },
      "target_impression_share_location is only valid",
    ],
  ])("rejects incomplete or inconsistent parameters", (params, message) => {
    expect(() => buildBiddingStrategy(params)).toThrow(message);
  });
});
