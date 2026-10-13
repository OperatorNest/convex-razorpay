import { stubRazorpayEnv, restoreRazorpayTestState, expectRazorpayError } from "../test-helpers.js";
import { computeSha256Hex } from "../shared/crypto.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const idempotencyKey = "order_claim_key_0001";
const base = { amount: 50000, currency: "INR", idempotencyKey: idempotencyKey };

function conflict(promise: Promise<unknown>) {
  return expectRazorpayError(promise, "RAZORPAY_IDEMPOTENCY_CONFLICT");
}

beforeEach(() => {
  stubRazorpayEnv({ keyId: "rzp_test_public", keySecret: "fake_secret" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected provider HTTP");
    }),
  );
});

afterEach(() => {
  restoreRazorpayTestState();
});

async function providerOrder(overrides: Record<string, unknown> = {}) {
  return {
    entity: "order",
    id: "order_provider_1",
    amount: 50000,
    amount_paid: 0,
    amount_due: 50000,
    currency: "INR",
    receipt: `rcpt_${(await computeSha256Hex(idempotencyKey)).slice(0, 35)}`,
    status: "created",
    attempts: 0,
    notes: { operatornestIdempotencyKey: idempotencyKey },
    created_at: 1_567_674_599,
    ...overrides,
  };
}

test("a reused order idempotencyKey with any different request is a conflict, never a returned order", async () => {
  stubRazorpayEnv({ keySecret: "fake_secret" });
  const t = convexTest(schema, modules);
  const args = { ...base, userId: "user_a", notes: { cart: "1" }, testMode: true };
  const first = await t.action(api.orders.create, { partialPayment: false, ...args });
  expect((await t.action(api.orders.create, { partialPayment: false, ...args })).order._id).toBe(
    first.order._id,
  );
  await conflict(t.action(api.orders.create, { partialPayment: false, ...args, userId: "user_b" }));
  await conflict(
    t.action(api.orders.create, { partialPayment: false, ...args, externalId: "ext_1" }),
  );
  await conflict(
    t.action(api.orders.create, { partialPayment: false, ...args, notes: { cart: "2" } }),
  );
  await conflict(
    t.action(api.orders.create, { partialPayment: false, ...args, metadata: { source: "web" } }),
  );
  await conflict(t.action(api.orders.create, { partialPayment: false, ...args, amount: 60000 }));
  await conflict(t.action(api.orders.create, { partialPayment: false, ...args, currency: "USD" }));
  await conflict(
    t.action(api.orders.create, { partialPayment: false, ...args, receipt: "other-receipt" }),
  );
  await conflict(t.action(api.orders.create, { ...args, partialPayment: true }));
  const { userId: _omitted, ...withoutUser } = args;
  await conflict(t.action(api.orders.create, { partialPayment: false, ...withoutUser }));
  expect(await t.run((ctx) => ctx.db.query("orders").take(1000))).toHaveLength(1);
});

test("a live order retry returns the mirror and posts exactly once", async () => {
  stubRazorpayEnv({ keyId: "rzp_live_public", keySecret: "fake_secret" });
  const t = convexTest(schema, modules);
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json(
      await providerOrder({
        notes: { operatornestUserId: "u1", operatornestIdempotencyKey: idempotencyKey },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const args = { ...base, userId: "u1" };
  const first = await t.action(api.orders.create, { partialPayment: false, ...args });
  expect(first.order).toMatchObject({
    razorpayOrderId: "order_provider_1",
    createdThroughComponent: true,
    testMode: false,
    idempotencyKey: idempotencyKey,
  });
  expect((await t.action(api.orders.create, { partialPayment: false, ...args })).order._id).toBe(
    first.order._id,
  );
  await conflict(t.action(api.orders.create, { partialPayment: false, ...args, userId: "u2" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  const init = fetch.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(init.body as string);
  expect(body.notes).toEqual({
    operatornestUserId: "u1",
    operatornestIdempotencyKey: idempotencyKey,
  });
  expect(body.receipt).toMatch(/^rcpt_[0-9a-f]{35}$/);
});

test("concurrent creates with one idempotencyKey are serialized by the claim", async () => {
  const t = convexTest(schema, modules);
  let openGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const fetch = vi.fn(async () => {
    await gate;
    return Response.json(await providerOrder());
  });
  vi.stubGlobal("fetch", fetch);
  const settled = Promise.allSettled([
    t.action(api.orders.create, { partialPayment: false, ...base }),
    t.action(api.orders.create, { partialPayment: false, ...base }),
  ]);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  openGate?.();
  const results = await settled;
  expect(results.map((result) => result.status).toSorted()).toEqual(["fulfilled", "rejected"]);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({
    reason: { data: { code: "RAZORPAY_IDEMPOTENCY_PENDING" } },
  });
  expect(fetch).toHaveBeenCalledTimes(1);

  const again = await t.action(api.orders.create, { partialPayment: false, ...base });
  expect(again.order.razorpayOrderId).toBe("order_provider_1");
  expect(await t.run((ctx) => ctx.db.query("orders").take(1000))).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an ambiguous POST /orders stays reserved, then reconciles by receipt without a second order", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === "POST") throw new TypeError("socket hang up");
    return Response.json({
      entity: "collection",
      count: 2,
      items: [
        await providerOrder({ id: "order_unrelated", notes: { operatornestIdempotencyKey: "x" } }),
        await providerOrder(),
      ],
    });
  });
  vi.stubGlobal("fetch", fetch);
  await expectRazorpayError(
    t.action(api.orders.create, { partialPayment: false, ...base }),
    "RAZORPAY_NETWORK_ERROR",
  );

  await expectRazorpayError(
    t.action(api.orders.create, { partialPayment: false, ...base }),
    "RAZORPAY_IDEMPOTENCY_PENDING",
  );
  expect(fetch).toHaveBeenCalledTimes(1);

  await conflict(t.action(api.orders.create, { partialPayment: false, ...base, amount: 60000 }));

  vi.setSystemTime(new Date("2026-10-04T00:11:00Z"));
  const recovered = await t.action(api.orders.create, { partialPayment: false, ...base });
  expect(recovered.order).toMatchObject({
    razorpayOrderId: "order_provider_1",
    createdThroughComponent: true,
  });
  const calls = fetch.mock.calls.map(
    ([url, init]) => `${init.method} ${new URL(url).pathname}${new URL(url).search}`,
  );
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatch(/^GET \/v1\/orders\?count=100&skip=0&receipt=rcpt_[0-9a-f]{35}$/);
  expect((await t.action(api.orders.create, { partialPayment: false, ...base })).order._id).toBe(
    recovered.order._id,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("unresolved reconciliation requires explicit release before a definitive rejection can free the idempotencyKey", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  let mode: "timeout" | "empty" | "reject" | "ok" = "timeout";
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    if (mode === "timeout") throw new TypeError("timeout");
    if (init.method === "GET") return Response.json({ entity: "collection", count: 0, items: [] });
    if (mode === "reject")
      return Response.json(
        { error: { code: "BAD_REQUEST_ERROR", description: "Amount exceeds limit" } },
        { status: 400 },
      );
    return Response.json(await providerOrder());
  });
  vi.stubGlobal("fetch", fetch);
  await expectRazorpayError(
    t.action(api.orders.create, { partialPayment: false, ...base }),
    "RAZORPAY_NETWORK_ERROR",
  );
  vi.setSystemTime(new Date("2026-10-04T00:11:00Z"));
  mode = "reject";
  await expectRazorpayError(
    t.action(api.orders.create, { partialPayment: false, ...base }),
    "RAZORPAY_IDEMPOTENCY_PENDING",
  );
  expect(
    await t.mutation(internal.idempotency.release, { resource: "order", idempotencyKey }),
  ).toBe(true);
  await expectRazorpayError(
    t.action(api.orders.create, { partialPayment: false, ...base }),
    "RAZORPAY_PROVIDER_ERROR",
  );

  mode = "ok";
  expect(
    (await t.action(api.orders.create, { partialPayment: false, ...base })).order.razorpayOrderId,
  ).toBe("order_provider_1");
  const methods = fetch.mock.calls.map(([, init]) => init.method);
  expect(methods).toEqual(["POST", "GET", "POST", "GET", "POST"]);
});

test("a duplicate-receipt rejection adopts only the provably identical order", async () => {
  const t = convexTest(schema, modules);
  const duplicate = Response.json(
    { error: { code: "BAD_REQUEST_ERROR", description: "Same receipt already exists" } },
    { status: 400 },
  );
  const adopted = await providerOrder({
    notes: { operatornestUserId: "u1", operatornestIdempotencyKey: idempotencyKey },
  });
  let existing: unknown = adopted;
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    init.method === "POST"
      ? duplicate.clone()
      : Response.json({ entity: "collection", count: 1, items: [existing] }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await t.action(api.orders.create, {
    partialPayment: false,
    ...base,
    userId: "u1",
  });
  expect(result.order.razorpayOrderId).toBe("order_provider_1");

  existing = await providerOrder({ notes: { userId: "someone_else" } });
  await expectRazorpayError(
    t.action(api.orders.create, {
      partialPayment: false,
      amount: 50000,
      currency: "INR",
      idempotencyKey: "order_claim_key_0002",
      receipt: adopted.receipt,
      userId: "u1",
    }),
    "RAZORPAY_PROVIDER_ERROR",
  );
});

test("a reused refund idempotencyKey with a different request is a conflict in both modes", async () => {
  stubRazorpayEnv({ keySecret: "fake_secret" });
  const t = convexTest(schema, modules);
  await t.mutation(internal.mutations.putPayment, {
    raw: {
      entity: "payment",
      id: "pay_refund_key",
      amount: 5000,
      currency: "INR",
      status: "captured",
      captured: true,
      amount_refunded: 0,
      created_at: 1_567_674_599,
    },
    observedAt: 1_567_674_599_000,
    testMode: true,
  });
  const args = {
    razorpayPaymentId: "pay_refund_key",
    amount: 100,
    idempotencyKey: "refund_conflict_key",
    testMode: true,
  };
  const first = await t.action(api.refunds.create, { speed: "normal", ...args });
  expect((await t.action(api.refunds.create, { speed: "normal", ...args })).razorpayRefundId).toBe(
    first.razorpayRefundId,
  );
  await conflict(t.action(api.refunds.create, { speed: "normal", ...args, amount: 200 }));
  await conflict(
    t.action(api.refunds.create, { speed: "normal", ...args, notes: { why: "other" } }),
  );
  await conflict(t.action(api.refunds.create, { speed: "normal", ...args, userId: "user_x" }));

  await conflict(
    t.mutation(internal.mutations.putTestRefund, {
      razorpayRefundId: "rfnd_test_other",
      razorpayPaymentId: "pay_refund_key",
      amount: 100,
      notes: {},
      idempotencyKey: "refund_conflict_key",
      requestFingerprint: "different",
    }),
  );
});

test("a reused customer idempotencyKey with a different customer is a conflict", async () => {
  stubRazorpayEnv({ keySecret: "fake_secret" });
  const t = convexTest(schema, modules);
  const args = {
    name: "Key Customer",
    email: "idempotencyKey@example.test",
    idempotencyKey: "customer_conflict_key",
    testMode: true,
  };
  const first = await t.action(api.customers.create, args);
  expect((await t.action(api.customers.create, args)).razorpayCustomerId).toBe(
    first.razorpayCustomerId,
  );
  await conflict(t.action(api.customers.create, { ...args, name: "Someone Else" }));
  await conflict(t.action(api.customers.create, { ...args, email: "else@example.test" }));
  await conflict(t.action(api.customers.create, { ...args, contact: "+919999999999" }));
});

test("plan and subscription idempotencyKey reuse report the conflict code", async () => {
  stubRazorpayEnv({ keySecret: "fake_secret" });
  const t = convexTest(schema, modules);
  const plan = {
    period: "monthly" as const,
    interval: 1,
    item: { name: "Pro", amount: 5000, currency: "INR" },
    idempotencyKey: "plan_conflict_key_1",
    testMode: true,
  };
  await t.action(api.plans.create, plan);
  await conflict(t.action(api.plans.create, { ...plan, item: { ...plan.item, amount: 9000 } }));
  const sub = {
    razorpayPlanId: "plan_x",
    totalCount: 3,
    idempotencyKey: "subscription_conflict_k",
    testMode: true,
  };
  await t.action(api.subscriptions.create, { quantity: 1, customerNotify: true, ...sub });
  await conflict(
    t.action(api.subscriptions.create, {
      quantity: 1,
      customerNotify: true,
      ...sub,
      totalCount: 4,
    }),
  );
});
