import { isDefinitiveNoCreate, providerErrorCode, razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  isTestMode,
  listPath,
  requestProvider,
} from "./provider.js";
import {
  deterministicTestId,
  linkedNotes,
  omitUndefined,
  record,
  stableStringify,
  validateNotes,
} from "../shared/validation.js";
import {
  linkArgs,
  notesArg,
  pageArgs,
  validateAmount,
  validateCurrency,
  validateIdempotencyKey,
  validatePage,
  optionalLinkage,
} from "./validators.js";

const idempotencyNote = "operatornestIdempotencyKey";

export const create = action({
  args: {
    period: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly"),
    ),
    interval: v.number(),
    item: v.object({
      name: v.string(),
      amount: v.number(),
      currency: v.string(),
      description: v.optional(v.string()),
    }),
    notes: notesArg,
    ...linkArgs,
  },
  returns: schema.doc("plans"),
  handler: async (ctx, args): Promise<Doc<"plans">> => {
    validateIdempotencyKey(args.idempotencyKey);
    if (!Number.isSafeInteger(args.interval) || args.interval < (args.period === "daily" ? 7 : 1))
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid plan interval");
    validateAmount(args.item.amount, 100);
    validateCurrency(args.item.currency);
    if (!args.item.name) throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Plan name is required");
    const testMode = isTestMode(args.testMode);
    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(args.idempotencyKey ? { [idempotencyNote]: args.idempotencyKey } : {}),
    });
    const fingerprint = stableStringify({
      period: args.period,
      interval: args.interval,
      item: args.item,
      notes,
    });
    let shouldReconcile = false;
    if (args.idempotencyKey) {
      const claim = await ctx.runMutation(internal.idempotency.claim, {
        resource: "plan",
        key: args.idempotencyKey,
        fingerprint,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.planByKey, {
          key: args.idempotencyKey,
        });
        if (!existing)
          throw razorpayError("RAZORPAY_NOT_FOUND", "Completed plan claim has no mirror");
        assertModeMatches(existing, testMode, "plan");
        return existing;
      }
      shouldReconcile = claim === "reconcile";
    }
    let raw: unknown;
    if (testMode) {
      raw = {
        id: await deterministicTestId("plan", [
          args.idempotencyKey ?? args.item.name,
          args.period,
          args.interval,
          args.item.amount,
        ]),
        entity: "plan",
        period: args.period,
        interval: args.interval,
        item: args.item,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    } else {
      if (shouldReconcile && args.idempotencyKey) {
        const reconciledRaw = await findByIdempotencyKey("plan", args.idempotencyKey);
        if (reconciledRaw) {
          raw = reconciledRaw;
        }
      }
      if (raw === null || raw === undefined) {
        try {
          raw = await requestProvider("POST", "/plans", {
            body: { period: args.period, interval: args.interval, item: args.item, notes },
          });
        } catch (error) {
          if (args.idempotencyKey && isDefinitiveNoCreate(error)) {
            await ctx.runMutation(internal.idempotency.fail, {
              resource: "plan",
              key: args.idempotencyKey,
              fingerprint,
              errorCode: providerErrorCode(error),
            });
          }
          throw error;
        }
      }
    }
    const plan = await ctx.runMutation(internal.mutations.putPlan, {
      raw: omitUndefined(raw),
      observedAt: Date.now(),
      ...optionalLinkage({
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        requestFingerprint: fingerprint,
        testMode,
      }),
    });
    return plan;
  },
});

export const fetch = action({
  args: { planId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("plans"),
  handler: async (ctx, { planId, testMode }): Promise<Doc<"plans">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.plan, { id: planId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND", "Plan not found in test mode");
      assertModeMatches(local, true, "plan");
      return local;
    }
    const raw = await requestProvider("GET", `/plans/${encodeURIComponent(planId)}`, {
      idempotent: true,
    });
    if (record(raw).id !== planId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay plan id mismatch");
    return ctx.runMutation(internal.mutations.putPlan, { raw, observedAt: Date.now() });
  },
});

export const list = action({
  args: pageArgs,
  returns: v.array(schema.doc("plans")),
  handler: async (ctx, args): Promise<Doc<"plans">[]> => {
    const { count, skip } = validatePage(args.count, args.skip);
    if (isTestMode(args.testMode))
      return ctx.runQuery(internal.lookup.plansPage, { count, skip, testMode: true });
    const items = collectionItems(
      await requestProvider("GET", listPath("/plans", count, skip), { idempotent: true }),
    );
    return Promise.all(
      items.map((raw) =>
        ctx.runMutation(internal.mutations.putPlan, { raw, observedAt: Date.now() }),
      ),
    );
  },
});
