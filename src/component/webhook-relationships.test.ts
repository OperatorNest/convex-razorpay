import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { hmacSha256Hex } from "../shared/crypto.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const newHarness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof newHarness>;
const secret = "whsec_relationships";

const order = {
  entity: "order",
  id: "order_rel",
  amount: 5000,
  amount_paid: 5000,
  amount_due: 0,
  currency: "INR",
  status: "paid",
  attempts: 1,
  created_at: 1_567_674_599,
};
const payment = {
  entity: "payment",
  id: "pay_rel",
  amount: 5000,
  currency: "INR",
  status: "captured",
  captured: true,
  created_at: 1_567_674_599,
};
const refund = {
  entity: "refund",
  id: "rfnd_rel",
  payment_id: "pay_rel",
  amount: 100,
  currency: "INR",
  status: "processed",
  created_at: 1_567_674_599,
};
const subscription = {
  entity: "subscription",
  id: "sub_rel",
  plan_id: "plan_rel",
  status: "active",
  quantity: 1,
  total_count: 12,
  paid_count: 1,
  remaining_count: 11,
  created_at: 1_567_674_599,
};

beforeEach(() => {
  stubRazorpayEnv({ webhookSecret: secret });
});

afterEach(() => {
  restoreRazorpayTestState();
});

let sequence = 0;
async function ingest(t: Harness, event: string, payload: unknown) {
  const body = JSON.stringify({ entity: "event", event, created_at: 1_567_674_600, payload });
  return t.action(api.webhooks.ingest, {
    body,
    signature: await hmacSha256Hex(secret, body),
    eventId: `evt_rel_${sequence++}`,
  });
}

const invalidEntity = { status: "failed", errorCode: "RAZORPAY_INVALID_ENTITY" };
const counts = (t: Harness) =>
  t.run(async (ctx) => ({
    orders: (await ctx.db.query("orders").collect()).length,
    payments: (await ctx.db.query("payments").collect()).length,
    refunds: (await ctx.db.query("refunds").collect()).length,
    subscriptions: (await ctx.db.query("subscriptions").collect()).length,
  }));

test("mismatched webhook entity relationships fail without mirroring anything", async () => {
  const t = convexTest(schema, modules);
  expect(
    await ingest(t, "order.paid", {
      order: { entity: order },
      payment: { entity: { ...payment, order_id: "order_other" } },
    }),
  ).toMatchObject(invalidEntity);
  expect(
    await ingest(t, "refund.processed", {
      refund: { entity: refund },
      payment: { entity: { ...payment, id: "pay_other" } },
    }),
  ).toMatchObject(invalidEntity);
  expect(
    await ingest(t, "subscription.charged", {
      subscription: { entity: subscription },
      payment: { entity: { ...payment, subscription_id: "sub_other" } },
    }),
  ).toMatchObject(invalidEntity);
  expect(
    await ingest(t, "subscription.charged", {
      subscription: { entity: subscription },
      invoice: { entity: { id: "inv_rel", subscription_id: "sub_other" } },
    }),
  ).toMatchObject(invalidEntity);
  expect(await counts(t)).toEqual({ orders: 0, payments: 0, refunds: 0, subscriptions: 0 });
});

test("a subscription event links its payment to the subscription and invoice", async () => {
  const t = convexTest(schema, modules);
  expect(
    await ingest(t, "subscription.charged", {
      subscription: { entity: subscription },
      payment: { entity: payment },
      invoice: { entity: { id: "inv_rel", subscription_id: "sub_rel" } },
    }),
  ).toMatchObject({ status: "processed" });
  const row = await t.run((ctx) => ctx.db.query("payments").first());
  expect(row).toMatchObject({
    razorpayId: "pay_rel",
    subscriptionId: "sub_rel",
    invoiceId: "inv_rel",
    testMode: false,
  });
  // A payment that names its own subscription and invoice keeps them.
  expect(
    await ingest(t, "subscription.charged", {
      subscription: { entity: { ...subscription, id: "sub_own" } },
      payment: {
        entity: { ...payment, id: "pay_own", subscription_id: "sub_own", invoice_id: "inv_own" },
      },
    }),
  ).toMatchObject({ status: "processed" });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_razorpayId", (q) => q.eq("razorpayId", "pay_own"))
        .first(),
    ),
  ).toMatchObject({ subscriptionId: "sub_own", invoiceId: "inv_own" });
});

test("matching refund and order relationships mirror both entities", async () => {
  const t = convexTest(schema, modules);
  expect(
    await ingest(t, "order.paid", {
      order: { entity: order },
      payment: { entity: { ...payment, order_id: "order_rel" } },
    }),
  ).toMatchObject({ status: "processed" });
  expect(
    await ingest(t, "refund.processed", {
      refund: { entity: refund },
      payment: { entity: payment },
    }),
  ).toMatchObject({ status: "processed" });
  expect(await counts(t)).toEqual({ orders: 1, payments: 1, refunds: 1, subscriptions: 0 });
});
