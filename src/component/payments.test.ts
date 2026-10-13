import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, describe, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import {
  restoreRazorpayTestState,
  stubRazorpayEnv,
  expectRazorpayError,
  expectRazorpayErrorDetails,
} from "../test-helpers.js";

function stubCaptureRejection(current: unknown) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) =>
    init.method === "POST"
      ? Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })
      : Response.json(current),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("payments", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

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
    await expectRazorpayError(
      t
        .query(api.payments.list, {
          paginationOpts: { numItems, cursor: null },
          razorpayOrderId: "order_fixture",
        })
        .then(({ page }) => page),
      "RAZORPAY_INVALID_ARGUMENT",
    );
    await expectRazorpayError(
      t
        .query(api.subscriptions.list, {
          paginationOpts: { numItems, cursor: null },
          userId: "owner",
        })
        .then(({ page }) => page),
      "RAZORPAY_INVALID_ARGUMENT",
    );
  });

  test.each(["invalid", "{}", "null", '[{"$integer":"invalid"}]'])(
    "stored payment lists reject malformed cursor %s at either boundary",
    async (cursor) => {
      const t = harness();
      for (const paginationOpts of [
        { numItems: 1, cursor },
        { numItems: 1, cursor: null, endCursor: cursor },
      ]) {
        await expectRazorpayError(
          t.query(api.payments.list, { razorpayOrderId: "order_fixture", paginationOpts }),
          "RAZORPAY_INVALID_ARGUMENT",
        );
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

  const authorizedPayment = {
    entity: "payment",
    id: "pay_capture_fixture",
    amount: 5000,
    currency: "INR",
    status: "authorized",
    captured: false,
    amount_refunded: 0,
    created_at: 1_567_674_500,
  };

  const capturedPayment = { ...authorizedPayment, status: "captured", captured: true };

  const captureArgs = { razorpayPaymentId: authorizedPayment.id, amount: 5000, currency: "INR" };

  test("a capture 4xx for a payment already captured with the requested amount stores and returns it", async () => {
    const fetch = stubCaptureRejection(capturedPayment);
    const t = harness();
    const captured = await t.action(api.payments.capture, captureArgs);
    expect(captured).toMatchObject({
      razorpayPaymentId: authorizedPayment.id,
      status: "captured",
      captured: true,
      testMode: true,
    });
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
    expect(await t.query(internal.lookup.payment, { id: authorizedPayment.id })).toMatchObject({
      status: "captured",
    });
  });

  test.each([
    { case: "an uncaptured payment", current: authorizedPayment },
    { case: "a different captured amount", current: { ...capturedPayment, amount: 4000 } },
    { case: "a different captured currency", current: { ...capturedPayment, currency: "USD" } },
  ])("a capture 4xx rethrows the original error for $case", async ({ current }) => {
    stubCaptureRejection(current);
    const t = harness();
    await expectRazorpayErrorDetails(
      t.action(api.payments.capture, captureArgs),
      "RAZORPAY_PROVIDER_ERROR",
      { providerStatus: 400 },
    );
    expect(await t.query(internal.lookup.payment, { id: authorizedPayment.id })).toBeNull();
  });
});
