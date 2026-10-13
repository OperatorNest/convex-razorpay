import { Razorpay, buildCheckoutOptions, isRazorpayError } from "@operatornest/convex-razorpay";
import { v } from "convex/values";
import { components } from "./_generated/api.js";
import { env, internalAction, internalQuery } from "./_generated/server.js";

const razorpay = new Razorpay(components.razorpay, {
  testMode: env.RAZORPAY_TEST_MODE === "true",
});

export const environment = internalQuery({
  args: {},
  returns: v.object({ testMode: v.boolean(), keyIdConfigured: v.boolean() }),
  handler: () => ({
    testMode: env.RAZORPAY_TEST_MODE === "true",
    keyIdConfigured: Boolean(env.RAZORPAY_KEY_ID),
  }),
});

export const notificationCount = internalQuery({
  args: { eventId: v.string() },
  returns: v.number(),
  handler: async (ctx, { eventId }) =>
    (
      await ctx.db
        .query("webhookNotifications")
        .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
        .take(10)
    ).length,
});

export const setup = internalAction({
  args: { userId: v.string(), runId: v.string() },
  returns: v.object({
    razorpayCustomerId: v.string(),
    sameCustomerOnRetry: v.boolean(),
    razorpayOrderId: v.string(),
    razorpayPlanId: v.string(),
    razorpaySubscriptionId: v.string(),
    amount: v.number(),
    checkoutKeyIdPresent: v.boolean(),
  }),
  handler: async (ctx, { userId, runId }) => {
    const customerArgs = { userId, name: "Smoke Tester", email: `${runId}@example.com` };
    const customer = await razorpay.customers.getOrCreate(ctx, customerArgs);
    const again = await razorpay.customers.getOrCreate(ctx, customerArgs);
    const order = await razorpay.orders.create(ctx, {
      partialPayment: false,
      amount: 50000,
      currency: "INR",
      userId,
      idempotencyKey: `smoke-order-${runId}`,
    });
    const plan = await razorpay.plans.create(ctx, {
      period: "monthly",
      interval: 1,
      item: { name: `Smoke ${runId}`, amount: 29900, currency: "INR" },
      idempotencyKey: `smoke-plan-${runId}`,
    });
    const subscription = await razorpay.subscriptions.create(ctx, {
      quantity: 1,
      customerNotify: true,
      razorpayPlanId: plan.razorpayPlanId,
      totalCount: 12,
      userId,
      idempotencyKey: `smoke-sub-${runId}`,
    });
    return {
      razorpayCustomerId: customer.razorpayCustomerId,
      sameCustomerOnRetry: again.razorpayCustomerId === customer.razorpayCustomerId,
      razorpayOrderId: order.razorpayOrderId,
      razorpayPlanId: plan.razorpayPlanId,
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      amount: order.amount,
      checkoutKeyIdPresent:
        buildCheckoutOptions({
          razorpayOrderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          ...(order.keyId === undefined ? {} : { keyId: order.keyId }),
        }).key === env.RAZORPAY_KEY_ID,
    };
  },
});

export const refund = internalAction({
  args: { razorpayPaymentId: v.string(), runId: v.string() },
  returns: v.object({
    razorpayRefundId: v.string(),
    amount: v.number(),
    stableOnRetry: v.boolean(),
    overRefundRejected: v.boolean(),
  }),
  handler: async (ctx, { razorpayPaymentId, runId }) => {
    const args = { razorpayPaymentId, amount: 20000, idempotencyKey: `smoke_refund_${runId}` };
    const created = await razorpay.refunds.create(ctx, { speed: "normal", ...args });
    const again = await razorpay.refunds.create(ctx, { speed: "normal", ...args });
    const fetched = await razorpay.refunds.fetch(ctx, {
      razorpayRefundId: created.razorpayRefundId,
    });
    let overRefundRejected = false;
    try {
      await razorpay.refunds.create(ctx, {
        speed: "normal",
        razorpayPaymentId,
        amount: 40000,
        idempotencyKey: `smoke_refund_excess_${runId}`,
      });
    } catch (error) {
      overRefundRejected =
        isRazorpayError(error) && error.data.code === "RAZORPAY_INVALID_ARGUMENT";
    }
    return {
      razorpayRefundId: created.razorpayRefundId,
      amount: fetched.amount,
      stableOnRetry: again.razorpayRefundId === created.razorpayRefundId,
      overRefundRejected,
    };
  },
});

export const changeSubscription = internalAction({
  args: { razorpaySubscriptionId: v.string() },
  returns: v.object({ paused: v.boolean(), resumed: v.boolean(), updated: v.boolean() }),
  handler: async (ctx, { razorpaySubscriptionId }) => {
    const paused = await razorpay.subscriptions.pause(ctx, { razorpaySubscriptionId });
    const resumed = await razorpay.subscriptions.resume(ctx, { razorpaySubscriptionId });
    const updated = await razorpay.subscriptions.update(ctx, {
      scheduleChangeAt: "now",
      razorpaySubscriptionId,
      quantity: 2,
    });
    return {
      paused: paused.status === "paused",
      resumed: resumed.status === "active",
      updated: updated.quantity === 2,
    };
  },
});

export const paginate = internalAction({
  args: { runId: v.string(), userId: v.string(), razorpayOrderId: v.string() },
  returns: v.object({
    firstCount: v.number(),
    secondCount: v.number(),
    distinct: v.boolean(),
    paymentPages: v.boolean(),
    subscriptionPages: v.boolean(),
  }),
  handler: async (ctx, { runId, userId, razorpayOrderId }) => {
    const plan = await razorpay.plans.create(ctx, {
      period: "monthly",
      interval: 1,
      item: { name: `Smoke second ${runId}`, amount: 19900, currency: "INR" },
      idempotencyKey: `smoke_plan_second_${runId}`,
    });
    const first = await razorpay.plans.fetchAll(ctx, { count: 1, skip: 0 });
    const second = await razorpay.plans.fetchAll(ctx, { count: 1, skip: 1 });
    await razorpay.subscriptions.create(ctx, {
      razorpayPlanId: plan.razorpayPlanId,
      totalCount: 12,
      quantity: 1,
      customerNotify: false,
      userId,
    });
    const firstPayments = await ctx.runQuery(components.razorpay.payments.list, {
      razorpayOrderId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    const secondPayments = await ctx.runQuery(components.razorpay.payments.list, {
      razorpayOrderId,
      paginationOpts: { numItems: 1, cursor: firstPayments.continueCursor },
    });
    const firstSubscriptions = await ctx.runQuery(components.razorpay.subscriptions.list, {
      userId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    const secondSubscriptions = await ctx.runQuery(components.razorpay.subscriptions.list, {
      userId,
      paginationOpts: { numItems: 1, cursor: firstSubscriptions.continueCursor },
    });
    return {
      firstCount: first.length,
      secondCount: second.length,
      distinct: first[0]?.razorpayPlanId !== second[0]?.razorpayPlanId,
      paymentPages:
        !firstPayments.isDone &&
        firstPayments.page.length === 1 &&
        secondPayments.page.length === 1 &&
        firstPayments.page[0]?.razorpayPaymentId !== secondPayments.page[0]?.razorpayPaymentId,
      subscriptionPages:
        !firstSubscriptions.isDone &&
        firstSubscriptions.page.length === 1 &&
        secondSubscriptions.page.length === 1 &&
        firstSubscriptions.page[0]?.razorpaySubscriptionId !==
          secondSubscriptions.page[0]?.razorpaySubscriptionId,
    };
  },
});

export const cleanup = internalAction({
  args: {},
  returns: v.object({ removedRecent: v.number() }),
  handler: async (ctx) => ({
    removedRecent: await ctx.runMutation(components.razorpay.webhooks.cleanup, {
      before: Date.now() - 30 * 86400_000,
    }),
  }),
});

export const state = internalQuery({
  args: { userId: v.string(), razorpayOrderId: v.string() },
  returns: v.object({
    customer: v.union(v.object({ razorpayCustomerId: v.string() }), v.null()),
    order: v.union(v.object({ status: v.string(), amount: v.number() }), v.null()),
    payments: v.array(
      v.object({
        razorpayPaymentId: v.string(),
        status: v.string(),
        verified: v.boolean(),
      }),
    ),
    subscription: v.union(
      v.object({ razorpaySubscriptionId: v.string(), status: v.string() }),
      v.null(),
    ),
  }),
  handler: async (ctx, { userId, razorpayOrderId }) => {
    const customer = await razorpay.customers.get(ctx, { userId });
    const order = await razorpay.orders.get(ctx, { razorpayOrderId });
    const { page: payments } = await razorpay.payments.list(ctx, {
      razorpayOrderId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const subscription = await razorpay.subscriptions.get(ctx, { userId });
    return {
      customer: customer ? { razorpayCustomerId: customer.razorpayCustomerId } : null,
      order: order ? { status: order.status, amount: order.amount } : null,
      payments: payments.map((p) => ({
        razorpayPaymentId: p.razorpayPaymentId,
        status: p.status,
        verified: p.verified,
      })),
      subscription: subscription
        ? {
            razorpaySubscriptionId: subscription.razorpaySubscriptionId,
            status: subscription.status,
          }
        : null,
    };
  },
});

export const verifyCheckout = internalAction({
  args: {
    razorpayOrderId: v.string(),
    razorpayPaymentId: v.string(),
    signature: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    verified: v.optional(v.boolean()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const payment = await razorpay.orders.verifyCheckout(ctx, args);
      return { ok: true, verified: payment.verified };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
