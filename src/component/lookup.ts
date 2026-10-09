import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import schema from "./schema.js";

export const order = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("orders"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("orders")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .unique(),
});
export const payment = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("payments"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("payments")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .unique(),
});
export const refund = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("refunds"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("refunds")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .unique(),
});
export const customer = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("customers")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .unique(),
});
export const plan = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("plans"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("plans")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .unique(),
});
export const subscription = internalQuery({
  args: { id: v.string() },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: (ctx, { id }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_razorpayId", (q) => q.eq("razorpayId", id))
      .unique(),
});
export const paymentsForOrder = internalQuery({
  args: { orderId: v.string(), limit: v.number() },
  returns: v.array(schema.doc("payments")),
  handler: (ctx, { orderId, limit }) =>
    ctx.db
      .query("payments")
      .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
      .take(Math.min(Math.max(limit, 1), 100)),
});
export const paymentsPage = internalQuery({
  args: { count: v.number(), skip: v.number(), testMode: v.boolean() },
  returns: v.array(schema.doc("payments")),
  handler: async (ctx, { count, skip, testMode }) =>
    (
      await ctx.db
        .query("payments")
        .withIndex("by_testMode", (q) => q.eq("testMode", testMode))
        .order("desc")
        .take(Math.min(count + skip, 1000))
    ).slice(skip, skip + count),
});
export const plansPage = internalQuery({
  args: { count: v.number(), skip: v.number(), testMode: v.boolean() },
  returns: v.array(schema.doc("plans")),
  handler: async (ctx, { count, skip, testMode }) =>
    (
      await ctx.db
        .query("plans")
        .withIndex("by_testMode", (q) => q.eq("testMode", testMode))
        .order("desc")
        .take(Math.min(count + skip, 1000))
    ).slice(skip, skip + count),
});
export const subscriptionsForUser = internalQuery({
  args: { userId: v.string(), limit: v.number() },
  returns: v.array(schema.doc("subscriptions")),
  handler: (ctx, { userId, limit }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(Math.min(Math.max(limit, 1), 100)),
});
