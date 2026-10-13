import { stubRazorpayEnv, restoreRazorpayTestState, expectRazorpayError } from "../test-helpers.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { computeHmacSha256Hex } from "@operatornest/convex-razorpay";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const newHarness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof newHarness>;

const testOnlySigningSecret = "EnLs21M47BllR3X8PSFtjtbd";
const razorpayPaymentId = "pay_IH4NVgf4wjLNgR";
const razorpayOrderId = "order_IluGWxBm9U8zJ8";
const razorpaySubscriptionId = "sub_ID6MOhgkcoHjE7";
const orderSignature = "efeceae0e93bd41a7096ecce1d1cf69979db6c1d91a8116a21965faa42177a62";
const subscriptionSignature = "460acecf881994c1fb48d8bddb43b971181207b8d9403687aaeacd5f4433404b";
const linkSignature = "382e72222f660d836ec37add68edb5844459fa1642c2812cca8bf6df4e639d05";

const payment = {
  id: razorpayPaymentId,
  entity: "payment",
  amount: 50000,
  currency: "INR",
  status: "captured",
  captured: true,
  created_at: 1567674599,
};

function mirrorOrder(
  t: Harness,
  id: string,
  options: {
    testMode?: boolean;
    createdThroughComponent?: boolean;
    userId?: string;
    amount?: number;
  } = {},
) {
  const amount = options.amount ?? 50000;
  return t.mutation(internal.mutations.putOrder, {
    raw: {
      id,
      entity: "order",
      amount,
      amount_paid: 0,
      amount_due: amount,
      currency: "INR",
      status: "created",
      attempts: 0,
      notes: {},
      created_at: 1567674599,
    },
    observedAt: 1_567_674_599_000,
    testMode: options.testMode ?? false,
    createdThroughComponent: options.createdThroughComponent ?? true,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
  });
}

function mirrorSubscription(
  t: Harness,
  id: string,
  options: { testMode?: boolean; createdThroughComponent?: boolean; userId?: string } = {},
) {
  return t.mutation(internal.mutations.putSubscription, {
    raw: {
      id,
      entity: "subscription",
      plan_id: "plan_fixture",
      status: "created",
      total_count: 12,
      paid_count: 0,
      remaining_count: 12,
      quantity: 1,
      created_at: 1567674599,
    },
    observedAt: 1_567_674_599_000,
    testMode: options.testMode ?? false,
    createdThroughComponent: options.createdThroughComponent ?? true,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
  });
}

function mirrorPayment(t: Harness, raw: Record<string, unknown>, testMode: boolean) {
  return t.mutation(internal.mutations.putPayment, {
    raw: { ...payment, ...raw },
    observedAt: 1_567_674_599_000,
    testMode,
  });
}

const signOrder = (order: string, pay = razorpayPaymentId) =>
  computeHmacSha256Hex(testOnlySigningSecret, `${order}|${pay}`);
const signSubscription = (sub: string, pay = razorpayPaymentId) =>
  computeHmacSha256Hex(testOnlySigningSecret, `${pay}|${sub}`);

function respond(subscription: unknown, pay: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(url.includes("/subscriptions/") ? subscription : pay),
    ),
  );
}

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
  restoreRazorpayTestState();
});

test("subscription Checkout verifies the fixed HMAC fixture and links a payment without subscription_id", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith(`/subscriptions/${razorpaySubscriptionId}`)) {
      return new Response(
        JSON.stringify({
          id: razorpaySubscriptionId,
          entity: "subscription",
          plan_id: "plan_fixture",
          status: "active",
          total_count: 12,
          paid_count: 1,
          remaining_count: 11,
          quantity: 1,
          created_at: 1567674599,
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/payments/${razorpayPaymentId}`)) {
      return new Response(JSON.stringify(payment), { status: 200 });
    }
    throw new Error(`unexpected provider path: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  await mirrorSubscription(t, razorpaySubscriptionId);

  const verified = await t.action(api.subscriptions.verifyCheckout, {
    razorpaySubscriptionId,
    razorpayPaymentId,
    signature: subscriptionSignature,
  });
  expect(verified).toMatchObject({
    razorpayPaymentId: razorpayPaymentId,
    razorpaySubscriptionId,
    verified: true,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("payment-link callback verifies the fixed HMAC fixture without provider HTTP", async () => {
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  expect(
    await t.action(api.paymentLinks.verifyCheckout, {
      razorpayPaymentLinkId: "plink_ID6MOhgkcoHjE7",
      referenceId: "inv-001",
      status: "paid",
      razorpayPaymentId,
      signature: linkSignature,
    }),
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test("payment-link callback rejects a bad signature with a typed error", async () => {
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  await expectRazorpayError(
    t.action(api.paymentLinks.verifyCheckout, {
      razorpayPaymentLinkId: "plink_ID6MOhgkcoHjE7",
      referenceId: "inv-001",
      status: "paid",
      razorpayPaymentId,
      signature: "0".repeat(64),
    }),
    "RAZORPAY_INVALID_PAYMENT_SIGNATURE",
  );
});

test("order and subscription Checkout reject a wrong signature with the invalid payment signature code", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  await mirrorOrder(t, razorpayOrderId);
  await mirrorSubscription(t, razorpaySubscriptionId);
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      razorpayOrderId,
      razorpayPaymentId,
      signature: subscriptionSignature,
    }),
    "RAZORPAY_INVALID_PAYMENT_SIGNATURE",
  );
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      razorpaySubscriptionId,
      razorpayPaymentId,
      signature: orderSignature,
    }),
    "RAZORPAY_INVALID_PAYMENT_SIGNATURE",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("all Checkout and payment-link signatures fail closed without the API secret", async () => {
  const t = convexTest(schema, modules);
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      razorpayOrderId,
      razorpayPaymentId,
      signature: orderSignature,
    }),
    "RAZORPAY_NOT_CONFIGURED",
  );
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      razorpaySubscriptionId,
      razorpayPaymentId,
      signature: subscriptionSignature,
    }),
    "RAZORPAY_NOT_CONFIGURED",
  );
  await expectRazorpayError(
    t.action(api.paymentLinks.verifyCheckout, {
      razorpayPaymentLinkId: "plink_ID6MOhgkcoHjE7",
      referenceId: "inv-001",
      status: "paid",
      razorpayPaymentId,
      signature: linkSignature,
    }),
    "RAZORPAY_NOT_CONFIGURED",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("order Checkout rejects a valid signature when provider payment belongs to another order", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  const checkoutOrderId = "order_checkout_mismatch";
  await mirrorOrder(t, checkoutOrderId);
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ ...payment, order_id: "order_another" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      razorpayOrderId: checkoutOrderId,
      razorpayPaymentId,
      signature: await signOrder(checkoutOrderId),
    }),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    await t
      .query(api.payments.list, {
        paginationOpts: { numItems: 100, cursor: null },
        razorpayOrderId: checkoutOrderId,
      })
      .then(({ page }) => page),
  ).toEqual([]);
  expect(
    await t
      .query(api.payments.list, {
        paginationOpts: { numItems: 100, cursor: null },
        razorpayOrderId: "order_another",
      })
      .then(({ page }) => page),
  ).toEqual([]);
});

test("order Checkout requires an authorized or captured payment", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  const checkoutOrderId = "order_checkout_status";
  await mirrorOrder(t, checkoutOrderId);
  const signature = await signOrder(checkoutOrderId);
  const args = { razorpayOrderId: checkoutOrderId, razorpayPaymentId, signature };
  for (const status of ["created", "failed"]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...payment,
              order_id: checkoutOrderId,
              status,
              captured: false,
            }),
          ),
      ),
    );
    await expectRazorpayError(
      t.action(api.orders.verifyCheckout, args),
      "RAZORPAY_INVALID_ARGUMENT",
    );
  }

  expect(
    await t
      .query(api.payments.list, {
        paginationOpts: { numItems: 100, cursor: null },
        razorpayOrderId: checkoutOrderId,
      })
      .then(({ page }) => page),
  ).toMatchObject([{ verified: false }]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...payment,
            order_id: checkoutOrderId,
            status: "authorized",
            captured: false,
          }),
        ),
    ),
  );
  expect(await t.action(api.orders.verifyCheckout, args)).toMatchObject({
    verified: true,
    status: "authorized",
    testMode: false,
  });
});

test("checkout requires a component-created order and checks expected user ownership", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  const signature = await computeHmacSha256Hex(
    testOnlySigningSecret,
    `${razorpayOrderId}|${razorpayPaymentId}`,
  );
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, { razorpayOrderId, razorpayPaymentId, signature }),
    "RAZORPAY_NOT_FOUND",
  );
  await mirrorOrder(t, razorpayOrderId, { createdThroughComponent: false });
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, { razorpayOrderId, razorpayPaymentId, signature }),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  const owned = "order_checkout_owned";
  await mirrorOrder(t, owned, { userId: "user_owner" });
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      razorpayOrderId: owned,
      razorpayPaymentId,
      signature: await signOrder(owned),
      userId: "user_other",
    }),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { suffix: "amount", changes: { amount: 40000 } },
  { suffix: "currency", changes: { currency: "USD" } },
])("checkout rejects a fetched payment with a mismatched $suffix", async ({ suffix, changes }) => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  const checkoutOrderId = `order_checkout_${suffix}_match`;
  await mirrorOrder(t, checkoutOrderId);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ...payment, order_id: checkoutOrderId, ...changes })),
    ),
  );
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      razorpayOrderId: checkoutOrderId,
      razorpayPaymentId,
      signature: await signOrder(checkoutOrderId),
    }),
    "RAZORPAY_INVALID_ARGUMENT",
  );
});

test("test-mode Checkout confirms against the mirrored payment without provider HTTP", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_567_674_660_000);
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  const created = await t.action(api.orders.create, {
    partialPayment: false,
    amount: 50000,
    currency: "INR",
    receipt: "checkout-test-mode",
    testMode: true,
  });
  const checkoutOrderId = created.order.razorpayOrderId;
  const signature = await signOrder(checkoutOrderId);
  const args = { razorpayOrderId: checkoutOrderId, razorpayPaymentId, signature, testMode: true };
  await expectRazorpayError(t.action(api.orders.verifyCheckout, args), "RAZORPAY_NOT_FOUND");

  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_checkout_fixture");
  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    created_at: 1_567_674_599,
    payload: {
      payment: {
        entity: {
          id: razorpayPaymentId,
          entity: "payment",
          amount: 50000,
          currency: "INR",
          status: "captured",
          captured: true,
          order_id: checkoutOrderId,
        },
      },
    },
  });
  await t.action(api.webhooks.ingest, {
    body,
    signature: await computeHmacSha256Hex("whsec_checkout_fixture", body),
    eventId: "evt_checkout_test_mode",
  });
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      ...args,
      signature: "0".repeat(64),
    }),
    "RAZORPAY_INVALID_PAYMENT_SIGNATURE",
  );
  expect(await t.action(api.orders.verifyCheckout, args)).toMatchObject({
    razorpayPaymentId: razorpayPaymentId,
    razorpayOrderId: checkoutOrderId,
    verified: true,
    testMode: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("test-mode Checkout cannot verify a live-mirrored payment or order", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_567_674_660_000);
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_checkout_live");
  const t = convexTest(schema, modules);
  const testOrder = (
    await t.action(api.orders.create, {
      partialPayment: false,
      amount: 50000,
      currency: "INR",
      receipt: "checkout-live-payment",
      testMode: true,
    })
  ).order.razorpayOrderId;

  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    created_at: 1_567_674_599,
    payload: {
      payment: {
        entity: { ...payment, entity: "payment", order_id: testOrder },
      },
    },
  });
  await t.action(api.webhooks.ingest, {
    body,
    signature: await computeHmacSha256Hex("whsec_checkout_live", body),
    eventId: "evt_checkout_live_payment",
  });
  const args = {
    razorpayOrderId: testOrder,
    razorpayPaymentId,
    signature: await signOrder(testOrder),
    testMode: true,
  };
  await expectRazorpayError(t.action(api.orders.verifyCheckout, args), "RAZORPAY_MODE_MISMATCH");
  expect(
    await t
      .query(api.payments.list, {
        paginationOpts: { numItems: 100, cursor: null },
        razorpayOrderId: testOrder,
      })
      .then(({ page }) => page),
  ).toMatchObject([{ verified: false, testMode: false }]);

  const liveOrder = "order_checkout_live_only";
  await mirrorOrder(t, liveOrder);
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, {
      razorpayOrderId: liveOrder,
      razorpayPaymentId,
      signature: await signOrder(liveOrder),
      testMode: true,
    }),
    "RAZORPAY_MODE_MISMATCH",
  );
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  await expectRazorpayError(
    t.action(api.orders.verifyCheckout, { ...args, testMode: false }),
    "RAZORPAY_MODE_MISMATCH",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("subscription Checkout needs a mirrored, component-created, owned subscription", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      razorpaySubscriptionId,
      razorpayPaymentId,
      signature: await signSubscription(razorpaySubscriptionId),
    }),
    "RAZORPAY_NOT_FOUND",
  );
  await mirrorSubscription(t, razorpaySubscriptionId, { createdThroughComponent: false });
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      razorpaySubscriptionId,
      razorpayPaymentId,
      signature: await signSubscription(razorpaySubscriptionId),
    }),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  const owned = "sub_checkout_owned";
  await mirrorSubscription(t, owned, { userId: "user_owner" });
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      razorpaySubscriptionId: owned,
      razorpayPaymentId,
      signature: await signSubscription(owned),
      userId: "user_other",
    }),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("live subscription Checkout validates provider identities and payment status", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  await mirrorSubscription(t, razorpaySubscriptionId, { userId: "user_owner" });
  const args = {
    razorpaySubscriptionId,
    razorpayPaymentId,
    signature: await signSubscription(razorpaySubscriptionId),
    userId: "user_owner",
  };
  const providerSubscription = {
    id: razorpaySubscriptionId,
    entity: "subscription",
    plan_id: "plan_fixture",
    status: "active",
    total_count: 12,
    paid_count: 1,
    remaining_count: 11,
    quantity: 1,
    created_at: 1567674599,
  };
  respond({ ...providerSubscription, id: "sub_other" }, payment);
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  respond(providerSubscription, { ...payment, id: "pay_other" });
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  respond(providerSubscription, { ...payment, status: "failed", captured: false });
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  respond(providerSubscription, payment);
  expect(await t.action(api.subscriptions.verifyCheckout, args)).toMatchObject({
    verified: true,
    razorpaySubscriptionId,
    testMode: false,
  });
});

test("test-mode subscription Checkout confirms mirrored rows and refuses live ones", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", testOnlySigningSecret);
  const t = convexTest(schema, modules);
  const testSubscription = "sub_checkout_test_mode";
  await mirrorSubscription(t, testSubscription, { testMode: true, userId: "user_owner" });
  const args = {
    razorpaySubscriptionId: testSubscription,
    razorpayPaymentId,
    signature: await signSubscription(testSubscription),
    userId: "user_owner",
    testMode: true,
  };
  await expectRazorpayError(t.action(api.subscriptions.verifyCheckout, args), "RAZORPAY_NOT_FOUND");
  await mirrorPayment(t, { status: "created", captured: false }, true);
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
  );
  await mirrorPayment(t, { status: "authorized", captured: false }, true);
  expect(await t.action(api.subscriptions.verifyCheckout, args)).toMatchObject({
    verified: true,
    razorpaySubscriptionId: testSubscription,
    testMode: true,
  });

  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_public");
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, { ...args, testMode: false }),
    "RAZORPAY_MODE_MISMATCH",
  );
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);

  const livePay = "pay_live_row";
  await mirrorPayment(t, { id: livePay, status: "captured" }, false);
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      ...args,
      razorpayPaymentId: livePay,
      signature: await signSubscription(testSubscription, livePay),
    }),
    "RAZORPAY_MODE_MISMATCH",
  );
  await mirrorSubscription(t, "sub_checkout_live_row");
  await expectRazorpayError(
    t.action(api.subscriptions.verifyCheckout, {
      razorpaySubscriptionId: "sub_checkout_live_row",
      razorpayPaymentId,
      signature: await signSubscription("sub_checkout_live_row"),
      testMode: true,
    }),
    "RAZORPAY_MODE_MISMATCH",
  );
  expect(fetch).not.toHaveBeenCalled();
});
