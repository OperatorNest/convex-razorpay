import {
  isRazorpayError,
  razorpayError,
  type RazorpayErrorCode,
  type RazorpayErrorData,
} from "./errors.js";
import type { ConvexError } from "convex/values";
import { isRecord } from "./validation.js";

function isRefusalStatus(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500 && statusCode !== 409 && statusCode !== 429;
}

/** Returns the provider error for a failure status. `retryable` is true when the call is repeat-safe or the provider definitively refused it without effect: a 4xx other than 409 and 429 whose description does not report a concurrent operation. */
export function classifyProviderError(
  statusCode: number,
  body: unknown,
  isRepeatSafe: boolean,
): ConvexError<RazorpayErrorData> {
  const fields = isRecord(body) && isRecord(body.error) ? body.error : {};
  const concurrent =
    typeof fields.description === "string" &&
    /concurrent operation in progress/i.test(fields.description);
  return razorpayError("RAZORPAY_PROVIDER_ERROR", {
    retryable: isRepeatSafe || (isRefusalStatus(statusCode) && !concurrent),
    providerStatus: statusCode,
    providerCode: typeof fields.code === "string" ? fields.code : undefined,
  });
}

export function providerErrorCode(error: unknown): RazorpayErrorCode {
  return isRazorpayError(error) ? error.data.code : "RAZORPAY_PROVIDER_ERROR";
}

/** Returns true for a provider error whose status shows a create was refused without effect: a 4xx other than 409 and 429. Create endpoints report no concurrent operations, so the status alone decides. */
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
