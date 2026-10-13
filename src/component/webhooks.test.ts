import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import { computeHmacSha256Hex } from "../shared/crypto.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

describe("webhooks", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const subscription = {
    entity: "subscription",
    id: "sub_ordered",
    plan_id: "plan_ordered",
    status: "paused",
    quantity: 2,
    total_count: 12,
    paid_count: 1,
    remaining_count: 11,
  };

  const payment = {
    entity: "payment",
    id: "pay_mode",
    amount: 500,
    currency: "INR",
    status: "authorized",
  };

  beforeEach(() =>
    stubRazorpayEnv({
      keyId: "rzp_test_fixture",
      keySecret: "fixture_secret",
      webhookSecret: "fixture_webhook",
    }),
  );

  afterEach(restoreRazorpayTestState);

  test("signed webhooks reject test mode with a recognizable live key", async () => {
    vi.stubEnv("RAZORPAY_TEST_MODE", "true");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_fixture");
    const t = harness();
    const body = JSON.stringify({
      entity: "event",
      event: "payment.authorized",
      created_at: 1,
      payload: { payment: { entity: payment } },
    });
    await expect(
      t.action(api.webhooks.ingest, {
        body,
        signature: await computeHmacSha256Hex("fixture_webhook", body),
        eventId: "evt_live_mode",
      }),
    ).rejects.toMatchObject({ data: { code: "RAZORPAY_LIVE_KEY_TEST_MODE" } });
  });

  test.each(["not_an_invoice", "inv_other"])(
    "subscription webhook rejects invoice reference %s",
    async (id) => {
      const t = harness();
      const body = JSON.stringify({
        entity: "event",
        event: "subscription.charged",
        created_at: 1,
        payload: {
          subscription: { entity: subscription },
          payment: { entity: { ...payment, invoice_id: "inv_real" } },
          invoice: { entity: { id } },
        },
      });
      expect(
        await t.action(api.webhooks.ingest, {
          body,
          signature: await computeHmacSha256Hex("fixture_webhook", body),
          eventId: "evt_invoice",
        }),
      ).toMatchObject({ status: "failed", errorCode: "RAZORPAY_INVALID_ENTITY" });
    },
  );
});
