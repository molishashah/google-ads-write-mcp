import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import { buildResponsiveDisplayAdResource } from "./assets-ads";

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
});
