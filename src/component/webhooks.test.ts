import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import { computeHmacSha256Hex } from "../shared/crypto.js";
import { restoreRazorpayTestState, stubRazorpayEnv, expectRazorpayError } from "../test-helpers.js";

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

  test("a signed event older than the retention window minus one day is a failed receipt that a retry deduplicates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_567_674_600_000 + 29 * 86_400_000);
    const t = harness();
    const ingestSigned = async (createdAtSeconds: number, eventId: string) => {
      const body = JSON.stringify({
        entity: "event",
        event: "payment.authorized",
        created_at: createdAtSeconds,
        payload: { payment: { entity: payment } },
      });
      return t.action(api.webhooks.ingest, {
        body,
        signature: await computeHmacSha256Hex("fixture_webhook", body),
        eventId,
      });
    };
    expect(await ingestSigned(1_567_674_599, "evt_stale")).toEqual({
      status: "failed",
      errorCode: "RAZORPAY_STALE_WEBHOOK",
    });
    expect(await ingestSigned(1_567_674_599, "evt_stale")).toEqual({ status: "duplicate" });
    expect(await t.run((ctx) => ctx.db.query("payments").take(1))).toEqual([]);
    expect(await ingestSigned(1_567_674_600, "evt_retention_boundary")).toMatchObject({
      status: "processed",
    });
  });

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
    await expectRazorpayError(
      t.action(api.webhooks.ingest, {
        body,
        signature: await computeHmacSha256Hex("fixture_webhook", body),
        eventId: "evt_live_mode",
      }),
      "RAZORPAY_LIVE_KEY_TEST_MODE",
    );
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
