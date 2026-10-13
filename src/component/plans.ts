import { parseProviderResponse } from "../shared/providerErrors.js";
import { planFields } from "./mapping.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { razorpayError } from "../shared/errors.js";
import { isDefinitiveNoCreate, providerErrorCode } from "../shared/providerErrors.js";
import { v } from "convex/values";
import { action, mutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { collectionItems } from "./mapping.js";
import {
  assertModeMatches,
  findByIdempotencyKey,
  listPath,
  requestProvider,
  resolveProviderMode,
} from "./provider.js";
import {
  boundedString,
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
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    validateAmount(args.item.amount);
    validateCurrency(args.item.currency);
    boundedString(args.item.name, 256);
    if (args.item.description !== undefined) boundedString(args.item.description, 4096);
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    const notes = validateNotes({
      ...linkedNotes(args.notes, args.userId, args.externalId, args.metadata),
      ...(args.idempotencyKey ? { [idempotencyNote]: args.idempotencyKey } : {}),
    });
    const requestFingerprint = stableStringify({
      testMode,
      period: args.period,
      interval: args.interval,
      item: args.item,
      notes,
    });
    let shouldReconcile = false;
    if (args.idempotencyKey) {
      const claim = await ctx.runMutation(internal.idempotency.claim, {
        resource: "plan",
        idempotencyKey: args.idempotencyKey,
        requestFingerprint,
        testMode,
      });
      if (claim === "completed") {
        const existing = await ctx.runQuery(internal.mutations.planByKey, {
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
        id: await deterministicTestId("plan", [
          args.idempotencyKey ?? crypto.randomUUID(),
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
        raw = await findByIdempotencyKey("plan", args.idempotencyKey);
      }
      if (raw === undefined) {
        try {
          raw = await requestProvider("POST", "/plans", {
            body: { period: args.period, interval: args.interval, item: args.item, notes },
          });
        } catch (error) {
          if (args.idempotencyKey && isDefinitiveNoCreate(error)) {
            await ctx.runMutation(internal.idempotency.fail, {
              resource: "plan",
              idempotencyKey: args.idempotencyKey,
              requestFingerprint,
              testMode,
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
        requestFingerprint,
        testMode,
      }),
    });
    return plan;
  },
});

export const fetch = action({
  args: { razorpayPlanId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.object(schema.tables.plans.validator.fields),
  handler: async (
    ctx,
    { razorpayPlanId, testMode },
  ): Promise<Omit<Doc<"plans">, "_id" | "_creationTime">> => {
    const mode = resolveProviderMode(testMode);
    if (mode.isSimulated) {
      const local = await ctx.runQuery(internal.lookup.plan, { id: razorpayPlanId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      const { _id, _creationTime, ...entity } = local;
      return entity;
    }
    const raw = await requestProvider("GET", `/plans/${encodeURIComponent(razorpayPlanId)}`, {
      idempotent: true,
    });
    if (parseProviderResponse(() => record(raw)).id !== razorpayPlanId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return { ...planFields(raw, Date.now()), testMode: mode.testMode };
  },
});

export const fetchAll = action({
  args: pageArgs,
  returns: v.array(v.object(schema.tables.plans.validator.fields)),
  handler: async (ctx, args): Promise<Omit<Doc<"plans">, "_id" | "_creationTime">[]> => {
    const { count, skip } = validatePage(args.count, args.skip);
    const mode = resolveProviderMode(args.testMode);
    if (mode.isSimulated)
      return (await ctx.runQuery(internal.lookup.plansPage, { count, skip, testMode: true })).map(
        ({ _id, _creationTime, ...entity }) => entity,
      );
    const items = collectionItems(
      await requestProvider("GET", listPath("/plans", count, skip), { idempotent: true }),
    );
    return items.map((raw) =>
      Object.assign(planFields(raw, Date.now()), { testMode: mode.testMode }),
    );
  },
});

export const releaseIdempotency = mutation({
  args: { idempotencyKey: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.boolean(),
  handler: (ctx, args): Promise<boolean> =>
    ctx.runMutation(internal.idempotency.release, {
      resource: "plan",
      idempotencyKey: args.idempotencyKey,
      testMode: args.testMode,
    }),
});
