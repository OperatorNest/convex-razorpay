import { ConvexError } from "convex/values";
import { isRecord, wellFormed, truncateText } from "./validation.js";

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

const errorMessages = {
  RAZORPAY_INVALID_ARGUMENT: "An argument is invalid, missing or out of bounds.",
  RAZORPAY_INVALID_RESPONSE: "The provider response is invalid or a required mirror is missing.",
  RAZORPAY_NOT_CONFIGURED: "Razorpay API credentials are missing.",
  RAZORPAY_LIVE_KEY_TEST_MODE: "Test mode cannot use a live Razorpay key.",
  RAZORPAY_MODE_MISMATCH: "The operation and mirror have different modes.",
  RAZORPAY_CUSTOMER_CONFLICT: "The customer belongs to another app user.",
  RAZORPAY_IDEMPOTENCY_REQUIRED: "Refund creation requires an idempotency key or receipt.",
  RAZORPAY_IDEMPOTENCY_CONFLICT:
    "The idempotency key or receipt identifies a different create request.",
  RAZORPAY_IDEMPOTENCY_PENDING:
    "The create outcome is pending or unknown; reconcile before retrying.",
  RAZORPAY_NOT_FOUND: "The required mirror does not exist.",
  RAZORPAY_PROVIDER_REJECTED: "Razorpay rejected the request.",
  RAZORPAY_HTTP_ERROR: "Razorpay returned an HTTP failure with an uncertain outcome.",
  RAZORPAY_NETWORK_ERROR: "The Razorpay network request failed with an uncertain outcome.",
  RAZORPAY_WEBHOOK_SECRET_MISSING: "The webhook signing secret is missing.",
  RAZORPAY_INVALID_WEBHOOK_SIGNATURE: "The webhook signature is invalid.",
  RAZORPAY_MALFORMED_WEBHOOK: "The webhook body or envelope is invalid or exceeds the size limit.",
  RAZORPAY_INVALID_ENTITY: "The webhook entities or their relationships are invalid.",
} as const satisfies Record<RazorpayErrorCode, string>;

export type RazorpayErrorData = {
  code: RazorpayErrorCode;
  message: string;
  providerStatus?: number;
  providerCode?: string;
};
export type RazorpayError = ConvexError<RazorpayErrorData>;

export function isRazorpayError(error: unknown): error is RazorpayError {
  if (!(error instanceof ConvexError) || !isRecord(error.data)) return false;
  const data = error.data;
  return (
    errorCodes.some((code) => code === data.code) &&
    typeof data.message === "string" &&
    (data.providerStatus === undefined ||
      (typeof data.providerStatus === "number" &&
        Number.isInteger(data.providerStatus) &&
        data.providerStatus >= 100 &&
        data.providerStatus <= 599)) &&
    (data.providerCode === undefined ||
      (typeof data.providerCode === "string" &&
        data.providerCode.length <= 64 &&
        wellFormed(data.providerCode))) &&
    Object.keys(data).every((key) =>
      ["code", "message", "providerStatus", "providerCode"].includes(key),
    )
  );
}

export function razorpayError(
  code: RazorpayErrorCode,
  provider?: { providerStatus: number; providerCode?: string },
): RazorpayError {
  return new ConvexError({ code, message: errorMessages[code], ...provider });
}

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
  const code = definitive ? "RAZORPAY_PROVIDER_REJECTED" : "RAZORPAY_HTTP_ERROR";
  const providerCode = typeof fields.code === "string" ? truncateText(fields.code, 64) : undefined;
  return {
    code,
    message: errorMessages[code],
    providerStatus: statusCode,
    ...(providerCode === undefined ? {} : { providerCode }),
  };
}

export function providerErrorCode(error: unknown): RazorpayErrorCode {
  return isRazorpayError(error) ? error.data.code : "RAZORPAY_HTTP_ERROR";
}

export function isDefinitiveNoCreate(error: unknown): boolean {
  return isRazorpayError(error) && error.data.code === "RAZORPAY_PROVIDER_REJECTED";
}

export function getOrThrow<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw razorpayError("RAZORPAY_INVALID_RESPONSE");
  }
  return value;
}
