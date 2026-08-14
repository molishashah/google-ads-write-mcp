import { describe, expect, it } from "vitest";
import { enums } from "google-ads-api";
import {
  buildBatchJobOperationsRequest,
  buildRecommendationSubscription,
} from "./automation";

describe("automation helpers", () => {
  it("builds recommendation subscriptions", () => {
    expect(
      buildRecommendationSubscription({
        recommendation_type: "TARGET_ROAS_OPT_IN",
        status: "ENABLED",
      })
    ).toEqual({
      type: enums.RecommendationType.TARGET_ROAS_OPT_IN,
      status: enums.RecommendationSubscriptionStatus.ENABLED,
    });
  });

  it("builds sequenced batch-job operation requests", () => {
    expect(
      buildBatchJobOperationsRequest({
        customer_id: "123",
        batch_job_id: "456",
        mutate_operations: [{ campaign_operation: { remove: "campaign" } }],
        sequence_token: "next-token",
      })
    ).toEqual({
      resource_name: "customers/123/batchJobs/456",
      mutate_operations: [{ campaign_operation: { remove: "campaign" } }],
      sequence_token: "next-token",
    });
  });
});
