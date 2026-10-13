import {
  isRazorpayError,
  razorpayError,
  type RazorpayErrorCode,
  type RazorpayErrorData,
} from "./errors.js";
import type { ConvexError } from "convex/values";
import { isRecord } from "./validation.js";

function isRefusalStatus(statusCode: number): boolean {
  return (
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 409 &&
    statusCode !== 429
  );
}

/** Returns a provider error whose retry eligibility requires both a transient failure and a repeat-safe call, except that 429 is always repeat-safe. */
export function classifyProviderError(
  statusCode: number,
  body: unknown,
  isRepeatSafe: boolean,
): ConvexError<RazorpayErrorData> {
  const fields = isRecord(body) && isRecord(body.error) ? body.error : {};
  return razorpayError("RAZORPAY_PROVIDER_ERROR", {
    retryable:
      statusCode === 429 ||
      (isRepeatSafe && (statusCode === 408 || (statusCode >= 500 && statusCode < 600))),
    providerStatus: statusCode,
    providerCode: typeof fields.code === "string" ? fields.code : undefined,
  });
}

export function providerErrorCode(error: unknown): RazorpayErrorCode {
  return isRazorpayError(error) ? error.data.code : "RAZORPAY_PROVIDER_ERROR";
}

/** Returns true for a provider error whose status shows a create was refused without effect: a 4xx other than 408, 409 and 429. Create endpoints report no concurrent operations, so the status alone decides. */
export function isDefinitiveNoCreate(error: unknown): boolean {
  return (
    isRazorpayError(error) &&
    error.data.code === "RAZORPAY_PROVIDER_ERROR" &&
    error.data.providerStatus !== undefined &&
    isRefusalStatus(error.data.providerStatus)
  );
}

export function getOrThrow<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw razorpayError("RAZORPAY_INVALID_RESPONSE");
  }
  return value;
}

export function parseProviderResponse<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw razorpayError("RAZORPAY_INVALID_RESPONSE");
  }
}
