import { wellFormed } from "./validation.js";
import { razorpayError } from "./errors.js";

/** Lists the Razorpay environment variables the component reads. */
export type ComponentEnv = {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS?: string;
  RAZORPAY_TEST_MODE?: string;
};

/** Reads and validates the Razorpay environment variables. */
export function readConfig(env: ComponentEnv) {
  for (const value of [
    env.RAZORPAY_KEY_ID,
    env.RAZORPAY_KEY_SECRET,
    env.RAZORPAY_WEBHOOK_SECRET,
    env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
  ]) {
    if (
      value !== undefined &&
      (value.length === 0 || value.trim() !== value || !wellFormed(value))
    ) {
      throw razorpayError("RAZORPAY_NOT_CONFIGURED");
    }
  }
  if (
    (env.RAZORPAY_KEY_ID !== undefined &&
      !/^rzp_(test|live)_[A-Za-z0-9_]+$/.test(env.RAZORPAY_KEY_ID)) ||
    (env.RAZORPAY_TEST_MODE !== undefined &&
      env.RAZORPAY_TEST_MODE !== "true" &&
      env.RAZORPAY_TEST_MODE !== "false")
  ) {
    throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  }
  return {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    previousWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
  };
}

/** Returns a configured value or throws `RAZORPAY_NOT_CONFIGURED`. */
export function requireConfigValue(value: string | undefined): string {
  if (value === undefined) throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  return value;
}

// shared-block:begin
/** Returns true when the caller requests test mode or `RAZORPAY_TEST_MODE` is `"true"`; the request can enable test mode and cannot disable it. */
export function resolveTestMode(requested: boolean | undefined, env: ComponentEnv): boolean {
  return requested === true || env.RAZORPAY_TEST_MODE === "true";
}
// shared-block:end

/** Returns `resolveTestMode` or true for an `rzp_test_` key ID, because Razorpay defines its Test Mode by test keys; throws `RAZORPAY_LIVE_KEY_TEST_MODE` for an `rzp_live_` key in test mode. */
export function resolveRazorpayTestMode(
  requested: boolean | undefined,
  env: ComponentEnv,
): boolean {
  const { keyId } = readConfig(env);
  const testMode = resolveTestMode(requested, env) || keyId?.startsWith("rzp_test_") === true;
  if (testMode && keyId?.startsWith("rzp_live_") === true)
    throw razorpayError("RAZORPAY_LIVE_KEY_TEST_MODE");
  return testMode;
}
