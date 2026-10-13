import { razorpayError } from "./errors.js";

// repository-config:begin
/** Lists the Razorpay environment variables the component reads. */
export type ComponentEnv = {
  readonly RAZORPAY_KEY_ID?: string;
  readonly RAZORPAY_KEY_SECRET?: string;
  readonly RAZORPAY_WEBHOOK_SECRET?: string;
  readonly RAZORPAY_WEBHOOK_SECRET_PREVIOUS?: string;
  readonly RAZORPAY_TEST_MODE?: string;
};

/** Validates every Razorpay environment variable and returns validated values only; never resolves test mode. Throws `RAZORPAY_NOT_CONFIGURED` on any malformed value. */
export function readConfig(env: ComponentEnv) {
  const keyId = readSecret(env.RAZORPAY_KEY_ID);
  const keySecret = readSecret(env.RAZORPAY_KEY_SECRET);
  const webhookSecret = readSecret(env.RAZORPAY_WEBHOOK_SECRET);
  const previousWebhookSecret = readSecret(env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS);
  if (
    (keyId !== undefined && !/^rzp_(test|live)_[A-Za-z0-9_]+$/.test(keyId)) ||
    (env.RAZORPAY_TEST_MODE !== undefined &&
      env.RAZORPAY_TEST_MODE !== "true" &&
      env.RAZORPAY_TEST_MODE !== "false")
  )
    throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  return { keyId, keySecret, webhookSecret, previousWebhookSecret };
}
// repository-config:end

/** Returns a configured value or throws `RAZORPAY_NOT_CONFIGURED`. */
export function requireConfigValue(value: string | undefined): string {
  if (value === undefined) throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  return value;
}

// shared-block:begin
/** Returns `undefined` for an unset value and `value` when it is non-empty, well-formed and equal to its trim; otherwise throws `RAZORPAY_NOT_CONFIGURED`. */
export function readSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === "" || !value.isWellFormed() || value.trim() !== value)
    throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  return value;
}

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
