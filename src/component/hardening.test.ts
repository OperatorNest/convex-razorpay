import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { hmacSha256Hex } from "../shared/crypto.js";
import { classifyProviderError } from "../shared/errors.js";
import { paymentFields } from "./mapping.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const harness = () => convexTest(schema, modules);
const invalid = { data: { code: "RAZORPAY_INVALID_ARGUMENT" } };
const customer = {
  name: "Buyer",
  email: "buyer@example.test",
  idempotencyKey: "customer_key_1",
  testMode: true,
};
const plan = {
  period: "monthly" as const,
  interval: 1,
  item: { name: "Plan", amount: 1000, currency: "INR" },
  testMode: true,
};
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

test("reserved caller notes cannot complete another order claim", async () => {
  const t = harness();
  await t.mutation(internal.idempotency.claim, {
    resource: "order",
    testMode: false,
    key: "victim_key_123",
    fingerprint: "victim",
  });
  await expect(
    t.action(api.orders.create, {
      amount: 1000,
      currency: "INR",
      notes: { operatornestIdempotencyKey: "victim_key_123" },
      testMode: true,
    }),
  ).rejects.toMatchObject(invalid);
  expect(await t.run((ctx) => ctx.db.query("idempotencyRequests").first())).toMatchObject({
    status: "pending",
  });
});

test("provider notes without a fingerprint cannot settle a claim", async () => {
  const t = harness();
  await t.mutation(internal.idempotency.claim, {
    resource: "order",
    testMode: false,
    key: "victim_key_123",
    fingerprint: "victim",
  });
  await t.mutation(internal.mutations.putOrder, {
    raw: {
      entity: "order",
      id: "order_attacker",
      amount: 1000,
      currency: "INR",
      status: "created",
      notes: { operatornestIdempotencyKey: "victim_key_123" },
    },
    observedAt: 100,
  });
  expect(await t.run((ctx) => ctx.db.query("idempotencyRequests").first())).toMatchObject({
    status: "pending",
  });
});

test.each([
  { userId: "other" },
  { gstin: "1234567890ABCDE" },
  { notes: { sku: "other" } },
  { externalId: "other" },
  { metadata: { sku: "other" } },
])("customer keyed create rejects changed request %j", async (change) => {
  const t = harness();
  await t.action(api.customers.create, { ...customer, userId: "owner" });
  await expect(
    t.action(api.customers.create, { ...customer, userId: "owner", ...change }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_CONFLICT" } });
});

test("completed create claims survive retention and preserve deduplication", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const t = harness();
  const args = { ...plan, idempotencyKey: "retained_plan_key" };
  const first = await t.action(api.plans.create, args);
  vi.setSystemTime(1000000 + 31 * 86400000);
  expect(await t.mutation(internal.idempotency.cleanupScheduled, {})).toBe(0);
  expect((await t.action(api.plans.create, args)).razorpayId).toBe(first.razorpayId);
  await expect(
    t.action(api.plans.create, { ...args, item: { ...args.item, amount: 2000 } }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_CONFLICT" } });
});

test.each(["active", "paused"])(
  "subscription fetch applies current %s state regardless of local observation time",
  async (status) => {
    const t = harness();
    await t.mutation(internal.mutations.putSubscription, { raw: subscription, observedAt: 200 });
    const row = await t.mutation(internal.mutations.putSubscription, {
      raw: { ...subscription, status, quantity: 1 },
      observedAt: 100,
    });
    expect(row).toMatchObject({ status, quantity: 1, updatedAtProvider: 100 });
  },
);

test("opposite-mode payment writes reject without changing the mirror", async () => {
  const t = harness();
  await t.mutation(internal.mutations.putPayment, {
    raw: payment,
    observedAt: 100,
    testMode: false,
  });
  await expect(
    t.mutation(internal.mutations.putPayment, {
      raw: { ...payment, status: "captured", captured: true },
      observedAt: 200,
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_MODE_MISMATCH" } });
  expect(await t.run((ctx) => ctx.db.query("payments").first())).toMatchObject({
    status: "authorized",
    testMode: false,
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
  await expect(
    t.action(api.webhooks.ingest, {
      body,
      signature: await hmacSha256Hex("fixture_webhook", body),
      eventId: "evt_live_mode",
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_LIVE_KEY_TEST_MODE" } });
});

test("live local reads omit test-mode mirrors", async () => {
  const t = harness();
  const order = (
    await t.action(api.orders.create, { amount: 1000, currency: "INR", testMode: true })
  ).order;
  await t.action(api.customers.create, { ...customer, userId: "owner" });
  await t.action(api.subscriptions.create, {
    planId: "plan_fixture",
    totalCount: 12,
    userId: "owner",
    testMode: true,
  });
  await t.mutation(internal.mutations.putPayment, {
    raw: { ...payment, order_id: order.razorpayId },
    observedAt: 100,
    testMode: true,
  });
  expect(await t.query(api.orders.get, { orderId: order.razorpayId })).toBeNull();
  expect(await t.query(api.customers.getByUser, { userId: "owner" })).toBeNull();
  expect(await t.query(api.subscriptions.getForUser, { userId: "owner" })).toBeNull();
  expect(await t.query(api.subscriptions.listByUser, { userId: "owner" })).toEqual([]);
  expect(await t.query(api.payments.listForOrder, { orderId: order.razorpayId })).toEqual([]);
});

test("partial-payment checkout accepts a smaller authenticated payment", async () => {
  const t = harness();
  const order = (
    await t.action(api.orders.create, {
      amount: 1000,
      currency: "INR",
      partialPayment: true,
      testMode: true,
    })
  ).order;
  await t.mutation(internal.mutations.putPayment, {
    raw: { ...payment, order_id: order.razorpayId },
    observedAt: 100,
    testMode: true,
  });
  const row = await t.action(api.verification.checkout, {
    orderId: order.razorpayId,
    paymentId: payment.id,
    signature: await hmacSha256Hex("fixture_secret", `${order.razorpayId}|${payment.id}`),
    testMode: true,
  });
  expect(row.verified).toBe(true);
});

test("duplicate receipts without this claim marker preserve the provider rejection", async () => {
  const t = harness();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "BAD_REQUEST_ERROR", description: "duplicate receipt" },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entity: "collection",
            items: [
              {
                entity: "order",
                id: "order_old",
                amount: 1000,
                currency: "INR",
                receipt: "receipt",
                status: "created",
                notes: { sku: "old" },
                partial_payment: false,
              },
            ],
          }),
        ),
      ),
  );
  await expect(
    t.action(api.orders.create, {
      amount: 1000,
      currency: "INR",
      receipt: "receipt",
      notes: { sku: "new" },
      partialPayment: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_PROVIDER_REJECTED" } });
});

test("original metadata is bounded before linkage overwrites it", async () => {
  const t = harness();
  await expect(
    t.action(api.orders.create, {
      amount: 1000,
      currency: "INR",
      userId: "owner",
      metadata: { userId: "x".repeat(300000) },
      testMode: true,
    }),
  ).rejects.toMatchObject(invalid);
});

test("provider note normalization preserves surrogate pairs", () => {
  const text = "x".repeat(255) + "😀";
  const notes = paymentFields({ ...payment, notes: { [text]: text } }, 100).notes;
  expect(Object.keys(notes)[0]).toBe("x".repeat(255));
  expect(Object.values(notes)[0]).toBe("x".repeat(255));
});

test("unkeyed synthetic creates allocate independent resources", async () => {
  const t = harness();
  const a = await t.action(api.subscriptions.create, {
    planId: "plan_fixture",
    totalCount: 12,
    externalId: "a",
    testMode: true,
  });
  const b = await t.action(api.subscriptions.create, {
    planId: "plan_fixture",
    totalCount: 12,
    externalId: "b",
    quantity: 2,
    testMode: true,
  });
  expect(a.razorpayId).not.toBe(b.razorpayId);
  const p = await t.action(api.plans.create, plan);
  const q = await t.action(api.plans.create, { ...plan, item: { ...plan.item, currency: "USD" } });
  expect(p.razorpayId).not.toBe(q.razorpayId);
});

test("getOrCreate rejects attaching ownership without a profile change", async () => {
  const t = harness();
  const first = await t.action(api.customers.create, customer);
  await expect(
    t.action(api.customers.getOrCreate, { ...customer, userId: "owner" }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_CUSTOMER_CONFLICT" } });
  expect(
    await t.action(api.customers.fetch, { customerId: first.razorpayId, testMode: true }),
  ).not.toHaveProperty("userId");
});

test.each([1.5, 0, 101])("local list limit %s fails with the package code", async (limit) => {
  const t = harness();
  await expect(
    t.query(api.payments.listForOrder, { orderId: "order_fixture", limit }),
  ).rejects.toMatchObject(invalid);
  await expect(
    t.query(api.subscriptions.listByUser, { userId: "owner", limit }),
  ).rejects.toMatchObject(invalid);
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
        signature: await hmacSha256Hex("fixture_webhook", body),
        eventId: "evt_invoice",
      }),
    ).toMatchObject({ status: "failed", errorCode: "RAZORPAY_INVALID_ENTITY" });
  },
);

test("provider errors expose fixed messages without descriptions", () => {
  const a = classifyProviderError(400, {
    error: { code: "BAD_REQUEST_ERROR", description: "private value" },
  });
  const b = classifyProviderError(400, {
    error: { code: "BAD_REQUEST_ERROR", description: "other value" },
  });
  expect(a.message).toBe(b.message);
  expect(a).toMatchObject({ providerStatus: 400, providerCode: "BAD_REQUEST_ERROR" });
});
