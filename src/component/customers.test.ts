import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, describe, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

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
    stubRazorpayEnv({
      keyId: "rzp_test_fixture",
      keySecret: "fixture_secret",
      webhookSecret: "fixture_webhook",
    }),
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
    await expect(
      t.action(api.customers.create, { ...customer, userId: "owner", ...change }),
    ).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_CONFLICT" } });
  });

  test("getOrCreate rejects attaching ownership without a profile change", async () => {
    const t = harness();
    const first = await t.action(api.customers.create, customer);
    await expect(
      t.action(api.customers.getOrCreate, { ...customer, userId: "owner" }),
    ).rejects.toMatchObject({ data: { code: "RAZORPAY_CUSTOMER_CONFLICT" } });
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
    await expect(
      t.action(api.customers.getOrCreate, {
        ...args,
        name: "Changed Buyer",
        email: "changed@example.test",
        ...(requested === undefined ? {} : { userId: requested }),
      }),
    ).rejects.toMatchObject({ data: { code: "RAZORPAY_CUSTOMER_CONFLICT" } });
    expect(
      await t.action(api.customers.fetch, {
        razorpayCustomerId: first.razorpayCustomerId,
        testMode: true,
      }),
    ).toMatchObject({ name: "Original Buyer", email: "original@example.test" });
  });
});
