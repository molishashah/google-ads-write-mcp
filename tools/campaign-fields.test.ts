import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildCampaignDateTimeFields,
  buildFinalUrlExpansionAutomation,
} from "./campaign-fields";

describe("buildCampaignDateTimeFields", () => {
  it("maps date-only inputs to v24 campaign date-time fields", () => {
    expect(
      buildCampaignDateTimeFields({
        start_date: "2026-08-15",
        end_date: "2026-09-30",
      })
    ).toEqual({
      start_date_time: "2026-08-15 00:00:00",
      end_date_time: "2026-09-30 23:59:59",
    });
  });
});

describe("buildFinalUrlExpansionAutomation", () => {
  it.each([
    [true, enums.AssetAutomationStatus.OPTED_OUT],
    [false, enums.AssetAutomationStatus.OPTED_IN],
  ])("maps opt-out=%s to asset automation status", (optOut, status) => {
    expect(buildFinalUrlExpansionAutomation(optOut)).toEqual({
      asset_automation_settings: [
        {
          asset_automation_type:
            enums.AssetAutomationType
              .FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION,
          asset_automation_status: status,
        },
      ],
    });
  });
});
