import { ConvexError } from "convex/values";
import { isRecord } from "./validation.js";

const errorCodes = [
  "RAZORPAY_INVALID_ARGUMENT",
  "RAZORPAY_INVALID_RESPONSE",
  "RAZORPAY_NOT_CONFIGURED",
  "RAZORPAY_LIVE_KEY_TEST_MODE",
  "RAZORPAY_MODE_MISMATCH",
  "RAZORPAY_CUSTOMER_CONFLICT",
  "RAZORPAY_IDEMPOTENCY_REQUIRED",
  "RAZORPAY_IDEMPOTENCY_CONFLICT",
  "RAZORPAY_IDEMPOTENCY_PENDING",
  "RAZORPAY_NOT_FOUND",
  "RAZORPAY_PROVIDER_REJECTED",
  "RAZORPAY_HTTP_ERROR",
  "RAZORPAY_NETWORK_ERROR",
  "RAZORPAY_WEBHOOK_SECRET_MISSING",
  "RAZORPAY_INVALID_WEBHOOK_SIGNATURE",
  "RAZORPAY_MALFORMED_WEBHOOK",
  "RAZORPAY_INVALID_ENTITY",
] as const;

export type RazorpayErrorCode = (typeof errorCodes)[number];

function isRazorpayErrorCode(value: unknown): value is RazorpayErrorCode {
  return typeof value === "string" && errorCodes.some((code) => code === value);
}

export type RazorpayErrorData = {
  code: RazorpayErrorCode;
  message: string;
  retryable?: boolean;
};

export type RazorpayError = ConvexError<RazorpayErrorData>;

export function isRazorpayError(error: unknown): error is RazorpayError {
  if (!(error instanceof ConvexError) || !isRecord(error.data)) return false;
  return (
    isRazorpayErrorCode(error.data.code) &&
    typeof error.data.message === "string" &&
    (error.data.retryable === undefined || typeof error.data.retryable === "boolean")
  );
}

export function razorpayError(
  code: RazorpayErrorCode,
  message: string,
  retryable?: boolean,
): RazorpayError {
  return new ConvexError({ code, message, ...(retryable === undefined ? {} : { retryable }) });
}

export function retryableStatus(
  statusCode: number,
  idempotent: boolean,
  description = "",
  refund = false,
): boolean {
  if (!idempotent) return false;
  return (
    statusCode === 429 ||
    statusCode >= 500 ||
    (refund && statusCode === 409) ||
    (statusCode === 400 && /concurrent operation in progress/i.test(description))
  );
}

export function classifyProviderError(
  statusCode: number,
  body: unknown,
  idempotent: boolean,
  refund = false,
): RazorpayErrorData {
  const error = isRecord(body) ? body.error : null;
  const fields = isRecord(error) ? error : {};
  const description =
    typeof fields.description === "string" && fields.description.length > 0
      ? fields.description
      : `Razorpay request failed (${statusCode})`;
  const definitive =
    statusCode >= 400 && statusCode < 500 && statusCode !== 409 && statusCode !== 429;
  return {
    code: definitive ? "RAZORPAY_PROVIDER_REJECTED" : "RAZORPAY_HTTP_ERROR",
    message: description,
    retryable: retryableStatus(statusCode, idempotent, description, refund),
  };
}

export function providerErrorCode(error: unknown): RazorpayErrorCode {
  return isRazorpayError(error) ? error.data.code : "RAZORPAY_HTTP_ERROR";
}

export function isDefinitiveNoCreate(error: unknown): boolean {
  return isRazorpayError(error) && error.data.code === "RAZORPAY_PROVIDER_REJECTED";
}

export function getOrThrow<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw razorpayError("RAZORPAY_INVALID_RESPONSE", message);
  }
  return value;
}
