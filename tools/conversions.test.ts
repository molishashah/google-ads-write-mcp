import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildCampaignConversionGoalResourceName,
  buildConversionActionResource,
  buildCustomerConversionGoalResourceName,
} from "./conversions";

describe("conversion setup helpers", () => {
  it("builds a typed offline conversion action resource", () => {
    expect(
      buildConversionActionResource({
        name: "Qualified lead",
        type: "UPLOAD_CLICKS",
        category: "QUALIFIED_LEAD",
        default_value: 250,
        currency_code: "USD",
        click_through_lookback_window_days: 30,
      })
    ).toMatchObject({
      name: "Qualified lead",
      type: enums.ConversionActionType.UPLOAD_CLICKS,
      category: enums.ConversionActionCategory.QUALIFIED_LEAD,
      status: enums.ConversionActionStatus.ENABLED,
      include_in_conversions_metric: true,
      counting_type: enums.ConversionActionCountingType.ONE_PER_CLICK,
      primary_for_goal: true,
      value_settings: {
        default_value: 250,
        default_currency_code: "USD",
        always_use_default_value: false,
      },
      click_through_lookback_window_days: 30,
    });
  });

  it("builds customer and campaign conversion goal resource names", () => {
    expect(
      buildCustomerConversionGoalResourceName("123", "PURCHASE", "WEBSITE")
    ).toBe("customers/123/customerConversionGoals/4~2");

    expect(
      buildCampaignConversionGoalResourceName(
        "123",
        "customers/123/campaigns/456",
        "IMPORTED_LEAD",
        "WEBSITE"
      )
    ).toBe("customers/123/campaignConversionGoals/456~12~2");
  });
});
