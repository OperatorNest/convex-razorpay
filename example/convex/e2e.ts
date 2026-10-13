import { Razorpay, buildCheckoutOptions } from "@operatornest/convex-razorpay";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api.js";
import { env, internalAction, internalQuery } from "./_generated/server.js";

const razorpay = new Razorpay(components.razorpay, { testMode: false });

function assertProviderMode() {
  if (
    env.RAZORPAY_TEST_MODE === "true" ||
    !env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ||
    !env.RAZORPAY_KEY_SECRET
  ) {
    throw new ConvexError({
      code: "E2E_VERIFICATION_MODE_REQUIRED",
      message:
        "End-to-end verification requires Razorpay sandbox credentials and disabled local test mode",
    });
  }
}

export const environment = internalQuery({
  args: {},
  returns: v.object({ testMode: v.boolean(), keyIdConfigured: v.boolean(), testKey: v.boolean() }),
  handler: () => ({
    testMode: env.RAZORPAY_TEST_MODE === "true",
    keyIdConfigured: Boolean(env.RAZORPAY_KEY_ID),
    testKey: env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ?? false,
  }),
});

export const setup = internalAction({
  args: { runId: v.string() },
  returns: v.object({
    razorpayCustomerId: v.string(),
    razorpayOrderId: v.string(),
    orderStatus: v.string(),
    razorpayPlanId: v.string(),
    razorpaySubscriptionId: v.string(),
    subscriptionStatus: v.string(),
    buildCheckoutOptions: v.object({
      key: v.optional(v.string()),
      order_id: v.string(),
      amount: v.number(),
      currency: v.string(),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
    }),
  }),
  handler: async (ctx, { runId }) => {
    assertProviderMode();
    const userId = `e2e-${runId}`;
    const customer = await razorpay.customers.getOrCreate(ctx, {
      userId,
      name: "OperatorNest verification",
      email: `e2e-${runId}@example.invalid`,
      idempotencyKey: `e2e_customer_${runId}`,
    });
    const order = await razorpay.orders.create(ctx, {
      partialPayment: false,
      amount: 100,
      currency: "INR",
      userId,
      receipt: `e2e-${runId}`,
      idempotencyKey: `e2e_order_${runId}`,
    });
    const plan = await razorpay.plans.create(ctx, {
      period: "monthly",
      interval: 1,
      item: { name: `End-to-end verification ${runId}`, amount: 100, currency: "INR" },
      idempotencyKey: `e2e_plan_${runId}`,
    });
    const subscription = await razorpay.subscriptions.create(ctx, {
      quantity: 1,
      customerNotify: true,
      razorpayPlanId: plan.razorpayPlanId,
      totalCount: 12,
      userId,
      idempotencyKey: `e2e_subscription_${runId}`,
    });
    const fetchedOrder = await razorpay.orders.fetch(ctx, {
      razorpayOrderId: order.razorpayOrderId,
    });
    const checkoutOrder = {
      razorpayOrderId: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      ...(order.keyId === undefined ? {} : { keyId: order.keyId }),
    };
    return {
      razorpayCustomerId: customer.razorpayCustomerId,
      razorpayOrderId: order.razorpayOrderId,
      orderStatus: fetchedOrder.status,
      razorpayPlanId: plan.razorpayPlanId,
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      subscriptionStatus: subscription.status,
      buildCheckoutOptions: buildCheckoutOptions(checkoutOrder, {
        name: "OperatorNest verification",
        description: "Maintainer e2e verification",
      }),
    };
  },
});

export const fetches = internalAction({
  args: {
    razorpayOrderId: v.string(),
    razorpayPlanId: v.string(),
    razorpaySubscriptionId: v.string(),
  },
  returns: v.object({
    razorpayOrderId: v.string(),
    orderStatus: v.string(),
    razorpayPlanId: v.string(),
    razorpaySubscriptionId: v.string(),
    subscriptionStatus: v.string(),
  }),
  handler: async (ctx, args) => {
    assertProviderMode();
    const order = await razorpay.orders.fetch(ctx, { razorpayOrderId: args.razorpayOrderId });
    const plan = await razorpay.plans.fetch(ctx, { razorpayPlanId: args.razorpayPlanId });
    const subscription = await razorpay.subscriptions.fetch(ctx, {
      razorpaySubscriptionId: args.razorpaySubscriptionId,
    });
    return {
      razorpayOrderId: order.razorpayOrderId,
      orderStatus: order.status,
      razorpayPlanId: plan.razorpayPlanId,
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      subscriptionStatus: subscription.status,
    };
  },
});

export const cancelSubscription = internalAction({
  args: { razorpaySubscriptionId: v.string() },
  returns: v.object({
    razorpaySubscriptionId: v.string(),
    status: v.string(),
    hasScheduledChanges: v.boolean(),
  }),
  handler: async (ctx, { razorpaySubscriptionId }) => {
    assertProviderMode();
    const subscription = await razorpay.subscriptions.cancelAtCycleEnd(ctx, {
      razorpaySubscriptionId,
    });
    return {
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      status: subscription.status,
      hasScheduledChanges: subscription.hasScheduledChanges,
    };
  },
});

export const paymentsForOrder = internalAction({
  args: { razorpayOrderId: v.string() },
  returns: v.array(
    v.object({ razorpayPaymentId: v.string(), status: v.string(), captured: v.boolean() }),
  ),
  handler: async (ctx, { razorpayOrderId }) => {
    assertProviderMode();
    return (await razorpay.orders.fetchPayments(ctx, { razorpayOrderId })).map((payment) => ({
      razorpayPaymentId: payment.razorpayPaymentId,
      status: payment.status,
      captured: payment.captured,
    }));
  },
});

export const verifyCheckout = internalAction({
  args: { razorpayOrderId: v.string(), razorpayPaymentId: v.string(), signature: v.string() },
  returns: v.object({
    razorpayPaymentId: v.string(),
    status: v.string(),
    captured: v.boolean(),
    verified: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertProviderMode();
    const payment = await razorpay.orders.verifyCheckout(ctx, args);
    return {
      razorpayPaymentId: payment.razorpayPaymentId,
      status: payment.status,
      captured: payment.captured,
      verified: payment.verified,
    };
  },
});

export const refund = internalAction({
  args: { razorpayPaymentId: v.string(), runId: v.string() },
  returns: v.object({ razorpayRefundId: v.string(), status: v.string(), amount: v.number() }),
  handler: async (ctx, { razorpayPaymentId, runId }) => {
    assertProviderMode();
    const payment = await razorpay.payments.fetch(ctx, { razorpayPaymentId });
    if (payment.status !== "captured" || !payment.captured)
      throw new ConvexError({
        code: "E2E_REFUND_REQUIRES_CAPTURED_PAYMENT",
        message: "Refusing e2e refund until the payment is captured",
      });
    const createdRefund = await razorpay.refunds.create(ctx, {
      speed: "normal",
      amount: 100,
      razorpayPaymentId,
      idempotencyKey: `e2e_refund_${runId}`,
    });
    return {
      razorpayRefundId: createdRefund.razorpayRefundId,
      status: createdRefund.status,
      amount: createdRefund.amount,
    };
  },
});

export const state = internalQuery({
  args: { razorpayOrderId: v.string(), eventIds: v.array(v.string()) },
  returns: v.object({
    order: v.union(
      v.object({
        amount: v.number(),
        amountPaid: v.number(),
        amountDue: v.number(),
        status: v.string(),
      }),
      v.null(),
    ),
    payments: v.array(
      v.object({
        razorpayPaymentId: v.string(),
        status: v.string(),
        captured: v.boolean(),
        verified: v.boolean(),
      }),
    ),
    notifications: v.array(
      v.object({ eventId: v.string(), event: v.string(), invocationCount: v.number() }),
    ),
  }),
  handler: async (ctx, { razorpayOrderId, eventIds }) => {
    if (eventIds.length > 20)
      throw new ConvexError({
        code: "E2E_TOO_MANY_EVENT_IDS",
        message: "End-to-end verification accepts at most 20 webhook event ids per query",
      });
    const [order, payments] = await Promise.all([
      razorpay.orders.get(ctx, { razorpayOrderId }),
      razorpay.payments
        .list(ctx, { paginationOpts: { numItems: 20, cursor: null }, razorpayOrderId })
        .then(({ page }) => page),
    ]);
    const rows = await Promise.all(
      eventIds.map((eventId) =>
        ctx.db
          .query("webhookNotifications")
          .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
          .unique(),
      ),
    );
    const notifications = rows.flatMap((row) =>
      row
        ? [{ eventId: row.eventId, event: row.event, invocationCount: row.invocationCount ?? 1 }]
        : [],
    );
    return {
      order: order
        ? {
            status: order.status,
            amount: order.amount,
            amountPaid: order.amountPaid,
            amountDue: order.amountDue,
          }
        : null,
      payments: payments.map((payment) => ({
        razorpayPaymentId: payment.razorpayPaymentId,
        status: payment.status,
        captured: payment.captured,
        verified: payment.verified,
      })),
      notifications,
    };
  },
});

export const notificationCount = internalQuery({
  args: { eventId: v.string() },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db
      .query("webhookNotifications")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    return row ? (row.invocationCount ?? 1) : 0;
  },
});
