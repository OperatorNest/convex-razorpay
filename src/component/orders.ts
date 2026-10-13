import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action, query, env } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  isTestMode,
  resolveMode,
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
import { isRazorpayError, isDefinitiveNoCreate, providerErrorCode } from "../shared/errors.js";
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

async function recoverDuplicateReceipt(
  error: unknown,
  receipt: string | undefined,
  key: string | undefined,
  expected: {
    amount: number;
    currency: string;
    notes: Record<string, string>;
    partialPayment: boolean;
  },
): Promise<unknown> {
  if (!isRazorpayError(error) || error.data.providerStatus !== 400 || !receipt || !key) return null;
  const found = collectionItems(
    await requestProvider("GET", `/orders?receipt=${encodeURIComponent(receipt)}&count=1`, {
      idempotent: true,
    }),
  );
  if (found.length !== 1) return null;
  const recovered = record(found[0]);
  const notes = isRecord(recovered.notes) ? recovered.notes : {};
  if (notes.operatornestIdempotencyKey !== key) return null;
  if (
    recovered.receipt !== receipt ||
    recovered.amount !== expected.amount ||
    recovered.currency !== expected.currency ||
    stableStringify(notes) !== stableStringify(expected.notes) ||
    (recovered.partial_payment ?? false) !== expected.partialPayment
  ) {
    throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
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
    validateReceipt(args.receipt);
    const key = args.idempotencyKey;

    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(key ? { [idempotencyNote]: key } : {}),
    });
    const fingerprint = stableStringify({
      testMode,
      amount: args.amount,
      currency: args.currency,
      receipt: args.receipt,
      partialPayment: args.partialPayment ?? false,
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
        testMode,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.orderByKey, { key, testMode });
        if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND");
        assertModeMatches(existing, testMode);
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
          testMode,
          errorCode: providerErrorCode(error),
        });
    };
    let raw: unknown;
    if (testMode) {
      raw = {
        id: await deterministicTestId("order", [
          key ?? crypto.randomUUID(),
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
        partial_payment: args.partialPayment ?? false,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    } else {
      if (shouldReconcile && key) raw = await findByIdempotencyKey("order", key, receipt);
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
            recovered = await recoverDuplicateReceipt(error, receipt, key, {
              amount: args.amount,
              currency: args.currency,
              notes,
              partialPayment: args.partialPayment ?? false,
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
    try {
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
    } catch (error) {
      await failClaim(error);
      throw error;
    }
  },
});

export const fetch = action({
  args: { orderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("orders"),
  handler: async (ctx, { orderId, testMode }): Promise<Doc<"orders">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.order, { id: orderId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      return local;
    }
    const raw = await requestProvider("GET", `/orders/${encodeURIComponent(orderId)}`, {
      idempotent: true,
    });
    if (record(raw).id !== orderId) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    return ctx.runMutation(internal.mutations.putOrder, { raw, observedAt: Date.now() });
  },
});

export const fetchPayments = action({
  args: { orderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.array(schema.doc("payments")),
  handler: async (ctx, { orderId, testMode }): Promise<Doc<"payments">[]> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.paymentsForOrder, {
        orderId,
        limit: 100,
        testMode: true,
      });
      for (const payment of local) assertModeMatches(payment, true);
      return local;
    }
    const items = collectionItems(
      await requestProvider("GET", `/orders/${encodeURIComponent(orderId)}/payments`, {
        idempotent: true,
      }),
    );
    for (const raw of items)
      if (record(raw).order_id !== orderId) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    return Promise.all(
      items.map((raw) =>
        ctx.runMutation(internal.mutations.putPayment, { raw, observedAt: Date.now() }),
      ),
    );
  },
});

export const get = query({
  args: { orderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { orderId, testMode }) =>
    ctx.db
      .query("orders")
      .withIndex("by_testMode_and_razorpayId", (q) =>
        q.eq("testMode", resolveMode(testMode)).eq("razorpayId", orderId),
      )
      .unique(),
});
