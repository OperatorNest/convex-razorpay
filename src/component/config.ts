import { wellFormed } from "../shared/validation.js";
import { razorpayError } from "../shared/errors.js";

type ComponentEnv = {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS?: string;
  RAZORPAY_TEST_MODE?: string;
};

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
    testMode: env.RAZORPAY_TEST_MODE === "true",
  };
}

export function requireConfigValue(value: string | undefined): string {
  if (value === undefined) throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  return value;
}
