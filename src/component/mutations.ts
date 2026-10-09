import { getOrThrow, razorpayError } from "../shared/errors.js";
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
// Provider fetches are live data, so an absent testMode means live. Test-mode writers and
// signed webhooks always pass the mode they observed.
const writeArgs = { raw: v.any(), observedAt: v.number(), ...linkage };

export const putOrder = internalMutation({
  args: writeArgs,
  returns: schema.doc("orders"),
  handler: (ctx, args) =>
    applyOrder(ctx, args.raw, args.observedAt, { ...args, testMode: args.testMode ?? false }),
});
export const putPayment = internalMutation({
  args: { raw: v.any(), observedAt: v.number(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("payments"),
  handler: (ctx, args) =>
    applyPayment(ctx, args.raw, args.observedAt, { testMode: args.testMode ?? false }),
});
export const putRefund = internalMutation({
  args: writeArgs,
  returns: schema.doc("refunds"),
  handler: (ctx, args) =>
    applyRefund(ctx, args.raw, args.observedAt, { ...args, testMode: args.testMode ?? false }),
});
export const putTestRefund = internalMutation({
  args: {
    refundId: v.string(),
    paymentId: v.string(),
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
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) {
        assertModeMatches(existing, true, "refund");
        if (existing.requestFingerprint !== args.requestFingerprint)
          throw razorpayError(
            "RAZORPAY_IDEMPOTENCY_CONFLICT",
            "Idempotency key reused with different refund request",
          );
        return existing;
      }
    }
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", args.paymentId))
      .first();
    if (!payment) throw razorpayError("RAZORPAY_NOT_FOUND", "Payment not found in test mode");
    // A fake refund must never raise amountRefunded on a live-mirrored payment.
    assertModeMatches(payment, true, "payment");
    if (!payment.captured)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Only captured payments can be refunded");
    const amount = args.amount ?? payment.amount - payment.amountRefunded;
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > payment.amount - payment.amountRefunded
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Refund exceeds captured amount");
    }
    const now = Date.now();
    const raw = {
      id: args.refundId,
      entity: "refund",
      payment_id: args.paymentId,
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
      id: payment.razorpayId,
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
  handler: (ctx, args) =>
    applyCustomer(ctx, args.raw, args.observedAt, { ...args, testMode: args.testMode ?? false }),
});
export const putPlan = internalMutation({
  args: writeArgs,
  returns: schema.doc("plans"),
  handler: (ctx, args) =>
    applyPlan(ctx, args.raw, args.observedAt, { ...args, testMode: args.testMode ?? false }),
});
export const putSubscription = internalMutation({
  args: writeArgs,
  returns: schema.doc("subscriptions"),
  handler: (ctx, args) =>
    applySubscription(ctx, args.raw, args.observedAt, {
      ...args,
      testMode: args.testMode ?? false,
    }),
});
export const markVerified = internalMutation({
  args: {
    paymentId: v.string(),
    testMode: v.boolean(),
    orderId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", args.paymentId))
      .first();
    if (!payment) throw razorpayError("RAZORPAY_NOT_FOUND", "Checkout payment not found");
    // Test-mode checkout may only verify test rows, and live checkout only live rows.
    assertModeMatches(payment, args.testMode, "payment");
    if (
      (args.orderId && payment.orderId !== args.orderId) ||
      (args.subscriptionId &&
        payment.subscriptionId &&
        payment.subscriptionId !== args.subscriptionId)
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Checkout payment identity mismatch");
    }
    if (payment.status !== "authorized" && payment.status !== "captured") {
      throw razorpayError(
        "RAZORPAY_INVALID_ARGUMENT",
        "Checkout payment is not authorized or captured",
      );
    }
    await ctx.db.patch("payments", payment["_id"], {
      verified: true,
      subscriptionId: args.subscriptionId ?? payment.subscriptionId,
    });
    return getOrThrow(await ctx.db.get("payments", payment["_id"]), "Updated payment is missing");
  },
});

export const orderByKey = internalQuery({
  args: { key: v.string() },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { key }) =>
    ctx.db
      .query("orders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key))
      .first(),
});
export const refundByKey = internalQuery({
  args: { key: v.string() },
  returns: v.union(schema.doc("refunds"), v.null()),
  handler: (ctx, { key }) =>
    ctx.db
      .query("refunds")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key))
      .first(),
});
export const customerByKey = internalQuery({
  args: { key: v.string() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { key }) =>
    ctx.db
      .query("customers")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key))
      .first(),
});
export const customerByUser = internalQuery({
  args: { userId: v.string() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { userId }) =>
    ctx.db
      .query("customers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first(),
});
export const planByKey = internalQuery({
  args: { key: v.string() },
  returns: v.union(schema.doc("plans"), v.null()),
  handler: (ctx, { key }) =>
    ctx.db
      .query("plans")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key))
      .first(),
});
export const subscriptionByKey = internalQuery({
  args: { key: v.string() },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: (ctx, { key }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key))
      .first(),
});
