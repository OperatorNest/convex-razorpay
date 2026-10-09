import { razorpayError } from "../shared/errors.js";
import { ConvexError, v } from "convex/values";
import { action, query, env } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  isTestMode,
  requestProvider,
} from "./provider.js";
import {
  deterministicTestId,
  isRecord,
  linkedNotes,
  record,
  stableStringify,
  validateNotes,
} from "../shared/validation.js";
import { isDefinitiveNoCreate, providerErrorCode } from "../shared/errors.js";
import { sha256Hex } from "../shared/crypto.js";
import {
  linkArgs,
  notesArg,
  validateAmount,
  validateCurrency,
  validateIdempotencyKey,
  validateReceipt,
} from "./validators.js";
import { optionalLinkage } from "./validators.js";

const idempotencyNote = "operatornestIdempotencyKey";

function orderResult(order: Doc<"orders">): { order: Doc<"orders">; keyId?: string } {
  return { order, ...(env.RAZORPAY_KEY_ID === undefined ? {} : { keyId: env.RAZORPAY_KEY_ID }) };
}

/**
 * Razorpay requires receipts to be unique per account. When a create is rejected as a duplicate
 * receipt, the earlier order is adopted only if it is provably the same request.
 */
async function recoverDuplicateReceipt(
  error: unknown,
  receipt: string | undefined,
  expected: { amount: number; currency: string; notes: Record<string, string> },
): Promise<unknown> {
  const duplicate =
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    /same receipt|duplicate receipt/i.test(String(error.data.message));
  if (!duplicate || !receipt) return null;
  const found = collectionItems(
    await requestProvider("GET", `/orders?receipt=${encodeURIComponent(receipt)}&count=1`, {
      idempotent: true,
    }),
  );
  if (found.length !== 1) return null;
  const recovered = record(found[0]);
  const notes = isRecord(recovered.notes) ? recovered.notes : {};
  if (
    recovered.receipt !== receipt ||
    recovered.amount !== expected.amount ||
    recovered.currency !== expected.currency ||
    notes.userId !== expected.notes.userId ||
    notes.externalId !== expected.notes.externalId ||
    notes[idempotencyNote] !== expected.notes[idempotencyNote]
  ) {
    throw razorpayError(
      "RAZORPAY_IDEMPOTENCY_CONFLICT",
      "Duplicate receipt points to a different order",
    );
  }
  return found[0];
}

export const create = action({
  args: {
    amount: v.number(),
    currency: v.string(),
    receipt: v.optional(v.string()),
    notes: notesArg,
    partialPayment: v.optional(v.boolean()),
    ...linkArgs,
  },
  returns: v.object({ order: schema.doc("orders"), keyId: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ order: Doc<"orders">; keyId?: string }> => {
    const testMode = isTestMode(args.testMode);
    validateAmount(args.amount, 100);
    validateCurrency(args.currency);
    validateIdempotencyKey(args.idempotencyKey);
    validateReceipt(args.receipt, "order");
    const key = args.idempotencyKey;
    // The fingerprint covers everything that makes two orders different, including who the
    // order is for, so a key reused by another user is a conflict rather than a returned order.
    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(key ? { [idempotencyNote]: key } : {}),
    });
    const fingerprint = stableStringify({
      amount: args.amount,
      currency: args.currency,
      receipt: args.receipt,
      partialPayment: args.partialPayment,
      notes,
    });
    const receipt =
      args.receipt ?? (key ? `rcpt_${(await sha256Hex(key)).slice(0, 35)}` : undefined);
    let shouldReconcile = false;
    if (key) {
      const claim = await ctx.runMutation(internal.idempotency.claim, {
        resource: "order",
        key,
        fingerprint,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.orderByKey, { key });
        if (!existing)
          throw razorpayError("RAZORPAY_NOT_FOUND", "Completed order claim has no mirror");
        assertModeMatches(existing, testMode, "order");
        return orderResult(existing);
      }
      shouldReconcile = claim === "reconcile";
    }
    const failClaim = async (error: unknown) => {
      if (key && isDefinitiveNoCreate(error))
        await ctx.runMutation(internal.idempotency.fail, {
          resource: "order",
          key,
          fingerprint,
          errorCode: providerErrorCode(error),
        });
    };
    let raw: unknown;
    if (testMode) {
      raw = {
        id: await deterministicTestId("order", [
          key ?? receipt ?? crypto.randomUUID(),
          args.amount,
          args.currency,
        ]),
        entity: "order",
        amount: args.amount,
        amount_paid: 0,
        amount_due: args.amount,
        currency: args.currency,
        receipt: receipt ?? null,
        status: "created",
        attempts: 0,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    } else {
      if (shouldReconcile && key)
        raw = (await findByIdempotencyKey("order", key, receipt)) ?? undefined;
      if (raw === undefined) {
        try {
          raw = await requestProvider("POST", "/orders", {
            body: {
              amount: args.amount,
              currency: args.currency,
              receipt,
              notes,
              partial_payment: args.partialPayment,
            },
          });
        } catch (error) {
          let recovered: unknown;
          try {
            recovered = await recoverDuplicateReceipt(error, receipt, {
              amount: args.amount,
              currency: args.currency,
              notes,
            });
          } catch (conflict) {
            await failClaim(error);
            throw conflict;
          }
          if (recovered === null) {
            await failClaim(error);
            throw error;
          }
          raw = recovered;
        }
      }
    }
    const order = await ctx.runMutation(internal.mutations.putOrder, {
      raw,
      observedAt: Date.now(),
      ...optionalLinkage({
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: key,
        requestFingerprint: key ? fingerprint : undefined,
        createdThroughComponent: true,
        testMode,
      }),
    });
    return orderResult(order);
  },
});

export const fetch = action({
  args: { orderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("orders"),
  handler: async (ctx, { orderId, testMode }): Promise<Doc<"orders">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.order, { id: orderId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND", "Order not found in test mode");
      assertModeMatches(local, true, "order");
      return local;
    }
    const raw = await requestProvider("GET", `/orders/${encodeURIComponent(orderId)}`, {
      idempotent: true,
    });
    if (record(raw).id !== orderId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay order id mismatch");
    return ctx.runMutation(internal.mutations.putOrder, { raw, observedAt: Date.now() });
  },
});

export const fetchPayments = action({
  args: { orderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.array(schema.doc("payments")),
  handler: async (ctx, { orderId, testMode }): Promise<Doc<"payments">[]> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.paymentsForOrder, { orderId, limit: 100 });
      for (const payment of local) assertModeMatches(payment, true, "payment");
      return local;
    }
    const items = collectionItems(
      await requestProvider("GET", `/orders/${encodeURIComponent(orderId)}/payments`, {
        idempotent: true,
      }),
    );
    for (const raw of items)
      if (record(raw).order_id !== orderId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay order payment mismatch");
    return Promise.all(
      items.map((raw) =>
        ctx.runMutation(internal.mutations.putPayment, { raw, observedAt: Date.now() }),
      ),
    );
  },
});

export const get = query({
  args: { orderId: v.string() },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { orderId }) =>
    ctx.db
      .query("orders")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", orderId))
      .unique(),
});
