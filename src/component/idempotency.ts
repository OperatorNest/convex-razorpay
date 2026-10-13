import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import { resolveMode } from "./provider.js";

const staleAfterMs = 10 * 60_000;
const retentionMs = 30 * 24 * 60 * 60_000;

const resourceValidator = schema.tables.idempotencyRequests.validator.fields.resource;

export const claim = internalMutation({
  args: {
    resource: resourceValidator,
    key: v.string(),
    fingerprint: v.string(),
    testMode: v.boolean(),
  },
  returns: v.union(v.literal("claimed"), v.literal("completed"), v.literal("reconcile")),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_key", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", resolveMode(args.testMode))
          .eq("key", args.key),
      )
      .unique();
    if (existing) {
      if (existing.status === "completed") {
        if (existing.fingerprint !== args.fingerprint)
          throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
        return "completed";
      }
      if (existing.status === "pending" && existing.fingerprint !== args.fingerprint)
        throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
      if (existing.status === "pending" && Date.now() - existing.createdAt < staleAfterMs)
        throw razorpayError("RAZORPAY_IDEMPOTENCY_PENDING");
      await ctx.db.patch("idempotencyRequests", existing["_id"], {
        fingerprint: args.fingerprint,
        status: "pending",
        errorCode: undefined,
        createdAt: Date.now(),
        settledAt: undefined,
      });
      return existing.status === "pending" ? "reconcile" : "claimed";
    }
    await ctx.db.insert("idempotencyRequests", {
      resource: args.resource,
      testMode: args.testMode,
      key: args.key,
      fingerprint: args.fingerprint,
      status: "pending",
      createdAt: Date.now(),
    });
    return "claimed";
  },
});

export const fail = internalMutation({
  args: {
    resource: resourceValidator,
    testMode: v.boolean(),
    key: v.string(),
    fingerprint: v.string(),
    errorCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingClaim = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_key", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", resolveMode(args.testMode))
          .eq("key", args.key),
      )
      .unique();
    if (existingClaim?.fingerprint === args.fingerprint && existingClaim.status === "pending") {
      await ctx.db.patch("idempotencyRequests", existingClaim["_id"], {
        status: "failed",
        errorCode: args.errorCode,
        settledAt: Date.now(),
      });
    }
    return null;
  },
});

export const release = mutation({
  args: { resource: resourceValidator, key: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existingClaim = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_key", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", resolveMode(args.testMode))
          .eq("key", args.key),
      )
      .unique();
    if (!existingClaim || existingClaim.status === "completed") return false;
    await ctx.db.delete("idempotencyRequests", existingClaim["_id"]);
    return true;
  },
});

export const cleanupScheduled = internalMutation({
  args: { before: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { before }) => {
    const cutoff = before ?? Date.now() - retentionMs;
    if (!Number.isSafeInteger(cutoff) || cutoff < 0)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    const rows = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_status_and_settledAt", (q) => q.eq("status", "failed").lt("settledAt", cutoff))
      .take(20);
    for (const row of rows) await ctx.db.delete("idempotencyRequests", row._id);
    const deleted = rows.length;
    if (deleted === 20)
      await ctx.scheduler.runAfter(0, internal.idempotency.cleanupScheduled, { before: cutoff });
    return deleted;
  },
});
