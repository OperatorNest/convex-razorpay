import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  webhookNotifications: defineTable({
    eventId: v.string(),
    event: v.string(),
    invocationCount: v.optional(v.number()),
  }).index("by_eventId", ["eventId"]),
});
