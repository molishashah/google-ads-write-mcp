import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildCampaignConversionGoalResourceName,
  buildConversionActionResource,
  buildConversionCustomVariableResource,
  buildConversionValueRuleResource,
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
    ).toBe("customers/123/customerConversionGoals/PURCHASE~WEBSITE");

    expect(
      buildCustomerConversionGoalResourceName(
        "123",
        "QUALIFIED_LEAD",
        "WEBSITE"
      )
    ).toBe("customers/123/customerConversionGoals/QUALIFIED_LEAD~WEBSITE");

    expect(
      buildCampaignConversionGoalResourceName(
        "123",
        "customers/123/campaigns/456",
        "IMPORTED_LEAD",
        "WEBSITE"
      )
    ).toBe(
      "customers/123/campaignConversionGoals/456~IMPORTED_LEAD~WEBSITE"
    );
  });

  it("builds a typed conversion custom variable resource", () => {
    expect(
      buildConversionCustomVariableResource({
        name: "Lead score",
        tag: "lead_score",
        status: "ENABLED",
      })
    ).toEqual({
      name: "Lead score",
      tag: "lead_score",
      status: enums.ConversionCustomVariableStatus.ENABLED,
    });
  });

  it("builds a typed conversion value rule with common conditions", () => {
    expect(
      buildConversionValueRuleResource({
        customer_id: "123",
        operation: "MULTIPLY",
        value: 1.2,
        geo_target_constant_ids: ["2840"],
        geo_match_type: "LOCATION_OF_PRESENCE",
        device_types: ["MOBILE"],
        user_list_ids: ["555"],
        user_interest_ids: ["999"],
      })
    ).toMatchObject({
      action: {
        operation: enums.ValueRuleOperation.MULTIPLY,
        value: 1.2,
      },
      status: enums.ConversionValueRuleStatus.ENABLED,
      geo_location_condition: {
        geo_target_constants: ["geoTargetConstants/2840"],
        geo_match_type: enums.ValueRuleGeoLocationMatchType.LOCATION_OF_PRESENCE,
      },
      device_condition: {
        device_types: [enums.ValueRuleDeviceType.MOBILE],
      },
      audience_condition: {
        user_lists: ["customers/123/userLists/555"],
        user_interests: ["userInterests/999"],
      },
    });
  });
});
