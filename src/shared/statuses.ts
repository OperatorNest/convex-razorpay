import { v } from "convex/values";
import type { Infer } from "convex/values";

export const orderStatusValidator = v.union(
  v.literal("created"),
  v.literal("attempted"),
  v.literal("paid"),
  v.literal("unknown"),
);
/** Names the order states returned by Razorpay. */
export type OrderStatus = Infer<typeof orderStatusValidator>;

export const paymentStatusValidator = v.union(
  v.literal("created"),
  v.literal("authorized"),
  v.literal("captured"),
  v.literal("refunded"),
  v.literal("failed"),
  v.literal("unknown"),
);
/** Names the payment states returned by Razorpay. */
export type PaymentStatus = Infer<typeof paymentStatusValidator>;

export const refundStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processed"),
  v.literal("failed"),
  v.literal("unknown"),
);
/** Names the refund states returned by Razorpay. */
export type RefundStatus = Infer<typeof refundStatusValidator>;

export const subscriptionStatusValidator = v.union(
  v.literal("created"),
  v.literal("authenticated"),
  v.literal("active"),
  v.literal("pending"),
  v.literal("halted"),
  v.literal("paused"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("expired"),
  v.literal("unknown"),
);
/** Names the subscription states returned by Razorpay. */
export type SubscriptionStatus = Infer<typeof subscriptionStatusValidator>;

export const paymentRefundStatusValidator = v.union(v.literal("partial"), v.literal("full"));
/** Names the payment refund states returned by Razorpay. */
export type PaymentRefundStatus = Infer<typeof paymentRefundStatusValidator>;

export const webhookStatusValidator = v.union(
  v.literal("processed"),
  v.literal("ignored"),
  v.literal("failed"),
  v.literal("duplicate"),
);
/** Names the webhook states returned by Razorpay. */
export type WebhookStatus = Infer<typeof webhookStatusValidator>;

export const idempotencyStatusValidator = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("failed"),
);
/** Names the idempotency states returned by Razorpay. */
export type IdempotencyStatus = Infer<typeof idempotencyStatusValidator>;

export const paymentLinkStatusValidator = v.union(
  v.literal("created"),
  v.literal("partially_paid"),
  v.literal("paid"),
  v.literal("expired"),
  v.literal("cancelled"),
);
/** Names the payment link states returned by Razorpay. */
export type PaymentLinkStatus = Infer<typeof paymentLinkStatusValidator>;
