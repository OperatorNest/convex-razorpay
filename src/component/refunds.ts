import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import { sha256Hex } from "../shared/crypto.js";
import { assertModeMatches, isTestMode, requestProvider } from "./provider.js";
import { deterministicTestId, linkedNotes, record } from "../shared/validation.js";
import {
  linkArgs,
  notesArg,
  validateAmount,
  validateIdempotencyKey,
  validateReceipt,
} from "./validators.js";
import { optionalLinkage } from "./validators.js";

export const create = action({
  args: {
    paymentId: v.string(),
    amount: v.optional(v.number()),
    speed: v.optional(v.union(v.literal("normal"), v.literal("optimum"))),
    receipt: v.optional(v.string()),
    notes: notesArg,
    ...linkArgs,
  },
  returns: schema.doc("refunds"),
  handler: async (ctx, args): Promise<Doc<"refunds">> => {
    const testMode = isTestMode(args.testMode);
    if (args.amount !== undefined) validateAmount(args.amount);
    validateReceipt(args.receipt);
    const idempotencyKey =
      args.idempotencyKey ?? (args.receipt ? `receipt:${args.receipt}` : undefined);
    if (!idempotencyKey) {
      throw razorpayError("RAZORPAY_IDEMPOTENCY_REQUIRED");
    }
    validateIdempotencyKey(args.idempotencyKey);
    const notes = linkedNotes(args.notes, args.userId, args.externalId, args.metadata);
    const fingerprint = JSON.stringify([
      args.paymentId,
      args.amount,
      args.speed,
      args.receipt,
      Object.entries(notes).toSorted(([a], [b]) => a.localeCompare(b)),
    ]);
    const existing = await ctx.runQuery(internal.mutations.refundByKey, { key: idempotencyKey });
    if (existing) {
      assertModeMatches(existing, testMode);
      if (existing.requestFingerprint !== fingerprint)
        throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    if (testMode) {
      return ctx.runMutation(internal.mutations.putTestRefund, {
        refundId: await deterministicTestId("rfnd", [idempotencyKey, args.paymentId]),
        paymentId: args.paymentId,
        ...(args.amount === undefined ? {} : { amount: args.amount }),
        ...(args.speed === undefined ? {} : { speed: args.speed }),
        ...(args.receipt === undefined ? {} : { receipt: args.receipt }),
        notes,
        ...optionalLinkage({
          ...args,
          idempotencyKey,
          requestFingerprint: fingerprint,
          testMode: true,
        }),
        requestFingerprint: fingerprint,
      });
    }
    const providerIdempotencyKey =
      args.idempotencyKey ?? `receipt_${await sha256Hex(idempotencyKey)}`;
    const raw = await requestProvider(
      "POST",
      `/payments/${encodeURIComponent(args.paymentId)}/refund`,
      {
        body: { amount: args.amount, speed: args.speed, receipt: args.receipt, notes },
        idempotent: true,
        refund: true,
        idempotencyKey: providerIdempotencyKey,
      },
    );
    if (record(raw).payment_id !== args.paymentId) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    return ctx.runMutation(internal.mutations.putRefund, {
      raw,
      observedAt: Date.now(),
      ...optionalLinkage({
        ...args,
        idempotencyKey,
        requestFingerprint: fingerprint,
        testMode: false,
      }),
    });
  },
});

export const fetch = action({
  args: { refundId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("refunds"),
  handler: async (ctx, { refundId, testMode }): Promise<Doc<"refunds">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.refund, { id: refundId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND");
      assertModeMatches(local, true);
      return local;
    }
    const raw = await requestProvider("GET", `/refunds/${encodeURIComponent(refundId)}`, {
      idempotent: true,
    });
    if (record(raw).id !== refundId) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    return ctx.runMutation(internal.mutations.putRefund, { raw, observedAt: Date.now() });
  },
});
