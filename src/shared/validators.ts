import { v } from "convex/values";

export const webhookEventValidator = v.object({
  eventId: v.string(),
  event: v.string(),
  entityId: v.optional(v.string()),
  accountId: v.optional(v.string()),
  createdAtProvider: v.number(),
});

export const webhookIngestResultValidator = v.object({
  status: v.union(
    v.literal("processed"),
    v.literal("duplicate"),
    v.literal("ignored"),
    v.literal("failed"),
  ),
  event: v.optional(webhookEventValidator),
  errorCode: v.optional(v.string()),
});
