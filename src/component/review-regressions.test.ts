import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hmacSha256Hex } from "../shared/crypto.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const harness = () => convexTest(schema, modules);
const invalid = { data: { code: "RAZORPAY_INVALID_ARGUMENT" } };
const pending = { data: { code: "RAZORPAY_IDEMPOTENCY_PENDING" } };
const rejected = { data: { code: "RAZORPAY_PROVIDER_REJECTED", providerStatus: 400 } };
const ownerNotes = {
  userId: "attacker",
  externalId: "attacker_external",
  operatornestUserId: "attacker",
  operatornestExternalId: "attacker_external",
};
const order = {
  entity: "order",
  id: "order_review",
  amount: 1000,
  currency: "INR",
  status: "created",
};
const payment = {
  entity: "payment",
  id: "pay_review",
  order_id: order.id,
  amount: 1000,
  currency: "INR",
  status: "captured",
};
const subscription = {
  entity: "subscription",
  id: "sub_review",
  plan_id: "plan_review",
  status: "active",
  total_count: 12,
  paid_count: 1,
  remaining_count: 11,
};
const planArgs = {
  period: "monthly" as const,
  interval: 1,
  item: { name: "Review Plan", amount: 1000, currency: "INR" },
};
type CreateOptions = { idempotencyKey: string; testMode?: boolean };
const planRaw = { entity: "plan", id: "plan_review", ...planArgs };
const resourceCases = [
  {
    resource: "order" as const,
    create: (t: ReturnType<typeof harness>, options: CreateOptions) =>
      t.action(api.orders.create, { amount: 1000, currency: "INR", ...options }),
    raw: order,
  },
  {
    resource: "plan" as const,
    create: (t: ReturnType<typeof harness>, options: CreateOptions) =>
      t.action(api.plans.create, { ...planArgs, ...options }),
    raw: planRaw,
  },
  {
    resource: "subscription" as const,
    create: (t: ReturnType<typeof harness>, options: CreateOptions) =>
      t.action(api.subscriptions.create, { planId: "plan_review", totalCount: 12, ...options }),
    raw: subscription,
  },
];

beforeEach(() => {
  stubRazorpayEnv({
    keyId: "rzp_test_review",
    keySecret: "fixture_secret",
    webhookSecret: "fixture_webhook",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Unexpected HTTP"))),
  );
});
afterEach(restoreRazorpayTestState);

async function ingest(
  t: ReturnType<typeof harness>,
  event: string,
  payload: Record<string, unknown>,
  createdAt: number,
  eventId: string,
) {
  const body = JSON.stringify({ entity: "event", event, created_at: createdAt, payload });
  return t.action(api.webhooks.ingest, {
    body,
    signature: await hmacSha256Hex("fixture_webhook", body),
    eventId,
  });
}

test.each([
  {
    read: (t: ReturnType<typeof harness>) => t.action(api.orders.fetch, { orderId: order.id }),
    raw: order,
  },
  {
    read: (t: ReturnType<typeof harness>) =>
      t.action(api.customers.fetch, { customerId: "cust_review" }),
    raw: { entity: "customer", id: "cust_review", name: "Provider Buyer" },
  },
  {
    read: (t: ReturnType<typeof harness>) => t.action(api.plans.fetch, { planId: "plan_review" }),
    raw: planRaw,
  },
  {
    read: (t: ReturnType<typeof harness>) =>
      t.action(api.subscriptions.fetch, { subscriptionId: subscription.id }),
    raw: subscription,
  },
  {
    read: (t: ReturnType<typeof harness>) =>
      t.action(api.refunds.fetch, { refundId: "rfnd_review" }),
    raw: {
      entity: "refund",
      id: "rfnd_review",
      payment_id: payment.id,
      amount: 100,
      currency: "INR",
      status: "processed",
    },
  },
])("finding 1: provider $raw.entity notes cannot assign ownership", async (fixture) => {
  const t = harness();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ ...fixture.raw, notes: ownerNotes }))),
  );
  const row = await fixture.read(t);
  expect(row).not.toHaveProperty("userId");
  expect(row).not.toHaveProperty("externalId");
});

test.each(["operatornestUserId", "OperatorNestExternalId", "OPERATORNESTcustom"])(
  "finding 1: caller namespace %s is rejected in notes and metadata",
  async (key) => {
    const t = harness();
    for (const field of ["notes", "metadata"]) {
      await expect(
        t.action(api.orders.create, {
          amount: 1000,
          currency: "INR",
          [field]: { [key]: "attacker" },
          testMode: true,
        }),
      ).rejects.toMatchObject(invalid);
    }
  },
);

test("finding 1: app ownership survives deceptive notes and propagates to payment and refund", async () => {
  const t = harness();
  const fetch = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(Response.json({ ...order, notes: ownerNotes })),
  );
  vi.stubGlobal("fetch", fetch);
  const created = await t.action(api.orders.create, {
    amount: 1000,
    currency: "INR",
    userId: "owner",
    externalId: "app_external",
    notes: { userId: "attacker", externalId: "attacker_external" },
  });
  expect(created.order).toMatchObject({ userId: "owner", externalId: "app_external" });
  const requestBody = fetch.mock.calls[0]?.[1]?.body;
  if (typeof requestBody !== "string") throw new Error("Expected order request body");
  const body: { notes: Record<string, string> } = JSON.parse(requestBody);
  expect(body.notes).toMatchObject({
    operatornestUserId: "owner",
    operatornestExternalId: "app_external",
  });
  expect(
    await ingest(
      t,
      "payment.captured",
      { payment: { entity: { ...payment, notes: ownerNotes } } },
      1,
      "evt_payment",
    ),
  ).toMatchObject({ status: "processed" });
  const paid = await t.query(api.payments.listForOrder, { orderId: order.id });
  expect(paid).toMatchObject([{ userId: "owner", externalId: "app_external" }]);
  expect(
    await ingest(
      t,
      "refund.processed",
      {
        refund: {
          entity: {
            entity: "refund",
            id: "rfnd_review",
            payment_id: payment.id,
            amount: 100,
            currency: "INR",
            status: "processed",
            notes: ownerNotes,
          },
        },
      },
      2,
      "evt_refund",
    ),
  ).toMatchObject({ status: "processed" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          entity: "refund",
          id: "rfnd_review",
          payment_id: payment.id,
          amount: 100,
          currency: "INR",
          status: "processed",
          notes: ownerNotes,
        }),
      ),
    ),
  );
  expect(await t.action(api.refunds.fetch, { refundId: "rfnd_review" })).toMatchObject({
    userId: "owner",
    externalId: "app_external",
  });
});

test("finding 2: synthetic duplicate receipt never returns another user's order", async () => {
  const t = harness();
  const args = { amount: 1000, currency: "INR", receipt: "review_receipt", testMode: true };
  const first = await t.action(api.orders.create, { ...args, userId: "first" });
  await expect(t.action(api.orders.create, { ...args, userId: "second" })).rejects.toMatchObject(
    rejected,
  );
  expect(
    await t.query(api.orders.get, { orderId: first.order.razorpayId, testMode: true }),
  ).toMatchObject({ userId: "first" });
  expect(await t.run((ctx) => ctx.db.query("orders").take(10))).toHaveLength(1);
});

test.each([
  { stored: undefined, requested: "owner" },
  { stored: "owner", requested: undefined },
  { stored: "owner", requested: "other" },
])(
  "finding 3: keyed getOrCreate requires exact owner equality %j",
  async ({ stored, requested }) => {
    const t = harness();
    const args = {
      name: "Original Buyer",
      email: "original@example.test",
      idempotencyKey: "review_customer",
      testMode: true,
    };
    const first = await t.action(api.customers.create, {
      ...args,
      ...(stored === undefined ? {} : { userId: stored }),
    });
    await expect(
      t.action(api.customers.getOrCreate, {
        ...args,
        name: "Changed Buyer",
        email: "changed@example.test",
        ...(requested === undefined ? {} : { userId: requested }),
      }),
    ).rejects.toMatchObject({ data: { code: "RAZORPAY_CUSTOMER_CONFLICT" } });
    expect(
      await t.action(api.customers.fetch, { customerId: first.razorpayId, testMode: true }),
    ).toMatchObject({ name: "Original Buyer", email: "original@example.test" });
  },
);

test("finding 4: subscription webhook after fetch ignores local clock and orders only webhook times", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(2_000_000);
  const t = harness();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(subscription))),
  );
  await t.action(api.subscriptions.fetch, { subscriptionId: subscription.id });
  expect(
    await ingest(
      t,
      "subscription.paused",
      { subscription: { entity: { ...subscription, status: "paused", quantity: 2 } } },
      100,
      "evt_pause",
    ),
  ).toMatchObject({ status: "processed" });
  expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
    status: "paused",
    quantity: 2,
  });
  await ingest(
    t,
    "subscription.resumed",
    { subscription: { entity: { ...subscription, quantity: 1 } } },
    90,
    "evt_old_resume",
  );
  expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
    status: "paused",
    quantity: 2,
  });
  await ingest(
    t,
    "subscription.resumed",
    { subscription: { entity: { ...subscription, quantity: 3 } } },
    110,
    "evt_resume",
  );
  expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
    status: "active",
    quantity: 3,
  });
});

test("finding 4: subscription fetch always applies current provider state", async () => {
  const t = harness();
  await ingest(
    t,
    "subscription.paused",
    { subscription: { entity: { ...subscription, status: "paused", quantity: 2 } } },
    1000,
    "evt_pause",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ ...subscription, updated_at: 1, quantity: 4 }))),
  );
  expect(
    await t.action(api.subscriptions.fetch, { subscriptionId: subscription.id }),
  ).toMatchObject({ status: "active", quantity: 4 });
});

test.each(resourceCases)(
  "finding 5: $resource claims and completed reads are isolated by mode",
  async ({ create, raw, resource }) => {
    const t = harness();
    const keyed = { idempotencyKey: "review_mode_key" };
    const synthetic = await create(t, { ...keyed, testMode: true });
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
    expect(await create(t, { ...keyed, testMode: true })).toEqual(synthetic);
    expect(await create(t, { ...keyed, testMode: false })).toEqual(live);
    const claims = await t.run((ctx) => ctx.db.query("idempotencyRequests").take(10));
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.fingerprint)).size).toBe(2);
  },
);

test("finding 6: unkeyed HTTP 400 never adopts an unmarked provider order", async () => {
  const t = harness();
  const fetch = vi.fn((_url: string, init: RequestInit) =>
    Promise.resolve(
      init.method === "POST"
        ? Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })
        : Response.json({
            entity: "collection",
            items: [{ ...order, receipt: "review_receipt", notes: {} }],
          }),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    t.action(api.orders.create, { amount: 1000, currency: "INR", receipt: "review_receipt" }),
  ).rejects.toMatchObject(rejected);
  expect(await t.query(api.orders.get, { orderId: order.id })).toBeNull();
});

test.each(resourceCases)(
  "finding 7: unresolved $resource reconciliation never repeats POST",
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
    const keyed = { idempotencyKey: "review_unknown_key" };
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

test("finding 7: reconciliation stops at 2000 records with a pending outcome", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const t = harness();
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    if (init.method === "POST") return Promise.reject(new TypeError("lost response"));
    return Promise.resolve(
      Response.json({
        entity: "collection",
        items: Array.from({ length: 100 }, (_, i) => ({
          ...order,
          id: `order_unrelated_${i}`,
          notes: {},
        })),
      }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const args = { amount: 1000, currency: "INR", idempotencyKey: "review_bound_key" };
  await expect(t.action(api.orders.create, args)).rejects.toMatchObject({
    data: { code: "RAZORPAY_NETWORK_ERROR" },
  });
  vi.setSystemTime(1_660_000);
  await expect(t.action(api.orders.create, args)).rejects.toMatchObject(pending);
  expect(fetch).toHaveBeenCalledTimes(21);
  expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("skip=1900");
});

test("finding 5: claim release and failure affect only the selected mode", async () => {
  const t = harness();
  const keyed = { ...planArgs, idempotencyKey: "review_release_key" };
  const synthetic = await t.action(api.plans.create, { ...keyed, testMode: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })),
    ),
  );
  await expect(t.action(api.plans.create, { ...keyed, testMode: false })).rejects.toMatchObject(
    rejected,
  );
  expect(
    await t.mutation(api.idempotency.release, {
      resource: "plan",
      key: keyed.idempotencyKey,
      testMode: true,
    }),
  ).toBe(false);
  expect(
    await t.mutation(api.idempotency.release, {
      resource: "plan",
      key: keyed.idempotencyKey,
      testMode: false,
    }),
  ).toBe(true);
  expect(await t.action(api.plans.create, { ...keyed, testMode: true })).toEqual(synthetic);
  expect(await t.run((ctx) => ctx.db.query("idempotencyRequests").take(10))).toMatchObject([
    { testMode: true, status: "completed" },
  ]);
});

test("finding 1: payment and refund never inherit opposite-mode parent ownership", async () => {
  const t = harness();
  const synthetic = await t.action(api.orders.create, {
    amount: 1000,
    currency: "INR",
    userId: "synthetic_owner",
    externalId: "synthetic_external",
    testMode: true,
  });
  const rawPayment = { ...payment, order_id: synthetic.order.razorpayId, notes: ownerNotes };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(rawPayment))),
  );
  const livePayment = await t.action(api.payments.fetch, {
    paymentId: payment.id,
    testMode: false,
  });
  expect(livePayment).not.toHaveProperty("userId");
  expect(livePayment).not.toHaveProperty("externalId");
  const syntheticRefund = await t.action(api.orders.create, {
    amount: 1000,
    currency: "INR",
    userId: "synthetic_parent_owner",
    testMode: true,
  });
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  expect(
    await ingest(
      t,
      "payment.captured",
      {
        payment: {
          entity: {
            ...rawPayment,
            id: "pay_parent_owner",
            order_id: syntheticRefund.order.razorpayId,
          },
        },
      },
      1,
      "evt_opposite_parent",
    ),
  ).toMatchObject({ status: "processed" });
  expect(
    await t.query(api.payments.listForOrder, {
      orderId: syntheticRefund.order.razorpayId,
      testMode: true,
    }),
  ).toMatchObject([{ userId: "synthetic_parent_owner" }]);
  vi.stubEnv("RAZORPAY_TEST_MODE", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          entity: "refund",
          id: "rfnd_opposite_parent",
          payment_id: "pay_parent_owner",
          amount: 100,
          currency: "INR",
          status: "processed",
          notes: ownerNotes,
        }),
      ),
    ),
  );
  const refund = await t.action(api.refunds.fetch, { refundId: "rfnd_opposite_parent" });
  expect(refund).not.toHaveProperty("userId");
});

test("finding 2: synthetic receipts reject another key and unkeyed orders allocate independent IDs", async () => {
  const t = harness();
  const args = { amount: 1000, currency: "INR", testMode: true };
  const first = await t.action(api.orders.create, args);
  const second = await t.action(api.orders.create, args);
  expect(first.order.razorpayId).not.toBe(second.order.razorpayId);
  const keyed = {
    ...args,
    receipt: "review_keyed_receipt",
    idempotencyKey: "review_receipt_first",
    userId: "first",
  };
  const created = await t.action(api.orders.create, keyed);
  expect(await t.action(api.orders.create, keyed)).toEqual(created);
  await expect(
    t.action(api.orders.create, {
      ...keyed,
      idempotencyKey: "review_receipt_second",
      userId: "second",
    }),
  ).rejects.toMatchObject(rejected);
  expect(
    await t.mutation(api.idempotency.release, {
      resource: "order",
      key: "review_receipt_second",
      testMode: true,
    }),
  ).toBe(true);
});
