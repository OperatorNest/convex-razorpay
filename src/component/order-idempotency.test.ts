import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { sha256Hex } from "../shared/crypto.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const key = "order_claim_key_0001";
const base = { amount: 50000, currency: "INR", idempotencyKey: key };

function conflict(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_CONFLICT" } });
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
    receipt: `rcpt_${(await sha256Hex(key)).slice(0, 35)}`,
    status: "created",
    attempts: 0,
    notes: { operatornestIdempotencyKey: key },
    created_at: 1_567_674_599,
    ...overrides,
  };
}

test("a reused order key with any different request is a conflict, never a returned order", async () => {
  const t = convexTest(schema, modules);
  const args = { ...base, userId: "user_a", notes: { cart: "1" }, testMode: true };
  const first = await t.action(api.orders.create, args);
  expect((await t.action(api.orders.create, args)).order._id).toBe(first.order._id);
  await conflict(t.action(api.orders.create, { ...args, userId: "user_b" }));
  await conflict(t.action(api.orders.create, { ...args, externalId: "ext_1" }));
  await conflict(t.action(api.orders.create, { ...args, notes: { cart: "2" } }));
  await conflict(t.action(api.orders.create, { ...args, metadata: { source: "web" } }));
  await conflict(t.action(api.orders.create, { ...args, amount: 60000 }));
  await conflict(t.action(api.orders.create, { ...args, currency: "USD" }));
  await conflict(t.action(api.orders.create, { ...args, receipt: "other-receipt" }));
  await conflict(t.action(api.orders.create, { ...args, partialPayment: true }));
  const { userId: _omitted, ...withoutUser } = args;
  await conflict(t.action(api.orders.create, withoutUser));
  expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(1);
});

test("a live order retry returns the mirror and posts exactly once", async () => {
  const t = convexTest(schema, modules);
  const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json(
      await providerOrder({ notes: { userId: "u1", operatornestIdempotencyKey: key } }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const args = { ...base, userId: "u1" };
  const first = await t.action(api.orders.create, args);
  expect(first.order).toMatchObject({
    razorpayId: "order_provider_1",
    createdThroughComponent: true,
    testMode: false,
    idempotencyKey: key,
  });
  expect((await t.action(api.orders.create, args)).order._id).toBe(first.order._id);
  await conflict(t.action(api.orders.create, { ...args, userId: "u2" }));
  expect(fetch).toHaveBeenCalledTimes(1);
  const init = fetch.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(init.body as string);
  expect(body.notes).toEqual({ userId: "u1", operatornestIdempotencyKey: key });
  expect(body.receipt).toMatch(/^rcpt_[0-9a-f]{35}$/);
});

test("concurrent creates with one key are serialized by the claim", async () => {
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
    t.action(api.orders.create, base),
    t.action(api.orders.create, base),
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
  // After the winner completes, the key resolves to the same single mirror.
  const again = await t.action(api.orders.create, base);
  expect(again.order.razorpayId).toBe("order_provider_1");
  expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(1);
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
  await expect(t.action(api.orders.create, base)).rejects.toMatchObject({
    data: { code: "RAZORPAY_NETWORK_ERROR" },
  });
  // Reserved: the outcome is unknown, so a retry must not POST again.
  await expect(t.action(api.orders.create, base)).rejects.toMatchObject({
    data: { code: "RAZORPAY_IDEMPOTENCY_PENDING" },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  // A different request under the pending key is a conflict, not a pending hint.
  await conflict(t.action(api.orders.create, { ...base, amount: 60000 }));

  vi.setSystemTime(new Date("2026-10-04T00:11:00Z"));
  const recovered = await t.action(api.orders.create, base);
  expect(recovered.order).toMatchObject({
    razorpayId: "order_provider_1",
    createdThroughComponent: true,
  });
  const calls = fetch.mock.calls.map(
    ([url, init]) => `${init.method} ${new URL(url).pathname}${new URL(url).search}`,
  );
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatch(/^GET \/v1\/orders\?count=100&skip=0&receipt=rcpt_[0-9a-f]{35}$/);
  expect((await t.action(api.orders.create, base)).order._id).toBe(recovered.order._id);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("reconciliation that finds nothing posts again; a definitive rejection frees the key", async () => {
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
  await expect(t.action(api.orders.create, base)).rejects.toMatchObject({
    data: { code: "RAZORPAY_NETWORK_ERROR" },
  });
  vi.setSystemTime(new Date("2026-10-04T00:11:00Z"));
  mode = "reject";
  await expect(t.action(api.orders.create, base)).rejects.toMatchObject({
    data: { code: "RAZORPAY_PROVIDER_REJECTED" },
  });
  // Definitive failure: the key is free immediately, no waiting and no pending error.
  mode = "ok";
  expect((await t.action(api.orders.create, base)).order.razorpayId).toBe("order_provider_1");
  const methods = fetch.mock.calls.map(([, init]) => init.method);
  expect(methods).toEqual(["POST", "GET", "POST", "POST"]);
});

test("a duplicate-receipt rejection adopts only the provably identical order", async () => {
  const t = convexTest(schema, modules);
  const duplicate = Response.json(
    { error: { code: "BAD_REQUEST_ERROR", description: "Same receipt already exists" } },
    { status: 400 },
  );
  const adopted = await providerOrder({ notes: { userId: "u1", operatornestIdempotencyKey: key } });
  let existing: unknown = adopted;
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    init.method === "POST"
      ? duplicate.clone()
      : Response.json({ entity: "collection", count: 1, items: [existing] }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await t.action(api.orders.create, { ...base, userId: "u1" });
  expect(result.order.razorpayId).toBe("order_provider_1");

  // Same receipt but a different owner or key: conflict, and the key is released.
  existing = await providerOrder({ notes: { userId: "someone_else" } });
  await conflict(
    t.action(api.orders.create, {
      amount: 50000,
      currency: "INR",
      idempotencyKey: "order_claim_key_0002",
      receipt: adopted.receipt,
      userId: "u1",
    }),
  );
});

test("a reused refund key with a different request is a conflict in both modes", async () => {
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
    paymentId: "pay_refund_key",
    amount: 100,
    idempotencyKey: "refund_conflict_key",
    testMode: true,
  };
  const first = await t.action(api.refunds.create, args);
  expect((await t.action(api.refunds.create, args)).razorpayId).toBe(first.razorpayId);
  await conflict(t.action(api.refunds.create, { ...args, amount: 200 }));
  await conflict(t.action(api.refunds.create, { ...args, notes: { why: "other" } }));
  await conflict(t.action(api.refunds.create, { ...args, userId: "user_x" }));
  // The in-mutation guard (race path) reports the same code.
  await conflict(
    t.mutation(internal.mutations.putTestRefund, {
      refundId: "rfnd_test_other",
      paymentId: "pay_refund_key",
      amount: 100,
      notes: {},
      idempotencyKey: "refund_conflict_key",
      requestFingerprint: "different",
    }),
  );
});

test("a reused customer key with a different customer is a conflict", async () => {
  const t = convexTest(schema, modules);
  const args = {
    name: "Key Customer",
    email: "key@example.test",
    idempotencyKey: "customer_conflict_key",
    testMode: true,
  };
  const first = await t.action(api.customers.create, args);
  expect((await t.action(api.customers.create, args)).razorpayId).toBe(first.razorpayId);
  await conflict(t.action(api.customers.create, { ...args, name: "Someone Else" }));
  await conflict(t.action(api.customers.create, { ...args, email: "else@example.test" }));
  await conflict(t.action(api.customers.create, { ...args, contact: "+919999999999" }));
});

test("plan and subscription key reuse report the conflict code", async () => {
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
    planId: "plan_x",
    totalCount: 3,
    idempotencyKey: "subscription_conflict_k",
    testMode: true,
  };
  await t.action(api.subscriptions.create, sub);
  await conflict(t.action(api.subscriptions.create, { ...sub, totalCount: 4 }));
});
