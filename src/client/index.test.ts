import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { components, internal } from "../../example/convex/_generated/api.js";
import {
  Razorpay,
  buildCheckoutOptions,
  isRazorpayError,
  registerRoutes,
  webhookEventValidator,
} from "./index.js";
import { expectRazorpayError } from "../test-helpers.js";

vi.mock("convex/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/server")>()),
  createFunctionHandle: vi.fn(async () => "test-callback-handle"),
}));

function mockContext() {
  return {
    runAction: vi.fn().mockResolvedValue({
      order: { _id: "row_1", _creationTime: 1, razorpayOrderId: "order_1" },
      keyId: "rzp_test_public",
    }),
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation: vi.fn().mockResolvedValue(1),
  };
}

test("every public client method delegates to its component function", async () => {
  const client = new Razorpay(components.razorpay, { testMode: true });
  const ctx = mockContext();
  ctx.runQuery
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: "" })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: "" });

  expect(
    await client.orders.create(ctx, { partialPayment: false, amount: 50000, currency: "INR" }),
  ).toMatchObject({
    razorpayOrderId: "order_1",
    keyId: "rzp_test_public",
  });
  await client.orders.fetch(ctx, { razorpayOrderId: "order_1" });
  await client.orders.fetchPayments(ctx, { razorpayOrderId: "order_1" });
  await client.orders.get(ctx, { razorpayOrderId: "order_1" });
  await client.payments.fetch(ctx, { razorpayPaymentId: "pay_1" });
  await client.payments.capture(ctx, {
    razorpayPaymentId: "pay_1",
    amount: 50000,
    currency: "INR",
  });
  await client.payments.fetchAll(ctx, {});
  await client.payments.list(ctx, {
    paginationOpts: { numItems: 100, cursor: null },
    razorpayOrderId: "order_1",
  });
  await client.refunds.create(ctx, {
    speed: "normal",
    amount: 100,
    razorpayPaymentId: "pay_1",
    receipt: "refund-1",
  });
  await client.refunds.fetch(ctx, { razorpayRefundId: "rfnd_1" });
  await client.customers.create(ctx, { name: "A", email: "a@example.test" });
  await client.customers.getOrCreate(ctx, { name: "A", email: "a@example.test" });
  await client.customers.fetch(ctx, { razorpayCustomerId: "cust_1" });
  await client.customers.edit(ctx, { razorpayCustomerId: "cust_1", name: "B" });
  await client.customers.get(ctx, { userId: "user_1" });
  await client.plans.create(ctx, {
    period: "monthly",
    interval: 1,
    item: { name: "Plan", amount: 50000, currency: "INR" },
  });
  await client.plans.fetch(ctx, { razorpayPlanId: "plan_1" });
  await client.plans.fetchAll(ctx, {});
  await client.subscriptions.create(ctx, {
    quantity: 1,
    customerNotify: true,
    razorpayPlanId: "plan_1",
    totalCount: 12,
  });
  await client.subscriptions.fetch(ctx, { razorpaySubscriptionId: "sub_1" });
  await client.subscriptions.cancel(ctx, { razorpaySubscriptionId: "sub_1" });
  await client.subscriptions.cancelAtCycleEnd(ctx, { razorpaySubscriptionId: "sub_1" });
  await client.subscriptions.pause(ctx, { razorpaySubscriptionId: "sub_1" });
  await client.subscriptions.resume(ctx, { razorpaySubscriptionId: "sub_1" });
  await client.subscriptions.update(ctx, {
    scheduleChangeAt: "now",
    razorpaySubscriptionId: "sub_1",
    quantity: 2,
  });
  await client.subscriptions.get(ctx, { userId: "user_1" });
  await client.subscriptions.list(ctx, {
    paginationOpts: { numItems: 100, cursor: null },
    userId: "user_1",
  });
  await client.orders.verifyCheckout(ctx, {
    razorpayOrderId: "order_1",
    razorpayPaymentId: "pay_1",
    signature: "sig",
  });
  await client.subscriptions.verifyCheckout(ctx, {
    razorpaySubscriptionId: "sub_1",
    razorpayPaymentId: "pay_1",
    signature: "sig",
  });
  await client.paymentLinks.verifyCheckout(ctx, {
    razorpayPaymentLinkId: "plink_1",
    referenceId: "ref_1",
    status: "paid",
    razorpayPaymentId: "pay_1",
    signature: "sig",
  });
  await client.orders.releaseIdempotency(ctx, { idempotencyKey: "key_1" });
  await client.subscriptions.releaseIdempotency(ctx, { idempotencyKey: "key_1" });
  await client.plans.releaseIdempotency(ctx, { idempotencyKey: "key_1" });
  await client.customers.releaseIdempotency(ctx, { idempotencyKey: "key_1" });
  expect(ctx.runMutation.mock.calls.at(-1)?.[1]).toEqual({
    idempotencyKey: "key_1",
    testMode: true,
  });
  expect(
    buildCheckoutOptions(
      { razorpayOrderId: "order_1", amount: 50000, currency: "INR", keyId: "rzp_test_public" },
      { name: "Demo" },
    ),
  ).toEqual({
    key: "rzp_test_public",
    name: "Demo",
    order_id: "order_1",
    amount: 50000,
    currency: "INR",
  });

  const actionRefs = [
    components.razorpay.orders.create,
    components.razorpay.orders.fetch,
    components.razorpay.orders.fetchPayments,
    components.razorpay.payments.fetch,
    components.razorpay.payments.capture,
    components.razorpay.payments.fetchAll,
    components.razorpay.refunds.create,
    components.razorpay.refunds.fetch,
    components.razorpay.customers.create,
    components.razorpay.customers.getOrCreate,
    components.razorpay.customers.fetch,
    components.razorpay.customers.edit,
    components.razorpay.plans.create,
    components.razorpay.plans.fetch,
    components.razorpay.plans.fetchAll,
    components.razorpay.subscriptions.create,
    components.razorpay.subscriptions.fetch,
    components.razorpay.subscriptions.cancel,
    components.razorpay.subscriptions.cancelAtCycleEnd,
    components.razorpay.subscriptions.pause,
    components.razorpay.subscriptions.resume,
    components.razorpay.subscriptions.update,
    components.razorpay.orders.verifyCheckout,
    components.razorpay.subscriptions.verifyCheckout,
    components.razorpay.paymentLinks.verifyCheckout,
  ];
  expect(ctx.runAction.mock.calls.map(([ref]) => ref)).toEqual(actionRefs);
  expect(ctx.runAction.mock.calls.slice(0, -1).every(([, args]) => args.testMode === true)).toBe(
    true,
  );
  expect(ctx.runAction.mock.calls.at(-1)?.[1]).not.toHaveProperty("testMode");
  expect(ctx.runQuery.mock.calls.map(([ref]) => ref)).toEqual([
    components.razorpay.orders.get,
    components.razorpay.payments.list,
    components.razorpay.customers.get,
    components.razorpay.subscriptions.get,
    components.razorpay.subscriptions.list,
  ]);
  expect(ctx.runMutation.mock.calls.map(([ref]) => ref)).toEqual([
    components.razorpay.orders.releaseIdempotency,
    components.razorpay.subscriptions.releaseIdempotency,
    components.razorpay.plans.releaseIdempotency,
    components.razorpay.customers.releaseIdempotency,
  ]);
});

test.each(["é", "$a"])(
  "note and metadata key %s that is not a Convex field name is rejected before any component call",
  async (key) => {
    const client = new Razorpay(components.razorpay);
    const ctx = mockContext();
    const calls = [
      () =>
        client.orders.create(ctx, {
          amount: 50000,
          currency: "INR",
          partialPayment: false,
          notes: { [key]: "v" },
        }),
      () =>
        client.refunds.create(ctx, {
          razorpayPaymentId: "pay_1",
          amount: 100,
          speed: "normal",
          metadata: { [key]: "v" },
        }),
      () =>
        client.customers.create(ctx, {
          name: "Buyer",
          email: "buyer@example.test",
          notes: { [key]: "v" },
        }),
      () =>
        client.customers.getOrCreate(ctx, {
          name: "Buyer",
          email: "buyer@example.test",
          metadata: { [key]: "v" },
        }),
      () =>
        client.plans.create(ctx, {
          period: "monthly",
          interval: 1,
          item: { name: "Pro", amount: 69900, currency: "INR" },
          notes: { [key]: "v" },
        }),
      () =>
        client.subscriptions.create(ctx, {
          razorpayPlanId: "plan_1",
          totalCount: 12,
          quantity: 1,
          customerNotify: false,
          metadata: { [key]: "v" },
        }),
    ];
    for (const call of calls) await expectRazorpayError(call(), "RAZORPAY_INVALID_ARGUMENT");
    expect(ctx.runAction).not.toHaveBeenCalled();
  },
);

test("an omitted test mode is passed as undefined and a missing Checkout key stays undefined", async () => {
  const client = new Razorpay(components.razorpay);
  const ctx = mockContext();
  await client.orders.fetch(ctx, { razorpayOrderId: "order_1" });
  expect(Object.entries(ctx.runAction.mock.calls[0]?.[1] ?? {})).toContainEqual([
    "testMode",
    undefined,
  ]);
  expect(
    buildCheckoutOptions({ razorpayOrderId: "order_1", amount: 50000, currency: "INR" }),
  ).toEqual({
    order_id: "order_1",
    amount: 50000,
    currency: "INR",
  });
});

test("the package exports the webhook event validator that app callbacks declare as args", () => {
  expect(webhookEventValidator.kind).toBe("object");
  expect(Object.keys(webhookEventValidator.fields).toSorted()).toEqual([
    "event",
    "eventId",
    "providerCreatedAt",
    "razorpayAccountId",
    "razorpayEntityId",
  ]);
});

test("typed Razorpay errors retain their ConvexError data", async () => {
  const error = new ConvexError({
    code: "RAZORPAY_PROVIDER_ERROR",
    message: "Razorpay returned a failure response.",
    retryable: true,
  });
  expect(isRazorpayError(error)).toBe(true);
  expect(isRazorpayError(new ConvexError({ code: "OTHER", message: "Other" }))).toBe(false);
  expect(isRazorpayError(new ConvexError({ code: "RAZORPAY_NOT_FOUND", message: 1 }))).toBe(false);
  expect(
    isRazorpayError(
      new ConvexError({ code: "RAZORPAY_NOT_FOUND", message: "Missing", retryable: "yes" }),
    ),
  ).toBe(false);
  expect(isRazorpayError(new Error("Other"))).toBe(false);
  const client = new Razorpay(components.razorpay);
  const ctx = mockContext();
  ctx.runAction.mockRejectedValueOnce(error);
  await expect(client.orders.fetch(ctx, { razorpayOrderId: "order_1" })).rejects.toBe(error);
  const unexpected = new Error("Network unavailable");
  ctx.runAction.mockRejectedValueOnce(unexpected);
  await expect(client.orders.fetch(ctx, { razorpayOrderId: "order_1" })).rejects.toBe(unexpected);
});

test("testMode is excluded from public call arguments at the type boundary", () => {
  const client = new Razorpay(components.razorpay);
  expectTypeOf<Parameters<typeof client.orders.create>[1]>().not.toHaveProperty("testMode");
  expectTypeOf<Parameters<typeof client.payments.capture>[1]>().not.toHaveProperty("testMode");
  expectTypeOf<Parameters<typeof client.refunds.create>[1]>().not.toHaveProperty("testMode");
  expectTypeOf<Parameters<typeof client.customers.create>[1]>().not.toHaveProperty("testMode");
  expectTypeOf<Parameters<typeof client.plans.create>[1]>().not.toHaveProperty("testMode");
  expectTypeOf<Parameters<typeof client.subscriptions.create>[1]>().not.toHaveProperty("testMode");
  expectTypeOf<Parameters<typeof client.orders.verifyCheckout>[1]>().not.toHaveProperty("testMode");
});

function routeHandler(
  path: `/${string}` = "/razorpay/webhook",
  throughClient = false,
  withCallback = true,
  overrideCallback = false,
) {
  const http = httpRouter();
  const client = new Razorpay(
    components.razorpay,
    overrideCallback ? {} : { onEvent: internal.webhookCallback.onEvent },
  );
  if (throughClient)
    client.registerRoutes(http, {
      path,
      ...(overrideCallback ? { onEvent: internal.webhookCallback.onEvent } : {}),
    });
  else
    registerRoutes(http, components.razorpay, {
      path,
      ...(withCallback ? { onEvent: internal.webhookCallback.onEvent } : {}),
    });
  const handler = http.exactRoutes.get(path)?.get("POST");
  if (!handler) throw new Error("Missing webhook route");

  return handler as typeof handler & {
    _handler: (ctx: ReturnType<typeof mockContext>, request: Request) => Promise<Response>;
  };
}

function invokeRoute(
  handler: ReturnType<typeof routeHandler>,
  ctx: ReturnType<typeof mockContext>,
  req: Request,
) {
  // eslint-disable-next-line eslint/no-underscore-dangle -- Convex hides the registered handler in its public type.
  return handler._handler(ctx, req);
}

function request(
  body: BodyInit = "{}",
  headers: Record<string, string> = {
    "x-razorpay-signature": "sig",
    "x-razorpay-event-id": "evt_1",
  },
) {
  return new Request("https://example.test/razorpay/webhook", { method: "POST", body, headers });
}

describe("registered webhook route", () => {
  test("passes the raw body, headers, and callback handle without post-commit work", async () => {
    const handler = routeHandler();
    const ctx = mockContext();
    expect((await invokeRoute(handler, ctx, request('{"event":"payment.captured"}'))).status).toBe(
      200,
    );
    expect(ctx.runAction).toHaveBeenCalledWith(components.razorpay.webhooks.ingest, {
      body: '{"event":"payment.captured"}',
      signature: "sig",
      eventId: "evt_1",
      callbackHandle: "test-callback-handle",
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("client shortcut supports a custom path and missing headers", async () => {
    const handler = routeHandler("/custom/webhook", true);
    const ctx = mockContext();
    expect((await invokeRoute(handler, ctx, request("{}", {}))).status).toBe(200);
    expect(ctx.runAction).toHaveBeenCalledWith(components.razorpay.webhooks.ingest, {
      body: "{}",
      signature: "",
      eventId: "",
      callbackHandle: "test-callback-handle",
    });
  });

  test("an empty body without a callback is forwarded without a handle", async () => {
    const handler = routeHandler("/razorpay/webhook", false, false);
    const ctx = mockContext();
    const empty = new Request("https://example.test/razorpay/webhook", { method: "POST" });
    expect((await invokeRoute(handler, ctx, empty)).status).toBe(200);
    expect(ctx.runAction).toHaveBeenCalledWith(components.razorpay.webhooks.ingest, {
      body: "",
      signature: "",
      eventId: "",
    });
  });

  test("a client callback option can be supplied when registering the route", async () => {
    const handler = routeHandler("/override/webhook", true, true, true);
    const ctx = mockContext();
    expect((await invokeRoute(handler, ctx, request())).status).toBe(200);
    expect(ctx.runAction.mock.calls[0]?.[1]).toHaveProperty(
      "callbackHandle",
      "test-callback-handle",
    );
  });

  test("oversized and undecodable bodies return specific statuses", async () => {
    const handler = routeHandler();
    const ctx = mockContext();
    expect((await invokeRoute(handler, ctx, request("x".repeat(128 * 1024 + 1)))).status).toBe(413);
    expect((await invokeRoute(handler, ctx, request(new Uint8Array([0xff])))).status).toBe(400);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  test("a failed request stream returns 500 before ingest", async () => {
    const handler = routeHandler();
    const ctx = mockContext();
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream failed");
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body: stream,
      duplex: "half",
    };
    const broken = new Request("https://example.test/razorpay/webhook", init);
    expect((await invokeRoute(handler, ctx, broken)).status).toBe(500);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  test("signature failures return 401 and callback failures return 500", async () => {
    const handler = routeHandler();
    const ctx = mockContext();
    ctx.runAction.mockRejectedValueOnce(
      new ConvexError({
        code: "RAZORPAY_INVALID_WEBHOOK_SIGNATURE",
        message: "The webhook signature is invalid.",
      }),
    );
    expect((await invokeRoute(handler, ctx, request())).status).toBe(401);
    ctx.runAction.mockRejectedValueOnce(
      new ConvexError({ code: "RAZORPAY_PROVIDER_ERROR", message: "Unavailable" }),
    );
    expect((await invokeRoute(handler, ctx, request())).status).toBe(500);
  });
});

test("undeclared caller testMode never reaches component arguments", async () => {
  const ctx = mockContext();
  ctx.runAction.mockResolvedValueOnce({ order: { razorpayOrderId: "order_fixture" } });
  const client = new Razorpay(components.razorpay);
  const args = { amount: 1000, currency: "INR", testMode: true };
  await client.orders.create(ctx, { partialPayment: false, ...args });
  expect(ctx.runAction.mock.calls[0]?.[1]?.testMode).toBeUndefined();
});

test("webhook routes preserve the leading UTF-8 BOM for signature verification", async () => {
  const handler = routeHandler();
  const ctx = mockContext();
  await invokeRoute(handler, ctx, request("\ufeff{}"));
  expect(ctx.runAction.mock.calls[0]?.[1]?.body).toBe("\ufeff{}");
});
