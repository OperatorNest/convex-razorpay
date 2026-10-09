import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("live fetches reject provider records with a different resource ID", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fabricated_secret");
  vi.stubEnv("RAZORPAY_TEST_MODE", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "other_id" }))),
  );
  const t = convexTest(schema, modules);

  await expect(t.action(api.orders.fetch, { orderId: "order_requested" })).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_ARGUMENT" },
  });
  await expect(t.action(api.payments.fetch, { paymentId: "pay_requested" })).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_ARGUMENT" },
  });
  await expect(t.action(api.refunds.fetch, { refundId: "rfnd_requested" })).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_ARGUMENT" },
  });
  await expect(
    t.action(api.customers.fetch, { customerId: "cust_requested" }),
  ).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_ARGUMENT" },
  });
  await expect(t.action(api.plans.fetch, { planId: "plan_requested" })).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_ARGUMENT" },
  });
  await expect(
    t.action(api.subscriptions.fetch, { subscriptionId: "sub_requested" }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
});

test("live order payment listing rejects cross-order provider data before mirroring it", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fabricated_secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entity: "collection",
            count: 1,
            items: [{ id: "pay_wrong_order", order_id: "order_other" }],
          }),
        ),
    ),
  );
  const t = convexTest(schema, modules);

  await expect(
    t.action(api.orders.fetchPayments, { orderId: "order_requested" }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  expect(await t.query(api.payments.listForOrder, { orderId: "order_requested" })).toEqual([]);
});

test("live refund creation rejects a provider refund linked to another payment", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fabricated_secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "rfnd_other", payment_id: "pay_other" }))),
  );
  const t = convexTest(schema, modules);

  await expect(
    t.action(api.refunds.create, {
      paymentId: "pay_requested",
      amount: 100,
      idempotencyKey: "refund_key_123",
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  expect(await t.run((ctx) => ctx.db.query("refunds").take(1))).toEqual([]);
});

test("live order create mirrors the provider record and keyed retry does not post twice", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fabricated_secret");
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          entity: "order",
          id: "order_live_fixture",
          amount: 5000,
          amount_paid: 0,
          amount_due: 5000,
          currency: "INR",
          status: "created",
          attempts: 0,
          notes: {},
          created_at: 1_567_674_500,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  const args = {
    amount: 5000,
    currency: "INR",
    idempotencyKey: "order_live_fixture_key",
    userId: "user_live_fixture",
    testMode: false,
  };

  const first = await t.action(api.orders.create, args);
  const second = await t.action(api.orders.create, args);
  expect(first.order.razorpayId).toBe("order_live_fixture");
  expect(second.order._id).toBe(first.order._id);
  expect(first.keyId).toBe("rzp_test_fixture");
  expect(fetch).toHaveBeenCalledTimes(1);
  const mirrored = await t.query(api.orders.get, { orderId: "order_live_fixture" });
  expect(mirrored).toMatchObject({
    _id: first.order._id,
    userId: "user_live_fixture",
  });
  expect(mirrored).toMatchObject({ testMode: false, createdThroughComponent: true });
});
