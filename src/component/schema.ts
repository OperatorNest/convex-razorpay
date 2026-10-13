import {
  orderStatusValidator,
  paymentStatusValidator,
  refundStatusValidator,
  subscriptionStatusValidator,
  paymentRefundStatusValidator,
} from "../shared/statuses.js";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const notes = v.record(v.string(), v.string());
const linkage = {
  userId: v.optional(v.string()),
  externalId: v.optional(v.string()),
  metadata: v.optional(notes),
};

export default defineSchema({
  orders: defineTable({
    razorpayOrderId: v.string(),
    amount: v.number(),
    partialPayment: v.boolean(),
    amountPaid: v.number(),
    amountDue: v.number(),
    currency: v.string(),
    receipt: v.optional(v.string()),
    status: orderStatusValidator,
    rawStatus: v.optional(v.string()),
    attempts: v.number(),
    notes,
    createdAt: v.number(),
    providerUpdatedAt: v.number(),
    idempotencyKey: v.optional(v.string()),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
    createdThroughComponent: v.optional(v.boolean()),
  })
    .index("by_razorpayOrderId", ["razorpayOrderId"])
    .index("by_testMode_and_razorpayOrderId", ["testMode", "razorpayOrderId"])
    .index("by_testMode_and_receipt", ["testMode", "receipt"])
    .index("by_idempotencyKey_and_testMode", ["idempotencyKey", "testMode"]),
  payments: defineTable({
    razorpayPaymentId: v.string(),
    razorpayOrderId: v.optional(v.string()),
    razorpaySubscriptionId: v.optional(v.string()),
    razorpayInvoiceId: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    status: paymentStatusValidator,
    rawStatus: v.optional(v.string()),
    method: v.optional(v.string()),
    captured: v.boolean(),
    verified: v.boolean(),
    amountRefunded: v.number(),
    refundStatus: v.optional(paymentRefundStatusValidator),
    international: v.optional(v.boolean()),
    email: v.optional(v.string()),
    contact: v.optional(v.string()),
    razorpayCustomerId: v.optional(v.string()),
    fee: v.optional(v.number()),
    tax: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorDescription: v.optional(v.string()),
    errorReason: v.optional(v.string()),
    errorSource: v.optional(v.string()),
    errorStep: v.optional(v.string()),
    userId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    notes,
    createdAt: v.number(),
    providerUpdatedAt: v.number(),
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayPaymentId", ["razorpayPaymentId"])
    .index("by_razorpayOrderId_and_testMode", ["razorpayOrderId", "testMode"])
    .index("by_testMode", ["testMode"]),
  refunds: defineTable({
    razorpayRefundId: v.string(),
    razorpayPaymentId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: refundStatusValidator,
    rawStatus: v.optional(v.string()),
    speedRequested: v.optional(v.string()),
    speedProcessed: v.optional(v.string()),
    receipt: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    createdAt: v.number(),
    providerUpdatedAt: v.number(),
    userId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    metadata: v.optional(notes),
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayRefundId", ["razorpayRefundId"])
    .index("by_idempotencyKey_and_testMode", ["idempotencyKey", "testMode"]),
  customers: defineTable({
    razorpayCustomerId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    contact: v.optional(v.string()),
    gstin: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    providerUpdatedAt: v.number(),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayCustomerId", ["razorpayCustomerId"])
    .index("by_userId_and_testMode", ["userId", "testMode"])
    .index("by_idempotencyKey_and_testMode", ["idempotencyKey", "testMode"]),
  plans: defineTable({
    razorpayPlanId: v.string(),
    period: v.string(),
    interval: v.number(),
    itemName: v.string(),
    amount: v.number(),
    currency: v.string(),
    description: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    providerUpdatedAt: v.number(),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayPlanId", ["razorpayPlanId"])
    .index("by_idempotencyKey_and_testMode", ["idempotencyKey", "testMode"])
    .index("by_testMode", ["testMode"]),
  subscriptions: defineTable({
    razorpaySubscriptionId: v.string(),
    razorpayPlanId: v.string(),
    razorpayCustomerId: v.optional(v.string()),
    status: subscriptionStatusValidator,
    rawStatus: v.optional(v.string()),
    quantity: v.number(),
    totalCount: v.number(),
    paidCount: v.number(),
    remainingCount: v.number(),
    currentStartAt: v.optional(v.number()),
    currentEndAt: v.optional(v.number()),
    chargeAt: v.optional(v.number()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    pausedAt: v.optional(v.number()),
    hasScheduledChanges: v.boolean(),
    shortUrl: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    providerUpdatedAt: v.number(),
    lastWebhookAt: v.optional(v.number()),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
    createdThroughComponent: v.optional(v.boolean()),
  })
    .index("by_razorpaySubscriptionId", ["razorpaySubscriptionId"])

    .index("by_userId_and_testMode_and_createdAt", ["userId", "testMode", "createdAt"])
    .index("by_userId_and_testMode_and_status", ["userId", "testMode", "status"])
    .index("by_idempotencyKey_and_testMode", ["idempotencyKey", "testMode"]),
  webhookEvents: defineTable({
    eventId: v.string(),
    event: v.string(),
    razorpayAccountId: v.optional(v.string()),
    razorpayEntityId: v.optional(v.string()),
    providerCreatedAt: v.number(),
    receivedAt: v.number(),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    errorCode: v.optional(v.string()),
    bodyHash: v.string(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_bodyHash", ["bodyHash"])
    .index("by_receivedAt", ["receivedAt"]),
  idempotencyRequests: defineTable({
    resource: v.union(
      v.literal("order"),
      v.literal("plan"),
      v.literal("subscription"),
      v.literal("customer"),
    ),
    testMode: v.boolean(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    razorpayEntityId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_resource_and_testMode_and_idempotencyKey", [
      "resource",
      "testMode",
      "idempotencyKey",
    ])
    .index("by_status_and_settledAt", ["status", "settledAt"]),
});
