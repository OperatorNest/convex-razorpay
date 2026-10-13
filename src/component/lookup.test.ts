import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, describe } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

describe("lookup", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const customer = {
    name: "Buyer",
    email: "buyer@example.test",
    idempotencyKey: "customer_key_1",
    testMode: true,
  };

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

  test("live local reads omit test-mode mirrors", async () => {
    const t = harness();
    const order = (
      await t.action(api.orders.create, {
        partialPayment: false,
        amount: 1000,
        currency: "INR",
        testMode: true,
      })
    ).order;
    await t.action(api.customers.create, { ...customer, userId: "owner" });
    await t.action(api.subscriptions.create, {
      quantity: 1,
      customerNotify: true,
      razorpayPlanId: "plan_fixture",
      totalCount: 12,
      userId: "owner",
      testMode: true,
    });
    await t.mutation(internal.mutations.putPayment, {
      raw: { ...payment, order_id: order.razorpayOrderId },
      observedAt: 100,
      testMode: true,
    });
    expect(await t.query(api.orders.get, { razorpayOrderId: order.razorpayOrderId })).toBeNull();
    expect(await t.query(api.customers.get, { userId: "owner" })).toBeNull();
    expect(await t.query(api.subscriptions.get, { userId: "owner" })).toBeNull();
    expect(
      await t
        .query(api.subscriptions.list, {
          paginationOpts: { numItems: 100, cursor: null },
          userId: "owner",
        })
        .then(({ page }) => page),
    ).toEqual([]);
    expect(
      await t
        .query(api.payments.list, {
          paginationOpts: { numItems: 100, cursor: null },
          razorpayOrderId: order.razorpayOrderId,
        })
        .then(({ page }) => page),
    ).toEqual([]);
  });
});
