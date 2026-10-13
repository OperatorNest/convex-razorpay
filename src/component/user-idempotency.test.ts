import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import {
  setupTest,
  type TestCtx,
  stubRazorpayEnv,
  stubSimulatedRazorpayEnv,
  restoreRazorpayTestState,
  expectRazorpayError,
  stubFetch,
} from "../test-helpers.js";

function requestBody(init: RequestInit) {
  if (typeof init.body !== "string") throw new Error("Expected JSON request body");
  return JSON.parse(init.body);
}

const key = "checkout_1";
type Options = { userId?: string; externalId?: string; idempotencyKey: string };
const cases = [
  {
    resource: "order",
    create: async (t: TestCtx, options: Options) =>
      (
        await t.action(api.orders.create, {
          amount: 1000,
          currency: "INR",
          partialPayment: false,
          ...options,
        })
      ).order,
    release: (t: TestCtx, userId?: string) =>
      t.mutation(api.orders.releaseIdempotency, { idempotencyKey: key, userId }),
    raw: { entity: "order", amount: 1000, currency: "INR", status: "created" },
  },
  {
    resource: "plan",
    create: (t: TestCtx, options: Options) =>
      t.action(api.plans.create, {
        period: "monthly",
        interval: 1,
        item: { name: "Plan", amount: 1000, currency: "INR" },
        ...options,
      }),
    release: (t: TestCtx, userId?: string) =>
      t.mutation(api.plans.releaseIdempotency, { idempotencyKey: key, userId }),
    raw: {
      entity: "plan",
      period: "monthly",
      interval: 1,
      item: { name: "Plan", amount: 1000, currency: "INR" },
    },
  },
  {
    resource: "subscription",
    create: (t: TestCtx, options: Options) =>
      t.action(api.subscriptions.create, {
        razorpayPlanId: "plan_fixture",
        totalCount: 12,
        quantity: 1,
        customerNotify: false,
        ...options,
      }),
    release: (t: TestCtx, userId?: string) =>
      t.mutation(api.subscriptions.releaseIdempotency, { idempotencyKey: key, userId }),
    raw: {
      entity: "subscription",
      plan_id: "plan_fixture",
      total_count: 12,
      quantity: 1,
      status: "created",
    },
  },
  {
    resource: "customer",
    create: (t: TestCtx, options: Options) =>
      t.action(api.customers.create, { name: "Buyer", email: "buyer@example.test", ...options }),
    release: (t: TestCtx, userId?: string) =>
      t.mutation(api.customers.releaseIdempotency, { idempotencyKey: key, userId }),
    raw: { entity: "customer", name: "Buyer", email: "buyer@example.test" },
  },
];

afterEach(restoreRazorpayTestState);

test.each(cases)(
  "$resource creates isolate users and omitted userId while preserving completed retries",
  async ({ create }) => {
    stubSimulatedRazorpayEnv();
    const t = setupTest();
    const ids = [];
    for (const userId of ["alice", "bob", undefined]) {
      const options = { idempotencyKey: key, userId };
      const first = await create(t, options);
      ids.push(first._id);
      expect((await create(t, options))._id).toBe(first._id);
      await expectRazorpayError(
        create(t, { ...options, externalId: "different" }),
        "RAZORPAY_IDEMPOTENCY_CONFLICT",
      );
    }
    expect(new Set(ids).size).toBe(3);
  },
);

test.each(cases)(
  "$resource reconciliation selects the user's provider identifier without another POST",
  async ({ create, raw, resource }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    stubRazorpayEnv({ keyId: "rzp_test_fixture", keySecret: "fixture_secret" });
    const t = setupTest();
    const entities: Record<string, unknown>[] = [];
    const calls = stubFetch(({ init }) => {
      if (init.method === "POST") {
        const body = requestBody(init);
        entities.push({
          ...raw,
          id: `${raw.entity === "customer" ? "cust" : raw.entity === "subscription" ? "sub" : resource}_${entities.length}`,
          notes: body.notes,
          receipt: body.receipt,
          created_at: 1_800_000_000,
        });
        throw new TypeError("Disconnected after send");
      }
      return Response.json({ entity: "collection", items: entities.toReversed() });
    });
    for (const userId of ["alice", "bob", undefined])
      await expectRazorpayError(
        create(t, { idempotencyKey: key, userId }),
        "RAZORPAY_NETWORK_ERROR",
      );
    expect(new Set(entities.map((entity) => JSON.stringify(entity.notes))).size).toBe(3);
    vi.setSystemTime(1_800_000_660_000);
    const ids = [];
    for (const userId of ["alice", "bob", undefined]) {
      const created = await create(t, { idempotencyKey: key, userId });
      expect(created.userId).toBe(userId);
      ids.push(created._id);
      expect((await create(t, { idempotencyKey: key, userId }))._id).toBe(created._id);
    }
    expect(new Set(ids).size).toBe(3);
    expect(calls.map(({ init }) => init.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "GET",
      "GET",
      "GET",
    ]);
  },
);

test.each(cases)(
  "$resource release and definitive refusal affect only the named user's claim",
  async ({ create, release, raw, resource }) => {
    stubRazorpayEnv({ keyId: "rzp_test_fixture", keySecret: "fixture_secret" });
    const t = setupTest();
    let response: "network" | "refusal" | "success" = "network";
    const calls = stubFetch(({ init }) => {
      if (response === "network") throw new TypeError("Disconnected");
      if (response === "refusal")
        return Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 });
      const body = requestBody(init);
      return Response.json({
        ...raw,
        id: `${raw.entity === "customer" ? "cust" : raw.entity === "subscription" ? "sub" : resource}_bob`,
        notes: body.notes,
        created_at: 1_800_000_000,
      });
    });
    await expectRazorpayError(
      create(t, { idempotencyKey: key, userId: "alice" }),
      "RAZORPAY_NETWORK_ERROR",
    );
    response = "refusal";
    await expectRazorpayError(
      create(t, { idempotencyKey: key, userId: "bob" }),
      "RAZORPAY_PROVIDER_ERROR",
    );
    expect(await release(t)).toBe(false);
    expect(await release(t, "stranger")).toBe(false);
    response = "success";
    const bob = await create(t, { idempotencyKey: key, userId: "bob" });
    expect(bob.userId).toBe("bob");
    await expectRazorpayError(
      create(t, { idempotencyKey: key, userId: "alice" }),
      "RAZORPAY_IDEMPOTENCY_PENDING",
    );
    expect(await release(t, "alice")).toBe(true);
    expect(await release(t, "bob")).toBe(false);
    expect((await create(t, { idempotencyKey: key, userId: "bob" }))._id).toBe(bob._id);
    expect(calls.filter(({ init }) => init.method === "POST")).toHaveLength(3);
  },
);

test("customers.getOrCreate isolates equal keys for different users", async () => {
  stubSimulatedRazorpayEnv();
  const t = setupTest();
  const args = { name: "Buyer", email: "buyer@example.test", idempotencyKey: key };
  const alice = await t.action(api.customers.getOrCreate, { ...args, userId: "alice" });
  const bob = await t.action(api.customers.getOrCreate, { ...args, userId: "bob" });
  expect(bob._id).not.toBe(alice._id);
  expect((await t.action(api.customers.getOrCreate, { ...args, userId: "alice" }))._id).toBe(
    alice._id,
  );
});

test("refund keys and provider headers isolate users and preserve unscoped retries with inferred ownership", async () => {
  const t = setupTest();
  stubSimulatedRazorpayEnv();
  await t.mutation(internal.mutations.putOrder, {
    raw: { entity: "order", id: "order_refund", amount: 1000, currency: "INR", status: "paid" },
    observedAt: Date.now(),
    testMode: true,
    userId: "owner",
  });
  await t.mutation(internal.mutations.putPayment, {
    raw: {
      entity: "payment",
      id: "pay_refund",
      order_id: "order_refund",
      amount: 1000,
      currency: "INR",
      captured: true,
      status: "captured",
    },
    observedAt: Date.now(),
    testMode: true,
  });
  const args = {
    idempotencyKey: key,
    razorpayPaymentId: "pay_refund",
    amount: 100,
    speed: "normal" as const,
  };
  const ids = [];
  for (const userId of ["alice", "bob", undefined]) {
    const first = await t.action(api.refunds.create, { ...args, userId });
    ids.push(first._id);
    expect(first.userId).toBe(userId ?? "owner");
    expect((await t.action(api.refunds.create, { ...args, userId }))._id).toBe(first._id);
  }
  expect(new Set(ids).size).toBe(3);
  stubRazorpayEnv({ keyId: "rzp_live_fixture", keySecret: "fixture_secret" });
  const calls = stubFetch(({ init }, index) =>
    Response.json({
      entity: "refund",
      id: `rfnd_provider_${index}`,
      payment_id: "pay_refund",
      amount: 100,
      currency: "INR",
      status: "processed",
      notes: requestBody(init).notes,
    }),
  );
  for (const userId of ["alice", "bob", undefined]) {
    const first = await t.action(api.refunds.create, { ...args, userId });
    expect((await t.action(api.refunds.create, { ...args, userId }))._id).toBe(first._id);
  }
  const headers = calls.map(({ init }) => new Headers(init.headers).get("X-Refund-Idempotency"));
  expect(new Set(headers).size).toBe(3);
  expect(headers.every((header) => /^[0-9a-f]{64}$/.test(header ?? ""))).toBe(true);
  expect(calls).toHaveLength(3);
});

test("a refund webhook preceding the create response preserves the supplied user scope for retries", async () => {
  stubRazorpayEnv({
    keyId: "rzp_test_fixture",
    keySecret: "fixture_secret",
    webhookSecret: "fixture_webhook",
  });
  const t = setupTest();
  const raw = {
    entity: "refund",
    id: "rfnd_webhook_first",
    payment_id: "pay_fixture",
    amount: 100,
    currency: "INR",
    status: "processed",
  };
  await t.mutation(internal.mutations.putRefund, { raw, observedAt: Date.now(), testMode: true });
  const calls = stubFetch(() => Response.json(raw));
  const args = {
    idempotencyKey: key,
    userId: "alice",
    razorpayPaymentId: "pay_fixture",
    amount: 100,
    speed: "normal" as const,
  };
  const first = await t.action(api.refunds.create, args);
  expect(first.idempotencyUserId).toBe("alice");
  expect((await t.action(api.refunds.create, args))._id).toBe(first._id);
  expect(calls).toHaveLength(1);
});
