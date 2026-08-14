import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildAppAdResource,
  buildAssetGroupListingFilterResource,
  buildAssetGroupAssetLinks,
  buildAssetGroupSignalResources,
  buildDemandGenMultiAssetAdResource,
  buildDynamicSearchAdResource,
  buildResponsiveDisplayAdResource,
  buildShoppingProductAdResource,
  validatePmaxCreativeCoverage,
} from "./assets-ads";

describe("buildResponsiveDisplayAdResource", () => {
  it("builds a typed responsive display ad payload from assets and copy", () => {
    expect(
      buildResponsiveDisplayAdResource({
        customer_id: "123",
        ad_group_id: "456",
        final_urls: ["https://example.com"],
        headlines: ["Headline"],
        long_headline: "Long headline",
        descriptions: ["Description"],
        business_name: "Example",
        marketing_image_asset_ids: ["111"],
        square_marketing_image_asset_ids: ["customers/123/assets/222"],
        logo_image_asset_ids: ["333"],
        youtube_video_asset_ids: ["444"],
        call_to_action_text: "LEARN_MORE",
        format_setting: "NATIVE",
        enable_asset_enhancements: true,
        enable_autogen_video: false,
        status: "PAUSED",
      })
    ).toMatchObject({
      ad_group: "customers/123/adGroups/456",
      status: enums.AdGroupAdStatus.PAUSED,
      ad: {
        final_urls: ["https://example.com"],
        responsive_display_ad: {
          marketing_images: [{ asset: "customers/123/assets/111" }],
          square_marketing_images: [{ asset: "customers/123/assets/222" }],
          logo_images: [{ asset: "customers/123/assets/333" }],
          youtube_videos: [{ asset: "customers/123/assets/444" }],
          headlines: [{ text: "Headline" }],
          long_headline: { text: "Long headline" },
          descriptions: [{ text: "Description" }],
          business_name: "Example",
          call_to_action_text: "LEARN_MORE",
          format_setting: enums.DisplayAdFormatSetting.NATIVE,
          control_spec: {
            enable_asset_enhancements: true,
            enable_autogen_video: false,
          },
        },
      },
    });
  });

  it("builds a typed dynamic search ad payload", () => {
    expect(
      buildDynamicSearchAdResource({
        customer_id: "123",
        ad_group_id: "456",
        description: "Find the right plan for your team.",
        description2: "Compare options and get started today.",
        final_url_suffix: "src=dsa",
        status: "ENABLED",
      })
    ).toMatchObject({
      ad_group: "customers/123/adGroups/456",
      status: enums.AdGroupAdStatus.ENABLED,
      ad: {
        final_url_suffix: "src=dsa",
        expanded_dynamic_search_ad: {
          description: "Find the right plan for your team.",
          description2: "Compare options and get started today.",
        },
      },
    });
  });

  it("builds a typed shopping product ad payload", () => {
    expect(
      buildShoppingProductAdResource({
        customer_id: "123",
        ad_group_id: "456",
        status: "PAUSED",
      })
    ).toEqual({
      ad_group: "customers/123/adGroups/456",
      status: enums.AdGroupAdStatus.PAUSED,
      ad: { shopping_product_ad: {} },
    });
  });

  it("builds PMax asset group search theme and audience signals", () => {
    expect(
      buildAssetGroupSignalResources({
        customer_id: "123",
        asset_group_id: "456",
        search_themes: ["crm automation"],
        audience_ids: ["789"],
      })
    ).toEqual([
      {
        asset_group: "customers/123/assetGroups/456",
        search_theme: { text: "crm automation" },
      },
      {
        asset_group: "customers/123/assetGroups/456",
        audience: { audience: "customers/123/audiences/789" },
      },
    ]);
  });

  it("builds typed PMax asset group links", () => {
    expect(
      buildAssetGroupAssetLinks({
        customer_id: "123",
        asset_group_id: "456",
        assets: [
          { asset_id: "111", field_type: "HEADLINE" },
          { asset_id: "222", field_type: "MARKETING_IMAGE" },
        ],
      })
    ).toEqual([
      {
        asset_group: "customers/123/assetGroups/456",
        asset: "customers/123/assets/111",
        field_type: enums.AssetFieldType.HEADLINE,
      },
      {
        asset_group: "customers/123/assetGroups/456",
        asset: "customers/123/assets/222",
        field_type: enums.AssetFieldType.MARKETING_IMAGE,
      },
    ]);
  });

  it("reports missing PMax creative coverage", () => {
    expect(
      validatePmaxCreativeCoverage({
        assets: [{ field_type: "HEADLINE" }],
      })
    ).toMatchObject({
      valid: false,
      campaign_mode: "STANDARD",
      missing: expect.arrayContaining([
        { field_type: "HEADLINE", minimum: 3, actual: 1 },
        { field_type: "LOGO", minimum: 1, actual: 0 },
      ]),
    });
  });

  it("allows feed-only retail asset groups", () => {
    expect(
      validatePmaxCreativeCoverage({ campaign_mode: "RETAIL", assets: [] })
    ).toMatchObject({ valid: true, missing: [] });
  });

  it("builds PMax listing group filters with product dimensions", () => {
    expect(
      buildAssetGroupListingFilterResource({
        customer_id: "123",
        asset_group_id: "456",
        type: "UNIT_INCLUDED",
        parent_listing_group_filter_id: "10",
        dimension: {
          type: "PRODUCT_BRAND",
          value: "Example",
        },
      })
    ).toMatchObject({
      asset_group: "customers/123/assetGroups/456",
      type: enums.ListingGroupFilterType.UNIT_INCLUDED,
      listing_source: enums.ListingGroupFilterListingSource.SHOPPING,
      parent_listing_group_filter:
        "customers/123/assetGroupListingGroupFilters/456~10",
      case_value: {
        product_brand: { value: "Example" },
      },
    });
  });

  it("builds a typed Demand Gen multi-asset ad payload", () => {
    expect(
      buildDemandGenMultiAssetAdResource({
        customer_id: "123",
        ad_group_id: "456",
        final_urls: ["https://example.com"],
        headlines: ["Headline"],
        descriptions: ["Description"],
        business_name: "Example",
        marketing_image_asset_ids: ["111"],
        square_marketing_image_asset_ids: ["222"],
        call_to_action_text: "LEARN_MORE",
      })
    ).toMatchObject({
      ad_group: "customers/123/adGroups/456",
      status: enums.AdGroupAdStatus.ENABLED,
      ad: {
        final_urls: ["https://example.com"],
        demand_gen_multi_asset_ad: {
          marketing_images: [{ asset: "customers/123/assets/111" }],
          square_marketing_images: [{ asset: "customers/123/assets/222" }],
          headlines: [{ text: "Headline" }],
          descriptions: [{ text: "Description" }],
          business_name: "Example",
          call_to_action_text: "LEARN_MORE",
        },
      },
    });
  });

  it("builds a typed app ad payload", () => {
    expect(
      buildAppAdResource({
        customer_id: "123",
        ad_group_id: "456",
        mandatory_ad_text: ["Install now"],
        headlines: ["Track leads"],
        descriptions: ["Close more revenue"],
        image_asset_ids: ["111"],
        youtube_video_asset_ids: ["222"],
        html5_media_bundle_asset_ids: ["333"],
        app_deep_link_asset_id: "444",
      })
    ).toMatchObject({
      ad_group: "customers/123/adGroups/456",
      ad: {
        app_ad: {
          mandatory_ad_text: [{ text: "Install now" }],
          headlines: [{ text: "Track leads" }],
          descriptions: [{ text: "Close more revenue" }],
          images: [{ asset: "customers/123/assets/111" }],
          youtube_videos: [{ asset: "customers/123/assets/222" }],
          html5_media_bundles: [{ asset: "customers/123/assets/333" }],
          app_deep_link: { asset: "customers/123/assets/444" },
        },
      },
    });
  });
});
