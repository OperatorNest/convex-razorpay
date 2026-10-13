import { razorpayError } from "../shared/errors.js";

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import schema from "./schema.js";
import { readTestMode } from "./provider.js";

const staleAfterMs = 10 * 60_000;

const resourceValidator = schema.tables.idempotencyRequests.validator.fields.resource;

export const claim = internalMutation({
  args: {
    resource: resourceValidator,
    userId: v.optional(v.string()),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    testMode: v.boolean(),
  },
  returns: v.union(v.literal("claimed"), v.literal("completed"), v.literal("reconcile")),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_userId_and_idempotencyKey", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", args.testMode)
          .eq("userId", args.userId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (existing.status === "completed") {
        if (existing.requestFingerprint !== args.requestFingerprint)
          throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
        return "completed";
      }
      if (existing.status === "pending" && existing.requestFingerprint !== args.requestFingerprint)
        throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
      if (existing.status === "pending" && Date.now() - existing.createdAt < staleAfterMs)
        throw razorpayError("RAZORPAY_IDEMPOTENCY_PENDING");
      await ctx.db.patch("idempotencyRequests", existing["_id"], {
        requestFingerprint: args.requestFingerprint,
        status: "pending",
        errorCode: undefined,
        createdAt: Date.now(),
        settledAt: undefined,
      });
      return existing.status === "pending" ? "reconcile" : "claimed";
    }
    await ctx.db.insert("idempotencyRequests", {
      resource: args.resource,
      userId: args.userId,
      testMode: args.testMode,
      idempotencyKey: args.idempotencyKey,
      requestFingerprint: args.requestFingerprint,
      status: "pending",
      createdAt: Date.now(),
    });
    return "claimed";
  },
});

export const fail = internalMutation({
  args: {
    resource: resourceValidator,
    userId: v.optional(v.string()),
    testMode: v.boolean(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    errorCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingClaim = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_userId_and_idempotencyKey", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", args.testMode)
          .eq("userId", args.userId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (
      existingClaim?.requestFingerprint === args.requestFingerprint &&
      existingClaim.status === "pending"
    ) {
      await ctx.db.patch("idempotencyRequests", existingClaim["_id"], {
        status: "failed",
        errorCode: args.errorCode,
        settledAt: Date.now(),
      });
    }
    return null;
  },
});

export const release = internalMutation({
  args: {
    resource: resourceValidator,
    userId: v.optional(v.string()),
    idempotencyKey: v.string(),
    testMode: v.optional(v.boolean()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existingClaim = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_userId_and_idempotencyKey", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", readTestMode(args.testMode))
          .eq("userId", args.userId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (!existingClaim || existingClaim.status === "completed") return false;
    await ctx.db.delete("idempotencyRequests", existingClaim["_id"]);
    return true;
  },
});

export const findClaimedEntityId = internalQuery({
  args: {
    resource: resourceValidator,
    userId: v.optional(v.string()),
    idempotencyKey: v.string(),
    testMode: v.boolean(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const existingClaim = await ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_testMode_and_userId_and_idempotencyKey", (q) =>
        q
          .eq("resource", args.resource)
          .eq("testMode", args.testMode)
          .eq("userId", args.userId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    return existingClaim?.status === "completed" ? (existingClaim.razorpayEntityId ?? null) : null;
  },
});
