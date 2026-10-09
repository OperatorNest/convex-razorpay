import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import schema from "./schema.js";

export const notesArg = v.optional(schema.tables.orders.validator.fields.notes);
export const linkArgs = {
  userId: schema.tables.orders.validator.fields.userId,
  externalId: schema.tables.orders.validator.fields.externalId,
  metadata: schema.tables.orders.validator.fields.metadata,
  idempotencyKey: schema.tables.orders.validator.fields.idempotencyKey,
  testMode: v.optional(v.boolean()),
};
export const pageArgs = {
  count: v.optional(v.number()),
  skip: v.optional(v.number()),
  testMode: v.optional(v.boolean()),
};

export function validateCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency))
    throw razorpayError(
      "RAZORPAY_INVALID_ARGUMENT",
      "Currency must be a three-letter uppercase code",
    );
}

export function validateAmount(amount: number, minimum = 1): void {
  if (!Number.isSafeInteger(amount) || amount < minimum)
    throw razorpayError(
      "RAZORPAY_INVALID_ARGUMENT",
      "Amount must be an integer in currency subunits",
    );
}

export function validatePage(count?: number, skip?: number): { count: number; skip: number } {
  const cappedCount = count ?? 10;
  const offset = skip ?? 0;
  if (
    !Number.isSafeInteger(cappedCount) ||
    cappedCount < 1 ||
    cappedCount > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 900
  )
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid page size or offset");
  return { count: cappedCount, skip: offset };
}

/** Order and refund receipts: 1-40 printable ASCII characters. */
export function validateReceipt(receipt: string | undefined, label: string): void {
  if (receipt === undefined) return;
  if (receipt.length === 0 || receipt.length > 40 || !/^[\x20-\x7e]+$/.test(receipt))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid ${label} receipt`);
}

export function validateIdempotencyKey(key?: string): void {
  if (key === undefined) return;
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(key)) {
    throw razorpayError(
      "RAZORPAY_INVALID_ARGUMENT",
      "Idempotency key must contain 10-128 letters, digits, hyphens, or underscores",
    );
  }
}

export function optionalLinkage(link: {
  userId?: string | undefined;
  externalId?: string | undefined;
  metadata?: Record<string, string> | undefined;
  idempotencyKey?: string | undefined;
  requestFingerprint?: string | undefined;
  testMode?: boolean | undefined;
  createdThroughComponent?: boolean | undefined;
}) {
  return {
    ...(link.userId === undefined ? {} : { userId: link.userId }),
    ...(link.externalId === undefined ? {} : { externalId: link.externalId }),
    ...(link.metadata === undefined ? {} : { metadata: link.metadata }),
    ...(link.idempotencyKey === undefined ? {} : { idempotencyKey: link.idempotencyKey }),
    ...(link.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: link.requestFingerprint }),
    ...(link.testMode === undefined ? {} : { testMode: link.testMode }),
    ...(link.createdThroughComponent === undefined
      ? {}
      : { createdThroughComponent: link.createdThroughComponent }),
  };
}
