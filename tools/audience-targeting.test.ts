import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildAdGroupAudienceCriteria,
  buildTargetingSetting,
} from "./audience-targeting";

describe("buildTargetingSetting", () => {
  it("maps Observation and Targeting without reversing bid_only", () => {
    expect(
      buildTargetingSetting([
        { dimension: "AUDIENCE", mode: "OBSERVATION" },
        { dimension: "PLACEMENT", mode: "TARGETING" },
      ])
    ).toEqual({
      target_restrictions: [
        {
          targeting_dimension: enums.TargetingDimension.AUDIENCE,
          bid_only: true,
        },
        {
          targeting_dimension: enums.TargetingDimension.PLACEMENT,
          bid_only: false,
        },
      ],
    });
  });

  it("rejects duplicate dimensions", () => {
    expect(() =>
      buildTargetingSetting([
        { dimension: "AUDIENCE", mode: "OBSERVATION" },
        { dimension: "AUDIENCE", mode: "TARGETING" },
      ])
    ).toThrow("provided more than once");
  });
});

describe("buildAdGroupAudienceCriteria", () => {
  it("builds reusable audience and user-list criteria", () => {
    expect(
      buildAdGroupAudienceCriteria({
        customer_id: "123",
        ad_group_id: "456",
        audience_ids: ["789"],
        user_list_ids: ["101"],
        bid_modifier: 1.2,
      })
    ).toEqual([
      expect.objectContaining({
        ad_group: "customers/123/adGroups/456",
        bid_modifier: 1.2,
        audience: { audience: "customers/123/audiences/789" },
      }),
      expect.objectContaining({
        ad_group: "customers/123/adGroups/456",
        user_list: { user_list: "customers/123/userLists/101" },
      }),
    ]);
  });

  it("requires at least one segment", () => {
    expect(() =>
      buildAdGroupAudienceCriteria({
        customer_id: "123",
        ad_group_id: "456",
      })
    ).toThrow("Provide at least one");
  });
});
