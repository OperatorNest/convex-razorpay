import { parseProviderResponse } from "../shared/providerErrors.js";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { boundedPage, validateIdempotencyKey } from "../shared/bounds.js";
import { paginator } from "convex-helpers/server/pagination";
import { subscriptionFields } from "./mapping.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import type { ActionCtx } from "./_generated/server.js";
import { razorpayError } from "../shared/errors.js";
import { isDefinitiveNoCreate, providerErrorCode } from "../shared/providerErrors.js";
import { v } from "convex/values";
import { action, internalAction, query, env, mutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  readTestMode,
  resolveProviderMode,
  requestProvider,
} from "./provider.js";
import {
  deterministicTestId,
  scopedIdempotencyKey,
  integerField,
  linkedNotes,
  omitUndefined,
  record,
  stableStringify,
  validateNotes,
} from "../shared/validation.js";
import { linkArgs, notesArg, optionalLinkage, timestampSeconds } from "./validators.js";
import { readConfig, requireConfigValue } from "../shared/config.js";
import { verifySubscriptionCheckout } from "../shared/crypto.js";

export const reconcile = internalAction({
  args: {
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    userId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    testMode: v.boolean(),
  },
  returns: schema.doc("subscriptions"),
  handler: async (ctx, args): Promise<Doc<"subscriptions">> => {
    const providerKey = await scopedIdempotencyKey(
      "subscription",
      args.idempotencyKey,
      args.testMode,
      args.userId,
    );
    const raw = await findByIdempotencyKey("subscription", providerKey);
    return ctx.runMutation(internal.mutations.putSubscription, {
      raw,
      observedAt: Date.now(),
      ...optionalLinkage({
        ...args,
        idempotencyKey: args.idempotencyKey,
        requestFingerprint: args.requestFingerprint,
        createdThroughComponent: true,
        testMode: args.testMode,
      }),
    });
  },
});

export const create = action({
  args: {
    razorpayPlanId: v.string(),
    totalCount: v.number(),
    quantity: v.number(),
    startAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    customerNotify: v.boolean(),
    razorpayOfferId: v.optional(v.string()),
    notes: notesArg,
    ...linkArgs,
  },
  returns: schema.doc("subscriptions"),
  handler: async (ctx, args): Promise<Doc<"subscriptions">> => {
    if (args.idempotencyKey !== undefined) validateIdempotencyKey(args.idempotencyKey);
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    if (
      !Number.isSafeInteger(args.totalCount) ||
      args.totalCount < 1 ||
      !Number.isSafeInteger(args.quantity) ||
      args.quantity < 1
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    timestampSeconds(args.startAt);
    timestampSeconds(args.expiresAt);
    const providerKey = args.idempotencyKey
      ? await scopedIdempotencyKey("subscription", args.idempotencyKey, testMode, args.userId)
      : undefined;
    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(providerKey ? { operatornestIdempotencyKey: providerKey } : {}),
    });
    const requestFingerprint = stableStringify({
      testMode,
      razorpayPlanId: args.razorpayPlanId,
      totalCount: args.totalCount,
      quantity: args.quantity,
      startAt: args.startAt,
      expiresAt: args.expiresAt,
      customerNotify: args.customerNotify,
      razorpayOfferId: args.razorpayOfferId,
      notes,
    });
    let shouldReconcile = false;
    if (args.idempotencyKey) {
      const claim = await ctx.runMutation(internal.idempotency.claim, {
        userId: args.userId,
        resource: "subscription",
        idempotencyKey: args.idempotencyKey,
        requestFingerprint,
        testMode,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.subscriptionByKey, {
          userId: args.userId,
          idempotencyKey: args.idempotencyKey,
          testMode,
        });
        if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND");
        assertModeMatches(existing, testMode);
        return existing;
      }
      shouldReconcile = claim === "reconcile";
    }
    let raw: unknown;
    if (isSimulated) {
      raw = {
        id: await deterministicTestId("sub", [
          providerKey ?? crypto.randomUUID(),
          args.razorpayPlanId,
          args.totalCount,
        ]),
        entity: "subscription",
        plan_id: args.razorpayPlanId,
        status: "created",
        quantity: args.quantity,
        total_count: args.totalCount,
        paid_count: 0,
        remaining_count: args.totalCount,
        start_at: timestampSeconds(args.startAt),
        expire_by: timestampSeconds(args.expiresAt),
        customer_notify: args.customerNotify,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    } else {
      if (shouldReconcile && args.idempotencyKey) {
        return ctx.runAction(internal.subscriptions.reconcile, {
          idempotencyKey: args.idempotencyKey,
          requestFingerprint,
          ...(args.userId === undefined ? {} : { userId: args.userId }),
          ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
          ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
          testMode,
        });
      }
      try {
        raw = await requestProvider("POST", "/subscriptions", {
          body: {
            plan_id: args.razorpayPlanId,
            total_count: args.totalCount,
            quantity: args.quantity,
            start_at: timestampSeconds(args.startAt),
            expire_by: timestampSeconds(args.expiresAt),
            customer_notify: args.customerNotify,
            offer_id: args.razorpayOfferId,
            notes,
          },
          isDeduplicated: args.idempotencyKey !== undefined,
        });
      } catch (error) {
        if (args.idempotencyKey && isDefinitiveNoCreate(error)) {
          await ctx.runMutation(internal.idempotency.fail, {
            userId: args.userId,
            resource: "subscription",
            idempotencyKey: args.idempotencyKey,
            requestFingerprint,
            testMode,
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
        requestFingerprint,
        createdThroughComponent: true,
        testMode,
      }),
    });
    return subscription;
  },
});

export const fetch = action({
  args: { razorpaySubscriptionId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.object(schema.tables.subscriptions.validator.fields),
  handler: async (
    ctx,
    { razorpaySubscriptionId, testMode },
  ): Promise<Omit<Doc<"subscriptions">, "_id" | "_creationTime">> => {
    const mode = resolveProviderMode(testMode);
    if (mode.isSimulated) {
      const local = await ctx.runQuery(internal.lookup.subscription, {
        id: razorpaySubscriptionId,
      });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      const { _id, _creationTime, ...entity } = local;
      return entity;
    }
    const raw = await requestProvider(
      "GET",
      `/subscriptions/${encodeURIComponent(razorpaySubscriptionId)}`,
    );
    if (parseProviderResponse(() => record(raw)).id !== razorpaySubscriptionId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return { ...subscriptionFields(raw, Date.now()), testMode: mode.testMode };
  },
});

async function change(
  ctx: ActionCtx,
  razorpaySubscriptionId: string,
  operation: "cancel" | "pause" | "resume" | "update",
  body: Record<string, unknown>,
  requestedTestMode?: boolean,
): Promise<Doc<"subscriptions">> {
  let raw: unknown;
  let observedAt = Date.now();
  const { testMode, isSimulated } = resolveProviderMode(requestedTestMode);
  if (isSimulated) {
    const existing = await ctx.runQuery(internal.lookup.subscription, {
      id: razorpaySubscriptionId,
    });
    if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND");

    assertModeMatches(existing, true);
    observedAt = Math.max(observedAt, existing.providerUpdatedAt + 1);
    let status = existing.status;
    if (operation === "cancel" && body.cancel_at_cycle_end !== 1) status = "cancelled";
    if (operation === "pause") status = "paused";
    if (operation === "resume") status = "active";
    if (operation === "pause" && existing.status !== "active")
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    if (operation === "resume" && existing.status !== "paused")
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    if (operation === "update" && !["authenticated", "active"].includes(existing.status))
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    const scheduled =
      (operation === "cancel" && !!body.cancel_at_cycle_end) ||
      (operation === "update" && body.schedule_change_at === "cycle_end");
    const applyNow = operation === "update" && !scheduled;
    const remainingCount =
      applyNow && body.remaining_count !== undefined
        ? integerField(body.remaining_count)
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
      id: razorpaySubscriptionId,
      status,
      plan_id: applyNow ? (body.plan_id ?? existing.razorpayPlanId) : existing.razorpayPlanId,
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
        ? `/subscriptions/${encodeURIComponent(razorpaySubscriptionId)}`
        : `/subscriptions/${encodeURIComponent(razorpaySubscriptionId)}/${operation}`;
    raw = await requestProvider(method, path, { body });
    if (parseProviderResponse(() => record(raw)).id !== razorpaySubscriptionId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
  }
  return ctx.runMutation(internal.mutations.putSubscription, {
    raw: omitUndefined(raw),
    observedAt,
    testMode,
  });
}

export const cancel = action({
  args: {
    razorpaySubscriptionId: v.string(),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { razorpaySubscriptionId, testMode }) =>
    change(ctx, razorpaySubscriptionId, "cancel", { cancel_at_cycle_end: 0 }, testMode),
});
export const cancelAtCycleEnd = action({
  args: {
    razorpaySubscriptionId: v.string(),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { razorpaySubscriptionId, testMode }) =>
    change(ctx, razorpaySubscriptionId, "cancel", { cancel_at_cycle_end: 1 }, testMode),
});
export const pause = action({
  args: { razorpaySubscriptionId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { razorpaySubscriptionId, testMode }) =>
    change(ctx, razorpaySubscriptionId, "pause", { pause_at: "now" }, testMode),
});
export const resume = action({
  args: { razorpaySubscriptionId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("subscriptions"),
  handler: (ctx, { razorpaySubscriptionId, testMode }) =>
    change(ctx, razorpaySubscriptionId, "resume", { resume_at: "now" }, testMode),
});
export const update = action({
  args: {
    razorpaySubscriptionId: v.string(),
    razorpayPlanId: v.optional(v.string()),
    razorpayOfferId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    remainingCount: v.optional(v.number()),
    startAt: v.optional(v.number()),
    scheduleChangeAt: v.union(v.literal("now"), v.literal("cycle_end")),
    customerNotify: v.optional(v.boolean()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("subscriptions"),
  handler: (ctx, args) => {
    if (
      ![
        args.razorpayPlanId,
        args.razorpayOfferId,
        args.quantity,
        args.remainingCount,
        args.startAt,
        args.customerNotify,
      ].some((x) => x !== undefined)
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    if (
      (args.quantity !== undefined &&
        (!Number.isSafeInteger(args.quantity) || args.quantity < 1)) ||
      (args.remainingCount !== undefined &&
        (!Number.isSafeInteger(args.remainingCount) || args.remainingCount < 1))
    ) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    return change(
      ctx,
      args.razorpaySubscriptionId,
      "update",
      {
        plan_id: args.razorpayPlanId,
        offer_id: args.razorpayOfferId,
        quantity: args.quantity,
        remaining_count: args.remainingCount,
        start_at: timestampSeconds(args.startAt),
        schedule_change_at: args.scheduleChangeAt,
        customer_notify: args.customerNotify,
      },
      args.testMode,
    );
  },
});

export const get = query({
  args: {
    userId: v.string(),
    statuses: v.optional(v.array(schema.tables.subscriptions.validator.fields.status)),
    testMode: v.optional(v.boolean()),
  },
  returns: v.union(schema.doc("subscriptions"), v.null()),
  handler: async (ctx, { userId, statuses, testMode }) => {
    if (statuses && statuses.length > 20) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    const priority: Doc<"subscriptions">["status"][] = [
      "active",
      "authenticated",
      "pending",
      "halted",
      "paused",
    ];
    const requested = statuses ? [...new Set(statuses)] : undefined;
    const liveStatuses = priority.filter((status) => !requested || requested.includes(status));
    const otherStatuses = requested?.filter((status) => !priority.includes(status));
    const liveCandidates = await Promise.all(
      liveStatuses.map((status) =>
        ctx.db
          .query("subscriptions")
          .withIndex("by_userId_and_testMode_and_status", (q) =>
            q.eq("userId", userId).eq("testMode", readTestMode(testMode)).eq("status", status),
          )
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
            .withIndex("by_userId_and_testMode_and_status", (q) =>
              q.eq("userId", userId).eq("testMode", readTestMode(testMode)).eq("status", status),
            )
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
      .withIndex("by_userId_and_testMode_and_createdAt", (q) =>
        q.eq("userId", userId).eq("testMode", readTestMode(testMode)),
      )
      .order("desc")
      .first();
  },
});
export const list = query({
  args: {
    userId: v.string(),
    paginationOpts: paginationOptsValidator,
    testMode: v.optional(v.boolean()),
  },
  returns: paginationResultValidator(schema.doc("subscriptions")),
  handler: (ctx, { userId, paginationOpts, testMode }) =>
    paginator(ctx.db, schema)
      .query("subscriptions")
      .withIndex("by_userId_and_testMode_and_createdAt", (q) =>
        q.eq("userId", userId).eq("testMode", readTestMode(testMode)),
      )
      .order("desc")
      .paginate(boundedPage(paginationOpts, 5)),
});

export const verifyCheckout = action({
  args: {
    razorpaySubscriptionId: v.string(),
    razorpayPaymentId: v.string(),
    signature: v.string(),

    userId: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("payments"),
  handler: async (ctx, args): Promise<Doc<"payments">> => {
    if (
      !(await verifySubscriptionCheckout(
        requireConfigValue(readConfig(env).keySecret),
        args.razorpaySubscriptionId,
        args.razorpayPaymentId,
        args.signature,
      ))
    ) {
      throw razorpayError("RAZORPAY_INVALID_PAYMENT_SIGNATURE");
    }
    const mirrored = await ctx.runQuery(internal.lookup.subscription, {
      id: args.razorpaySubscriptionId,
    });
    if (!mirrored) throw razorpayError("RAZORPAY_NOT_FOUND");
    if (mirrored.createdThroughComponent !== true) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    assertModeMatches(mirrored, testMode);
    if (args.userId !== undefined && mirrored.userId !== args.userId) {
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    if (isSimulated) {
      const localPayment = await ctx.runQuery(internal.lookup.payment, {
        id: args.razorpayPaymentId,
      });
      if (!localPayment) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(localPayment, true);
    } else {
      const subscription = await requestProvider(
        "GET",
        `/subscriptions/${encodeURIComponent(args.razorpaySubscriptionId)}`,
      );
      if (record(subscription).id !== args.razorpaySubscriptionId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      await ctx.runMutation(internal.mutations.putSubscription, {
        raw: subscription,
        observedAt: Date.now(),
        testMode,
      });
      const payment = await requestProvider(
        "GET",
        `/payments/${encodeURIComponent(args.razorpayPaymentId)}`,
      );
      if (record(payment).id !== args.razorpayPaymentId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
      await ctx.runMutation(internal.mutations.putPayment, {
        raw: payment,
        observedAt: Date.now(),
        testMode,
      });
    }
    return ctx.runMutation(internal.mutations.markVerified, {
      razorpayPaymentId: args.razorpayPaymentId,
      razorpaySubscriptionId: args.razorpaySubscriptionId,
      testMode,
    });
  },
});

export const releaseIdempotency = mutation({
  args: {
    idempotencyKey: v.string(),
    userId: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: v.boolean(),
  handler: (ctx, args): Promise<boolean> =>
    ctx.runMutation(internal.idempotency.release, {
      userId: args.userId,
      resource: "subscription",
      idempotencyKey: args.idempotencyKey,
      testMode: args.testMode,
    }),
});
