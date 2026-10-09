// Internal harness driven by `pnpm smoke` through `convex run` against a local deployment.
// These functions are not callable by clients; they stand in for authenticated app code.
import { Razorpay, checkoutOptions, isRazorpayError } from "@operatornest/convex-razorpay";
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
    customerId: v.string(),
    sameCustomerOnRetry: v.boolean(),
    orderId: v.string(),
    planId: v.string(),
    subscriptionId: v.string(),
    amount: v.number(),
    checkoutKeyIdPresent: v.boolean(),
  }),
  handler: async (ctx, { userId, runId }) => {
    const customerArgs = { userId, name: "Smoke Tester", email: `${runId}@example.com` };
    const customer = await razorpay.customers.getOrCreate(ctx, customerArgs);
    const again = await razorpay.customers.getOrCreate(ctx, customerArgs);
    const order = await razorpay.orders.create(ctx, {
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
      planId: plan.razorpayId,
      totalCount: 12,
      userId,
      idempotencyKey: `smoke-sub-${runId}`,
    });
    return {
      customerId: customer.razorpayId,
      sameCustomerOnRetry: again.razorpayId === customer.razorpayId,
      orderId: order.razorpayId,
      planId: plan.razorpayId,
      subscriptionId: subscription.razorpayId,
      amount: order.amount,
      checkoutKeyIdPresent:
        checkoutOptions({
          razorpayId: order.razorpayId,
          amount: order.amount,
          currency: order.currency,
          ...(order.keyId === undefined ? {} : { keyId: order.keyId }),
        }).key === env.RAZORPAY_KEY_ID,
    };
  },
});

export const refund = internalAction({
  args: { paymentId: v.string(), runId: v.string() },
  returns: v.object({
    refundId: v.string(),
    amount: v.number(),
    stableOnRetry: v.boolean(),
    overRefundRejected: v.boolean(),
  }),
  handler: async (ctx, { paymentId, runId }) => {
    const args = { paymentId, amount: 20000, idempotencyKey: `smoke_refund_${runId}` };
    const created = await razorpay.refunds.create(ctx, args);
    const again = await razorpay.refunds.create(ctx, args);
    const fetched = await razorpay.refunds.fetch(ctx, { refundId: created.razorpayId });
    let overRefundRejected = false;
    try {
      await razorpay.refunds.create(ctx, {
        paymentId,
        amount: 40000,
        idempotencyKey: `smoke_refund_excess_${runId}`,
      });
    } catch (error) {
      overRefundRejected =
        isRazorpayError(error) && error.data.code === "RAZORPAY_INVALID_ARGUMENT";
    }
    return {
      refundId: created.razorpayId,
      amount: fetched.amount,
      stableOnRetry: again.razorpayId === created.razorpayId,
      overRefundRejected,
    };
  },
});

export const changeSubscription = internalAction({
  args: { subscriptionId: v.string() },
  returns: v.object({ paused: v.boolean(), resumed: v.boolean(), updated: v.boolean() }),
  handler: async (ctx, { subscriptionId }) => {
    const paused = await razorpay.subscriptions.pause(ctx, { subscriptionId });
    const resumed = await razorpay.subscriptions.resume(ctx, { subscriptionId });
    const updated = await razorpay.subscriptions.update(ctx, { subscriptionId, quantity: 2 });
    return {
      paused: paused.status === "paused",
      resumed: resumed.status === "active",
      updated: updated.quantity === 2,
    };
  },
});

export const paginate = internalAction({
  args: { runId: v.string() },
  returns: v.object({ firstCount: v.number(), secondCount: v.number(), distinct: v.boolean() }),
  handler: async (ctx, { runId }) => {
    await razorpay.plans.create(ctx, {
      period: "monthly",
      interval: 1,
      item: { name: `Smoke second ${runId}`, amount: 19900, currency: "INR" },
      idempotencyKey: `smoke_plan_second_${runId}`,
    });
    const first = await razorpay.plans.list(ctx, { count: 1, skip: 0 });
    const second = await razorpay.plans.list(ctx, { count: 1, skip: 1 });
    return {
      firstCount: first.length,
      secondCount: second.length,
      distinct: first[0]?.razorpayId !== second[0]?.razorpayId,
    };
  },
});

export const cleanup = internalAction({
  args: {},
  returns: v.object({ removedRecent: v.number() }),
  handler: async (ctx) => ({
    removedRecent: await razorpay.webhooks.cleanup(ctx, { before: Date.now() - 30 * 86400_000 }),
  }),
});

export const state = internalQuery({
  args: { userId: v.string(), orderId: v.string() },
  returns: v.object({
    customer: v.union(v.object({ razorpayId: v.string() }), v.null()),
    order: v.union(v.object({ status: v.string(), amount: v.number() }), v.null()),
    payments: v.array(
      v.object({
        razorpayId: v.string(),
        status: v.string(),
        verified: v.boolean(),
      }),
    ),
    subscription: v.union(v.object({ razorpayId: v.string(), status: v.string() }), v.null()),
  }),
  handler: async (ctx, { userId, orderId }) => {
    const customer = await razorpay.customers.getByUser(ctx, { userId });
    const order = await razorpay.orders.get(ctx, { orderId });
    const payments = await razorpay.payments.listForOrder(ctx, { orderId, limit: 10 });
    const subscription = await razorpay.subscriptions.getForUser(ctx, { userId });
    return {
      customer: customer ? { razorpayId: customer.razorpayId } : null,
      order: order ? { status: order.status, amount: order.amount } : null,
      payments: payments.map((p) => ({
        razorpayId: p.razorpayId,
        status: p.status,
        verified: p.verified,
      })),
      subscription: subscription
        ? { razorpayId: subscription.razorpayId, status: subscription.status }
        : null,
    };
  },
});

export const verifyCheckout = internalAction({
  args: { orderId: v.string(), paymentId: v.string(), signature: v.string(), userId: v.string() },
  returns: v.object({
    ok: v.boolean(),
    verified: v.optional(v.boolean()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const payment = await razorpay.verification.checkout(ctx, args);
      return { ok: true, verified: payment.verified };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
