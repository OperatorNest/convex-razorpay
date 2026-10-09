import { makeFunctionReference } from "convex/server";
import { stubRazorpayEnv, restoreRazorpayTestState } from "../../src/test-helpers.js";
import { hmacSha256Hex } from "@operatornest/convex-razorpay";
import { register } from "@operatornest/convex-razorpay/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const ingestWithCallback = makeFunctionReference<
  "action",
  { body: string; signature: string; eventId: string; shouldFail?: boolean },
  { status: "processed" | "duplicate" | "ignored" | "failed" }
>("test-helpers.fixtures:ingestWithCallback");

beforeEach(() => {
  stubRazorpayEnv({ testMode: "true" });
});

afterEach(() => {
  restoreRazorpayTestState();
});

test("getForUser prefers a e2e subscription over a newer abandoned checkout", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const active = await t.action(components.razorpay.subscriptions.create, {
    planId: "plan_fixture",
    totalCount: 12,
    userId: "user_returning",
    idempotencyKey: "active_subscription_key",
    testMode: true,
  });
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_subscription_priority");
  const envelope = JSON.stringify({
    entity: "event",
    event: "subscription.activated",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      subscription: {
        entity: {
          id: active.razorpayId,
          entity: "subscription",
          plan_id: "plan_fixture",
          status: "active",
          quantity: 1,
          total_count: 12,
          paid_count: 0,
          remaining_count: 12,
          notes: { userId: "user_returning" },
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
  });
  await t.action(components.razorpay.webhooks.ingest, {
    body: envelope,
    signature: await hmacSha256Hex("whsec_subscription_priority", envelope),
    eventId: "evt_subscription_priority",
  });
  const abandoned = await t.action(components.razorpay.subscriptions.create, {
    planId: "plan_fixture",
    totalCount: 12,
    userId: "user_returning",
    idempotencyKey: "abandoned_checkout_key",
    testMode: true,
  });
  expect(abandoned.razorpayId).not.toBe(active.razorpayId);
  expect(
    (await t.query(components.razorpay.subscriptions.getForUser, { userId: "user_returning" }))
      ?.razorpayId,
  ).toBe(active.razorpayId);
  expect(
    (
      await t.query(components.razorpay.subscriptions.getForUser, {
        userId: "user_returning",
        statuses: ["created"],
      })
    )?.razorpayId,
  ).toBe(abandoned.razorpayId);
  await expect(
    t.query(components.razorpay.subscriptions.getForUser, {
      userId: "user_returning",
      statuses: Array.from({ length: 21 }, (_, index) => `status_${index}`),
    }),
  ).rejects.toThrow("Too many subscription statuses");
});

test("getOrCreate refreshes a user's customer profile and keeps omitted contact", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const first = await t.action(components.razorpay.customers.getOrCreate, {
    name: "Alice Example",
    email: "alice@example.test",
    contact: "+919876543210",
    userId: "user_profile",
    testMode: true,
  });
  const refreshed = await t.action(components.razorpay.customers.getOrCreate, {
    name: "Alice Updated",
    email: "alice.updated@example.test",
    userId: "user_profile",
    testMode: true,
  });
  expect(refreshed).toMatchObject({
    razorpayId: first.razorpayId,
    name: "Alice Updated",
    email: "alice.updated@example.test",
    contact: "+919876543210",
    testMode: true,
  });
});

test("keyed getOrCreate refreshes a same-owner profile and preserves omitted contact", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const first = await t.action(components.razorpay.customers.getOrCreate, {
    name: "Alice Example",
    email: "alice@example.test",
    contact: "+919876543210",
    userId: "user_keyed_profile",
    idempotencyKey: "keyed-customer-profile-key",
    testMode: true,
  });
  const updated = await t.action(components.razorpay.customers.getOrCreate, {
    name: "Alice Updated",
    email: "alice.updated@example.test",
    userId: "user_keyed_profile",
    idempotencyKey: "keyed-customer-profile-key",
    testMode: true,
  });
  expect(updated).toMatchObject({
    razorpayId: first.razorpayId,
    name: "Alice Updated",
    email: "alice.updated@example.test",
    contact: "+919876543210",
    testMode: true,
  });
});

test("getOrCreate refuses an idempotent provider customer already linked to another user", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const args = {
    name: "Alice Example",
    email: "alice@example.test",
    contact: "+919876543210",
    idempotencyKey: "customer-conflict-key",
    testMode: true,
  };
  await t.action(components.razorpay.customers.getOrCreate, { ...args, userId: "user_a" });
  await expect(
    t.action(components.razorpay.customers.getOrCreate, { ...args, userId: "user_b" }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_CUSTOMER_CONFLICT" } });
});

test("subscription.charged webhook links payment to its subscription and invoice", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_subscription_fixture");
  const t = convexTest(schema, modules);
  register(t);
  const body = JSON.stringify({
    entity: "event",
    event: "subscription.charged",
    created_at: 1_567_674_600,
    payload: {
      subscription: {
        entity: {
          id: "sub_charged_fixture",
          entity: "subscription",
          plan_id: "plan_fixture",
          status: "active",
          quantity: 1,
          total_count: 12,
          paid_count: 1,
          remaining_count: 11,
          created_at: 1_567_674_500,
          notes: {},
        },
      },
      payment: {
        entity: {
          id: "pay_subscription_fixture",
          entity: "payment",
          amount: 50000,
          currency: "INR",
          status: "captured",
          captured: true,
          invoice_id: "inv_subscription_fixture",
          created_at: 1_567_674_600,
        },
      },
    },
  });
  const response = await t.fetch("/razorpay/webhook", {
    method: "POST",
    body,
    headers: {
      "x-razorpay-signature": await hmacSha256Hex("whsec_subscription_fixture", body),
      "x-razorpay-event-id": "evt_subscription_charged_fixture",
    },
  });
  expect(response.status).toBe(200);
  const payments = await t.action(components.razorpay.payments.list, { testMode: true });
  expect(
    payments.find((payment) => payment.razorpayId === "pay_subscription_fixture"),
  ).toMatchObject({
    subscriptionId: "sub_charged_fixture",
    invoiceId: "inv_subscription_fixture",
  });
});

test("authenticated app creates and reads a deterministic local order", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  const fetch = vi.fn(() => {
    throw new Error("unexpected provider HTTP");
  });
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const alice = t.withIdentity({ tokenIdentifier: "test|alice" });
  const bob = t.withIdentity({ tokenIdentifier: "test|bob" });
  const order = await alice.action(api.example.createOrder, { cartId: "cart-one" });
  expect(order).toMatchObject({ amount: 50000, currency: "INR" });
  expect(order.orderId).toMatch(/^order_test_/);
  expect(await alice.query(api.example.getOrder, { orderId: order.orderId })).toMatchObject({
    status: "created",
  });
  expect(await bob.query(api.example.getOrder, { orderId: order.orderId })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test("app rejects unauthenticated order creation and reads", async () => {
  const t = convexTest(schema, modules);
  register(t);
  // App-level codes never reuse the component's RAZORPAY_ namespace.
  await expect(t.action(api.example.createOrder, { cartId: "cart-one" })).rejects.toMatchObject({
    data: { code: "APP_AUTH_REQUIRED", message: "Authentication required" },
  });
  await expect(
    t.query(api.example.getOrder, { orderId: "order_test_missing" }),
  ).rejects.toMatchObject({ data: { code: "APP_AUTH_REQUIRED" } });
});

const rawBody =
  '{"entity":"event","account_id":"acc_BFQ7uQEaa7j2z7","event":"payment.captured","contains":["payment"],"payload":{"payment":{"entity":{"id":"pay_IH4NVgf4wjLNgR","entity":"payment","amount":50000,"currency":"INR","status":"captured","order_id":"order_IluGWxBm9U8zJ8"}}},"created_at":1567674599}';
const signature = "50389d12aae5cc398dd32babe40e775b171a2d9df8890763bf7ca52e0c74ac68";

test("HTTP route rejects missing secret and invalid signature", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const request = (sig: string) =>
    t.fetch("/razorpay/webhook", {
      method: "POST",
      body: rawBody,
      headers: { "x-razorpay-event-id": "evt_example_1", "x-razorpay-signature": sig },
    });
  expect((await request(signature)).status).toBe(500);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret_123");
  expect((await request("0".repeat(64))).status).toBe(401);
});

test("HTTP route verifies the raw body, then deduplicates a retry", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret_123");
  const t = convexTest(schema, modules);
  register(t);
  const request = () =>
    t.fetch("/razorpay/webhook", {
      method: "POST",
      body: rawBody,
      headers: { "x-razorpay-event-id": "evt_example_2", "x-razorpay-signature": signature },
    });
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(200);
  const callbacks = await t.run((ctx) =>
    ctx.db
      .query("webhookNotifications")
      .withIndex("by_eventId", (q) => q.eq("eventId", "evt_example_2"))
      .take(2),
  );
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0]?.invocationCount).toBe(1);
  expect(await t.query(internal.e2e.notificationCount, { eventId: "evt_example_2" })).toBe(1);
});

test("callback invocation counter preserves one row and exposes each actual invocation", async () => {
  const t = convexTest(schema, modules);
  register(t);
  const event = { eventId: "evt_direct_callback", event: "payment.failed", createdAtProvider: 1 };

  await t.mutation(internal.webhookCallback.onEvent, event);
  await t.mutation(internal.webhookCallback.onEvent, event);

  const callbacks = await t.run((ctx) =>
    ctx.db
      .query("webhookNotifications")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.eventId))
      .take(2),
  );
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0]?.invocationCount).toBe(2);
  expect(await t.query(internal.e2e.notificationCount, { eventId: event.eventId })).toBe(2);
});

test("callback invocation counter upgrades a legacy row on the next invocation", async () => {
  const t = convexTest(schema, modules);
  register(t);
  await t.run((ctx) =>
    ctx.db.insert("webhookNotifications", {
      eventId: "evt_legacy_callback",
      event: "payment.failed",
    }),
  );

  await t.mutation(internal.webhookCallback.onEvent, {
    eventId: "evt_legacy_callback",
    event: "payment.failed",
    createdAtProvider: 1,
  });

  const row = await t.run((ctx) =>
    ctx.db
      .query("webhookNotifications")
      .withIndex("by_eventId", (q) => q.eq("eventId", "evt_legacy_callback"))
      .unique(),
  );
  expect(row?.invocationCount).toBe(2);
});

test("callback failure rolls back entity, callback, and dedupe writes so Razorpay can retry", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret_123");
  const t = convexTest(schema, modules);
  register(t);
  const body = JSON.stringify({
    entity: "event",
    event: "payment.failed",
    created_at: 1_567_674_599,
    payload: {
      payment: {
        entity: {
          id: "pay_callback_retry",
          entity: "payment",
          amount: 50000,
          currency: "INR",
          status: "failed",
          captured: false,
          created_at: 1_567_674_599,
        },
      },
    },
  });
  const callbackSignature = await hmacSha256Hex("whsec_test_secret_123", body);
  await expect(
    t.action(ingestWithCallback, {
      body,
      signature: callbackSignature,
      eventId: "evt_callback_retry",
      shouldFail: true,
    }),
  ).rejects.toThrow("deliberate callback retry test");
  expect(await t.run((ctx) => ctx.db.query("webhookNotifications").take(5))).toHaveLength(0);
  expect(await t.action(components.razorpay.payments.list, { testMode: true })).toHaveLength(0);

  expect(
    await t.action(ingestWithCallback, {
      body,
      signature: callbackSignature,
      eventId: "evt_callback_retry",
      shouldFail: false,
    }),
  ).toMatchObject({ status: "processed" });
  expect(
    await t.action(ingestWithCallback, {
      body,
      signature: callbackSignature,
      eventId: "evt_callback_retry_other_header",
      shouldFail: true,
    }),
  ).toMatchObject({ status: "duplicate" });
  expect(await t.run((ctx) => ctx.db.query("webhookNotifications").take(5))).toHaveLength(1);
});

test("HTTP route accepts the previous signing secret", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_new_secret");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET_PREVIOUS", "whsec_test_secret_123");
  const t = convexTest(schema, modules);
  register(t);
  const response = await t.fetch("/razorpay/webhook", {
    method: "POST",
    body: rawBody,
    headers: { "x-razorpay-event-id": "evt_previous", "x-razorpay-signature": signature },
  });
  expect(response.status).toBe(200);
});

test("HTTP route acknowledges and records a correctly signed malformed payload", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret_123");
  const t = convexTest(schema, modules);
  register(t);
  const body = "not-json";
  const response = await t.fetch("/razorpay/webhook", {
    method: "POST",
    body,
    headers: {
      "x-razorpay-event-id": "evt_malformed",
      "x-razorpay-signature": await hmacSha256Hex("whsec_test_secret_123", body),
    },
  });
  expect(response.status).toBe(200);
});

test("HTTP route bounds a large body before signature processing", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret_123");
  const t = convexTest(schema, modules);
  register(t);
  const response = await t.fetch("/razorpay/webhook", {
    method: "POST",
    body: "x".repeat(128 * 1024 + 1),
    headers: { "x-razorpay-event-id": "evt_large", "x-razorpay-signature": "0".repeat(64) },
  });
  expect(response.status).toBe(413);
});

test("e2e webhook recorder route is disabled unless the harness supplies a capability URL", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const response = await t.fetch("/razorpay/e2e/webhook", {
    method: "POST",
    body: rawBody,
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_e2e_disabled" },
  });
  expect(response.status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

test("e2e webhook recorder route forwards bounded raw bytes and only relevant headers", async () => {
  const recorderUrl = "http://127.0.0.1:4321/capability";
  vi.stubEnv("E2E_RECORDER_URL", recorderUrl);
  vi.stubEnv("CONVEX_SITE_URL", "https://convex-test.example");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("accepted", { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const response = await t.fetch("/razorpay/e2e/webhook", {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": "evt_e2e_forwarded",
      "x-unrelated-header": "ignored",
    },
  });
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  const originInit = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(fetch.mock.calls[0]?.[0]).toBe("https://convex-test.example/razorpay/webhook");
  expect(originInit.method).toBe("POST");
  expect(new TextDecoder().decode(originInit.body as Uint8Array)).toBe(rawBody);
  expect(new Headers(originInit.headers).get("x-unrelated-header")).toBeNull();
  const captureInit = fetch.mock.calls[1]?.[1] as RequestInit;
  expect(fetch.mock.calls[1]?.[0]).toBe(recorderUrl);
  expect(new TextDecoder().decode(captureInit.body as Uint8Array)).toBe(rawBody);
  expect(new Headers(captureInit.headers).get("x-e2e-forward-status")).toBe("200");
  expect(new Headers(captureInit.headers).get("x-razorpay-event-id")).toBe("evt_e2e_forwarded");
});

test("e2e webhook recorder captures bounded deliveries when origin forwarding fails", async () => {
  const recorderUrl = "http://127.0.0.1:4321/capability";
  vi.stubEnv("E2E_RECORDER_URL", recorderUrl);
  vi.stubEnv("CONVEX_SITE_URL", "https://convex-test.example");
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("origin unavailable"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);

  const response = await t.fetch("/razorpay/e2e/webhook", {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": "evt_e2e_origin_failure",
    },
  });

  expect(response.status).toBe(502);
  expect(fetch).toHaveBeenCalledTimes(2);
  const captureInit = fetch.mock.calls[1]?.[1] as RequestInit;
  expect(new Headers(captureInit.headers).get("x-razorpay-event-id")).toBe(
    "evt_e2e_origin_failure",
  );
  expect(new Headers(captureInit.headers).get("x-e2e-forward-status")).toBe("502");
  expect(new TextDecoder().decode(captureInit.body as Uint8Array)).toBe(rawBody);
});

test("e2e webhook recorder route rejects an oversized body before forwarding", async () => {
  vi.stubEnv("E2E_RECORDER_URL", "http://127.0.0.1:4321/capability");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  register(t);
  const response = await t.fetch("/razorpay/e2e/webhook", {
    method: "POST",
    body: "x".repeat(128 * 1024 + 1),
  });
  expect(response.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});

test("HTTP route records a signed unsupported event without callback", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret_123");
  const t = convexTest(schema, modules);
  register(t);
  const body = JSON.stringify({
    entity: "event",
    event: "payment_link.paid",
    created_at: 1567674599,
    payload: {},
  });
  const response = await t.fetch("/razorpay/webhook", {
    method: "POST",
    body,
    headers: {
      "x-razorpay-event-id": "evt_ignored",
      "x-razorpay-signature": await hmacSha256Hex("whsec_test_secret_123", body),
    },
  });
  expect(response.status).toBe(200);
  const callbacks = await t.run((ctx) => ctx.db.query("webhookNotifications").take(2));
  expect(callbacks).toHaveLength(0);
});
