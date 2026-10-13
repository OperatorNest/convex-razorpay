import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { computeHmacSha256Hex } from "../shared/crypto.js";

const modules = import.meta.glob("./**/*.ts");

const webhookFixture = "whsec_runtime_fixture";
const checkoutFixture = "EnLs21M47BllR3X8PSFtjtbd";

beforeEach(() => {
  stubRazorpayEnv({});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected provider HTTP");
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreRazorpayTestState();
});

test("idempotency retention deletes old failed claims and preserves every completed or pending claim", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  const t = convexTest(schema, modules);
  const now = Date.now();
  const old = now - 31 * 24 * 60 * 60_000;
  await t.run(async (ctx) => {
    for (let i = 0; i < 21; i++) {
      await ctx.db.insert("idempotencyRequests", {
        testMode: false,
        resource: "plan",
        idempotencyKey: `old-completed-${i}`,
        requestFingerprint: `fingerprint-${i}`,
        status: "completed",
        createdAt: old,
        settledAt: old,
      });
    }
    await ctx.db.insert("idempotencyRequests", {
      testMode: false,
      resource: "subscription",
      idempotencyKey: "old-failed",
      requestFingerprint: "failed",
      status: "failed",
      createdAt: old,
      settledAt: old,
    });
    await ctx.db.insert("idempotencyRequests", {
      testMode: false,
      resource: "plan",
      idempotencyKey: "old-pending",
      requestFingerprint: "pending",
      status: "pending",
      createdAt: old,
    });
    await ctx.db.insert("idempotencyRequests", {
      testMode: false,
      resource: "plan",
      idempotencyKey: "recent-completed",
      requestFingerprint: "recent",
      status: "completed",
      createdAt: old,
      settledAt: now,
    });
  });
  const remaining = await t.run((ctx) => ctx.db.query("idempotencyRequests").take(100));
  expect(remaining).toHaveLength(24);
  expect(remaining.map((row) => row.idempotencyKey)).toEqual(
    expect.arrayContaining(["old-pending", "recent-completed"]),
  );
  const retained = await t.run((ctx) => ctx.db.query("idempotencyRequests").take(100));
  expect(retained).toEqual(remaining);
  expect(retained.some((row) => row.idempotencyKey === "old-failed")).toBe(true);
});

test("list returns newest indexed payments first", async () => {
  const t = convexTest(schema, modules);
  for (const [id, createdAt] of [
    ["pay_oldest", 1_567_674_599],
    ["pay_newest", 1_567_674_600],
  ] as const) {
    await t.mutation(internal.mutations.putPayment, {
      raw: {
        id,
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "captured",
        captured: true,
        order_id: "order_listed",
        created_at: createdAt,
      },
      observedAt: 1_567_674_600_000,
    });
  }
  const payments = await t
    .query(api.payments.list, {
      paginationOpts: { numItems: 100, cursor: null },
      razorpayOrderId: "order_listed",
    })
    .then(({ page }) => page);
  expect(payments.map((row) => row.razorpayPaymentId)).toEqual(["pay_newest", "pay_oldest"]);
});

function payment(id: string, status: string, amount = 5000) {
  return {
    entity: "payment",
    id,
    order_id: "order_fixture",
    amount,
    currency: "INR",
    status,
    captured: status === "captured" || status === "refunded",
    amount_refunded: 0,
    created_at: 1_567_674_500,
    notes: [],
  };
}

function subscription(status: string) {
  return {
    entity: "subscription",
    id: "sub_transitions",
    plan_id: "plan_fixture",
    status,
    quantity: 1,
    total_count: 12,
    paid_count: 1,
    remaining_count: 11,
    created_at: 1_567_674_500,
    notes: [],
  };
}

function envelope(event: string, entityKind: string, entity: unknown, createdAt: number) {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_fixture",
    event,
    payload: { [entityKind]: { entity } },
    created_at: createdAt,
  });
}

async function ingest(t: ReturnType<typeof convexTest>, eventId: string, body: string) {
  return t.action(api.webhooks.ingest, {
    eventId,
    body,
    signature: await computeHmacSha256Hex(webhookFixture, body),
  });
}

test("webhook dedupes and an older authorized payment cannot undo capture", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  const captured = envelope(
    "payment.captured",
    "payment",
    payment("pay_monotonic", "captured"),
    1_567_674_599,
  );
  const authorized = envelope(
    "payment.authorized",
    "payment",
    payment("pay_monotonic", "authorized"),
    1_567_674_500,
  );
  expect((await ingest(t, "evt_capture", captured)).status).toBe("processed");
  expect((await ingest(t, "evt_capture", captured)).status).toBe("duplicate");
  expect((await ingest(t, "evt_capture_different_header", captured)).status).toBe("duplicate");
  expect((await ingest(t, "", captured)).status).toBe("duplicate");
  expect((await ingest(t, "evt_authorized", authorized)).status).toBe("processed");
  const mirror = await t.run((ctx) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", "pay_monotonic"))
      .unique(),
  );
  expect(mirror?.status).toBe("captured");
  expect(await t.run((ctx) => ctx.db.query("webhookEvents").take(10))).toHaveLength(2);
});

test("a webhook with an older provider timestamp advances a fetched payment", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "secret_fixture");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  vi.spyOn(Date, "now").mockReturnValue(10_500);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payment("pay_clock", "authorized")))),
  );
  const t = convexTest(schema, modules);
  expect(
    (await t.action(api.payments.fetch, { razorpayPaymentId: "pay_clock", testMode: false }))
      .status,
  ).toBe("authorized");
  const body = envelope("payment.captured", "payment", payment("pay_clock", "captured"), 10);
  expect((await ingest(t, "evt_clock_capture", body)).status).toBe("processed");
  const mirror = await t.run((ctx) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", "pay_clock"))
      .unique(),
  );
  expect(mirror?.status).toBe("captured");
});

test("subscription authenticated advances to active within the same second", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  const authenticated = envelope(
    "subscription.authenticated",
    "subscription",
    subscription("authenticated"),
    10,
  );
  const active = envelope("subscription.activated", "subscription", subscription("active"), 10);
  expect((await ingest(t, "evt_sub_authenticated", authenticated)).status).toBe("processed");
  expect((await ingest(t, "evt_sub_active", active)).status).toBe("processed");
  const mirror = await t.run((ctx) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_razorpaySubscriptionId", (q) =>
        q.eq("razorpaySubscriptionId", "sub_transitions"),
      )
      .unique(),
  );
  expect(mirror?.status).toBe("active");
});

test("unknown payment statuses are preserved without changing known entity state", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  expect(
    (
      await ingest(
        t,
        "evt_known_status",
        envelope("payment.authorized", "payment", payment("pay_unknown_status", "authorized"), 10),
      )
    ).status,
  ).toBe("processed");
  const unknown = { ...payment("pay_unknown_status", "future_status"), captured: false };
  expect(
    (await ingest(t, "evt_future_status", envelope("payment.captured", "payment", unknown, 11)))
      .status,
  ).toBe("processed");
  const mirror = await t.run((ctx) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", "pay_unknown_status"))
      .unique(),
  );
  expect(mirror).toMatchObject({ status: "authorized", rawStatus: "future_status" });
});

test("a secondary apply failure rolls back the primary paid-order write", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  const existing = payment("pay_secondary_conflict", "authorized", 5000);
  await t.mutation(internal.mutations.putPayment, { raw: existing, observedAt: 10_000 });
  const body = JSON.stringify({
    entity: "event",
    event: "order.paid",
    created_at: 10,
    payload: {
      order: {
        entity: {
          entity: "order",
          id: "order_secondary_rollback",
          amount: 5000,
          amount_paid: 5000,
          amount_due: 0,
          currency: "INR",
          status: "paid",
          attempts: 1,
          notes: {},
          created_at: 10,
        },
      },
      payment: {
        entity: {
          ...existing,
          order_id: "order_secondary_rollback",
          amount: 4000,
        },
      },
    },
  });
  expect((await ingest(t, "evt_secondary_rollback", body)).status).toBe("failed");
  expect(await t.query(internal.lookup.order, { id: "order_secondary_rollback" })).toBeNull();
  const paymentMirror = await t.run((ctx) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", "pay_secondary_conflict"))
      .unique(),
  );
  expect(paymentMirror?.amount).toBe(5000);
});

test("signed event with a different valid status is accepted", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  const body = envelope(
    "payment.captured",
    "payment",
    payment("pay_wrong_status", "authorized"),
    1_567_674_599,
  );
  expect((await ingest(t, "evt_wrong_status", body)).status).toBe("processed");
  const mirror = await t.run((ctx) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", "pay_wrong_status"))
      .unique(),
  );
  expect(mirror?.status).toBe("authorized");
});

test("signed malformed webhook is recorded as failed without raw body", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  const body = "not-json";
  expect((await ingest(t, "evt_malformed_json", body)).status).toBe("failed");
  const events = await t.run((ctx) => ctx.db.query("webhookEvents").take(2));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    eventId: "evt_malformed_json",
    status: "failed",
    errorCode: "RAZORPAY_MALFORMED_WEBHOOK",
  });
  expect(events[0]).not.toHaveProperty("raw");
});

test("subscription webhooks recover from halted but cannot revive a terminal state", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookFixture);
  const t = convexTest(schema, modules);
  for (const [status, expected, timestamp] of [
    ["halted", "halted", 1],
    ["active", "active", 2],
    ["cancelled", "cancelled", 3],
    ["active", "cancelled", 4],
  ] as const) {
    const body = envelope("subscription.updated", "subscription", subscription(status), timestamp);
    expect((await ingest(t, `evt_subscription_${timestamp}`, body)).status).toBe("processed");
    expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
      status: expected,
    });
  }
});

test("test refunds update captured balance once and reject over-refund", async () => {
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  const t = convexTest(schema, modules);
  await t.mutation(internal.mutations.putPayment, {
    raw: payment("pay_refundable", "authorized"),
    observedAt: 1000,
    testMode: true,
  });
  await t.action(api.payments.capture, {
    razorpayPaymentId: "pay_refundable",
    amount: 5000,
    currency: "INR",
    testMode: true,
  });
  const firstArgs = {
    razorpayPaymentId: "pay_refundable",
    amount: 2000,
    idempotencyKey: "first_refund_key",
    testMode: true,
  };
  const first = await t.action(api.refunds.create, { speed: "normal", ...firstArgs });
  expect(
    (await t.action(api.refunds.create, { speed: "normal", ...firstArgs })).razorpayRefundId,
  ).toBe(first.razorpayRefundId);
  await t.action(api.refunds.create, {
    speed: "normal",
    razorpayPaymentId: "pay_refundable",
    amount: 3000,
    idempotencyKey: "second_refund_key",
    testMode: true,
  });
  await expect(
    t.action(api.refunds.create, {
      speed: "normal",
      razorpayPaymentId: "pay_refundable",
      amount: 1,
      idempotencyKey: "third_refund_key",
      testMode: true,
    }),
  ).rejects.toThrow("An argument is invalid, missing or out of bounds.");
  const mirror = await t
    .query(api.payments.list, {
      paginationOpts: { numItems: 100, cursor: null },
      razorpayOrderId: "order_fixture",
      testMode: true,
    })
    .then(({ page }) => page);
  expect(mirror[0]).toMatchObject({
    status: "refunded",
    amountRefunded: 5000,
    refundStatus: "full",
  });
});

test("checkout signature verifies identity and records authorization without capture", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", checkoutFixture);
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...payment("pay_IH4NVgf4wjLNgR", "authorized"),
            order_id: "order_IluGWxBm9U8zJ8",
          }),
        ),
    ),
  );
  await t.mutation(internal.mutations.putOrder, {
    raw: {
      entity: "order",
      id: "order_IluGWxBm9U8zJ8",
      amount: 5000,
      amount_paid: 0,
      amount_due: 5000,
      currency: "INR",
      status: "created",
      attempts: 0,
      notes: {},
      created_at: 1_567_674_500,
    },
    observedAt: Date.now(),
    createdThroughComponent: true,
  });
  const signed = {
    razorpayOrderId: "order_IluGWxBm9U8zJ8",
    razorpayPaymentId: "pay_IH4NVgf4wjLNgR",
    signature: "efeceae0e93bd41a7096ecce1d1cf69979db6c1d91a8116a21965faa42177a62",
  };
  await expect(
    t.action(api.orders.verifyCheckout, { ...signed, signature: "0".repeat(64) }),
  ).rejects.toThrow("An argument is invalid, missing or out of bounds.");
  const result = await t.action(api.orders.verifyCheckout, signed);
  expect(result).toMatchObject({ verified: true, status: "authorized", captured: false });
});

test("cleanup only removes old webhook events in the requested batch", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        ctx.db.insert("webhookEvents", {
          eventId: `evt_old_${i}`,
          event: "payment.captured",
          providerCreatedAt: now - 40 * 86400_000,
          receivedAt: now - 40 * 86400_000,
          status: "processed",
          bodyHash: "hash",
        }),
      ),
    );
    await ctx.db.insert("webhookEvents", {
      eventId: "evt_new",
      event: "payment.captured",
      providerCreatedAt: now,
      receivedAt: now,
      status: "processed",
      bodyHash: "hash",
    });
  });
  expect(
    await t.mutation(api.webhooks.cleanup, { before: now - 30 * 86400_000, batchSize: 2 }),
  ).toBe(2);
  expect(
    await t.mutation(api.webhooks.cleanup, { before: now - 30 * 86400_000, batchSize: 2 }),
  ).toBe(1);
  expect(
    (await t.run((ctx) => ctx.db.query("webhookEvents").take(10))).map((row) => row.eventId),
  ).toEqual(["evt_new"]);
});

test("public cleanup cannot delete events from the last 24 hours", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const eventId = await t.run((ctx) =>
    ctx.db.insert("webhookEvents", {
      eventId: "evt_recent_cleanup_guard",
      event: "payment.captured",
      providerCreatedAt: now,
      receivedAt: now - 23 * 60 * 60 * 1000,
      status: "processed",
      bodyHash: "cleanup-guard",
    }),
  );
  expect(await t.mutation(api.webhooks.cleanup, { before: now + 60_000, batchSize: 20 })).toBe(0);
  expect(await t.run((ctx) => ctx.db.get("webhookEvents", eventId))).not.toBeNull();
});

test("test mode customer, plan, and subscription lifecycle stays local and linked", async () => {
  const t = convexTest(schema, modules);
  const customerArgs = {
    name: "Alice Example",
    email: "alice@example.test",
    userId: "user_alice",
    testMode: true,
  };
  const customer = await t.action(api.customers.getOrCreate, customerArgs);
  expect((await t.action(api.customers.getOrCreate, customerArgs)).razorpayCustomerId).toBe(
    customer.razorpayCustomerId,
  );
  expect(
    (await t.query(api.customers.get, { userId: "user_alice", testMode: true }))
      ?.razorpayCustomerId,
  ).toBe(customer.razorpayCustomerId);
  expect(
    (
      await t.action(api.customers.edit, {
        razorpayCustomerId: customer.razorpayCustomerId,
        name: "Alice Updated",
        testMode: true,
      })
    ).name,
  ).toBe("Alice Updated");
  expect(
    (
      await t.action(api.customers.fetch, {
        razorpayCustomerId: customer.razorpayCustomerId,
        testMode: true,
      })
    ).name,
  ).toBe("Alice Updated");
  const plan = await t.action(api.plans.create, {
    period: "monthly",
    interval: 1,
    item: { name: "Pro", amount: 69900, currency: "INR" },
    idempotencyKey: "plan_key_alice",
    testMode: true,
  });
  expect(
    (await t.action(api.plans.fetch, { razorpayPlanId: plan.razorpayPlanId, testMode: true }))
      .razorpayPlanId,
  ).toBe(plan.razorpayPlanId);
  expect(
    (await t.action(api.plans.fetchAll, { testMode: true })).map((item) => item.razorpayPlanId),
  ).toContain(plan.razorpayPlanId);
  const sub = await t.action(api.subscriptions.create, {
    quantity: 1,
    customerNotify: true,
    razorpayPlanId: plan.razorpayPlanId,
    totalCount: 12,
    userId: "user_alice",
    idempotencyKey: "subscription_key_alice",
    testMode: true,
  });
  expect(
    (
      await t.action(api.subscriptions.fetch, {
        razorpaySubscriptionId: sub.razorpaySubscriptionId,
        testMode: true,
      })
    ).status,
  ).toBe("created");
  expect(
    (await t.query(api.subscriptions.get, { userId: "user_alice", testMode: true }))
      ?.razorpaySubscriptionId,
  ).toBe(sub.razorpaySubscriptionId);
  expect(
    await t
      .query(api.subscriptions.list, {
        paginationOpts: { numItems: 100, cursor: null },
        userId: "user_alice",
        testMode: true,
      })
      .then(({ page }) => page),
  ).toHaveLength(1);
  await t.mutation(internal.mutations.putSubscription, {
    raw: {
      ...subscription("active"),
      id: sub.razorpaySubscriptionId,
      plan_id: plan.razorpayPlanId,
      total_count: 12,
      paid_count: 0,
      remaining_count: 12,
    },
    observedAt: sub.providerUpdatedAt,
    testMode: true,
  });
  const paused = await t.action(api.subscriptions.pause, {
    razorpaySubscriptionId: sub.razorpaySubscriptionId,
    testMode: true,
  });
  expect(paused.status).toBe("paused");
  const resumed = await t.action(api.subscriptions.resume, {
    razorpaySubscriptionId: sub.razorpaySubscriptionId,
    testMode: true,
  });
  expect(resumed.status).toBe("active");
  const updated = await t.action(api.subscriptions.update, {
    scheduleChangeAt: "now",
    razorpaySubscriptionId: sub.razorpaySubscriptionId,
    quantity: 2,
    remainingCount: 13,
    testMode: true,
  });
  expect(updated).toMatchObject({ quantity: 2, remainingCount: 13 });
  const scheduled = await t.action(api.subscriptions.cancelAtCycleEnd, {
    razorpaySubscriptionId: sub.razorpaySubscriptionId,

    testMode: true,
  });
  expect(scheduled).toMatchObject({ status: "active", hasScheduledChanges: true });
  expect(
    (
      await t.action(api.subscriptions.cancel, {
        razorpaySubscriptionId: sub.razorpaySubscriptionId,
        testMode: true,
      })
    ).status,
  ).toBe("cancelled");
});

test("subscription checkout signature links a provider payment without subscription_id", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", checkoutFixture);
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/subscriptions/")
              ? {
                  entity: "subscription",
                  id: "sub_ID6MOhgkcoHjE7",
                  plan_id: "plan_fixture",
                  status: "authenticated",
                  quantity: 1,
                  total_count: 12,
                  paid_count: 0,
                  remaining_count: 12,
                  created_at: 1_567_674_500,
                  notes: [],
                }
              : payment("pay_IH4NVgf4wjLNgR", "authorized"),
          ),
        ),
    ),
  );
  await t.mutation(internal.mutations.putSubscription, {
    raw: {
      entity: "subscription",
      id: "sub_ID6MOhgkcoHjE7",
      plan_id: "plan_fixture",
      status: "created",
      quantity: 1,
      total_count: 12,
      paid_count: 0,
      remaining_count: 12,
      created_at: 1_567_674_500,
      notes: [],
    },
    observedAt: 1_567_674_500_000,
    createdThroughComponent: true,
  });
  const verified = await t.action(api.subscriptions.verifyCheckout, {
    razorpaySubscriptionId: "sub_ID6MOhgkcoHjE7",
    razorpayPaymentId: "pay_IH4NVgf4wjLNgR",
    signature: "460acecf881994c1fb48d8bddb43b971181207b8d9403687aaeacd5f4433404b",
  });
  expect(verified).toMatchObject({
    verified: true,
    razorpaySubscriptionId: "sub_ID6MOhgkcoHjE7",
    captured: false,
  });
});
