import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, describe } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

describe("payments", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const invalid = { data: { code: "RAZORPAY_INVALID_ARGUMENT" } };

  beforeEach(() =>
    stubRazorpayEnv({
      keyId: "rzp_test_fixture",
      keySecret: "fixture_secret",
      webhookSecret: "fixture_webhook",
    }),
  );

  afterEach(restoreRazorpayTestState);

  test.each([1.5, 0, 101])("stored lists reject page size %s", async (numItems) => {
    const t = harness();
    await expect(
      t
        .query(api.payments.list, {
          paginationOpts: { numItems, cursor: null },
          razorpayOrderId: "order_fixture",
        })
        .then(({ page }) => page),
    ).rejects.toMatchObject(invalid);
    await expect(
      t
        .query(api.subscriptions.list, {
          paginationOpts: { numItems, cursor: null },
          userId: "owner",
        })
        .then(({ page }) => page),
    ).rejects.toMatchObject(invalid);
  });

  test.each(["invalid", "{}", "null", '[{"$integer":"invalid"}]'])(
    "stored payment lists reject malformed cursor %s at either boundary",
    async (cursor) => {
      const t = harness();
      for (const paginationOpts of [
        { numItems: 1, cursor },
        { numItems: 1, cursor: null, endCursor: cursor },
      ]) {
        await expect(
          t.query(api.payments.list, { razorpayOrderId: "order_fixture", paginationOpts }),
        ).rejects.toMatchObject(invalid);
      }
    },
  );

  test("stored payment pages continue without overlap and bound endCursor reads", async () => {
    const t = harness();
    for (let index = 0; index < 5; index++) {
      await t.mutation(internal.mutations.putPayment, {
        raw: {
          id: `pay_page_${index}`,
          entity: "payment",
          order_id: "order_fixture",
          amount: 1000,
          currency: "INR",
          status: "captured",
          captured: true,
          created_at: index,
        },
        observedAt: index,
        testMode: true,
      });
    }
    const read = (paginationOpts: {
      numItems: number;
      cursor: string | null;
      endCursor?: string;
    }) =>
      t.query(api.payments.list, {
        razorpayOrderId: "order_fixture",
        paginationOpts,
        testMode: true,
      });
    const first = await read({ numItems: 1, cursor: null });
    const second = await read({ numItems: 1, cursor: first.continueCursor });
    expect(first.isDone).toBe(false);
    expect(first.page.map((payment) => payment.razorpayPaymentId)).toEqual(["pay_page_4"]);
    expect(second.page.map((payment) => payment.razorpayPaymentId)).toEqual(["pay_page_3"]);
    const full = await read({ numItems: 5, cursor: null });
    const bounded = await read({ numItems: 1, cursor: null, endCursor: full.continueCursor });
    expect(bounded.page.map((payment) => payment.razorpayPaymentId)).toEqual([
      "pay_page_4",
      "pay_page_3",
    ]);
    expect(bounded.isDone).toBe(false);
    const next = await read({ numItems: 1, cursor: bounded.continueCursor });
    expect(next.page.map((payment) => payment.razorpayPaymentId)).toEqual(["pay_page_2"]);
  });
});
