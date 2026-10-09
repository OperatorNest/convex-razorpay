import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

beforeEach(() => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fabricated_secret");
  vi.stubEnv("RAZORPAY_TEST_MODE", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("live customer create, keyed retry, profile refresh, and fetch mirror provider changes", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      requests.push(`${init.method} ${path}`);
      if (init.method === "POST" && path === "/v1/customers") {
        return new Response(
          JSON.stringify({
            entity: "customer",
            id: "cust_live_fixture",
            name: "Alice Example",
            email: "alice@example.com",
            contact: "9999999999",
            notes: {},
            created_at: 1_567_674_500,
          }),
        );
      }
      if (init.method === "PUT" && path === "/v1/customers/cust_live_fixture") {
        if (typeof init.body !== "string") throw new Error("Expected customer update body");
        const body: { name?: string } = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            entity: "customer",
            id: "cust_live_fixture",
            name: body.name ?? "Alice Updated",
            email: "alice@example.com",
            contact: "9999999999",
            notes: {},
            created_at: 1_567_674_500,
          }),
        );
      }
      if (init.method === "GET" && path === "/v1/customers/cust_live_fixture") {
        return new Response(
          JSON.stringify({
            entity: "customer",
            id: "cust_live_fixture",
            name: "Alice Updated",
            email: "alice@example.com",
            contact: "9999999999",
            notes: {},
            created_at: 1_567_674_500,
          }),
        );
      }
      throw new Error(`Unexpected provider request: ${init.method} ${path}`);
    }),
  );
  const t = convexTest(schema, modules);
  const args = {
    name: "Alice Example",
    email: "alice@example.com",
    contact: "9999999999",
    userId: "user_live_customer",
    idempotencyKey: "customer_live_fixture_key",
    testMode: false,
  };

  const created = await t.action(api.customers.create, args);
  const repeated = await t.action(api.customers.create, args);
  expect(repeated._id).toBe(created._id);
  const edited = await t.action(api.customers.edit, {
    customerId: created.razorpayId,
    name: "Alice Updated",
    testMode: false,
  });
  expect(edited.name).toBe("Alice Updated");
  const fetched = await t.action(api.customers.fetch, {
    customerId: created.razorpayId,
    testMode: false,
  });
  expect(fetched._id).toBe(created._id);
  expect(fetched.name).toBe("Alice Updated");
  const refreshed = await t.action(api.customers.getOrCreate, {
    ...args,
    name: "Alice Refreshed",
    idempotencyKey: "customer_refresh_fixture_key",
  });
  expect(refreshed.name).toBe("Alice Refreshed");
  expect(await t.query(api.customers.getByUser, { userId: "user_live_customer" })).toMatchObject({
    razorpayId: "cust_live_fixture",
    name: "Alice Refreshed",
  });
  expect(requests).toEqual([
    "POST /v1/customers",
    "PUT /v1/customers/cust_live_fixture",
    "GET /v1/customers/cust_live_fixture",
    "PUT /v1/customers/cust_live_fixture",
  ]);
});

test("live payment capture and refund mirror provider state without accepting an over-refund", async () => {
  const initialPayment = {
    entity: "payment",
    id: "pay_live_fixture",
    order_id: "order_live_fixture",
    amount: 5000,
    currency: "INR",
    status: "authorized",
    captured: false,
    amount_refunded: 0,
    created_at: 1_567_674_500,
  };
  const capturedPayment = { ...initialPayment, status: "captured", captured: true };
  const providerRefund = {
    entity: "refund",
    id: "rfnd_live_fixture",
    payment_id: "pay_live_fixture",
    amount: 2000,
    currency: "INR",
    status: "processed",
    notes: {},
    created_at: 1_567_674_501,
  };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = `${new URL(url).pathname}${new URL(url).search}`;
    if (init.method === "POST" && path === "/v1/payments/pay_live_fixture/capture") {
      return new Response(JSON.stringify(capturedPayment));
    }
    if (init.method === "POST" && path === "/v1/payments/pay_live_fixture/refund") {
      return new Response(JSON.stringify(providerRefund));
    }
    if (init.method === "GET" && path === "/v1/refunds/rfnd_live_fixture") {
      return new Response(JSON.stringify(providerRefund));
    }
    if (init.method === "GET" && path === "/v1/payments/pay_live_fixture") {
      return new Response(JSON.stringify(capturedPayment));
    }
    if (init.method === "GET" && path === "/v1/payments?count=1&skip=0") {
      return new Response(
        JSON.stringify({ entity: "collection", count: 1, items: [capturedPayment] }),
      );
    }
    throw new Error(`Unexpected provider request: ${init.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  await t.mutation(internal.mutations.putPayment, { raw: initialPayment, observedAt: Date.now() });

  const captured = await t.action(api.payments.capture, {
    paymentId: "pay_live_fixture",
    amount: 5000,
    currency: "INR",
    testMode: false,
  });
  expect(captured).toMatchObject({ status: "captured", captured: true });
  const refunded = await t.action(api.refunds.create, {
    paymentId: "pay_live_fixture",
    amount: 2000,
    idempotencyKey: "refund_live_fixture_key",
    testMode: false,
  });
  expect(refunded).toMatchObject({
    razorpayId: "rfnd_live_fixture",
    paymentId: "pay_live_fixture",
    amount: 2000,
  });
  expect(
    await t.query(internal.refunds.e2eRefund, { refundId: refunded.razorpayId }),
  ).toMatchObject({
    _id: refunded._id,
    razorpayId: "rfnd_live_fixture",
    paymentId: "pay_live_fixture",
    amount: 2000,
    status: "processed",
    testMode: false,
  });
  expect((await t.action(api.refunds.fetch, { refundId: refunded.razorpayId }))._id).toBe(
    refunded._id,
  );
  expect((await t.action(api.payments.fetch, { paymentId: captured.razorpayId }))._id).toBe(
    captured._id,
  );
  expect(await t.action(api.payments.list, { count: 1, skip: 0 })).toMatchObject([
    { razorpayId: "pay_live_fixture", status: "captured" },
  ]);
  expect(fetch).toHaveBeenCalledTimes(5);
});

test("live duplicate-receipt order is reconciled and its provider payments are mirrored", async () => {
  const order = {
    entity: "order",
    id: "order_reconciled",
    amount: 5000,
    amount_paid: 0,
    amount_due: 5000,
    currency: "INR",
    receipt: "rcpt_reconciled",
    status: "created",
    attempts: 0,
    notes: {},
    created_at: 1_567_674_500,
  };
  const payment = {
    entity: "payment",
    id: "pay_reconciled",
    order_id: order.id,
    amount: 5000,
    currency: "INR",
    status: "authorized",
    captured: false,
    amount_refunded: 0,
    created_at: 1_567_674_501,
  };
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = `${new URL(url).pathname}${new URL(url).search}`;
      requests.push(`${init.method} ${path}`);
      if (init.method === "POST" && path === "/v1/orders") {
        return new Response(
          JSON.stringify({
            error: { code: "BAD_REQUEST_ERROR", description: "Same receipt already exists" },
          }),
          { status: 400 },
        );
      }
      if (init.method === "GET" && path === "/v1/orders?receipt=rcpt_reconciled&count=1") {
        return new Response(JSON.stringify({ entity: "collection", count: 1, items: [order] }));
      }
      if (init.method === "GET" && path === "/v1/orders/order_reconciled") {
        return new Response(JSON.stringify(order));
      }
      if (init.method === "GET" && path === "/v1/orders/order_reconciled/payments") {
        return new Response(JSON.stringify({ entity: "collection", count: 1, items: [payment] }));
      }
      throw new Error(`Unexpected provider request: ${init.method} ${path}`);
    }),
  );
  const t = convexTest(schema, modules);

  const created = await t.action(api.orders.create, {
    amount: 5000,
    currency: "INR",
    receipt: "rcpt_reconciled",
    testMode: false,
  });
  expect(created.order.razorpayId).toBe(order.id);
  const fetched = await t.action(api.orders.fetch, { orderId: order.id, testMode: false });
  expect(fetched._id).toBe(created.order._id);
  const payments = await t.action(api.orders.fetchPayments, { orderId: order.id, testMode: false });
  expect(payments).toMatchObject([{ razorpayId: payment.id, orderId: order.id }]);
  expect(await t.query(api.payments.listForOrder, { orderId: order.id })).toHaveLength(1);
  expect(requests).toEqual([
    "POST /v1/orders",
    "GET /v1/orders?receipt=rcpt_reconciled&count=1",
    "GET /v1/orders/order_reconciled",
    "GET /v1/orders/order_reconciled/payments",
  ]);
});

test("explicit test mode refuses missing mirrors without calling the provider", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("Provider must not be called");
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);

  await expect(
    t.action(api.orders.fetch, { orderId: "order_missing", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
  await expect(
    t.action(api.payments.fetch, { paymentId: "pay_missing", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
  await expect(
    t.action(api.refunds.fetch, { refundId: "rfnd_missing", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
  await expect(
    t.action(api.customers.fetch, { customerId: "cust_missing", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
  await expect(
    t.action(api.plans.fetch, { planId: "plan_missing", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
  await expect(
    t.action(api.subscriptions.fetch, { subscriptionId: "sub_missing", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_FOUND" } });
  expect(fetch).not.toHaveBeenCalled();
});

test("invalid public create and capture arguments fail with structured errors before HTTP", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("Provider must not be called");
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);

  await expect(
    t.action(api.orders.create, { amount: 1, currency: "INR", testMode: true }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  await expect(
    t.action(api.orders.create, {
      amount: 5000,
      currency: "INR",
      receipt: "x".repeat(41),
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  await expect(
    t.action(api.customers.create, {
      name: "Alice Example",
      email: "not-an-email",
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  await expect(
    t.action(api.refunds.create, {
      paymentId: "pay_missing",
      amount: 100,
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_REQUIRED" } });
  await expect(
    t.action(api.payments.capture, {
      paymentId: "pay_missing",
      amount: 0,
      currency: "INR",
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
  expect(fetch).not.toHaveBeenCalled();
});
