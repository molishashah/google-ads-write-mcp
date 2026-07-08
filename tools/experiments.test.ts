import { describe, expect, it } from "vitest";
import { buildExperimentLifecycleRequest } from "./experiments";

describe("experiment lifecycle helpers", () => {
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
