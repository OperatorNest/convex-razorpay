import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import { computeHmacSha256Hex } from "../shared/crypto.js";
import {
  restoreRazorpayTestState,
  stubRazorpayEnv,
  stubLiveRazorpayEnv,
  stubSimulatedRazorpayEnv,
  expectRazorpayError,
  expectRazorpayErrorDetails,
} from "../test-helpers.js";

describe("orders", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

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

  test("partial-payment checkout accepts a smaller authenticated payment", async () => {
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" });
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
      raw: { ...payment, order_id: order.razorpayOrderId },
      observedAt: 100,
      testMode: true,
    });
    const row = await t.action(api.orders.verifyCheckout, {
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: payment.id,
      signature: await computeHmacSha256Hex(
        "fixture_secret",
        `${order.razorpayOrderId}|${payment.id}`,
      ),
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
    await expectRazorpayError(
      t.action(api.orders.create, {
        amount: 1000,
        currency: "INR",
        receipt: "receipt",
        notes: { sku: "new" },
        partialPayment: true,
      }),
      "RAZORPAY_PROVIDER_ERROR",
    );
  });

  test("order amounts below 100 are accepted and non-positive amounts are rejected", async () => {
    stubRazorpayEnv({ keySecret: "fixture_secret" });
    const t = harness();
    const create = (amount: number) =>
      t.action(api.orders.create, {
        partialPayment: false,
        amount,
        currency: "INR",
        testMode: true,
      });
    expect((await create(1)).order).toMatchObject({ amount: 1 });
    expect((await create(99)).order).toMatchObject({ amount: 99 });
    await expectRazorpayError(create(0), "RAZORPAY_INVALID_ARGUMENT");
  });

  test("original metadata is bounded before linkage overwrites it", async () => {
    const t = harness();
    await expectRazorpayError(
      t.action(api.orders.create, {
        partialPayment: false,
        amount: 1000,
        currency: "INR",
        userId: "owner",
        metadata: { userId: "x".repeat(300000) },
        testMode: true,
      }),
      "RAZORPAY_INVALID_ARGUMENT",
    );
  });
});

describe("orders", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const ownerNotes = {
    userId: "attacker",
    externalId: "attacker_external",
    operatornestUserId: "attacker",
    operatornestExternalId: "attacker_external",
  };

  const order = {
    entity: "order",
    id: "order_fixture",
    amount: 1000,
    currency: "INR",
    status: "created",
  };

  const payment = {
    entity: "payment",
    id: "pay_fixture",
    order_id: order.id,
    amount: 1000,
    currency: "INR",
    status: "captured",
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

  const planArgs = {
    period: "monthly" as const,
    interval: 1,
    item: { name: "Monthly Plan", amount: 1000, currency: "INR" },
  };

  const planRaw = { entity: "plan", id: "plan_fixture", ...planArgs };

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
      signature: await computeHmacSha256Hex("fixture_webhook", body),
      eventId,
    });
  }

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

  test.each([
    {
      read: (t: ReturnType<typeof harness>) =>
        t.action(api.orders.fetch, { razorpayOrderId: order.id }),
      raw: order,
    },
    {
      read: (t: ReturnType<typeof harness>) =>
        t.action(api.customers.fetch, { razorpayCustomerId: "cust_fixture" }),
      raw: { entity: "customer", id: "cust_fixture", name: "Provider Buyer" },
    },
    {
      read: (t: ReturnType<typeof harness>) =>
        t.action(api.plans.fetch, { razorpayPlanId: "plan_fixture" }),
      raw: planRaw,
    },
    {
      read: (t: ReturnType<typeof harness>) =>
        t.action(api.subscriptions.fetch, { razorpaySubscriptionId: subscription.id }),
      raw: subscription,
    },
    {
      read: (t: ReturnType<typeof harness>) =>
        t.action(api.refunds.fetch, { razorpayRefundId: "rfnd_fixture" }),
      raw: {
        entity: "refund",
        id: "rfnd_fixture",
        payment_id: payment.id,
        amount: 100,
        currency: "INR",
        status: "processed",
      },
    },
  ])("provider $raw.entity notes cannot assign ownership", async (fixture) => {
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
    "caller namespace %s is rejected in notes and metadata",
    async (key) => {
      const t = harness();
      for (const field of ["notes", "metadata"]) {
        await expectRazorpayError(
          t.action(api.orders.create, {
            partialPayment: false,
            amount: 1000,
            currency: "INR",
            [field]: { [key]: "attacker" },
            testMode: true,
          }),
          "RAZORPAY_INVALID_ARGUMENT",
        );
      }
    },
  );

  test("app ownership survives deceptive notes and propagates to payment and refund", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const t = harness();
    const fetch = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(Response.json({ ...order, notes: ownerNotes })),
    );
    vi.stubGlobal("fetch", fetch);
    const created = await t.action(api.orders.create, {
      partialPayment: false,
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
    const paid = await t
      .query(api.payments.list, {
        paginationOpts: { numItems: 100, cursor: null },
        razorpayOrderId: order.id,
      })
      .then(({ page }) => page);
    expect(paid).toMatchObject([{ userId: "owner", externalId: "app_external" }]);
    expect(
      await ingest(
        t,
        "refund.processed",
        {
          refund: {
            entity: {
              entity: "refund",
              id: "rfnd_fixture",
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
            id: "rfnd_fixture",
            payment_id: payment.id,
            amount: 100,
            currency: "INR",
            status: "processed",
            notes: ownerNotes,
          }),
        ),
      ),
    );
    expect(
      await t.action(api.refunds.fetch, { razorpayRefundId: "rfnd_fixture" }),
    ).not.toHaveProperty("userId");
    expect(await t.run((ctx) => ctx.db.query("refunds").first())).toMatchObject({
      userId: "owner",
      externalId: "app_external",
    });
  });

  test("simulated duplicate receipt never returns another user's order", async () => {
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" });
    const t = harness();
    const args = { amount: 1000, currency: "INR", receipt: "fixture_receipt", testMode: true };
    const first = await t.action(api.orders.create, {
      partialPayment: false,
      ...args,
      userId: "first",
    });
    await expectRazorpayErrorDetails(
      t.action(api.orders.create, { partialPayment: false, ...args, userId: "second" }),
      "RAZORPAY_PROVIDER_ERROR",
      { providerStatus: 400 },
    );
    expect(
      await t.query(api.orders.get, {
        razorpayOrderId: first.order.razorpayOrderId,
        testMode: true,
      }),
    ).toMatchObject({ userId: "first" });
    expect(await t.run((ctx) => ctx.db.query("orders").take(10))).toHaveLength(1);
  });

  test("unkeyed HTTP 400 never adopts an unmarked provider order", async () => {
    const t = harness();
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve(
        init.method === "POST"
          ? Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })
          : Response.json({
              entity: "collection",
              items: [{ ...order, receipt: "fixture_receipt", notes: {} }],
            }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expectRazorpayErrorDetails(
      t.action(api.orders.create, {
        partialPayment: false,
        amount: 1000,
        currency: "INR",
        receipt: "fixture_receipt",
      }),
      "RAZORPAY_PROVIDER_ERROR",
      { providerStatus: 400 },
    );
    expect(await t.query(api.orders.get, { razorpayOrderId: order.id })).toBeNull();
  });

  test("reconciliation stops at 2000 records with a pending outcome", async () => {
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
    const args = { amount: 1000, currency: "INR", idempotencyKey: "fixture_bound_key" };
    await expectRazorpayError(
      t.action(api.orders.create, { partialPayment: false, ...args }),
      "RAZORPAY_NETWORK_ERROR",
    );
    vi.setSystemTime(1_660_000);
    await expectRazorpayError(
      t.action(api.orders.create, { partialPayment: false, ...args }),
      "RAZORPAY_IDEMPOTENCY_PENDING",
    );
    expect(fetch).toHaveBeenCalledTimes(21);
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(fetch.mock.calls.at(-1)?.[0]).toContain("skip=1900");
  });

  test("payment and refund never inherit opposite-mode parent ownership", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    stubSimulatedRazorpayEnv();
    const t = harness();
    const simulated = await t.action(api.orders.create, {
      partialPayment: false,
      amount: 1000,
      currency: "INR",
      userId: "simulated_owner",
      externalId: "simulated_external",
      testMode: true,
    });
    const rawPayment = { ...payment, order_id: simulated.order.razorpayOrderId, notes: ownerNotes };
    stubLiveRazorpayEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json(rawPayment))),
    );
    const livePayment = await t.action(api.payments.fetch, {
      razorpayPaymentId: payment.id,
      testMode: false,
    });
    expect(livePayment).not.toHaveProperty("userId");
    expect(livePayment).not.toHaveProperty("externalId");
    stubSimulatedRazorpayEnv();
    const simulatedRefund = await t.action(api.orders.create, {
      partialPayment: false,
      amount: 1000,
      currency: "INR",
      userId: "simulated_parent_owner",
      testMode: true,
    });
    expect(
      await ingest(
        t,
        "payment.captured",
        {
          payment: {
            entity: {
              ...rawPayment,
              id: "pay_parent_owner",
              order_id: simulatedRefund.order.razorpayOrderId,
            },
          },
        },
        1,
        "evt_opposite_parent",
      ),
    ).toMatchObject({ status: "processed" });
    expect(
      await t
        .query(api.payments.list, {
          paginationOpts: { numItems: 100, cursor: null },
          razorpayOrderId: simulatedRefund.order.razorpayOrderId,
          testMode: true,
        })
        .then(({ page }) => page),
    ).toMatchObject([{ userId: "simulated_parent_owner" }]);
    stubLiveRazorpayEnv();
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
    const refund = await t.action(api.refunds.fetch, { razorpayRefundId: "rfnd_opposite_parent" });
    expect(refund).not.toHaveProperty("userId");
  });

  test("simulated receipts reject another key with a failed claim and unkeyed orders allocate independent IDs", async () => {
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" });
    const t = harness();
    const args = { amount: 1000, currency: "INR", testMode: true };
    const first = await t.action(api.orders.create, { partialPayment: false, ...args });
    const second = await t.action(api.orders.create, { partialPayment: false, ...args });
    expect(first.order.razorpayOrderId).not.toBe(second.order.razorpayOrderId);
    const keyed = {
      ...args,
      receipt: "fixture_keyed_receipt",
      idempotencyKey: "fixture_receipt_first",
      userId: "first",
    };
    const created = await t.action(api.orders.create, { partialPayment: false, ...keyed });
    expect(await t.action(api.orders.create, { partialPayment: false, ...keyed })).toEqual(created);
    await expectRazorpayErrorDetails(
      t.action(api.orders.create, {
        partialPayment: false,
        ...keyed,
        idempotencyKey: "fixture_receipt_second",
        userId: "second",
      }),
      "RAZORPAY_PROVIDER_ERROR",
      { providerStatus: 400, retryable: false },
    );
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("idempotencyRequests")
          .withIndex("by_resource_and_testMode_and_userId_and_idempotencyKey", (q) =>
            q
              .eq("resource", "order")
              .eq("testMode", true)
              .eq("userId", "second")
              .eq("idempotencyKey", "fixture_receipt_second"),
          )
          .unique(),
      ),
    ).toMatchObject({ status: "failed" });
    expect(
      await t.mutation(internal.idempotency.release, {
        resource: "order",
        idempotencyKey: "fixture_receipt_second",
        userId: "second",
        testMode: true,
      }),
    ).toBe(true);
  });
});
