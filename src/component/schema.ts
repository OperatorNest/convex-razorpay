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
    razorpayId: v.string(),
    amount: v.number(),
    amountPaid: v.number(),
    amountDue: v.number(),
    currency: v.string(),
    receipt: v.optional(v.string()),
    status: v.string(),
    rawStatus: v.optional(v.string()),
    attempts: v.number(),
    notes,
    createdAt: v.number(),
    updatedAtProvider: v.number(),
    idempotencyKey: v.optional(v.string()),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
    createdThroughComponent: v.optional(v.boolean()),
  })
    .index("by_razorpayId", ["razorpayId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
  payments: defineTable({
    razorpayId: v.string(),
    orderId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
    amount: v.number(),
    currency: v.string(),
    status: v.string(),
    rawStatus: v.optional(v.string()),
    method: v.optional(v.string()),
    captured: v.boolean(),
    verified: v.boolean(),
    amountRefunded: v.number(),
    refundStatus: v.optional(v.string()),
    international: v.optional(v.boolean()),
    email: v.optional(v.string()),
    contact: v.optional(v.string()),
    customerId: v.optional(v.string()),
    fee: v.optional(v.number()),
    tax: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorDescription: v.optional(v.string()),
    errorReason: v.optional(v.string()),
    errorSource: v.optional(v.string()),
    errorStep: v.optional(v.string()),
    notes,
    createdAt: v.number(),
    updatedAtProvider: v.number(),
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayId", ["razorpayId"])
    .index("by_orderId", ["orderId"])
    .index("by_testMode", ["testMode"]),
  refunds: defineTable({
    razorpayId: v.string(),
    paymentId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: v.string(),
    rawStatus: v.optional(v.string()),
    speedRequested: v.optional(v.string()),
    speedProcessed: v.optional(v.string()),
    receipt: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    createdAt: v.number(),
    updatedAtProvider: v.number(),
    userId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    metadata: v.optional(notes),
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayId", ["razorpayId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
  customers: defineTable({
    razorpayId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    contact: v.optional(v.string()),
    gstin: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAtProvider: v.number(),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayId", ["razorpayId"])
    .index("by_userId", ["userId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
  plans: defineTable({
    razorpayId: v.string(),
    period: v.string(),
    interval: v.number(),
    itemName: v.string(),
    amount: v.number(),
    currency: v.string(),
    description: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAtProvider: v.number(),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
  })
    .index("by_razorpayId", ["razorpayId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_testMode", ["testMode"]),
  subscriptions: defineTable({
    razorpayId: v.string(),
    planId: v.string(),
    customerId: v.optional(v.string()),
    status: v.string(),
    rawStatus: v.optional(v.string()),
    quantity: v.number(),
    totalCount: v.number(),
    paidCount: v.number(),
    remainingCount: v.number(),
    currentStart: v.optional(v.number()),
    currentEnd: v.optional(v.number()),
    chargeAt: v.optional(v.number()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    expireBy: v.optional(v.number()),
    pausedAt: v.optional(v.number()),
    hasScheduledChanges: v.boolean(),
    shortUrl: v.optional(v.string()),
    notes,
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAtProvider: v.number(),
    ...linkage,
    raw: v.any(),
    testMode: v.boolean(),
    createdThroughComponent: v.optional(v.boolean()),
  })
    .index("by_razorpayId", ["razorpayId"])
    // Distinct sort orders serve recent-by-user reads and status-priority lookups.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
  webhookEvents: defineTable({
    eventId: v.string(),
    event: v.string(),
    accountId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    createdAtProvider: v.number(),
    receivedAt: v.number(),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    errorCode: v.optional(v.string()),
    bodyHash: v.string(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_bodyHash", ["bodyHash"])
    .index("by_receivedAt", ["receivedAt"]),
  idempotencyRequests: defineTable({
    resource: v.union(v.literal("order"), v.literal("plan"), v.literal("subscription")),
    key: v.string(),
    fingerprint: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    razorpayId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_resource_and_key", ["resource", "key"])
    .index("by_status_and_settledAt", ["status", "settledAt"]),
});
