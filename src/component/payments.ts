import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  isTestMode,
  resolveMode,
  listPath,
  requestProvider,
} from "./provider.js";
import { pageArgs, validateAmount, validateCurrency, validatePage } from "./validators.js";
import { boundedLimit, record } from "../shared/validation.js";

export const fetch = action({
  args: { paymentId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("payments"),
  handler: async (ctx, { paymentId, testMode }): Promise<Doc<"payments">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.payment, { id: paymentId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      return local;
    }
    const raw = await requestProvider("GET", `/payments/${encodeURIComponent(paymentId)}`, {
      idempotent: true,
    });
    if (record(raw).id !== paymentId) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    return ctx.runMutation(internal.mutations.putPayment, { raw, observedAt: Date.now() });
  },
});

export const capture = action({
  args: {
    paymentId: v.string(),
    amount: v.number(),
    currency: v.string(),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args): Promise<Doc<"payments">> => {
    validateAmount(args.amount);
    validateCurrency(args.currency);
    if (isTestMode(args.testMode)) {
      const existing = await ctx.runQuery(internal.lookup.payment, { id: args.paymentId });
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
          id: args.paymentId,
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
    const raw = await requestProvider(
      "POST",
      `/payments/${encodeURIComponent(args.paymentId)}/capture`,
      {
        body: { amount: args.amount, currency: args.currency },
      },
    );
    if (record(raw).id !== args.paymentId) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    return ctx.runMutation(internal.mutations.putPayment, { raw, observedAt: Date.now() });
  },
});

export const list = action({
  args: pageArgs,
  returns: v.array(schema.doc("payments")),
  handler: async (ctx, args): Promise<Doc<"payments">[]> => {
    const { count, skip } = validatePage(args.count, args.skip);
    if (isTestMode(args.testMode))
      return ctx.runQuery(internal.lookup.paymentsPage, { count, skip, testMode: true });
    const items = collectionItems(
      await requestProvider("GET", listPath("/payments", count, skip), { idempotent: true }),
    );
    return Promise.all(
      items.map((raw) =>
        ctx.runMutation(internal.mutations.putPayment, { raw, observedAt: Date.now() }),
      ),
    );
  },
});

export const listForOrder = query({
  args: { orderId: v.string(), limit: v.optional(v.number()), testMode: v.optional(v.boolean()) },
  returns: v.array(schema.doc("payments")),
  handler: (ctx, { orderId, limit, testMode }) =>
    ctx.db
      .query("payments")
      .withIndex("by_orderId_and_testMode", (q) =>
        q.eq("orderId", orderId).eq("testMode", resolveMode(testMode)),
      )
      .order("desc")
      .take(boundedLimit(limit)),
});
