import {
  isRazorpayError,
  razorpayError,
  type RazorpayErrorCode,
  type RazorpayErrorData,
} from "./errors.js";
import { isRecord, truncateText } from "./validation.js";

export function classifyProviderError(statusCode: number, body: unknown): RazorpayErrorData {
  const fields = isRecord(body) && isRecord(body.error) ? body.error : {};
  const concurrent =
    typeof fields.description === "string" &&
    /concurrent operation in progress/i.test(fields.description);
  const definitive =
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 409 &&
    statusCode !== 429 &&
    !concurrent;
  const code = "RAZORPAY_PROVIDER_ERROR";
  const providerCode = typeof fields.code === "string" ? truncateText(fields.code, 64) : undefined;
  return {
    code,
    message: razorpayError(code).data.message,
    retryable: !definitive,
    providerStatus: statusCode,
    ...(providerCode === undefined ? {} : { providerCode }),
  };
}

export function providerErrorCode(error: unknown): RazorpayErrorCode {
  return isRazorpayError(error) ? error.data.code : "RAZORPAY_PROVIDER_ERROR";
}

export function isDefinitiveNoCreate(error: unknown): boolean {
  return (
    isRazorpayError(error) &&
    error.data.code === "RAZORPAY_PROVIDER_ERROR" &&
    error.data.retryable === false
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
