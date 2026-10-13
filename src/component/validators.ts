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
  if (!/^[A-Z]{3}$/.test(currency)) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
}

export function validateAmount(amount: number, minimum = 1): void {
  if (!Number.isSafeInteger(amount) || amount < minimum)
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
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
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return { count: cappedCount, skip: offset };
}

export function validateReceipt(receipt: string | undefined): void {
  if (receipt === undefined) return;
  if (receipt.length === 0 || receipt.length > 40 || !/^[\x20-\x7e]+$/.test(receipt))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
}

export function validateIdempotencyKey(key?: string): void {
  if (key === undefined) return;
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(key)) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
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

export function timestampSeconds(timestampAt: number | undefined): number | undefined {
  if (timestampAt === undefined) return undefined;
  if (!Number.isSafeInteger(timestampAt) || timestampAt < 0)
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return Math.floor(timestampAt / 1000);
}
