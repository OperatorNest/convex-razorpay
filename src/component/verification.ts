import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { env } from "./_generated/server.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  verifyOrderCheckout,
  verifyPaymentLinkCallback,
  verifySubscriptionCheckout,
} from "../shared/crypto.js";
import { assertModeMatches, isTestMode, requestProvider } from "./provider.js";
import { record } from "../shared/validation.js";

export const checkout = action({
  args: {
    orderId: v.string(),
    paymentId: v.string(),
    signature: v.string(),
    // When given, must equal the order's userId. Omitting it skips the ownership check.
    userId: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args): Promise<Doc<"payments">> => {
    if (
      !env.RAZORPAY_KEY_SECRET ||
      !(await verifyOrderCheckout(
        env.RAZORPAY_KEY_SECRET,
        args.orderId,
        args.paymentId,
        args.signature,
      ))
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid checkout signature");
    }
    const order = await ctx.runQuery(internal.lookup.order, { id: args.orderId });
    if (!order) throw razorpayError("RAZORPAY_NOT_FOUND", "Checkout order not found");
    if (order.createdThroughComponent !== true) {
      throw razorpayError(
        "RAZORPAY_INVALID_ARGUMENT",
        "Checkout order was not created through this component",
      );
    }
    const testMode = isTestMode(args.testMode);
    assertModeMatches(order, testMode, "order");
    if (args.userId !== undefined && order.userId !== args.userId) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Checkout order belongs to another user");
    }
    if (testMode) {
      // Test mode never contacts Razorpay: confirm against the mirrored payment instead.
      const local = await ctx.runQuery(internal.lookup.payment, { id: args.paymentId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND", "Payment not found in test mode");
      assertModeMatches(local, true, "payment");
      if (local.orderId !== args.orderId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Checkout payment identity mismatch");
      if (local.amount !== order.amount || local.currency !== order.currency) {
        throw razorpayError(
          "RAZORPAY_INVALID_ARGUMENT",
          "Checkout payment amount or currency mismatch",
        );
      }
    } else {
      const payment = await requestProvider(
        "GET",
        `/payments/${encodeURIComponent(args.paymentId)}`,
        { idempotent: true },
      );
      if (record(payment).id !== args.paymentId || record(payment).order_id !== args.orderId) {
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Checkout payment identity mismatch");
      }
      if (record(payment).amount !== order.amount || record(payment).currency !== order.currency) {
        throw razorpayError(
          "RAZORPAY_INVALID_ARGUMENT",
          "Checkout payment amount or currency mismatch",
        );
      }
      await ctx.runMutation(internal.mutations.putPayment, {
        raw: payment,
        observedAt: Date.now(),
        testMode: false,
      });
    }
    return ctx.runMutation(internal.mutations.markVerified, {
      paymentId: args.paymentId,
      orderId: args.orderId,
      testMode,
    });
  },
});

export const subscriptionCheckout = action({
  args: {
    subscriptionId: v.string(),
    paymentId: v.string(),
    signature: v.string(),
    // When given, must equal the subscription's userId. Omitting it skips the ownership check.
    userId: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args): Promise<Doc<"payments">> => {
    if (
      !env.RAZORPAY_KEY_SECRET ||
      !(await verifySubscriptionCheckout(
        env.RAZORPAY_KEY_SECRET,
        args.subscriptionId,
        args.paymentId,
        args.signature,
      ))
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid subscription checkout signature");
    }
    const mirrored = await ctx.runQuery(internal.lookup.subscription, { id: args.subscriptionId });
    if (!mirrored) throw razorpayError("RAZORPAY_NOT_FOUND", "Checkout subscription not found");
    if (mirrored.createdThroughComponent !== true) {
      throw razorpayError(
        "RAZORPAY_INVALID_ARGUMENT",
        "Checkout subscription was not created through this component",
      );
    }
    const testMode = isTestMode(args.testMode);
    assertModeMatches(mirrored, testMode, "subscription");
    if (args.userId !== undefined && mirrored.userId !== args.userId) {
      throw razorpayError(
        "RAZORPAY_INVALID_ARGUMENT",
        "Checkout subscription belongs to another user",
      );
    }
    if (testMode) {
      // Test mode never contacts Razorpay: confirm against the mirrored payment instead.
      const localPayment = await ctx.runQuery(internal.lookup.payment, { id: args.paymentId });
      if (!localPayment)
        throw razorpayError("RAZORPAY_NOT_FOUND", "Payment not found in test mode");
      assertModeMatches(localPayment, true, "payment");
    } else {
      const subscription = await requestProvider(
        "GET",
        `/subscriptions/${encodeURIComponent(args.subscriptionId)}`,
        { idempotent: true },
      );
      if (record(subscription).id !== args.subscriptionId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Subscription identity mismatch");
      await ctx.runMutation(internal.mutations.putSubscription, {
        raw: subscription,
        observedAt: Date.now(),
        testMode: false,
      });
      const payment = await requestProvider(
        "GET",
        `/payments/${encodeURIComponent(args.paymentId)}`,
        { idempotent: true },
      );
      if (record(payment).id !== args.paymentId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Payment identity mismatch");
      await ctx.runMutation(internal.mutations.putPayment, {
        raw: payment,
        observedAt: Date.now(),
        testMode: false,
      });
    }
    return ctx.runMutation(internal.mutations.markVerified, {
      paymentId: args.paymentId,
      subscriptionId: args.subscriptionId,
      testMode,
    });
  },
});

export const paymentLink = action({
  args: {
    paymentLinkId: v.string(),
    referenceId: v.string(),
    status: v.string(),
    paymentId: v.string(),
    signature: v.string(),
  },
  returns: v.literal(true),
  handler: async (_ctx, args): Promise<true> => {
    if (!env.RAZORPAY_KEY_SECRET)
      throw razorpayError("RAZORPAY_NOT_CONFIGURED", "Razorpay API credentials are not configured");
    if (
      !(await verifyPaymentLinkCallback(
        env.RAZORPAY_KEY_SECRET,
        args.paymentLinkId,
        args.referenceId,
        args.status,
        args.paymentId,
        args.signature,
      ))
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid payment link signature");
    }
    return true;
  },
});
