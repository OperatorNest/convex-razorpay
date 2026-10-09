import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { hmacSha256Hex } from "../shared/crypto.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const newHarness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof newHarness>;

const observedAt = 1_567_674_599_000;
const order = (id: string) => ({
  entity: "order",
  id,
  amount: 5000,
  amount_paid: 0,
  amount_due: 5000,
  currency: "INR",
  status: "created",
  attempts: 0,
  notes: {},
  created_at: 1_567_674_599,
});
const payment = (id: string, status = "captured") => ({
  entity: "payment",
  id,
  order_id: "order_mirror",
  amount: 5000,
  currency: "INR",
  status,
  captured: status === "captured",
  amount_refunded: 0,
  created_at: 1_567_674_599,
});
const refund = (id: string, paymentId: string) => ({
  entity: "refund",
  id,
  payment_id: paymentId,
  amount: 100,
  currency: "INR",
  status: "processed",
  created_at: 1_567_674_599,
});
const customer = {
  entity: "customer",
  id: "cust_mirror",
  name: "Mirror",
  email: "mirror@example.test",
  created_at: 1_567_674_599,
};
const plan = {
  entity: "plan",
  id: "plan_mirror",
  period: "monthly",
  interval: 1,
  item: { name: "Pro", amount: 5000, currency: "INR" },
  created_at: 1_567_674_599,
};
const subscription = (id: string, status = "active") => ({
  entity: "subscription",
  id,
  plan_id: "plan_mirror",
  status,
  quantity: 1,
  total_count: 12,
  paid_count: 1,
  remaining_count: 11,
  created_at: 1_567_674_599,
});

function mismatch(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ data: { code: "RAZORPAY_MODE_MISMATCH" } });
}
function notFound(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
}

async function mirrorLiveRows(t: Harness) {
  await t.mutation(internal.mutations.putOrder, { raw: order("order_mirror"), observedAt });
  await t.mutation(internal.mutations.putPayment, { raw: payment("pay_live"), observedAt });
  await t.mutation(internal.mutations.putPayment, {
    raw: payment("pay_live_authorized", "authorized"),
    observedAt,
  });
  await t.mutation(internal.mutations.putRefund, {
    raw: refund("rfnd_live", "pay_live"),
    observedAt,
  });
  await t.mutation(internal.mutations.putCustomer, { raw: customer, observedAt });
  await t.mutation(internal.mutations.putPlan, { raw: plan, observedAt });
  await t.mutation(internal.mutations.putSubscription, {
    raw: subscription("sub_live"),
    observedAt,
  });
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

const paymentRow = (t: Harness, id: string) =>
  t.run((ctx) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .first(),
  );

test("a fake refund can never raise amountRefunded on a live-mirrored payment", async () => {
  const t = convexTest(schema, modules);
  await mirrorLiveRows(t);
  await mismatch(
    t.action(api.refunds.create, {
      paymentId: "pay_live",
      amount: 1000,
      idempotencyKey: "fake_refund_on_live",
      testMode: true,
    }),
  );
  expect(await paymentRow(t, "pay_live")).toMatchObject({
    amountRefunded: 0,
    status: "captured",
    testMode: false,
  });
  expect(await t.run((ctx) => ctx.db.query("refunds").collect())).toHaveLength(1);
  // The mutation guard holds even if the action's checks were bypassed.
  await mismatch(
    t.mutation(internal.mutations.putTestRefund, {
      refundId: "rfnd_test_forced",
      paymentId: "pay_live",
      amount: 1000,
      notes: {},
      idempotencyKey: "forced_refund_key",
      requestFingerprint: "fingerprint",
    }),
  );
  await notFound(
    t.action(api.refunds.create, {
      paymentId: "pay_absent",
      amount: 1000,
      idempotencyKey: "fake_refund_on_nothing",
      testMode: true,
    }),
  );
});

test("a test-mode capture, fetch or list never reads or rewrites live rows", async () => {
  const t = convexTest(schema, modules);
  await mirrorLiveRows(t);
  await mismatch(t.action(api.orders.fetch, { orderId: "order_mirror", testMode: true }));
  await mismatch(t.action(api.orders.fetchPayments, { orderId: "order_mirror", testMode: true }));
  await mismatch(t.action(api.payments.fetch, { paymentId: "pay_live", testMode: true }));
  await mismatch(
    t.action(api.payments.capture, {
      paymentId: "pay_live_authorized",
      amount: 5000,
      currency: "INR",
      testMode: true,
    }),
  );
  await mismatch(t.action(api.refunds.fetch, { refundId: "rfnd_live", testMode: true }));
  await mismatch(t.action(api.customers.fetch, { customerId: "cust_mirror", testMode: true }));
  await mismatch(
    t.action(api.customers.edit, { customerId: "cust_mirror", name: "Edited", testMode: true }),
  );
  await mismatch(t.action(api.plans.fetch, { planId: "plan_mirror", testMode: true }));
  await mismatch(t.action(api.subscriptions.fetch, { subscriptionId: "sub_live", testMode: true }));
  for (const change of [
    api.subscriptions.cancel,
    api.subscriptions.pause,
    api.subscriptions.resume,
  ]) {
    await mismatch(t.action(change, { subscriptionId: "sub_live", testMode: true }));
  }
  await mismatch(
    t.action(api.subscriptions.update, { subscriptionId: "sub_live", quantity: 3, testMode: true }),
  );
  expect(await paymentRow(t, "pay_live_authorized")).toMatchObject({ status: "authorized" });
  expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
    status: "active",
    quantity: 1,
  });
  expect(await t.run((ctx) => ctx.db.query("customers").first())).toMatchObject({
    name: "Mirror",
  });
  // Mode-scoped listings: live rows never appear in test mode.
  expect(await t.action(api.payments.list, { testMode: true })).toEqual([]);
  expect(await t.action(api.plans.list, { testMode: true })).toEqual([]);
  await t.mutation(internal.mutations.putPayment, {
    raw: payment("pay_test_row"),
    observedAt,
    testMode: true,
  });
  await t.mutation(internal.mutations.putPlan, {
    raw: { ...plan, id: "plan_test_row" },
    observedAt,
    testMode: true,
  });
  expect(
    (await t.action(api.payments.list, { testMode: true })).map((row) => row.razorpayId),
  ).toEqual(["pay_test_row"]);
  expect((await t.action(api.plans.list, { testMode: true })).map((row) => row.razorpayId)).toEqual(
    ["plan_test_row"],
  );
});

test("missing local rows throw RAZORPAY_NOT_FOUND on every test-mode path", async () => {
  const t = convexTest(schema, modules);
  const common = { testMode: true } as const;
  await notFound(t.action(api.orders.fetch, { orderId: "order_none", ...common }));
  await notFound(t.action(api.payments.fetch, { paymentId: "pay_none", ...common }));
  await notFound(
    t.action(api.payments.capture, {
      paymentId: "pay_none",
      amount: 100,
      currency: "INR",
      ...common,
    }),
  );
  await notFound(t.action(api.refunds.fetch, { refundId: "rfnd_none", ...common }));
  await notFound(t.action(api.customers.fetch, { customerId: "cust_none", ...common }));
  await notFound(
    t.action(api.customers.edit, { customerId: "cust_none", name: "Nobody", ...common }),
  );
  await notFound(t.action(api.plans.fetch, { planId: "plan_none", ...common }));
  await notFound(t.action(api.subscriptions.fetch, { subscriptionId: "sub_none", ...common }));
  await notFound(t.action(api.subscriptions.cancel, { subscriptionId: "sub_none", ...common }));
  await notFound(
    t.mutation(internal.mutations.markVerified, { paymentId: "pay_none", testMode: false }),
  );
});

test("a completed claim whose mirror vanished is RAZORPAY_NOT_FOUND", async () => {
  const t = convexTest(schema, modules);
  const cases = [
    {
      table: "orders" as const,
      create: () =>
        t.action(api.orders.create, {
          amount: 5000,
          currency: "INR",
          idempotencyKey: "orphan_order_key",
          testMode: true,
        }),
    },
    {
      table: "plans" as const,
      create: () =>
        t.action(api.plans.create, {
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 5000, currency: "INR" },
          idempotencyKey: "orphan_plan_key",
          testMode: true,
        }),
    },
    {
      table: "subscriptions" as const,
      create: () =>
        t.action(api.subscriptions.create, {
          planId: "plan_x",
          totalCount: 3,
          idempotencyKey: "orphan_subscription_key",
          testMode: true,
        }),
    },
  ];
  for (const { table, create } of cases) {
    await create();
    // Remove the mirror but keep the completed claim.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(table, row._id);
    });
    await notFound(create());
  }
});

test("every test-mode create tags its mirror and uses a long digest id", async () => {
  const t = convexTest(schema, modules);
  const created = await t.action(api.orders.create, {
    amount: 5000,
    currency: "INR",
    idempotencyKey: "tagged_order_key",
    testMode: true,
  });
  expect(created.order).toMatchObject({ testMode: true });
  expect(created.order.razorpayId).toMatch(/^order_test_[0-9a-f]{20}$/);
  const keyless = await t.action(api.orders.create, {
    amount: 5000,
    currency: "INR",
    testMode: true,
  });
  const keylessAgain = await t.action(api.orders.create, {
    amount: 5000,
    currency: "INR",
    testMode: true,
  });
  expect(keyless.order.razorpayId).not.toBe(keylessAgain.order.razorpayId);
  const customerRow = await t.action(api.customers.create, {
    name: "Tagged",
    email: "tagged@example.test",
    idempotencyKey: "tagged_customer_key",
    testMode: true,
  });
  const planRow = await t.action(api.plans.create, {
    period: "monthly",
    interval: 1,
    item: { name: "Tagged", amount: 5000, currency: "INR" },
    testMode: true,
  });
  const subscriptionRow = await t.action(api.subscriptions.create, {
    planId: planRow.razorpayId,
    totalCount: 3,
    testMode: true,
  });
  expect([customerRow.testMode, planRow.testMode, subscriptionRow.testMode]).toEqual([
    true,
    true,
    true,
  ]);
  expect(subscriptionRow.createdThroughComponent).toBe(true);
  await t.mutation(internal.mutations.putPayment, {
    raw: payment("pay_to_refund"),
    observedAt,
    testMode: true,
  });
  const refundRow = await t.action(api.refunds.create, {
    paymentId: "pay_to_refund",
    amount: 100,
    receipt: "tagged-refund",
    testMode: true,
  });
  expect(refundRow).toMatchObject({ testMode: true });
  expect(refundRow.razorpayId).toMatch(/^rfnd_test_[0-9a-f]{20}$/);
  expect(await paymentRow(t, "pay_to_refund")).toMatchObject({
    testMode: true,
    amountRefunded: 100,
  });
});

const webhookSecret = "whsec_mode_tag";
async function ingest(t: Harness, eventId: string, event: string, payload: unknown) {
  const body = JSON.stringify({ entity: "event", event, created_at: 1_567_674_600, payload });
  return t.action(api.webhooks.ingest, {
    body,
    signature: await hmacSha256Hex(webhookSecret, body),
    eventId,
  });
}

async function ingestAll(t: Harness, suffix: string) {
  const entities = (id: string) => ({
    order: order(`order_${id}`),
    payment: { ...payment(`pay_${id}`), order_id: `order_${id}` },
  });
  const { order: o, payment: p } = entities(`wh_${suffix}`);
  await ingest(t, `evt_order_${suffix}`, "order.paid", {
    order: { entity: { ...o, status: "paid", amount_paid: 5000, amount_due: 0 } },
    payment: { entity: p },
  });
  const refundPayment = { ...payment(`pay_refund_${suffix}`), order_id: undefined };
  await ingest(t, `evt_refund_${suffix}`, "refund.processed", {
    refund: { entity: refund(`rfnd_wh_${suffix}`, `pay_refund_${suffix}`) },
    payment: { entity: refundPayment },
  });
  await ingest(t, `evt_sub_${suffix}`, "subscription.charged", {
    subscription: { entity: subscription(`sub_wh_${suffix}`) },
    payment: { entity: { ...payment(`pay_sub_${suffix}`), order_id: undefined } },
  });
}

test("webhook rows are live unless the deployment runs in test mode", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
  const t = convexTest(schema, modules);
  await ingestAll(t, "live");
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  await ingestAll(t, "test");
  const tags = async (table: "orders" | "payments" | "refunds" | "subscriptions") =>
    Object.fromEntries(
      (await t.run((ctx) => ctx.db.query(table).collect())).map((row) => [
        row.razorpayId,
        row.testMode,
      ]),
    );
  expect(await tags("orders")).toEqual({ order_wh_live: false, order_wh_test: true });
  expect(await tags("refunds")).toEqual({ rfnd_wh_live: false, rfnd_wh_test: true });
  expect(await tags("subscriptions")).toEqual({ sub_wh_live: false, sub_wh_test: true });
  expect(await tags("payments")).toEqual({
    pay_wh_live: false,
    pay_wh_test: true,
    pay_refund_live: false,
    pay_refund_test: true,
    pay_sub_live: false,
    pay_sub_test: true,
  });
});

test("a webhook never re-tags an existing mirrored row", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
  const t = convexTest(schema, modules);
  await t.mutation(internal.mutations.putPayment, { raw: payment("pay_retag"), observedAt });
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  await ingest(t, "evt_retag", "payment.captured", {
    payment: { entity: { ...payment("pay_retag"), created_at: 1_567_674_700 } },
  });
  expect(await paymentRow(t, "pay_retag")).toMatchObject({ testMode: false });
});

test("testMode is tri-state: explicit false overrides RAZORPAY_TEST_MODE, undefined defers to it", async () => {
  const t = convexTest(schema, modules);
  const args = { amount: 5000, currency: "INR" };
  const providerOrder = {
    ...order("order_from_provider"),
    notes: [],
  };
  const fetch = vi.fn(async () => Response.json(providerOrder));
  vi.stubGlobal("fetch", fetch);

  // Env true: undefined and true use test mode; explicit false goes to the provider.
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  expect((await t.action(api.orders.create, args)).order.testMode).toBe(true);
  expect((await t.action(api.orders.create, { ...args, testMode: true })).order.testMode).toBe(
    true,
  );
  expect(fetch).not.toHaveBeenCalled();
  expect((await t.action(api.orders.create, { ...args, testMode: false })).order).toMatchObject({
    razorpayId: "order_from_provider",
    testMode: false,
  });
  expect(fetch).toHaveBeenCalledTimes(1);

  // Env true without credentials: explicit false fails closed instead of silently faking.
  stubRazorpayEnv({ testMode: "true" });
  await expect(t.action(api.orders.create, { ...args, testMode: false })).rejects.toMatchObject({
    data: { code: "RAZORPAY_NOT_CONFIGURED" },
  });
  expect((await t.action(api.orders.create, args)).order.testMode).toBe(true);

  // Env unset: explicit true enables test mode, undefined requires credentials.
  stubRazorpayEnv({});
  expect((await t.action(api.orders.create, { ...args, testMode: true })).order.testMode).toBe(
    true,
  );
  await expect(t.action(api.orders.create, args)).rejects.toMatchObject({
    data: { code: "RAZORPAY_NOT_CONFIGURED" },
  });

  // A live key still refuses test mode however it was requested.
  stubRazorpayEnv({ keyId: "rzp_live_fixture", keySecret: "fake_secret", testMode: "true" });
  await expect(t.action(api.orders.create, args)).rejects.toMatchObject({
    data: { code: "RAZORPAY_LIVE_KEY_TEST_MODE" },
  });
});

test("receipts are printable ASCII for orders and refunds", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.mutations.putPayment, {
    raw: payment("pay_receipt"),
    observedAt,
    testMode: true,
  });
  for (const receipt of ["", "caf\u00e9", "line\nbreak", "x".repeat(41)]) {
    await expect(
      t.action(api.refunds.create, {
        paymentId: "pay_receipt",
        amount: 100,
        receipt,
        idempotencyKey: "receipt_validation_key",
        testMode: true,
      }),
    ).rejects.toMatchObject({
      data: { code: "RAZORPAY_INVALID_ARGUMENT", message: "Invalid refund receipt" },
    });
    await expect(
      t.action(api.orders.create, { amount: 5000, currency: "INR", receipt, testMode: true }),
    ).rejects.toMatchObject({
      data: { code: "RAZORPAY_INVALID_ARGUMENT", message: "Invalid order receipt" },
    });
  }
  expect(
    await t.action(api.refunds.create, {
      paymentId: "pay_receipt",
      amount: 100,
      receipt: "Refund #1 (ok)",
      testMode: true,
    }),
  ).toMatchObject({ receipt: "Refund #1 (ok)" });
});
