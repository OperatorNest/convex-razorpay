import { parseProviderResponse } from "../shared/providerErrors.js";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { boundedPage } from "../shared/bounds.js";
import { paginator } from "convex-helpers/server/pagination";
import { paymentFields } from "./mapping.js";
import { isRazorpayError, razorpayError } from "../shared/errors.js";

import { v } from "convex/values";
import { action, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  listPath,
  readTestMode,
  requestProvider,
  resolveProviderMode,
} from "./provider.js";
import { pageArgs, validateAmount, validateCurrency, validatePage } from "./validators.js";
import { isRecord, record } from "../shared/validation.js";

export const fetch = action({
  args: { razorpayPaymentId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.object(schema.tables.payments.validator.fields),
  handler: async (
    ctx,
    { razorpayPaymentId, testMode },
  ): Promise<Omit<Doc<"payments">, "_id" | "_creationTime">> => {
    const mode = resolveProviderMode(testMode);
    if (mode.isSimulated) {
      const local = await ctx.runQuery(internal.lookup.payment, { id: razorpayPaymentId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      const { _id, _creationTime, ...entity } = local;
      return entity;
    }
    const raw = await requestProvider("GET", `/payments/${encodeURIComponent(razorpayPaymentId)}`, {
      idempotent: true,
    });
    if (parseProviderResponse(() => record(raw)).id !== razorpayPaymentId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return { ...paymentFields(raw, Date.now()), testMode: mode.testMode };
  },
});

export const capture = action({
  args: {
    razorpayPaymentId: v.string(),
    amount: v.number(),
    currency: v.string(),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args): Promise<Doc<"payments">> => {
    validateAmount(args.amount);
    validateCurrency(args.currency);
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    if (isSimulated) {
      const existing = await ctx.runQuery(internal.lookup.payment, { id: args.razorpayPaymentId });
      if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(existing, true);
      if (
        existing.amount !== args.amount ||
        existing.currency !== args.currency ||
        existing.status !== "authorized"
      ) {
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      }
      return ctx.runMutation(internal.mutations.putPayment, {
        raw: {
          ...existing.raw,
          id: args.razorpayPaymentId,
          amount: args.amount,
          currency: args.currency,
          status: "captured",
          captured: true,
          amount_refunded: existing.amountRefunded,
          created_at: Math.floor(existing.createdAt / 1000),
        },
        observedAt: Date.now(),
        testMode: true,
      });
    }
    const paymentPath = `/payments/${encodeURIComponent(args.razorpayPaymentId)}`;
    let raw: unknown;
    try {
      raw = await requestProvider("POST", `${paymentPath}/capture`, {
        body: { amount: args.amount, currency: args.currency },
      });
    } catch (error) {
      if (
        !isRazorpayError(error) ||
        error.data.providerStatus === undefined ||
        error.data.providerStatus < 400 ||
        error.data.providerStatus >= 500
      )
        throw error;
      const current = await requestProvider("GET", paymentPath, { idempotent: true });
      if (
        !isRecord(current) ||
        current.status !== "captured" ||
        current.amount !== args.amount ||
        current.currency !== args.currency
      )
        throw error;
      raw = current;
    }
    if (parseProviderResponse(() => record(raw)).id !== args.razorpayPaymentId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return ctx.runMutation(internal.mutations.putPayment, {
      raw,
      observedAt: Date.now(),
      testMode,
    });
  },
});

export const fetchAll = action({
  args: pageArgs,
  returns: v.array(v.object(schema.tables.payments.validator.fields)),
  handler: async (ctx, args): Promise<Omit<Doc<"payments">, "_id" | "_creationTime">[]> => {
    const { count, skip } = validatePage(args.count, args.skip);
    const mode = resolveProviderMode(args.testMode);
    if (mode.isSimulated)
      return (
        await ctx.runQuery(internal.lookup.paymentsPage, { count, skip, testMode: true })
      ).map(({ _id, _creationTime, ...entity }) => entity);
    const items = collectionItems(
      await requestProvider("GET", listPath("/payments", count, skip), { idempotent: true }),
    );
    return items.map((raw) =>
      Object.assign(paymentFields(raw, Date.now()), { testMode: mode.testMode }),
    );
  },
});

export const list = query({
  args: {
    razorpayOrderId: v.string(),
    paginationOpts: paginationOptsValidator,
    testMode: v.optional(v.boolean()),
  },
  returns: paginationResultValidator(schema.doc("payments")),
  handler: (ctx, { razorpayOrderId, paginationOpts, testMode }) =>
    paginator(ctx.db, schema)
      .query("payments")
      .withIndex("by_razorpayOrderId_and_testMode", (q) =>
        q.eq("razorpayOrderId", razorpayOrderId).eq("testMode", readTestMode(testMode)),
      )
      .order("desc")
      .paginate(boundedPage(paginationOpts)),
});
