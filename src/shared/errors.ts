import { ConvexError } from "convex/values";
import { truncateText } from "./bounds.js";

// repository-codes:begin
/** Every code a Razorpay component error can carry, each with one fixed message in the README error table. */
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
  "RAZORPAY_INVALID_PAYMENT_SIGNATURE",
  "RAZORPAY_STALE_WEBHOOK",
  "RAZORPAY_MALFORMED_WEBHOOK",
  "RAZORPAY_INVALID_ENTITY",
] as const;

const RAZORPAY_PROVIDER_ERROR_CODES = [
  "RAZORPAY_PROVIDER_ERROR",
  "RAZORPAY_NETWORK_ERROR",
] as const satisfies readonly RazorpayErrorCode[];

const RAZORPAY_ERROR_MESSAGES = {
  RAZORPAY_INVALID_ARGUMENT: "An argument is missing, malformed or out of bounds.",
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
  RAZORPAY_NETWORK_ERROR: "The request to Razorpay failed before a response arrived.",
  RAZORPAY_INVALID_WEBHOOK_SIGNATURE: "The webhook signature is missing or wrong.",
  RAZORPAY_INVALID_PAYMENT_SIGNATURE: "The Checkout payment signature is invalid.",
  RAZORPAY_STALE_WEBHOOK: "The webhook event is older than the deduplication retention window.",
  RAZORPAY_MALFORMED_WEBHOOK: "The webhook body or envelope is invalid or exceeds the size limit.",
  RAZORPAY_INVALID_ENTITY: "The webhook entities or their relationships are invalid.",
} as const satisfies Record<RazorpayErrorCode, string>;
// repository-codes:end

const ERROR_DATA_KEYS: ReadonlySet<string> = new Set([
  "code",
  "message",
  "retryable",
  "providerStatus",
  "providerCode",
]);

/** One fixed caller-visible failure; `RAZORPAY_ERROR_CODES` lists every code. */
export type RazorpayErrorCode = (typeof RAZORPAY_ERROR_CODES)[number];

/** Error data: the code, its fixed message and bounded provider failure details. `retryable` is present exactly on provider-originated codes. */
export type RazorpayErrorData = {
  code: RazorpayErrorCode;
  message: string;
  /** `true` only when the failure may be transient (a network failure, a timeout, or provider status 408, 429 or 5xx) and repeating the identical call cannot create a second provider effect (the call is a read, carries an idempotency key the component or provider deduplicates, or failed with a 429 or before the request was sent). */
  retryable?: boolean;
  providerStatus?: number;
  providerCode?: string;
};

type ProviderErrorCode = (typeof RAZORPAY_PROVIDER_ERROR_CODES)[number];

type ErrorDetails<Code extends RazorpayErrorCode> = [Code] extends [
  Exclude<RazorpayErrorCode, ProviderErrorCode>,
]
  ? [details?: { retryable?: never; providerStatus?: number; providerCode?: string }]
  : [details: { retryable: boolean; providerStatus?: number; providerCode?: string }];

function isProviderErrorCode(code: unknown): code is ProviderErrorCode {
  return RAZORPAY_PROVIDER_ERROR_CODES.some((candidate) => candidate === code);
}

/** Creates the error for `code` with its fixed message. Provider-originated codes require `details.retryable`; other codes forbid it. `providerCode` is truncated to 64 characters. */
export function razorpayError<Code extends RazorpayErrorCode>(
  code: Code,
  ...[details]: ErrorDetails<Code>
): ConvexError<RazorpayErrorData> {
  return new ConvexError({
    code,
    message: RAZORPAY_ERROR_MESSAGES[code],
    ...(isProviderErrorCode(code) &&
      details?.retryable !== undefined && { retryable: details.retryable }),
    ...(details?.providerStatus !== undefined && { providerStatus: details.providerStatus }),
    ...(details?.providerCode !== undefined && {
      providerCode: truncateText(details.providerCode, 64),
    }),
  });
}

/** Returns true when `error` carries exactly a known code, its fixed message, `retryable` on provider-originated codes only, and well-formed provider details. */
export function isRazorpayError(error: unknown): error is ConvexError<RazorpayErrorData> {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("code" in data) || !("message" in data))
    return false;
  const { code, message } = data;
  return (
    Object.keys(data).every((key) => ERROR_DATA_KEYS.has(key)) &&
    RAZORPAY_ERROR_CODES.some(
      (candidate) => candidate === code && message === RAZORPAY_ERROR_MESSAGES[candidate],
    ) &&
    ("retryable" in data
      ? isProviderErrorCode(code) && typeof data.retryable === "boolean"
      : !isProviderErrorCode(code)) &&
    (!("providerStatus" in data) ||
      (typeof data.providerStatus === "number" &&
        Number.isInteger(data.providerStatus) &&
        data.providerStatus >= 100 &&
        data.providerStatus <= 599)) &&
    (!("providerCode" in data) ||
      (typeof data.providerCode === "string" &&
        data.providerCode.isWellFormed() &&
        data.providerCode.length <= 64))
  );
}
