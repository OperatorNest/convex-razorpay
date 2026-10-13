import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import {
  setupTest,
  stubRazorpayEnv,
  restoreRazorpayTestState,
  expectRazorpayErrorDetails,
  stubFetch,
} from "../test-helpers.js";

const calls = [
  { operation: "read", keyed: false, read: true },
  { operation: "keyed create", keyed: true, read: false },
  { operation: "unkeyed create", keyed: false, read: false },
];

afterEach(restoreRazorpayTestState);

const createArgs = { amount: 1000, currency: "INR", partialPayment: false };

test.each(calls)(
  "$operation reports retryable only for transient repeat-safe failures",
  async ({ keyed, read }) => {
    stubRazorpayEnv({ keyId: "rzp_test_fixture", keySecret: "fixture_secret" });
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500, 503]) {
      const t = setupTest();
      stubFetch(() =>
        Response.json(
          { error: { code: "PROVIDER_CODE", description: "Private field" } },
          { status },
        ),
      );
      const operation = read
        ? t.action(api.orders.fetch, { razorpayOrderId: "order_fixture" })
        : t.action(api.orders.create, {
            ...createArgs,
            idempotencyKey: keyed ? "checkout_1" : undefined,
          });
      await expectRazorpayErrorDetails(operation, "RAZORPAY_PROVIDER_ERROR", {
        providerStatus: status,
        retryable: status === 429 || ((read || keyed) && (status === 408 || status >= 500)),
      });
      if (keyed && status === 408)
        expect(await t.run((ctx) => ctx.db.query("idempotencyRequests").first())).toMatchObject({
          status: "pending",
        });
    }
  },
);

test.each(calls)(
  "$operation reports network and timeout retryability without exposing transport details",
  async ({ keyed, read }) => {
    stubRazorpayEnv({ keyId: "rzp_test_fixture", keySecret: "fixture_secret" });
    for (const timeout of [false, true]) {
      vi.useFakeTimers();
      const t = setupTest();
      stubFetch(({ init }) => {
        if (!timeout) throw new TypeError("Disconnected after send");
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new TypeError("Timed out after send")),
          ),
        );
      });
      const operation = read
        ? t.action(api.orders.fetch, { razorpayOrderId: "order_fixture" })
        : t.action(api.orders.create, {
            ...createArgs,
            idempotencyKey: keyed ? "checkout_1" : undefined,
          });
      const assertion = expectRazorpayErrorDetails(operation, "RAZORPAY_NETWORK_ERROR", {
        retryable: read || keyed,
      });
      if (timeout) {
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
        await vi.advanceTimersByTimeAsync(10_000);
      }
      await assertion;
      vi.useRealTimers();
    }
  },
);
