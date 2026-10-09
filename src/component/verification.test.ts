import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { hmacSha256Hex } from "@operatornest/convex-razorpay";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const newHarness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof newHarness>;
// Public test vector from docs/spec.md.
const signingFixture = "EnLs21M47BllR3X8PSFtjtbd";
const paymentId = "pay_IH4NVgf4wjLNgR";
const orderId = "order_IluGWxBm9U8zJ8";
const subscriptionId = "sub_ID6MOhgkcoHjE7";
const orderSignature = "efeceae0e93bd41a7096ecce1d1cf69979db6c1d91a8116a21965faa42177a62";
const subscriptionSignature = "460acecf881994c1fb48d8bddb43b971181207b8d9403687aaeacd5f4433404b";
const linkSignature = "382e72222f660d836ec37add68edb5844459fa1642c2812cca8bf6df4e639d05";

const payment = {
  id: paymentId,
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

const signOrder = (order: string, pay = paymentId) =>
  hmacSha256Hex(signingFixture, `${order}|${pay}`);
const signSubscription = (sub: string, pay = paymentId) =>
  hmacSha256Hex(signingFixture, `${pay}|${sub}`);

function respond(subscription: unknown, pay: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(url.includes("/subscriptions/") ? subscription : pay),
    ),
  );
}

function rejectsWith(promise: Promise<unknown>, code: string, message?: string) {
  return expect(promise).rejects.toMatchObject({
    data: { code, ...(message === undefined ? {} : { message }) },
  });
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

test("subscription Checkout verifies the spec vector and links a payment without subscription_id", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith(`/subscriptions/${subscriptionId}`)) {
      return new Response(
        JSON.stringify({
          id: subscriptionId,
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
    if (url.endsWith(`/payments/${paymentId}`)) {
      return new Response(JSON.stringify(payment), { status: 200 });
    }
    throw new Error(`unexpected provider path: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  await mirrorSubscription(t, subscriptionId);

  const verified = await t.action(api.verification.subscriptionCheckout, {
    subscriptionId,
    paymentId,
    signature: subscriptionSignature,
  });
  expect(verified).toMatchObject({
    razorpayId: paymentId,
    subscriptionId,
    verified: true,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("payment-link callback verifies the exact spec vector without provider HTTP", async () => {
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  expect(
    await t.action(api.verification.paymentLink, {
      paymentLinkId: "plink_ID6MOhgkcoHjE7",
      referenceId: "inv-001",
      status: "paid",
      paymentId,
      signature: linkSignature,
    }),
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test("payment-link callback rejects a bad signature with a typed error", async () => {
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.verification.paymentLink, {
      paymentLinkId: "plink_ID6MOhgkcoHjE7",
      referenceId: "inv-001",
      status: "paid",
      paymentId,
      signature: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
});

test("all Checkout and payment-link signatures fail closed without the API secret", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.verification.checkout, {
      orderId,
      paymentId,
      signature: orderSignature,
    }),
  ).rejects.toThrow("Invalid checkout signature");
  await expect(
    t.action(api.verification.subscriptionCheckout, {
      subscriptionId,
      paymentId,
      signature: subscriptionSignature,
    }),
  ).rejects.toThrow("Invalid subscription checkout signature");
  await expect(
    t.action(api.verification.paymentLink, {
      paymentLinkId: "plink_ID6MOhgkcoHjE7",
      referenceId: "inv-001",
      status: "paid",
      paymentId,
      signature: linkSignature,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_CONFIGURED" } });
  expect(fetch).not.toHaveBeenCalled();
});

test("order Checkout rejects a valid signature when provider payment belongs to another order", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  const checkoutOrderId = "order_checkout_mismatch";
  await mirrorOrder(t, checkoutOrderId);
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ ...payment, order_id: "order_another" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    t.action(api.verification.checkout, {
      orderId: checkoutOrderId,
      paymentId,
      signature: await signOrder(checkoutOrderId),
    }),
  ).rejects.toThrow("Checkout payment identity mismatch");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await t.query(api.payments.listForOrder, { orderId: checkoutOrderId })).toEqual([]);
  expect(await t.query(api.payments.listForOrder, { orderId: "order_another" })).toEqual([]);
});

test("order Checkout requires an authorized or captured payment", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  const checkoutOrderId = "order_checkout_status";
  await mirrorOrder(t, checkoutOrderId);
  const signature = await signOrder(checkoutOrderId);
  const args = { orderId: checkoutOrderId, paymentId, signature };
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
    await rejectsWith(
      t.action(api.verification.checkout, args),
      "RAZORPAY_INVALID_ARGUMENT",
      "Checkout payment is not authorized or captured",
    );
  }
  // The provider truth is still mirrored, but the payment is never marked verified.
  expect(await t.query(api.payments.listForOrder, { orderId: checkoutOrderId })).toMatchObject([
    { verified: false },
  ]);
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
  expect(await t.action(api.verification.checkout, args)).toMatchObject({
    verified: true,
    status: "authorized",
    testMode: false,
  });
});

test("checkout requires a component-created order and checks expected user ownership", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  const signature = await hmacSha256Hex(signingFixture, `${orderId}|${paymentId}`);
  await rejectsWith(
    t.action(api.verification.checkout, { orderId, paymentId, signature }),
    "RAZORPAY_NOT_FOUND",
    "Checkout order not found",
  );
  await mirrorOrder(t, orderId, { createdThroughComponent: false });
  await rejectsWith(
    t.action(api.verification.checkout, { orderId, paymentId, signature }),
    "RAZORPAY_INVALID_ARGUMENT",
    "Checkout order was not created through this component",
  );
  const owned = "order_checkout_owned";
  await mirrorOrder(t, owned, { userId: "user_owner" });
  await expect(
    t.action(api.verification.checkout, {
      orderId: owned,
      paymentId,
      signature: await signOrder(owned),
      userId: "user_other",
    }),
  ).rejects.toThrow("Checkout order belongs to another user");
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { suffix: "amount", changes: { amount: 40000 } },
  { suffix: "currency", changes: { currency: "USD" } },
])("checkout rejects a fetched payment with a mismatched $suffix", async ({ suffix, changes }) => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
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
  await expect(
    t.action(api.verification.checkout, {
      orderId: checkoutOrderId,
      paymentId,
      signature: await signOrder(checkoutOrderId),
    }),
  ).rejects.toThrow("Checkout payment amount or currency mismatch");
});

test("test-mode Checkout confirms against the mirrored payment without provider HTTP", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  const created = await t.action(api.orders.create, {
    amount: 50000,
    currency: "INR",
    receipt: "checkout-test-mode",
    testMode: true,
  });
  const checkoutOrderId = created.order.razorpayId;
  const signature = await signOrder(checkoutOrderId);
  const args = { orderId: checkoutOrderId, paymentId, signature, testMode: true };
  await rejectsWith(
    t.action(api.verification.checkout, args),
    "RAZORPAY_NOT_FOUND",
    "Payment not found in test mode",
  );
  // A signed webhook is tagged test only because the deployment runs in test mode.
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_checkout_fixture");
  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    created_at: 1_567_674_599,
    payload: {
      payment: {
        entity: {
          id: paymentId,
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
    signature: await hmacSha256Hex("whsec_checkout_fixture", body),
    eventId: "evt_checkout_test_mode",
  });
  await expect(
    t.action(api.verification.checkout, {
      ...args,
      signature: "0".repeat(64),
    }),
  ).rejects.toThrow("Invalid checkout signature");
  expect(await t.action(api.verification.checkout, args)).toMatchObject({
    razorpayId: paymentId,
    orderId: checkoutOrderId,
    verified: true,
    testMode: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("test-mode Checkout cannot verify a live-mirrored payment or order", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_checkout_live");
  const t = convexTest(schema, modules);
  const testOrder = (
    await t.action(api.orders.create, {
      amount: 50000,
      currency: "INR",
      receipt: "checkout-live-payment",
      testMode: true,
    })
  ).order.razorpayId;
  // Without RAZORPAY_TEST_MODE the signed webhook entity is live.
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
    signature: await hmacSha256Hex("whsec_checkout_live", body),
    eventId: "evt_checkout_live_payment",
  });
  const args = {
    orderId: testOrder,
    paymentId,
    signature: await signOrder(testOrder),
    testMode: true,
  };
  await rejectsWith(t.action(api.verification.checkout, args), "RAZORPAY_MODE_MISMATCH");
  expect(await t.query(api.payments.listForOrder, { orderId: testOrder })).toMatchObject([
    { verified: false, testMode: false },
  ]);

  // A live order cannot be verified in test mode, nor a test order in live mode.
  const liveOrder = "order_checkout_live_only";
  await mirrorOrder(t, liveOrder);
  await rejectsWith(
    t.action(api.verification.checkout, {
      orderId: liveOrder,
      paymentId,
      signature: await signOrder(liveOrder),
      testMode: true,
    }),
    "RAZORPAY_MODE_MISMATCH",
  );
  await rejectsWith(
    t.action(api.verification.checkout, { ...args, testMode: false }),
    "RAZORPAY_MODE_MISMATCH",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("subscription Checkout needs a mirrored, component-created, owned subscription", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, {
      subscriptionId,
      paymentId,
      signature: await signSubscription(subscriptionId),
    }),
    "RAZORPAY_NOT_FOUND",
    "Checkout subscription not found",
  );
  await mirrorSubscription(t, subscriptionId, { createdThroughComponent: false });
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, {
      subscriptionId,
      paymentId,
      signature: await signSubscription(subscriptionId),
    }),
    "RAZORPAY_INVALID_ARGUMENT",
    "Checkout subscription was not created through this component",
  );
  const owned = "sub_checkout_owned";
  await mirrorSubscription(t, owned, { userId: "user_owner" });
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, {
      subscriptionId: owned,
      paymentId,
      signature: await signSubscription(owned),
      userId: "user_other",
    }),
    "RAZORPAY_INVALID_ARGUMENT",
    "Checkout subscription belongs to another user",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("live subscription Checkout validates provider identities and payment status", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  await mirrorSubscription(t, subscriptionId, { userId: "user_owner" });
  const args = {
    subscriptionId,
    paymentId,
    signature: await signSubscription(subscriptionId),
    userId: "user_owner",
  };
  const providerSubscription = {
    id: subscriptionId,
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
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
    "Subscription identity mismatch",
  );
  respond(providerSubscription, { ...payment, id: "pay_other" });
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
    "Payment identity mismatch",
  );
  respond(providerSubscription, { ...payment, status: "failed", captured: false });
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
    "Checkout payment is not authorized or captured",
  );
  respond(providerSubscription, payment);
  expect(await t.action(api.verification.subscriptionCheckout, args)).toMatchObject({
    verified: true,
    subscriptionId,
    testMode: false,
  });
});

test("test-mode subscription Checkout confirms mirrored rows and refuses live ones", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", signingFixture);
  const t = convexTest(schema, modules);
  const testSubscription = "sub_checkout_test_mode";
  await mirrorSubscription(t, testSubscription, { testMode: true, userId: "user_owner" });
  const args = {
    subscriptionId: testSubscription,
    paymentId,
    signature: await signSubscription(testSubscription),
    userId: "user_owner",
    testMode: true,
  };
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, args),
    "RAZORPAY_NOT_FOUND",
    "Payment not found in test mode",
  );
  await mirrorPayment(t, { status: "created", captured: false }, true);
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, args),
    "RAZORPAY_INVALID_ARGUMENT",
    "Checkout payment is not authorized or captured",
  );
  await mirrorPayment(t, { status: "authorized", captured: false }, true);
  expect(await t.action(api.verification.subscriptionCheckout, args)).toMatchObject({
    verified: true,
    subscriptionId: testSubscription,
    testMode: true,
  });
  // The same checkout in live mode must not touch a test-mirrored subscription.
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, { ...args, testMode: false }),
    "RAZORPAY_MODE_MISMATCH",
  );
  // A live payment row is never verified by test-mode checkout.
  const livePay = "pay_live_row";
  await mirrorPayment(t, { id: livePay, status: "captured" }, false);
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, {
      ...args,
      paymentId: livePay,
      signature: await signSubscription(testSubscription, livePay),
    }),
    "RAZORPAY_MODE_MISMATCH",
  );
  await mirrorSubscription(t, "sub_checkout_live_row");
  await rejectsWith(
    t.action(api.verification.subscriptionCheckout, {
      subscriptionId: "sub_checkout_live_row",
      paymentId,
      signature: await signSubscription("sub_checkout_live_row"),
      testMode: true,
    }),
    "RAZORPAY_MODE_MISMATCH",
  );
  expect(fetch).not.toHaveBeenCalled();
});
