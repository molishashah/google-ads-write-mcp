import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildExperimentArms,
  buildExperimentLifecycleRequest,
  buildExperimentResource,
} from "./experiments";

describe("experiment lifecycle helpers", () => {
  it("builds a modern typed experiment shell", () => {
    expect(
      buildExperimentResource({
        name: "AI Max adoption",
        type: "ADOPT_AI_MAX",
      })
    ).toMatchObject({
      name: "AI Max adoption",
      type: enums.ExperimentType.ADOPT_AI_MAX,
      status: enums.ExperimentStatus.SETUP,
      suffix: " [AI Max adoption]",
    });
  });

  it("builds balanced control and treatment arms", () => {
    expect(
      buildExperimentArms({
        customer_id: "123",
        experiment_id: "456",
        arms: [
          {
            name: "Control",
            control: true,
            traffic_split: 50,
            campaign_ids: ["789"],
          },
          { name: "Treatment", control: false, traffic_split: 50 },
        ],
      })
    ).toEqual([
      {
        experiment: "customers/123/experiments/456",
        name: "Control",
        control: true,
        traffic_split: 50,
        campaigns: ["customers/123/campaigns/789"],
      },
      {
        experiment: "customers/123/experiments/456",
        name: "Treatment",
        control: false,
        traffic_split: 50,
      },
    ]);
  });

  it("rejects invalid traffic splits", () => {
    expect(() =>
      buildExperimentArms({
        customer_id: "123",
        experiment_id: "456",
        arms: [
          {
            name: "Control",
            control: true,
            traffic_split: 60,
            campaign_ids: ["789"],
          },
          { name: "Treatment", control: false, traffic_split: 30 },
        ],
      })
    ).toThrow("must total 100");
  });

  it("builds a lifecycle request from a numeric experiment ID", () => {
    expect(
      buildExperimentLifecycleRequest(
        {
          customer_id: "123",
          experiment_id: "456",
        },
        "scheduleExperiment"
      )
    ).toEqual({
      resource_name: "customers/123/experiments/456",
    });
  });

  it("preserves a raw lifecycle request", () => {
    expect(
      buildExperimentLifecycleRequest(
        {
          customer_id: "123",
          request: { resource_name: "customers/123/experiments/789" },
        },
        "promoteExperiment"
      )
    ).toEqual({ resource_name: "customers/123/experiments/789" });
  });
});
