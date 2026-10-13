import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, describe, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import {
  restoreRazorpayTestState,
  stubRazorpayEnv,
  expectRazorpayError,
  expectRazorpayErrorDetails,
} from "../test-helpers.js";

function stubSandboxEnv(): void {
  stubRazorpayEnv({ keyId: "rzp_test_fixture", keySecret: "fixture_secret" });
}

describe("customers", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const customer = {
    name: "Buyer",
    email: "buyer@example.test",
    idempotencyKey: "customer_key_1",
    testMode: true,
  };

  beforeEach(() =>
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" }),
  );

  afterEach(restoreRazorpayTestState);

  test.each([
    { userId: "other" },
    { gstin: "1234567890ABCDE" },
    { notes: { sku: "other" } },
    { externalId: "other" },
    { metadata: { sku: "other" } },
  ])("customer keyed create rejects changed request %j", async (change) => {
    const t = harness();
    await t.action(api.customers.create, { ...customer, userId: "owner" });
    await expectRazorpayError(
      t.action(api.customers.create, { ...customer, userId: "owner", ...change }),
      "RAZORPAY_IDEMPOTENCY_CONFLICT",
    );
  });

  test("getOrCreate rejects attaching ownership without a profile change", async () => {
    const t = harness();
    const first = await t.action(api.customers.create, customer);
    await expectRazorpayError(
      t.action(api.customers.getOrCreate, { ...customer, userId: "owner" }),
      "RAZORPAY_CUSTOMER_CONFLICT",
    );
    expect(
      await t.action(api.customers.fetch, {
        razorpayCustomerId: first.razorpayCustomerId,
        testMode: true,
      }),
    ).not.toHaveProperty("userId");
  });
});

describe("customers", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  beforeEach(() => {
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Unexpected HTTP"))),
    );
  });

  afterEach(restoreRazorpayTestState);

  test.each([
    { stored: undefined, requested: "owner" },
    { stored: "owner", requested: undefined },
    { stored: "owner", requested: "other" },
  ])("keyed getOrCreate requires exact owner equality %j", async ({ stored, requested }) => {
    const t = harness();
    const args = {
      name: "Original Buyer",
      email: "original@example.test",
      idempotencyKey: "fixture_customer",
      testMode: true,
    };
    const first = await t.action(api.customers.create, {
      ...args,
      ...(stored === undefined ? {} : { userId: stored }),
    });
    await expectRazorpayError(
      t.action(api.customers.getOrCreate, {
        ...args,
        name: "Changed Buyer",
        email: "changed@example.test",
        ...(requested === undefined ? {} : { userId: requested }),
      }),
      "RAZORPAY_CUSTOMER_CONFLICT",
    );
    expect(
      await t.action(api.customers.fetch, {
        razorpayCustomerId: first.razorpayCustomerId,
        testMode: true,
      }),
    ).toMatchObject({ name: "Original Buyer", email: "original@example.test" });
  });

  const keyedArgs = {
    name: "Keyed Buyer",
    email: "keyed@example.test",
    idempotencyKey: "fixture_customer_claim",
  };

  const providerCustomer = {
    entity: "customer",
    id: "cust_provider_fixture",
    name: keyedArgs.name,
    email: keyedArgs.email,
    notes: { operatornestIdempotencyKey: keyedArgs.idempotencyKey },
    created_at: 1_567_674_599,
  };

  const readClaims = (t: ReturnType<typeof harness>) =>
    t.run((ctx) => ctx.db.query("idempotencyRequests").take(10));

  test("a keyed customer create with an rzp_test_ key posts the claim note once and completes the claim", async () => {
    stubSandboxEnv();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(providerCustomer),
    );
    vi.stubGlobal("fetch", fetch);
    const t = harness();
    const created = await t.action(api.customers.create, keyedArgs);
    expect(created).toMatchObject({
      razorpayCustomerId: providerCustomer.id,
      idempotencyKey: keyedArgs.idempotencyKey,
      testMode: true,
    });
    expect(await t.action(api.customers.create, keyedArgs)).toEqual(created);
    expect(fetch).toHaveBeenCalledTimes(1);
    const requestBody = fetch.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected customer request body");
    expect(JSON.parse(requestBody)).toMatchObject({
      notes: { operatornestIdempotencyKey: keyedArgs.idempotencyKey },
      fail_existing: "1",
    });
    expect(await readClaims(t)).toMatchObject([
      {
        resource: "customer",
        testMode: true,
        status: "completed",
        razorpayEntityId: providerCustomer.id,
      },
    ]);
  });

  test("a stale customer claim reconciles from the provider customer listing without a second POST", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_567_674_600_000);
    stubSandboxEnv();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "SERVER_ERROR" } }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          entity: "collection",
          count: 2,
          items: [{ id: "cust_other", notes: [] }, providerCustomer],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const t = harness();
    await expectRazorpayErrorDetails(
      t.action(api.customers.create, keyedArgs),
      "RAZORPAY_PROVIDER_ERROR",
      { providerStatus: 503 },
    );
    vi.setSystemTime(1_567_674_600_000 + 11 * 60_000);
    expect(await t.action(api.customers.create, keyedArgs)).toMatchObject({
      razorpayCustomerId: providerCustomer.id,
      testMode: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("/customers?count=100&skip=0");
    expect(await readClaims(t)).toMatchObject([{ resource: "customer", status: "completed" }]);
  });

  test("a definitive customer rejection fails the claim so the same request can post again", async () => {
    stubSandboxEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })),
    );
    const t = harness();
    await expectRazorpayErrorDetails(
      t.action(api.customers.create, keyedArgs),
      "RAZORPAY_PROVIDER_ERROR",
      { providerStatus: 400 },
    );
    expect(await readClaims(t)).toMatchObject([{ resource: "customer", status: "failed" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(providerCustomer)),
    );
    expect(await t.action(api.customers.create, keyedArgs)).toMatchObject({
      razorpayCustomerId: providerCustomer.id,
    });
  });

  test("a completed customer claim whose provider customer kept another key returns that customer without posting", async () => {
    stubSandboxEnv();
    const fetch = vi.fn(async () => Response.json(providerCustomer));
    vi.stubGlobal("fetch", fetch);
    const t = harness();
    const first = await t.action(api.customers.getOrCreate, keyedArgs);
    const secondKey = { ...keyedArgs, idempotencyKey: "fixture_customer_second" };
    const adopted = await t.action(api.customers.getOrCreate, secondKey);
    expect(adopted).toMatchObject({ _id: first._id, idempotencyKey: keyedArgs.idempotencyKey });
    expect(await t.action(api.customers.getOrCreate, secondKey)).toMatchObject({ _id: first._id });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readClaims(t)).toMatchObject([
      { idempotencyKey: keyedArgs.idempotencyKey, status: "completed" },
      { idempotencyKey: secondKey.idempotencyKey, status: "completed" },
    ]);
  });
});
