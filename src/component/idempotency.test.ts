import schema from "../../example/convex/schema.js";
import componentSchema from "./schema.js";
import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { register } from "@operatornest/convex-razorpay/test";
import { computeHmacSha256Hex } from "@operatornest/convex-razorpay";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
import { components } from "../../example/convex/_generated/api.js";
import { api, internal } from "./_generated/api.js";
import { classifyProviderError } from "../shared/providerErrors.js";
import { paymentFields } from "./mapping.js";

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
  razorpayPlanId: "plan_fixture",
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
  expect(retry.razorpayPlanId).toBe(first.razorpayPlanId);
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
    t.action(components.razorpay.subscriptions.create, {
      quantity: 1,
      customerNotify: true,
      ...subscriptionArgs,
    }),
  ).rejects.toThrow();
  await expect(
    t.action(components.razorpay.subscriptions.create, {
      quantity: 1,
      customerNotify: true,
      ...subscriptionArgs,
    }),
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
  expect(corrected.razorpayPlanId).toBe("plan_corrected");
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
  expect(retry.razorpayPlanId).toBe("plan_same_request_retry");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("caller metadata cannot set the reserved idempotency note", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  await expect(
    t.action(components.razorpay.plans.create, {
      ...planArgs,
      metadata: { operatornestIdempotencyKey: "caller-overwrite" },
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  expect(fetch).not.toHaveBeenCalled();
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
  expect(recovered.razorpayPlanId).toBe("plan_recovered");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("stale plan lookup remains pending when the provider scan finds no match", async () => {
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
  await expect(t.action(components.razorpay.plans.create, planArgs)).rejects.toMatchObject({
    data: { code: "RAZORPAY_IDEMPOTENCY_PENDING" },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
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
    "The create outcome is pending or unknown; reconcile before retrying.",
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
              plan_id: subscriptionArgs.razorpayPlanId,
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
    t.action(components.razorpay.subscriptions.create, {
      quantity: 1,
      customerNotify: true,
      ...subscriptionArgs,
    }),
  ).rejects.toThrow();
  vi.setSystemTime(Date.now() + 11 * 60_000);
  const recovered = await t.action(components.razorpay.subscriptions.create, {
    quantity: 1,
    customerNotify: true,
    ...subscriptionArgs,
  });
  expect(recovered.razorpaySubscriptionId).toBe("sub_recovered");
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
    await t.mutation(components.razorpay.plans.releaseIdempotency, {
      idempotencyKey: planArgs.idempotencyKey,
    }),
  ).toBe(true);
  const created = await t.action(components.razorpay.plans.create, planArgs);
  expect(created.razorpayPlanId).toBe("plan_after_release");
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
    speed: "normal",
    razorpayPaymentId: "pay_refund_target",
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
    t.action(components.razorpay.refunds.create, {
      speed: "normal",
      razorpayPaymentId: "pay_refund_target",
      amount: 100,
    }),
  ).rejects.toMatchObject({
    data: { code: "RAZORPAY_IDEMPOTENCY_REQUIRED" },
  });
  await expect(
    t.action(components.razorpay.refunds.create, {
      speed: "normal",
      razorpayPaymentId: "pay_refund_target",
      amount: 100,
      idempotencyKey: "short-key",
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("mode changes isolate claims while customer and refund mirrors reject opposite mode", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("Unexpected provider POST on a mode mismatch");
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_mode_fixture");

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
    signature: await computeHmacSha256Hex("whsec_mode_fixture", paymentEvent),
    eventId: "evt_mode_fixture_payment",
  });
  const cases: Array<{ create: () => Promise<unknown>; retry: () => Promise<unknown> }> = [
    {
      create: () =>
        t.action(components.razorpay.orders.create, {
          partialPayment: false,
          amount: 50000,
          currency: "INR",
          idempotencyKey: "mode_order_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.orders.create, {
          partialPayment: false,
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
          quantity: 1,
          customerNotify: true,
          ...subscriptionArgs,
          idempotencyKey: "mode_subscription_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.subscriptions.create, {
          quantity: 1,
          customerNotify: true,
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
          speed: "normal",
          razorpayPaymentId: "pay_mode_fixture",
          amount: 100,
          idempotencyKey: "mode_refund_key",
          testMode: true,
        }),
      retry: () =>
        t.action(components.razorpay.refunds.create, {
          speed: "normal",
          razorpayPaymentId: "pay_mode_fixture",
          amount: 100,
          idempotencyKey: "mode_refund_key",
          testMode: false,
        }),
    },
  ];
  await Promise.all(cases.map(({ create }) => create()));
  vi.stubEnv("RAZORPAY_TEST_MODE", "false");
  await Promise.all(
    cases.map(({ retry }, index) =>
      expect(retry()).rejects.toMatchObject({
        data: { code: index < 3 ? "RAZORPAY_NETWORK_ERROR" : "RAZORPAY_MODE_MISMATCH" },
      }),
    ),
  );
  expect(fetch).toHaveBeenCalledTimes(3);
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

describe("idempotency", () => {
  const componentModules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(componentSchema, componentModules);

  const invalid = { data: { code: "RAZORPAY_INVALID_ARGUMENT" } };

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
      idempotencyKey: "victim_key_123",
      requestFingerprint: "victim",
    });
    await expect(
      t.action(api.orders.create, {
        partialPayment: false,
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
      idempotencyKey: "victim_key_123",
      requestFingerprint: "victim",
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

  test.each(["active", "paused"])(
    "subscription fetch applies current %s state regardless of local observation time",
    async (status) => {
      const t = harness();
      await t.mutation(internal.mutations.putSubscription, { raw: subscription, observedAt: 200 });
      const row = await t.mutation(internal.mutations.putSubscription, {
        raw: { ...subscription, status, quantity: 1 },
        observedAt: 100,
      });
      expect(row).toMatchObject({ status, quantity: 1, providerUpdatedAt: 100 });
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

  test("provider note normalization preserves surrogate pairs", () => {
    const text = "x".repeat(255) + "😀";
    const notes = paymentFields({ ...payment, notes: { [text]: text } }, 100).notes;
    expect(Object.keys(notes)[0]).toBe("x".repeat(255));
    expect(Object.values(notes)[0]).toBe("x".repeat(255));
  });

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
});

describe("idempotency", () => {
  const componentModules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(componentSchema, componentModules);

  const pending = { data: { code: "RAZORPAY_IDEMPOTENCY_PENDING" } };

  const order = {
    entity: "order",
    id: "order_fixture",
    amount: 1000,
    currency: "INR",
    status: "created",
  };

  const subscription = {
    entity: "subscription",
    id: "sub_fixture",
    plan_id: "plan_fixture",
    status: "active",
    total_count: 12,
    paid_count: 1,
    remaining_count: 11,
  };

  const createPlanArgs = {
    period: "monthly" as const,
    interval: 1,
    item: { name: "Monthly Plan", amount: 1000, currency: "INR" },
  };

  type CreateOptions = { idempotencyKey: string; testMode?: boolean };

  const planRaw = { entity: "plan", id: "plan_fixture", ...createPlanArgs };

  const resourceCases = [
    {
      resource: "order" as const,
      create: (t: ReturnType<typeof harness>, options: CreateOptions) =>
        t.action(api.orders.create, {
          partialPayment: false,
          amount: 1000,
          currency: "INR",
          ...options,
        }),
      raw: order,
    },
    {
      resource: "plan" as const,
      create: (t: ReturnType<typeof harness>, options: CreateOptions) =>
        t.action(api.plans.create, { ...createPlanArgs, ...options }),
      raw: planRaw,
    },
    {
      resource: "subscription" as const,
      create: (t: ReturnType<typeof harness>, options: CreateOptions) =>
        t.action(api.subscriptions.create, {
          quantity: 1,
          customerNotify: true,
          razorpayPlanId: "plan_fixture",
          totalCount: 12,
          ...options,
        }),
      raw: subscription,
    },
  ];

  beforeEach(() => {
    stubRazorpayEnv({
      keyId: "rzp_test_fixture",
      keySecret: "fixture_secret",
      webhookSecret: "fixture_webhook",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Unexpected HTTP"))),
    );
  });

  afterEach(restoreRazorpayTestState);

  test.each(resourceCases)(
    "$resource claims and completed reads are isolated by mode",
    async ({ create, raw, resource }) => {
      const t = harness();
      const keyed = { idempotencyKey: "fixture_mode_key" };
      const simulated = await create(t, { ...keyed, testMode: true });
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            Response.json({ ...raw, notes: { operatornestIdempotencyKey: keyed.idempotencyKey } }),
          ),
        ),
      );
      const live = await create(t, { ...keyed, testMode: false });
      expect(live).toMatchObject(
        resource === "order" ? { order: { testMode: false } } : { testMode: false },
      );
      expect(await create(t, { ...keyed, testMode: true })).toEqual(simulated);
      expect(await create(t, { ...keyed, testMode: false })).toEqual(live);
      const claims = await t.run((ctx) => ctx.db.query("idempotencyRequests").take(10));
      expect(claims).toHaveLength(2);
      expect(new Set(claims.map((claim) => claim.requestFingerprint)).size).toBe(2);
    },
  );

  test.each(resourceCases)(
    "unresolved $resource reconciliation never repeats POST",
    async ({ create, raw }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(1_000_000);
      const t = harness();
      const fetch = vi.fn((_url: string, init: RequestInit) => {
        if (init.method === "GET")
          return Promise.resolve(Response.json({ entity: "collection", items: [] }));
        if (fetch.mock.calls.length === 1) return Promise.reject(new TypeError("lost response"));
        return Promise.resolve(Response.json(raw));
      });
      vi.stubGlobal("fetch", fetch);
      const keyed = { idempotencyKey: "fixture_unknown_key" };
      await expect(create(t, keyed)).rejects.toMatchObject({
        data: { code: "RAZORPAY_NETWORK_ERROR" },
      });
      vi.setSystemTime(1_660_000);
      await expect(create(t, keyed)).rejects.toMatchObject(pending);
      expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
      expect(await t.run((ctx) => ctx.db.query("idempotencyRequests").first())).toMatchObject({
        status: "pending",
      });
    },
  );
});
