import { isDefinitiveNoCreate, providerErrorCode, razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action, internalAction, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import type { ActionCtx } from "./_generated/server.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  isTestMode,
  requestProvider,
} from "./provider.js";
import {
  deterministicTestId,
  integerField,
  linkedNotes,
  omitUndefined,
  record,
  stableStringify,
  validateNotes,
} from "../shared/validation.js";
import { linkArgs, notesArg, validateIdempotencyKey } from "./validators.js";
import { optionalLinkage } from "./validators.js";

export const reconcile = internalAction({
  args: {
    key: v.string(),
    fingerprint: v.string(),
    userId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: async (ctx, args): Promise<Doc<"subscriptions"> | null> => {
    const raw = await findByIdempotencyKey("subscription", args.key);
    if (raw === null) return null;
    return ctx.runMutation(internal.mutations.putSubscription, {
      raw,
      observedAt: Date.now(),
      ...optionalLinkage({
        ...args,
        idempotencyKey: args.key,
        requestFingerprint: args.fingerprint,
        createdThroughComponent: true,
        testMode: false,
      }),
    });
  },
});

export const create = action({
  args: {
    planId: v.string(),
    totalCount: v.number(),
    quantity: v.optional(v.number()),
    startAt: v.optional(v.number()),
    expireBy: v.optional(v.number()),
    customerNotify: v.optional(v.boolean()),
    offerId: v.optional(v.string()),
    notes: notesArg,
    ...linkArgs,
  },
  returns: schema.doc("subscriptions"),
  handler: async (ctx, args): Promise<Doc<"subscriptions">> => {
    validateIdempotencyKey(args.idempotencyKey);
    const testMode = isTestMode(args.testMode);
    if (
      !Number.isSafeInteger(args.totalCount) ||
      args.totalCount < 1 ||
      (args.quantity !== undefined && (!Number.isSafeInteger(args.quantity) || args.quantity < 1))
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid subscription counts");
    }
    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(args.idempotencyKey ? { operatornestIdempotencyKey: args.idempotencyKey } : {}),
    });
    const fingerprint = stableStringify({
      planId: args.planId,
      totalCount: args.totalCount,
      quantity: args.quantity ?? 1,
      startAt: args.startAt,
      expireBy: args.expireBy,
      customerNotify: args.customerNotify,
      offerId: args.offerId,
      notes,
    });
    let shouldReconcile = false;
    if (args.idempotencyKey) {
      const claim = await ctx.runMutation(internal.idempotency.claim, {
        resource: "subscription",
        key: args.idempotencyKey,
        fingerprint,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.subscriptionByKey, {
          key: args.idempotencyKey,
        });
        if (!existing)
          throw razorpayError("RAZORPAY_NOT_FOUND", "Completed subscription claim has no mirror");
        assertModeMatches(existing, testMode, "subscription");
        return existing;
      }
      shouldReconcile = claim === "reconcile";
    }
    let raw: unknown;
    if (testMode) {
      raw = {
        id: await deterministicTestId("sub", [
          args.idempotencyKey ?? args.userId,
          args.planId,
          args.totalCount,
        ]),
        entity: "subscription",
        plan_id: args.planId,
        status: "created",
        quantity: args.quantity ?? 1,
        total_count: args.totalCount,
        paid_count: 0,
        remaining_count: args.totalCount,
        start_at: args.startAt,
        expire_by: args.expireBy,
        customer_notify: args.customerNotify ?? true,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    } else {
      if (shouldReconcile && args.idempotencyKey) {
        const reconciled = await ctx.runAction(internal.subscriptions.reconcile, {
          key: args.idempotencyKey,
          fingerprint,
          ...(args.userId === undefined ? {} : { userId: args.userId }),
          ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
          ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        });
        if (reconciled) return reconciled;
      }
      try {
        raw = await requestProvider("POST", "/subscriptions", {
          body: {
            plan_id: args.planId,
            total_count: args.totalCount,
            quantity: args.quantity,
            start_at: args.startAt,
            expire_by: args.expireBy,
            customer_notify: args.customerNotify,
            offer_id: args.offerId,
            notes,
          },
        });
      } catch (error) {
        if (args.idempotencyKey && isDefinitiveNoCreate(error)) {
          await ctx.runMutation(internal.idempotency.fail, {
            resource: "subscription",
            key: args.idempotencyKey,
            fingerprint,
            errorCode: providerErrorCode(error),
          });
        }
        throw error;
      }
    }
    const subscription = await ctx.runMutation(internal.mutations.putSubscription, {
      raw: omitUndefined(raw),
      observedAt: Date.now(),
      ...optionalLinkage({
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        requestFingerprint: fingerprint,
        createdThroughComponent: true,
        testMode,
      }),
    });
    return subscription;
  },
});

export const fetch = action({
  args: { subscriptionId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("subscriptions"),
  handler: async (ctx, { subscriptionId, testMode }): Promise<Doc<"subscriptions">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.subscription, { id: subscriptionId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND", "Subscription not found in test mode");
      assertModeMatches(local, true, "subscription");
      return local;
    }
    const raw = await requestProvider(
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { idempotent: true },
    );
    if (record(raw).id !== subscriptionId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay subscription id mismatch");
    return ctx.runMutation(internal.mutations.putSubscription, { raw, observedAt: Date.now() });
  },
});

async function change(
  ctx: ActionCtx,
  subscriptionId: string,
  operation: "cancel" | "pause" | "resume" | "update",
  body: Record<string, unknown>,
  requestedTestMode?: boolean,
): Promise<Doc<"subscriptions">> {
  let raw: unknown;
  let observedAt = Date.now();
  const testMode = isTestMode(requestedTestMode);
  if (testMode) {
    const existing = await ctx.runQuery(internal.lookup.subscription, { id: subscriptionId });
    if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND", "Subscription not found in test mode");
    // Fake changes must never rewrite a live-mirrored subscription.
    assertModeMatches(existing, true, "subscription");
    observedAt = Math.max(observedAt, existing.updatedAtProvider + 1);
    let status = existing.status;
    if (operation === "cancel" && body.cancel_at_cycle_end !== 1) status = "cancelled";
    if (operation === "pause") status = "paused";
    if (operation === "resume") status = "active";
    if (operation === "pause" && existing.status !== "active")
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Only active subscriptions can be paused");
    if (operation === "resume" && existing.status !== "paused")
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Only paused subscriptions can be resumed");
    if (operation === "update" && !["authenticated", "active"].includes(existing.status))
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Subscription cannot be updated");
    const scheduled =
      (operation === "cancel" && !!body.cancel_at_cycle_end) ||
      (operation === "update" && body.schedule_change_at === "cycle_end");
    const applyNow = operation === "update" && !scheduled;
    const remainingCount =
      applyNow && body.remaining_count !== undefined
        ? integerField(body.remaining_count, "subscription remaining_count")
        : existing.remainingCount;
    const existingStartAt =
      existing.startAt === undefined ? undefined : Math.floor(existing.startAt / 1000);
    const startAt = applyNow ? (body.start_at ?? existingStartAt) : existingStartAt;
    const existingCustomerNotify = record(existing.raw).customer_notify;
    const customerNotify = applyNow
      ? (body.customer_notify ?? existingCustomerNotify)
      : existingCustomerNotify;
    raw = {
      ...existing.raw,
      id: subscriptionId,
      status,
      plan_id: applyNow ? (body.plan_id ?? existing.planId) : existing.planId,
      quantity: applyNow ? (body.quantity ?? existing.quantity) : existing.quantity,
      remaining_count: remainingCount,
      total_count: Math.max(existing.totalCount, existing.paidCount + remainingCount),
      start_at: startAt,
      customer_notify: customerNotify,
      has_scheduled_changes:
        scheduled || (operation === "update" ? false : existing.hasScheduledChanges),
      created_at: Math.floor(existing.createdAt / 1000),
    };
  } else {
    const method = operation === "update" ? "PATCH" : "POST";
    const path =
      operation === "update"
        ? `/subscriptions/${encodeURIComponent(subscriptionId)}`
        : `/subscriptions/${encodeURIComponent(subscriptionId)}/${operation}`;
    raw = await requestProvider(method, path, { body });
    if (record(raw).id !== subscriptionId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay subscription id mismatch");
  }
  return ctx.runMutation(internal.mutations.putSubscription, {
    raw: omitUndefined(raw),
    observedAt,
    testMode,
  });
}

export const cancel = action({
  args: {
    subscriptionId: v.string(),
    cancelAtCycleEnd: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { subscriptionId, cancelAtCycleEnd, testMode }) =>
    change(
      ctx,
      subscriptionId,
      "cancel",
      { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 },
      testMode,
    ),
});
export const pause = action({
  args: { subscriptionId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { subscriptionId, testMode }) =>
    change(ctx, subscriptionId, "pause", { pause_at: "now" }, testMode),
});
export const resume = action({
  args: { subscriptionId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { subscriptionId, testMode }) =>
    change(ctx, subscriptionId, "resume", { resume_at: "now" }, testMode),
});
export const update = action({
  args: {
    subscriptionId: v.string(),
    planId: v.optional(v.string()),
    offerId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    remainingCount: v.optional(v.number()),
    startAt: v.optional(v.number()),
    scheduleChangeAt: v.optional(v.union(v.literal("now"), v.literal("cycle_end"))),
    customerNotify: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("subscriptions"),
  handler: (ctx, args) => {
    if (
      ![
        args.planId,
        args.offerId,
        args.quantity,
        args.remainingCount,
        args.startAt,
        args.customerNotify,
      ].some((x) => x !== undefined)
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Subscription update requires a field");
    }
    if (
      (args.quantity !== undefined &&
        (!Number.isSafeInteger(args.quantity) || args.quantity < 1)) ||
      (args.remainingCount !== undefined &&
        (!Number.isSafeInteger(args.remainingCount) || args.remainingCount < 1))
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid subscription update count");
    }
    return change(
      ctx,
      args.subscriptionId,
      "update",
      {
        plan_id: args.planId,
        offer_id: args.offerId,
        quantity: args.quantity,
        remaining_count: args.remainingCount,
        start_at: args.startAt,
        schedule_change_at: args.scheduleChangeAt,
        customer_notify: args.customerNotify,
      },
      args.testMode,
    );
  },
});

export const getForUser = query({
  args: { userId: v.string(), statuses: v.optional(v.array(v.string())) },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: async (ctx, { userId, statuses }) => {
    if (statuses && statuses.length > 20)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Too many subscription statuses");
    const priority = ["active", "authenticated", "pending", "halted", "paused"];
    const requested = statuses ? [...new Set(statuses)] : undefined;
    const liveStatuses = priority.filter((status) => !requested || requested.includes(status));
    const otherStatuses = requested?.filter((status) => !priority.includes(status));
    const liveCandidates = await Promise.all(
      liveStatuses.map((status) =>
        ctx.db
          .query("subscriptions")
          .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", status))
          .order("desc")
          .first(),
      ),
    );
    const liveCandidate = liveCandidates.find((candidate) => candidate !== null);
    if (liveCandidate) return liveCandidate;
    if (requested) {
      const otherCandidates = await Promise.all(
        (otherStatuses ?? []).map((status) =>
          ctx.db
            .query("subscriptions")
            .withIndex("by_userId_and_status", (q) => q.eq("userId", userId).eq("status", status))
            .order("desc")
            .first(),
        ),
      );
      return (
        otherCandidates
          .filter((candidate) => candidate !== null)
          .toSorted((a, b) => b.createdAt - a.createdAt)[0] ?? null
      );
    }
    return ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});
export const listByUser = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(schema.doc("subscriptions")),
  handler: (ctx, { userId, limit }) =>
    ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 100)),
});
