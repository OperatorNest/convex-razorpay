import { parseProviderResponse } from "../shared/providerErrors.js";
import { validateIdempotencyKey } from "../shared/bounds.js";
import { refundFields } from "./mapping.js";
import { razorpayError } from "../shared/errors.js";

import { v } from "convex/values";
import { action } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { assertModeMatches, requestProvider, resolveProviderMode } from "./provider.js";
import {
  scopedIdempotencyKey,
  deterministicTestId,
  linkedNotes,
  record,
  stableStringify,
} from "../shared/validation.js";
import { linkArgs, notesArg, validateAmount, validateReceipt } from "./validators.js";
import { optionalLinkage } from "./validators.js";

export const create = action({
  args: {
    razorpayPaymentId: v.string(),
    amount: v.number(),
    speed: v.union(v.literal("normal"), v.literal("optimum")),
    receipt: v.optional(v.string()),
    notes: notesArg,
    ...linkArgs,
  },
  returns: schema.doc("refunds"),
  handler: async (ctx, args): Promise<Doc<"refunds">> => {
    const { testMode, isSimulated } = resolveProviderMode(args.testMode);
    validateAmount(args.amount);
    validateReceipt(args.receipt);
    const idempotencyKey =
      args.idempotencyKey ?? (args.receipt ? `receipt:${args.receipt}` : undefined);
    if (!idempotencyKey) {
      throw razorpayError("RAZORPAY_IDEMPOTENCY_REQUIRED");
    }
    if (args.idempotencyKey !== undefined) validateIdempotencyKey(args.idempotencyKey);
    const providerIdempotencyKey = await scopedIdempotencyKey(
      "refund",
      idempotencyKey,
      testMode,
      args.userId,
    );
    const notes = linkedNotes(args.notes, args.userId, args.externalId, args.metadata);
    const requestFingerprint = stableStringify({
      testMode,
      razorpayPaymentId: args.razorpayPaymentId,
      amount: args.amount,
      speed: args.speed,
      receipt: args.receipt,
      notes,
    });
    const existing = await ctx.runQuery(internal.mutations.refundByKey, {
      idempotencyKey,
      testMode,
      userId: args.userId,
    });
    if (existing) {
      assertModeMatches(existing, testMode);
      if (existing.requestFingerprint !== requestFingerprint)
        throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    if (isSimulated) {
      return ctx.runMutation(internal.mutations.putTestRefund, {
        razorpayRefundId: await deterministicTestId("rfnd", [
          providerIdempotencyKey,
          args.razorpayPaymentId,
        ]),
        razorpayPaymentId: args.razorpayPaymentId,
        amount: args.amount,
        speed: args.speed,
        ...(args.receipt === undefined ? {} : { receipt: args.receipt }),
        notes,
        ...optionalLinkage({
          ...args,
          idempotencyKey,
          requestFingerprint,
          testMode: true,
        }),
        requestFingerprint,
      });
    }
    const raw = await requestProvider(
      "POST",
      `/payments/${encodeURIComponent(args.razorpayPaymentId)}/refund`,
      {
        body: { amount: args.amount, speed: args.speed, receipt: args.receipt, notes },
        isDeduplicated: true,
        refundIdempotencyKey: providerIdempotencyKey,
      },
    );
    if (parseProviderResponse(() => record(raw)).payment_id !== args.razorpayPaymentId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return ctx.runMutation(internal.mutations.putRefund, {
      raw,
      observedAt: Date.now(),
      ...optionalLinkage({
        ...args,
        idempotencyKey,
        requestFingerprint,
        testMode,
      }),
    });
  },
});

export const fetch = action({
  args: { razorpayRefundId: v.string(), testMode: v.optional(v.boolean()) },
  returns: v.object(schema.tables.refunds.validator.fields),
  handler: async (
    ctx,
    { razorpayRefundId, testMode },
  ): Promise<Omit<Doc<"refunds">, "_id" | "_creationTime">> => {
    const mode = resolveProviderMode(testMode);
    if (mode.isSimulated) {
      const local = await ctx.runQuery(internal.lookup.refund, { id: razorpayRefundId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      const { _id, _creationTime, ...entity } = local;
      return entity;
    }
    const raw = await requestProvider("GET", `/refunds/${encodeURIComponent(razorpayRefundId)}`);
    if (parseProviderResponse(() => record(raw)).id !== razorpayRefundId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    return { ...refundFields(raw, Date.now()), testMode: mode.testMode };
  },
});
