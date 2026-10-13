import { razorpayError } from "../shared/errors.js";
import { getOrThrow } from "../shared/providerErrors.js";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import schema from "./schema.js";
import {
  applyCustomer,
  applyOrder,
  applyPayment,
  applyPlan,
  applyRefund,
  applySubscription,
} from "./write.js";
import { record } from "../shared/validation.js";
import { assertModeMatches } from "./provider.js";
import { linkArgs } from "./validators.js";

const linkage = {
  ...linkArgs,
  requestFingerprint: schema.tables.refunds.validator.fields.requestFingerprint,
  createdThroughComponent: schema.tables.orders.validator.fields.createdThroughComponent,
};

const writeArgs = { raw: v.any(), observedAt: v.number(), ...linkage, testMode: v.boolean() };

export const putOrder = internalMutation({
  args: writeArgs,
  returns: schema.doc("orders"),
  handler: (ctx, args) => applyOrder(ctx, args.raw, args.observedAt, args),
});
export const putPayment = internalMutation({
  args: { raw: v.any(), observedAt: v.number(), testMode: v.boolean() },
  returns: schema.doc("payments"),
  handler: (ctx, args) => applyPayment(ctx, args.raw, args.observedAt, args),
});
export const putRefund = internalMutation({
  args: writeArgs,
  returns: schema.doc("refunds"),
  handler: (ctx, args) => applyRefund(ctx, args.raw, args.observedAt, args),
});
export const putTestRefund = internalMutation({
  args: {
    razorpayRefundId: v.string(),
    razorpayPaymentId: v.string(),
    amount: v.optional(v.number()),
    speed: v.optional(v.string()),
    receipt: v.optional(v.string()),
    notes: schema.tables.refunds.validator.fields.notes,
    ...linkArgs,
    requestFingerprint: v.string(),
  },
  returns: schema.doc("refunds"),
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("refunds")
        .withIndex("by_idempotencyKey_and_testMode", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey).eq("testMode", true),
        )
        .first();
      if (existing) {
        if (existing.requestFingerprint !== args.requestFingerprint)
          throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
        return existing;
      }
    }
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", args.razorpayPaymentId))
      .first();
    if (!payment) throw razorpayError("RAZORPAY_NOT_FOUND");

    assertModeMatches(payment, true);
    if (!payment.captured) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    const amount = args.amount ?? payment.amount - payment.amountRefunded;
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > payment.amount - payment.amountRefunded
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    const now = Date.now();
    const raw = {
      id: args.razorpayRefundId,
      entity: "refund",
      payment_id: args.razorpayPaymentId,
      amount,
      currency: payment.currency,
      status: "processed",
      speed_requested: args.speed ?? "normal",
      speed_processed: "normal",
      receipt: args.receipt ?? null,
      notes: args.notes,
      created_at: Math.floor(now / 1000),
    };
    const refund = await applyRefund(ctx, raw, now, { ...args, testMode: true });
    const totalRefunded = payment.amountRefunded + amount;
    const paymentRaw = {
      ...record(payment.raw),
      id: payment.razorpayPaymentId,
      amount: payment.amount,
      currency: payment.currency,
      status: totalRefunded === payment.amount ? "refunded" : "captured",
      captured: true,
      amount_refunded: totalRefunded,
      refund_status: totalRefunded === payment.amount ? "full" : "partial",
      created_at: Math.floor(payment.createdAt / 1000),
    };
    await applyPayment(ctx, paymentRaw, now, { testMode: true });
    return refund;
  },
});
export const putCustomer = internalMutation({
  args: writeArgs,
  returns: schema.doc("customers"),
  handler: (ctx, args) => applyCustomer(ctx, args.raw, args.observedAt, args),
});
export const putPlan = internalMutation({
  args: writeArgs,
  returns: schema.doc("plans"),
  handler: (ctx, args) => applyPlan(ctx, args.raw, args.observedAt, args),
});
export const putSubscription = internalMutation({
  args: writeArgs,
  returns: schema.doc("subscriptions"),
  handler: (ctx, args) => applySubscription(ctx, args.raw, args.observedAt, args),
});
export const markVerified = internalMutation({
  args: {
    razorpayPaymentId: v.string(),
    testMode: v.boolean(),
    razorpayOrderId: v.optional(v.string()),
    razorpaySubscriptionId: v.optional(v.string()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", args.razorpayPaymentId))
      .first();
    if (!payment) throw razorpayError("RAZORPAY_NOT_FOUND");

    assertModeMatches(payment, args.testMode);
    if (
      (args.razorpayOrderId && payment.razorpayOrderId !== args.razorpayOrderId) ||
      (args.razorpaySubscriptionId &&
        payment.razorpaySubscriptionId &&
        payment.razorpaySubscriptionId !== args.razorpaySubscriptionId)
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    if (payment.status !== "authorized" && payment.status !== "captured") {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    await ctx.db.patch("payments", payment["_id"], {
      verified: true,
      razorpaySubscriptionId: args.razorpaySubscriptionId ?? payment.razorpaySubscriptionId,
    });
    return getOrThrow(await ctx.db.get("payments", payment["_id"]));
  },
});

export const orderByKey = internalQuery({
  args: { idempotencyKey: v.string(), testMode: v.boolean() },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { idempotencyKey, testMode }) =>
    ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey_and_testMode", (q) =>
        q.eq("idempotencyKey", idempotencyKey).eq("testMode", testMode),
      )
      .first(),
});
export const refundByKey = internalQuery({
  args: { idempotencyKey: v.string(), testMode: v.boolean() },
  returns: v.union(schema.doc("refunds"), v.null()),
  handler: (ctx, { idempotencyKey, testMode }) =>
    ctx.db
      .query("refunds")
      .withIndex("by_idempotencyKey_and_testMode", (q) =>
        q.eq("idempotencyKey", idempotencyKey).eq("testMode", testMode),
      )
      .first(),
});
export const customerByKey = internalQuery({
  args: { idempotencyKey: v.string(), testMode: v.boolean() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { idempotencyKey, testMode }) =>
    ctx.db
      .query("customers")
      .withIndex("by_idempotencyKey_and_testMode", (q) =>
        q.eq("idempotencyKey", idempotencyKey).eq("testMode", testMode),
      )
      .first(),
});
export const customerByUser = internalQuery({
  args: { userId: v.string(), testMode: v.boolean() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { userId, testMode }) =>
    ctx.db
      .query("customers")
      .withIndex("by_userId_and_testMode", (q) => q.eq("userId", userId).eq("testMode", testMode))
      .first(),
});
export const planByKey = internalQuery({
  args: { idempotencyKey: v.string(), testMode: v.boolean() },
  returns: v.union(schema.doc("plans"), v.null()),
  handler: (ctx, { idempotencyKey, testMode }) =>
    ctx.db
      .query("plans")
      .withIndex("by_idempotencyKey_and_testMode", (q) =>
        q.eq("idempotencyKey", idempotencyKey).eq("testMode", testMode),
      )
      .first(),
});
export const subscriptionByKey = internalQuery({
  args: { idempotencyKey: v.string(), testMode: v.boolean() },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: (ctx, { idempotencyKey, testMode }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_idempotencyKey_and_testMode", (q) =>
        q.eq("idempotencyKey", idempotencyKey).eq("testMode", testMode),
      )
      .first(),
});
