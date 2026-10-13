import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { readConfig } from "./config.js";
import schema from "./schema.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(restoreRazorpayTestState);

test.each([
  ["RAZORPAY_KEY_ID", "invalid"],
  ["RAZORPAY_KEY_ID", "rzp_test_"],
  ["RAZORPAY_KEY_SECRET", ""],
  ["RAZORPAY_WEBHOOK_SECRET", " surrounded "],
  ["RAZORPAY_WEBHOOK_SECRET_PREVIOUS", " prior "],
  ["RAZORPAY_TEST_MODE", "TRUE"],
  ["RAZORPAY_TEST_MODE", ""],
])("malformed %s rejects a test create before contacting Razorpay", async (variable, value) => {
  stubRazorpayEnv({ testMode: "true" });
  vi.stubEnv(variable, value);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const t = convexTest(schema, modules);
  await expect(
    t.action(api.orders.create, {
      amount: 100,
      currency: "INR",
      partialPayment: false,
      testMode: true,
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_NOT_CONFIGURED" } });
  expect(fetch).not.toHaveBeenCalled();
});

test("component env rejects unpaired UTF-16 surrogates", () => {
  expect(() => readConfig({ RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "\ud800" })).toThrowError(
    expect.objectContaining({ data: expect.objectContaining({ code: "RAZORPAY_NOT_CONFIGURED" }) }),
  );
});
