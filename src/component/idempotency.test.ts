import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { register } from "@operatornest/convex-razorpay/test";
import { hmacSha256Hex } from "@operatornest/convex-razorpay";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components } from "../../example/convex/_generated/api.js";
import schema from "../../example/convex/schema.js";

const modules = import.meta.glob("../../example/convex/**/*.ts");

beforeEach(() => {
  stubRazorpayEnv({ keyId: "rzp_test_public", keySecret: "fake_secret" });
});

afterEach(() => {
  restoreRazorpayTestState();
});

const planArgs = {
  period: "monthly" as const,
  interval: 1,
  item: { name: "Pro", amount: 69900, currency: "INR" },
  idempotencyKey: "plan-idempotency-key",
};

const subscriptionArgs = {
  planId: "plan_fixture",
  totalCount: 12,
  idempotencyKey: "subscription-idempotency-key",
};

test("keyed plan create reuses completed result and rejects changed body", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          entity: "plan",
          id: "plan_fixture",
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 69900, currency: "INR" },
          notes: {},
          created_at: 1567674599,
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const first = await t.action(components.razorpay.plans.create, planArgs);
  const retry = await t.action(components.razorpay.plans.create, planArgs);
  expect(retry.razorpayId).toBe(first.razorpayId);
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(
    t.action(components.razorpay.plans.create, {
      ...planArgs,
      item: { ...planArgs.item, amount: 79900 },
    }),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("uncertain keyed subscription result stays reserved before a retry", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: { code: "SERVER_ERROR", description: "Temporary failure" },
        }),
        { status: 503 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(
    t.action(components.razorpay.subscriptions.create, subscriptionArgs),
  ).rejects.toThrow();
  await expect(
    t.action(components.razorpay.subscriptions.create, subscriptionArgs),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("definitive plan 4xx releases the key for a corrected request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "Invalid plan" } }),
        { status: 400 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity: "plan",
          id: "plan_corrected",
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 79900, currency: "INR" },
          notes: {},
          created_at: 1567674599,
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
  const corrected = await t.action(components.razorpay.plans.create, {
    ...planArgs,
    item: { ...planArgs.item, amount: 79900 },
  });
  expect(corrected.razorpayId).toBe("plan_corrected");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("definitive plan 4xx releases the key for an identical retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR" } }), { status: 400 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity: "plan",
          id: "plan_same_request_retry",
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 69900, currency: "INR" },
          notes: {},
          created_at: 1567674599,
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
  const retry = await t.action(components.razorpay.plans.create, planArgs);
  expect(retry.razorpayId).toBe("plan_same_request_retry");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("plan idempotency note cannot be overwritten by caller metadata", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    if (typeof init.body !== "string") throw new Error("Expected a serialized provider request");
    expect(init.body).toContain(`"operatornestIdempotencyKey":"${planArgs.idempotencyKey}"`);
    return new Response(
      JSON.stringify({
        entity: "plan",
        id: "plan_reserved_note",
        period: "monthly",
        interval: 1,
        item: { name: "Pro", amount: 69900, currency: "INR" },
        notes: { operatornestIdempotencyKey: planArgs.idempotencyKey },
        created_at: 1567674599,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const result = await t.action(components.razorpay.plans.create, {
    ...planArgs,
    metadata: { operatornestIdempotencyKey: "caller-overwrite" },
  });
  expect(result.razorpayId).toBe("plan_reserved_note");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([409, 429])(
  "plan %i response remains pending for safe retry reconciliation",
  async (status) => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "CONFLICT", description: "Retry later" } }), {
          status,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const t = convexTest(schema, modules);
    register(t);
    await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
    await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow(
      /pending or unknown/i,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("stale plan claim reconciles note key before posting and tolerates unrelated notes arrays", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "SERVER_ERROR", description: "Unknown" } }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity: "collection",
          items: [
            { id: "plan_other", notes: [] },
            {
              id: "plan_recovered",
              entity: "plan",
              period: "monthly",
              interval: 1,
              item: { name: "Pro", amount: 69900, currency: "INR" },
              notes: { operatornestIdempotencyKey: planArgs.idempotencyKey },
              created_at: 1567674599,
            },
          ],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
  vi.setSystemTime(Date.now() + 11 * 60_000);
  const recovered = await t.action(components.razorpay.plans.create, planArgs);
  expect(recovered.razorpayId).toBe("plan_recovered");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("stale plan lookup posts only after a complete provider scan finds no match", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "SERVER_ERROR", description: "Unknown" } }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ entity: "collection", items: [] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity: "plan",
          id: "plan_after_absence",
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 69900, currency: "INR" },
          notes: {},
          created_at: 1567674599,
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
  vi.setSystemTime(Date.now() + 11 * 60_000);
  const created = await t.action(components.razorpay.plans.create, planArgs);
  expect(created.razorpayId).toBe("plan_after_absence");
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("a full bounded plan reconciliation scan never assumes absence or reposts", async () => {
  vi.useFakeTimers();
  const page = {
    entity: "collection",
    items: Array.from({ length: 100 }, (_, index) => ({
      id: `plan_unrelated_${index}`,
      notes: [],
    })),
  };
  const fetch = vi.fn(async (_url: string) =>
    _url.includes("/plans?")
      ? new Response(JSON.stringify(page), { status: 200 })
      : new Response(JSON.stringify({ error: { code: "SERVER_ERROR" } }), { status: 503 }),
  );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
  vi.setSystemTime(Date.now() + 11 * 60_000);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow(
    /Could not exhaust bounded plan lookup/i,
  );
  expect(fetch).toHaveBeenCalledTimes(21);
});

test("stale subscription claim reconciles provider notes before reposting", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "SERVER_ERROR", description: "Unknown" } }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity: "collection",
          items: [
            {
              id: "sub_recovered",
              entity: "subscription",
              plan_id: subscriptionArgs.planId,
              status: "created",
              quantity: 1,
              total_count: subscriptionArgs.totalCount,
              paid_count: 0,
              remaining_count: subscriptionArgs.totalCount,
              notes: { operatornestIdempotencyKey: subscriptionArgs.idempotencyKey },
              created_at: 1567674599,
            },
          ],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(
    t.action(components.razorpay.subscriptions.create, subscriptionArgs),
  ).rejects.toThrow();
  vi.setSystemTime(Date.now() + 11 * 60_000);
  const recovered = await t.action(components.razorpay.subscriptions.create, subscriptionArgs);
  expect(recovered.razorpayId).toBe("sub_recovered");
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

test("support can release a pending idempotency claim for a manually resolved key", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "SERVER_ERROR", description: "Unknown" } }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity: "plan",
          id: "plan_after_release",
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 69900, currency: "INR" },
          notes: {},
          created_at: 1567674599,
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toThrow();
  expect(
    await t.mutation(components.razorpay.idempotency.release, {
      resource: "plan",
      key: planArgs.idempotencyKey,
    }),
  ).toBe(true);
  const created = await t.action(components.razorpay.plans.create, planArgs);
  expect(created.razorpayId).toBe("plan_after_release");
});

test("refund creation derives its provider key from receipt and rejects keyless requests", async () => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          entity: "refund",
          id: "rfnd_from_receipt",
          payment_id: "pay_refund_target",
          amount: 100,
          currency: "INR",
          status: "processed",
          created_at: 1567674599,
          notes: {},
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const refunded = await t.action(components.razorpay.refunds.create, {
    paymentId: "pay_refund_target",
    amount: 100,
    receipt: "refund receipt 01",
  });
  expect(refunded.idempotencyKey).toBe("receipt:refund receipt 01");
  const call = fetch.mock.calls[0];
  if (!call) throw new Error("Expected provider refund call");
  const providerKey = call[1].headers;
  expect(providerKey).toMatchObject({
    "X-Refund-Idempotency": expect.stringMatching(/^receipt_[0-9a-f]{64}$/),
  });
  await expect(
    t.action(components.razorpay.refunds.create, { paymentId: "pay_refund_target", amount: 100 }),
  ).rejects.toMatchObject({
    data: { code: "RAZORPAY_IDEMPOTENCY_REQUIRED" },
  });
  await expect(
    t.action(components.razorpay.refunds.create, {
      paymentId: "pay_refund_target",
      amount: 100,
      idempotencyKey: "short-key",
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("test-mode cached creates reject reuse after switching to live mode", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("Unexpected provider POST on a mode mismatch");
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_mode_fixture");
  // Webhook entities are tagged test only when the deployment runs in test mode.
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  const paymentEvent = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    created_at: 1_567_674_599,
    payload: {
      payment: {
        entity: {
          id: "pay_mode_fixture",
          entity: "payment",
          amount: 100,
          currency: "INR",
          status: "captured",
          captured: true,
          created_at: 1_567_674_599,
        },
      },
    },
  });
  await t.action(components.razorpay.webhooks.ingest, {
    body: paymentEvent,
    signature: await hmacSha256Hex("whsec_mode_fixture", paymentEvent),
    eventId: "evt_mode_fixture_payment",
  });
  const cases: Array<{ create: () => Promise<unknown>; retry: () => Promise<unknown> }> = [
    {
      create: () =>
        t.action(components.razorpay.orders.create, {
          amount: 50000,
          currency: "INR",
          idempotencyKey: "mode_order_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.orders.create, {
          amount: 50000,
          currency: "INR",
          idempotencyKey: "mode_order_key",
          testMode: false,
        }),
    },
    {
      create: () =>
        t.action(components.razorpay.plans.create, {
          ...planArgs,
          idempotencyKey: "mode_plan_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.plans.create, {
          ...planArgs,
          idempotencyKey: "mode_plan_key",
          testMode: false,
        }),
    },
    {
      create: () =>
        t.action(components.razorpay.subscriptions.create, {
          ...subscriptionArgs,
          idempotencyKey: "mode_subscription_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.subscriptions.create, {
          ...subscriptionArgs,
          idempotencyKey: "mode_subscription_key",
          testMode: false,
        }),
    },
    {
      create: () =>
        t.action(components.razorpay.customers.getOrCreate, {
          name: "Mode Customer",
          email: "mode@example.test",
          userId: "mode_user",
          idempotencyKey: "mode_customer_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.customers.getOrCreate, {
          name: "Mode Customer",
          email: "mode@example.test",
          userId: "mode_user",
          idempotencyKey: "mode_customer_key",
          testMode: false,
        }),
    },
    {
      create: () =>
        t.action(components.razorpay.refunds.create, {
          paymentId: "pay_mode_fixture",
          amount: 100,
          idempotencyKey: "mode_refund_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.refunds.create, {
          paymentId: "pay_mode_fixture",
          amount: 100,
          idempotencyKey: "mode_refund_key",
          testMode: false,
        }),
    },
  ];
  await Promise.all(cases.map(({ create }) => create()));
  await Promise.all(
    cases.map(({ retry }) =>
      expect(retry()).rejects.toMatchObject({ data: { code: "RAZORPAY_MODE_MISMATCH" } }),
    ),
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("a configured secret without a key id fails as not configured", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fabricated_secret");
  const t = convexTest(schema, modules);
  register(t);
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toMatchObject({
    data: { code: "RAZORPAY_NOT_CONFIGURED" },
  });
});
