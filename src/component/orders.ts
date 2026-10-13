import { parseProviderResponse } from "../shared/providerErrors.js";
import { validateIdempotencyKey } from "../shared/bounds.js";
import { paymentFields } from "./mapping.js";
import { orderFields } from "./mapping.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { readConfig, requireConfigValue } from "../shared/config.js";
import { razorpayError, isRazorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action, query, env, mutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  readTestMode,
  requestProvider,
  resolveProviderMode,
} from "./provider.js";
import {
  deterministicTestId,
  scopedIdempotencyKey,
  isRecord,
  linkedNotes,
  record,
  stableStringify,
  validateNotes,
} from "../shared/validation.js";
import { isDefinitiveNoCreate, providerErrorCode } from "../shared/providerErrors.js";
import { computeSha256Hex, verifyOrderCheckout } from "../shared/crypto.js";
import {
  linkArgs,
  notesArg,
  validateAmount,
  validateCurrency,
  validateReceipt,
  optionalLinkage,
} from "./validators.js";

const idempotencyNote = "operatornestIdempotencyKey";

function orderResult(order: Doc<"orders">): { order: Doc<"orders">; keyId?: string } {
  return {
    order,
    ...(readConfig(env).keyId === undefined ? {} : { keyId: readConfig(env).keyId }),
  };
}

async function recoverDuplicateReceipt(
  error: unknown,
  receipt: string | undefined,
  idempotencyKey: string | undefined,
  expected: {
    amount: number;
    currency: string;
    notes: Record<string, string>;
    partialPayment: boolean;
  },
): Promise<unknown> {
  if (!isRazorpayError(error) || error.data.providerStatus !== 400 || !receipt || !idempotencyKey)
    return null;
  const found = collectionItems(
    await requestProvider("GET", `/orders?receipt=${encodeURIComponent(receipt)}&count=1`),
  );
  if (found.length !== 1) return null;
  const recovered = record(found[0]);
  const notes = isRecord(recovered.notes) ? recovered.notes : {};
  if (notes.operatornestIdempotencyKey !== idempotencyKey) return null;
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
    partialPayment: v.boolean(),
    ...linkArgs,
  },
  returns: v.object({ order: schema.doc("orders"), keyId: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ order: Doc<"orders">; keyId?: string }> => {
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    validateAmount(args.amount);
    validateCurrency(args.currency);
    if (args.idempotencyKey !== undefined) validateIdempotencyKey(args.idempotencyKey);
    validateReceipt(args.receipt);
    const idempotencyKey = args.idempotencyKey;
    const providerKey = idempotencyKey
      ? await scopedIdempotencyKey("order", idempotencyKey, testMode, args.userId)
      : undefined;

    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(providerKey ? { [idempotencyNote]: providerKey } : {}),
    });
    const requestFingerprint = stableStringify({
      testMode,
      amount: args.amount,
      currency: args.currency,
      receipt: args.receipt,
      partialPayment: args.partialPayment,
      notes,
    });
    const receipt =
      args.receipt ??
      (providerKey ? `rcpt_${(await computeSha256Hex(providerKey)).slice(0, 35)}` : undefined);
    let shouldReconcile = false;
    if (idempotencyKey) {
      const claim = await ctx.runMutation(internal.idempotency.claim, {
        userId: args.userId,
        resource: "order",
        idempotencyKey,
        requestFingerprint,
        testMode,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.orderByKey, {
          userId: args.userId,
          idempotencyKey,
          testMode,
        });
        if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND");
        assertModeMatches(existing, testMode);
        return orderResult(existing);
      }
      shouldReconcile = claim === "reconcile";
    }
    const failClaim = async (error: unknown) => {
      if (idempotencyKey && isDefinitiveNoCreate(error))
        await ctx.runMutation(internal.idempotency.fail, {
          userId: args.userId,
          resource: "order",
          idempotencyKey,
          requestFingerprint,
          testMode,
          errorCode: providerErrorCode(error),
        });
    };
    let raw: unknown;
    if (isSimulated) {
      raw = {
        id: await deterministicTestId("order", [
          providerKey ?? crypto.randomUUID(),
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
        partial_payment: args.partialPayment,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    } else {
      if (shouldReconcile && providerKey) {
        raw = await findByIdempotencyKey("order", providerKey, receipt);
      } else {
        try {
          raw = await requestProvider("POST", "/orders", {
            body: {
              amount: args.amount,
              currency: args.currency,
              receipt,
              notes,
              partial_payment: args.partialPayment,
            },
            isDeduplicated: idempotencyKey !== undefined,
          });
        } catch (error) {
          let recovered: unknown;
          try {
            recovered = await recoverDuplicateReceipt(error, receipt, providerKey, {
              amount: args.amount,
              currency: args.currency,
              notes,
              partialPayment: args.partialPayment,
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
          idempotencyKey,
          requestFingerprint: idempotencyKey ? requestFingerprint : undefined,
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
  args: { razorpayOrderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.object(schema.tables.orders.validator.fields),
  handler: async (
    ctx,
    { razorpayOrderId, testMode },
  ): Promise<Omit<Doc<"orders">, "_id" | "_creationTime">> => {
    const mode = resolveProviderMode(testMode);
    if (mode.isSimulated) {
      const local = await ctx.runQuery(internal.lookup.order, { id: razorpayOrderId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      const { _id, _creationTime, ...entity } = local;
      return entity;
    }
    const raw = await requestProvider("GET", `/orders/${encodeURIComponent(razorpayOrderId)}`);
    if (parseProviderResponse(() => record(raw)).id !== razorpayOrderId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return { ...orderFields(raw, Date.now()), testMode: mode.testMode };
  },
});

export const fetchPayments = action({
  args: { razorpayOrderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.array(v.object(schema.tables.payments.validator.fields)),
  handler: async (
    ctx,
    { razorpayOrderId, testMode },
  ): Promise<Omit<Doc<"payments">, "_id" | "_creationTime">[]> => {
    const mode = resolveProviderMode(testMode);
    if (mode.isSimulated) {
      const local = await ctx.runQuery(internal.lookup.paymentsForOrder, {
        razorpayOrderId,
        limit: 100,
        testMode: true,
      });
      for (const payment of local) assertModeMatches(payment, true);
      return local.map(({ _id, _creationTime, ...entity }) => entity);
    }
    const items = collectionItems(
      await requestProvider("GET", `/orders/${encodeURIComponent(razorpayOrderId)}/payments`),
    );
    for (const raw of items)
      if (parseProviderResponse(() => record(raw)).order_id !== razorpayOrderId)
        throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return items.map((raw) =>
      Object.assign(paymentFields(raw, Date.now()), { testMode: mode.testMode }),
    );
  },
});

export const get = query({
  args: { razorpayOrderId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { razorpayOrderId, testMode }) =>
    ctx.db
      .query("orders")
      .withIndex("by_testMode_and_razorpayOrderId", (q) =>
        q.eq("testMode", readTestMode(testMode)).eq("razorpayOrderId", razorpayOrderId),
      )
      .unique(),
});

export const verifyCheckout = action({
  args: {
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    signature: v.string(),

    userId: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args): Promise<Doc<"payments">> => {
    if (
      !(await verifyOrderCheckout(
        requireConfigValue(readConfig(env).keySecret),
        args.razorpayOrderId,
        args.razorpayPaymentId,
        args.signature,
      ))
    ) {
      throw razorpayError("RAZORPAY_INVALID_PAYMENT_SIGNATURE");
    }
    const order = await ctx.runQuery(internal.lookup.order, { id: args.razorpayOrderId });
    if (!order) throw razorpayError("RAZORPAY_NOT_FOUND");
    if (order.createdThroughComponent !== true) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    assertModeMatches(order, testMode);
    if (args.userId !== undefined && order.userId !== args.userId) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    if (isSimulated) {
      const local = await ctx.runQuery(internal.lookup.payment, { id: args.razorpayPaymentId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      if (local.razorpayOrderId !== args.razorpayOrderId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      if (
        (order.partialPayment ? local.amount > order.amount : local.amount !== order.amount) ||
        local.currency !== order.currency
      ) {
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      }
    } else {
      const payment = await requestProvider(
        "GET",
        `/payments/${encodeURIComponent(args.razorpayPaymentId)}`,
      );
      if (
        record(payment).id !== args.razorpayPaymentId ||
        record(payment).order_id !== args.razorpayOrderId
      ) {
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      }
      if (
        (order.partialPayment
          ? typeof record(payment).amount !== "number" ||
            Number(record(payment).amount) > order.amount
          : record(payment).amount !== order.amount) ||
        record(payment).currency !== order.currency
      ) {
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      }
      await ctx.runMutation(internal.mutations.putPayment, {
        raw: payment,
        observedAt: Date.now(),
        testMode,
      });
    }
    return ctx.runMutation(internal.mutations.markVerified, {
      razorpayPaymentId: args.razorpayPaymentId,
      razorpayOrderId: args.razorpayOrderId,
      testMode,
    });
  },
});

export const releaseIdempotency = mutation({
  args: {
    idempotencyKey: v.string(),
    userId: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: v.boolean(),
  handler: (ctx, args): Promise<boolean> =>
    ctx.runMutation(internal.idempotency.release, {
      userId: args.userId,
      resource: "order",
      idempotencyKey: args.idempotencyKey,
      testMode: args.testMode,
    }),
});
