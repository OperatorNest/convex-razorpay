import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { webhookEventValidator } from "../../src/shared/validators.js";

/** Example transactional notification callback. */
export const onEvent = internalMutation({
  args: webhookEventValidator,
  returns: v.null(),
  handler: async (ctx, { eventId, event }) => {
    const existing = await ctx.db
      .query("webhookNotifications")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (existing) {
      await ctx.db.patch("webhookNotifications", existing._id, {
        invocationCount: (existing.invocationCount ?? 1) + 1,
      });
    } else {
      await ctx.db.insert("webhookNotifications", { eventId, event, invocationCount: 1 });
    }
    return null;
  },
});
