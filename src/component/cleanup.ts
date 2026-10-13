import { v } from "convex/values";
import { dayMs, webhookRetentionDays } from "../shared/constants.js";
import { internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const cleanupBatchSize = 100;

/** Deletes up to 100 webhook receipts received before the retention cutoff and reschedules itself while a batch fills; `before` can only move the cutoff earlier. */
export const run = internalMutation({
  args: { before: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { before }): Promise<number> => {
    const retentionCutoff = Date.now() - webhookRetentionDays * dayMs;
    const cutoff = Math.min(before ?? retentionCutoff, retentionCutoff);
    const rows = await ctx.db
      .query("webhookEvents")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", cutoff))
      .take(cleanupBatchSize);
    for (const row of rows) await ctx.db.delete("webhookEvents", row._id);
    if (rows.length === cleanupBatchSize)
      await ctx.scheduler.runAfter(0, internal.cleanup.run, { before: cutoff });
    return rows.length;
  },
});
