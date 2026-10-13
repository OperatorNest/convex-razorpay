import { boundedLimit } from "../shared/validation.js";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import schema from "./schema.js";
import { validatePage } from "./validators.js";

export const order = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("orders")
      .withIndex("by_razorpayOrderId", (q) => q.eq("razorpayOrderId", id))
      .unique(),
});
export const payment = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("payments"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", id))
      .unique(),
});
export const refund = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("refunds"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("refunds")
      .withIndex("by_razorpayRefundId", (q) => q.eq("razorpayRefundId", id))
      .unique(),
});
export const customer = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("customers")
      .withIndex("by_razorpayCustomerId", (q) => q.eq("razorpayCustomerId", id))
      .unique(),
});
export const plan = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("plans"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("plans")
      .withIndex("by_razorpayPlanId", (q) => q.eq("razorpayPlanId", id))
      .unique(),
});
export const subscription = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_razorpaySubscriptionId", (q) => q.eq("razorpaySubscriptionId", id))
      .unique(),
});
export const paymentsForOrder = internalQuery({
  args: { razorpayOrderId: v.string(), limit: v.number(), testMode: v.boolean() },
  returns: v.array(schema.doc("payments")),
  handler: (ctx, { razorpayOrderId, limit, testMode }) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayOrderId_and_testMode", (q) =>
        q.eq("razorpayOrderId", razorpayOrderId).eq("testMode", testMode),
      )
      .take(boundedLimit(limit)),
});
export const paymentsPage = internalQuery({
  args: { count: v.number(), skip: v.number(), testMode: v.boolean() },
  returns: v.array(schema.doc("payments")),
  handler: async (ctx, { count, skip, testMode }) => {
    const page = validatePage(count, skip);
    return (
      await ctx.db
        .query("payments")
        .withIndex("by_testMode", (q) => q.eq("testMode", testMode))
        .order("desc")
        .take(page.count + page.skip)
    ).slice(page.skip, page.skip + page.count);
  },
});
export const plansPage = internalQuery({
  args: { count: v.number(), skip: v.number(), testMode: v.boolean() },
  returns: v.array(schema.doc("plans")),
  handler: async (ctx, { count, skip, testMode }) => {
    const page = validatePage(count, skip);
    return (
      await ctx.db
        .query("plans")
        .withIndex("by_testMode", (q) => q.eq("testMode", testMode))
        .order("desc")
        .take(page.count + page.skip)
    ).slice(page.skip, page.skip + page.count);
  },
});
export const subscriptionsForUser = internalQuery({
  args: { userId: v.string(), limit: v.number(), testMode: v.boolean() },
  returns: v.array(schema.doc("subscriptions")),
  handler: (ctx, { userId, limit, testMode }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_userId_and_testMode_and_createdAt", (q) =>
        q.eq("userId", userId).eq("testMode", testMode),
      )
      .take(boundedLimit(limit)),
});
