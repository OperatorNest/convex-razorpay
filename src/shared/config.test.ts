import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "../component/_generated/api.js";
import { readConfig, resolveRazorpayTestMode } from "./config.js";
import schema from "../component/schema.js";
import { restoreRazorpayTestState, stubRazorpayEnv, expectRazorpayError } from "../test-helpers.js";

const modules = import.meta.glob(["../component/**/*.ts", "!../component/**/*.test.ts"]);
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
  await expectRazorpayError(
    t.action(api.orders.create, {
      amount: 100,
      currency: "INR",
      partialPayment: false,
      testMode: true,
    }),
    "RAZORPAY_NOT_CONFIGURED",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("component env rejects unpaired UTF-16 surrogates", async () => {
  await expectRazorpayError(
    Promise.resolve().then(() => readConfig({ RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "\ud800" })),
    "RAZORPAY_NOT_CONFIGURED",
  );
});

test.each([
  [{}, undefined, false],
  [{}, true, true],
  [{ RAZORPAY_TEST_MODE: "true" }, undefined, true],
  [{ RAZORPAY_TEST_MODE: "false" }, false, false],
  [{ RAZORPAY_KEY_ID: "rzp_test_public" }, undefined, true],
  [{ RAZORPAY_KEY_ID: "rzp_test_public", RAZORPAY_TEST_MODE: "false" }, false, true],
  [{ RAZORPAY_KEY_ID: "rzp_live_public" }, undefined, false],
  [{ RAZORPAY_KEY_ID: "rzp_live_public" }, false, false],
])("resolveRazorpayTestMode with env %j and option %s resolves %s", (env, option, expected) => {
  expect(resolveRazorpayTestMode(option, env)).toBe(expected);
});

test.each([
  [{ RAZORPAY_KEY_ID: "rzp_live_public" }, true],
  [{ RAZORPAY_KEY_ID: "rzp_live_public", RAZORPAY_TEST_MODE: "true" }, undefined],
])("resolveRazorpayTestMode rejects a live key in test mode", async (env, option) => {
  await expectRazorpayError(
    Promise.resolve().then(() => resolveRazorpayTestMode(option, env)),
    "RAZORPAY_LIVE_KEY_TEST_MODE",
  );
});
