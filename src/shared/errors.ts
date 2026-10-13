import { ConvexError } from "convex/values";
import { isRecord, wellFormed, truncateText } from "./validation.js";

export const RAZORPAY_ERROR_CODES = [
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
  "RAZORPAY_PROVIDER_ERROR",
  "RAZORPAY_NETWORK_ERROR",
  "RAZORPAY_INVALID_WEBHOOK_SIGNATURE",
  "RAZORPAY_MALFORMED_WEBHOOK",
  "RAZORPAY_INVALID_ENTITY",
] as const;

/** Identifies the fixed reason a Razorpay operation failed. */
export type RazorpayErrorCode = (typeof RAZORPAY_ERROR_CODES)[number];

const errorMessages = {
  RAZORPAY_INVALID_ARGUMENT: "An argument is invalid, missing or out of bounds.",
  RAZORPAY_INVALID_RESPONSE: "The provider response is invalid or a required mirror is missing.",
  RAZORPAY_NOT_CONFIGURED: "Razorpay component configuration is missing or invalid.",
  RAZORPAY_LIVE_KEY_TEST_MODE: "Test mode cannot use a live Razorpay key.",
  RAZORPAY_MODE_MISMATCH: "The operation and mirror have different modes.",
  RAZORPAY_CUSTOMER_CONFLICT: "The customer belongs to another app user.",
  RAZORPAY_IDEMPOTENCY_REQUIRED: "Refund creation requires an idempotency key or receipt.",
  RAZORPAY_IDEMPOTENCY_CONFLICT:
    "The idempotency key or receipt identifies a different create request.",
  RAZORPAY_IDEMPOTENCY_PENDING:
    "The create outcome is pending or unknown; reconcile before retrying.",
  RAZORPAY_NOT_FOUND: "The required mirror does not exist.",
  RAZORPAY_PROVIDER_ERROR: "Razorpay returned a failure response.",
  RAZORPAY_NETWORK_ERROR: "The Razorpay network request failed with an uncertain outcome.",
  RAZORPAY_INVALID_WEBHOOK_SIGNATURE: "The webhook signature is invalid.",
  RAZORPAY_MALFORMED_WEBHOOK: "The webhook body or envelope is invalid or exceeds the size limit.",
  RAZORPAY_INVALID_ENTITY: "The webhook entities or their relationships are invalid.",
} as const satisfies Record<RazorpayErrorCode, string>;

/** Contains a fixed Razorpay failure message and bounded provider details. */
export type RazorpayErrorData = {
  code: RazorpayErrorCode;
  message: string;
  retryable?: boolean;
  providerStatus?: number;
  providerCode?: string;
};

/** Identify a Razorpay error with its fixed message and bounded provider details. */
export function isRazorpayError(error: unknown): error is ConvexError<RazorpayErrorData> {
  if (!(error instanceof ConvexError) || !isRecord(error.data)) return false;
  const data = error.data;
  const code = RAZORPAY_ERROR_CODES.find((candidate) => candidate === data.code);
  return (
    code !== undefined &&
    data.message === errorMessages[code] &&
    (data.retryable === undefined ||
      ((data.code === "RAZORPAY_PROVIDER_ERROR" || data.code === "RAZORPAY_NETWORK_ERROR") &&
        typeof data.retryable === "boolean")) &&
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
      ["code", "message", "retryable", "providerStatus", "providerCode"].includes(key),
    )
  );
}

export function razorpayError(
  code: RazorpayErrorCode,
  details?: { retryable?: boolean; providerStatus?: number; providerCode?: string },
): ConvexError<RazorpayErrorData> {
  return new ConvexError({
    code,
    message: errorMessages[code],
    ...(code === "RAZORPAY_PROVIDER_ERROR" || code === "RAZORPAY_NETWORK_ERROR"
      ? { retryable: details?.retryable ?? true }
      : {}),
    ...(details?.providerStatus === undefined ? {} : { providerStatus: details.providerStatus }),
    ...(details?.providerCode === undefined
      ? {}
      : { providerCode: truncateText(details.providerCode, 64) }),
  });
}
