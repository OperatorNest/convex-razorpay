import { razorpayError, isRazorpayError } from "../shared/errors.js";
import { maxWebhookBodyBytes, retentionMs } from "../shared/constants.js";
import { sha256Hex } from "../shared/crypto.js";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import type { FunctionHandle } from "convex/server";
import { internal } from "./_generated/api.js";
import { env } from "./_generated/server.js";
import { constantTimeEqualHex, hmacSha256Hex } from "../shared/crypto.js";
import { integerField, isRecord, record, stringField } from "../shared/validation.js";
import { envTestMode } from "./provider.js";
import { orderFields, paymentFields, refundFields, subscriptionFields } from "./mapping.js";
import { applyOrder, applyPayment, applyRefund, applySubscription } from "./write.js";

import { webhookIngestResultValidator } from "../shared/validators.js";
import schema from "./schema.js";

type IngestResult = Infer<typeof webhookIngestResultValidator>;

/** Internal-only receipt used by the maintainer end-to-end test harness. */
export const e2eReceipt = internalQuery({
  args: { eventId: v.string(), bodyHash: v.string() },
  returns: v.object({
    byEventId: v.union(schema.doc("webhookEvents"), v.null()),
    byBodyHash: v.union(schema.doc("webhookEvents"), v.null()),
  }),
  handler: async (ctx, { eventId, bodyHash }) => ({
    byEventId: await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique(),
    byBodyHash: await ctx.db
      .query("webhookEvents")
      .withIndex("by_bodyHash", (q) => q.eq("bodyHash", bodyHash))
      .unique(),
  }),
});

type Parsed = {
  event: string;
  accountId?: string | undefined;
  createdAtProvider: number;
  entity?: Record<string, unknown> | undefined;
  secondary?: Record<string, unknown> | undefined;
  subscriptionId?: string | undefined;
  invoiceId?: string | undefined;
};

function parseEnvelopeUnsafe(body: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK", "Webhook body is not valid JSON");
  }
  const envelope = record(value, "webhook");
  if (envelope.entity !== "event")
    throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK", "Webhook envelope is invalid");
  const event = stringField(envelope.event, "webhook event");
  const accountId = typeof envelope.account_id === "string" ? envelope.account_id : undefined;
  const createdAtProvider = integerField(envelope.created_at, "webhook created_at") * 1000;
  if (!Number.isSafeInteger(createdAtProvider))
    throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK", "Webhook timestamp is invalid");
  const payload = record(envelope.payload, "webhook payload");
  const readEntity = (key: string) => {
    const wrapped = record(payload[key], `${key} payload`);
    return record(wrapped.entity, `${key} entity`);
  };
  let entity: Record<string, unknown> | undefined;
  let secondary: Record<string, unknown> | undefined;
  let subscriptionId: string | undefined;
  let invoiceId: string | undefined;
  if (
    event.startsWith("payment.") &&
    ["authorized", "captured", "failed"].includes(event.slice(8))
  ) {
    entity = readEntity("payment");
    paymentFields(entity, createdAtProvider);
  } else if (event === "order.paid") {
    entity = readEntity("order");
    orderFields(entity, createdAtProvider);
    if (payload.payment) {
      secondary = readEntity("payment");
      paymentFields(secondary, createdAtProvider);
      if (secondary.order_id !== entity.id)
        throw razorpayError("RAZORPAY_INVALID_ENTITY", "Webhook entity relationship is invalid");
    }
  } else if (
    event.startsWith("refund.") &&
    ["created", "processed", "failed", "speed_changed"].includes(event.slice(7))
  ) {
    entity = readEntity("refund");
    refundFields(entity, createdAtProvider);
    if (payload.payment) {
      secondary = readEntity("payment");
      paymentFields(secondary, createdAtProvider);
      if (secondary.id !== entity.payment_id)
        throw razorpayError("RAZORPAY_INVALID_ENTITY", "Webhook entity relationship is invalid");
    }
  } else if (
    event.startsWith("subscription.") &&
    [
      "authenticated",
      "activated",
      "charged",
      "completed",
      "updated",
      "pending",
      "halted",
      "cancelled",
      "paused",
      "resumed",
    ].includes(event.slice(13))
  ) {
    entity = readEntity("subscription");
    subscriptionFields(entity, createdAtProvider);
    subscriptionId = typeof entity.id === "string" ? entity.id : undefined;
    if (payload.payment) {
      secondary = readEntity("payment");
      paymentFields(secondary, createdAtProvider);
      if (secondary.subscription_id !== undefined && secondary.subscription_id !== entity.id) {
        throw razorpayError("RAZORPAY_INVALID_ENTITY", "Webhook entity relationship is invalid");
      }
    }
    if (
      isRecord(payload.invoice) &&
      isRecord(payload.invoice.entity) &&
      typeof payload.invoice.entity.id === "string"
    ) {
      invoiceId = payload.invoice.entity.id;
      if (
        typeof payload.invoice.entity.subscription_id === "string" &&
        payload.invoice.entity.subscription_id !== subscriptionId
      ) {
        throw razorpayError("RAZORPAY_INVALID_ENTITY", "Webhook entity relationship is invalid");
      }
    }
  }
  if (secondary) {
    subscriptionId ??=
      typeof secondary.subscription_id === "string" ? secondary.subscription_id : undefined;
    invoiceId ??= typeof secondary.invoice_id === "string" ? secondary.invoice_id : undefined;
  }
  return { event, accountId, createdAtProvider, entity, secondary, subscriptionId, invoiceId };
}

function parseEnvelope(body: string): Parsed {
  try {
    return parseEnvelopeUnsafe(body);
  } catch (error) {
    if (isRazorpayError(error)) throw error;
    throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK", "Webhook envelope or entity is malformed");
  }
}

function safeErrorCode(error: unknown): string {
  if (isRazorpayError(error)) return error.data.code;
  return "RAZORPAY_INVALID_ENTITY";
}

export const ingest = action({
  args: {
    body: v.string(),
    signature: v.string(),
    eventId: v.string(),
    callbackHandle: v.optional(v.string()),
  },
  returns: webhookIngestResultValidator,
  handler: async (ctx, args): Promise<IngestResult> => {
    if (!env.RAZORPAY_WEBHOOK_SECRET)
      throw razorpayError(
        "RAZORPAY_WEBHOOK_SECRET_MISSING",
        "Webhook signing secret is not configured",
      );
    const current = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, args.body);
    const validCurrent = constantTimeEqualHex(current, args.signature);
    const previous = env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS
      ? await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS, args.body)
      : current;
    const validPrevious = constantTimeEqualHex(previous, args.signature);
    if (!validCurrent && !validPrevious)
      throw razorpayError("RAZORPAY_INVALID_WEBHOOK_SIGNATURE", "Webhook signature is invalid");
    const bodyHash = await sha256Hex(args.body);
    let parsed: Parsed | undefined;
    let errorCode: string | undefined;
    try {
      if (new TextEncoder().encode(args.body).byteLength > maxWebhookBodyBytes)
        throw razorpayError(
          "RAZORPAY_MALFORMED_WEBHOOK",
          "Webhook body exceeds the supported size",
        );
      parsed = parseEnvelope(args.body);
    } catch (error) {
      errorCode = safeErrorCode(error);
    }
    const fallbackNow = Date.now();
    return ctx.runMutation(internal.webhooks.apply, {
      eventId: args.eventId || `sha256:${bodyHash}`,
      event: parsed?.event ?? "unknown",
      ...(parsed?.accountId === undefined ? {} : { accountId: parsed.accountId }),
      ...(parsed?.entity === undefined ? {} : { rawEntity: parsed.entity }),
      ...(parsed?.secondary === undefined ? {} : { rawSecondary: parsed.secondary }),
      ...(parsed?.subscriptionId === undefined ? {} : { subscriptionId: parsed.subscriptionId }),
      ...(parsed?.invoiceId === undefined ? {} : { invoiceId: parsed.invoiceId }),
      createdAtProvider: parsed?.createdAtProvider ?? fallbackNow,
      // Signed webhooks carry no mode: entities are live unless the deployment runs in test mode.
      testMode: envTestMode(),
      bodyHash,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(args.callbackHandle === undefined ? {} : { callbackHandle: args.callbackHandle }),
    });
  },
});

export const applyEntities = internalMutation({
  args: {
    event: v.string(),
    rawEntity: v.optional(v.record(v.string(), v.any())),
    rawSecondary: v.optional(v.record(v.string(), v.any())),
    createdAtProvider: v.number(),
    testMode: v.boolean(),
    subscriptionId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.rawEntity) {
      const { testMode } = args;
      if (args.event.startsWith("payment."))
        await applyPayment(ctx, args.rawEntity, args.createdAtProvider, { testMode });
      else if (args.event === "order.paid") {
        await applyOrder(ctx, args.rawEntity, args.createdAtProvider, { testMode });
        if (args.rawSecondary)
          await applyPayment(ctx, args.rawSecondary, args.createdAtProvider, { testMode });
      } else if (args.event.startsWith("refund.")) {
        await applyRefund(ctx, args.rawEntity, args.createdAtProvider, { testMode });
        if (args.rawSecondary)
          await applyPayment(ctx, args.rawSecondary, args.createdAtProvider, { testMode });
      } else if (args.event.startsWith("subscription.")) {
        await applySubscription(ctx, args.rawEntity, args.createdAtProvider, { testMode });
        if (args.rawSecondary)
          await applyPayment(ctx, args.rawSecondary, args.createdAtProvider, {
            testMode,
            ...(args.subscriptionId === undefined ? {} : { subscriptionId: args.subscriptionId }),
            ...(args.invoiceId === undefined ? {} : { invoiceId: args.invoiceId }),
          });
      }
    }
    return null;
  },
});

export const apply = internalMutation({
  args: {
    eventId: v.string(),
    event: v.string(),
    accountId: v.optional(v.string()),
    rawEntity: v.optional(v.record(v.string(), v.any())),
    rawSecondary: v.optional(v.record(v.string(), v.any())),
    createdAtProvider: v.number(),
    testMode: v.boolean(),
    bodyHash: v.string(),
    errorCode: v.optional(v.string()),
    callbackHandle: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    invoiceId: v.optional(v.string()),
  },
  returns: webhookIngestResultValidator,
  handler: async (ctx, args): Promise<IngestResult> => {
    const byEventId = await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    const byBodyHash = await ctx.db
      .query("webhookEvents")
      .withIndex("by_bodyHash", (q) => q.eq("bodyHash", args.bodyHash))
      .unique();
    if (byEventId || byBodyHash) return { status: "duplicate" };
    const receivedAt = Date.now();
    const entityId = typeof args.rawEntity?.id === "string" ? args.rawEntity.id : undefined;
    let status: "processed" | "ignored" | "failed" = args.errorCode
      ? "failed"
      : args.rawEntity
        ? "processed"
        : "ignored";
    let errorCode = args.errorCode;
    if (status === "processed") {
      try {
        await ctx.runMutation(internal.webhooks.applyEntities, {
          event: args.event,
          ...(args.rawEntity === undefined ? {} : { rawEntity: args.rawEntity }),
          ...(args.rawSecondary === undefined ? {} : { rawSecondary: args.rawSecondary }),
          createdAtProvider: args.createdAtProvider,
          testMode: args.testMode,
          ...(args.subscriptionId === undefined ? {} : { subscriptionId: args.subscriptionId }),
          ...(args.invoiceId === undefined ? {} : { invoiceId: args.invoiceId }),
        });
      } catch (error) {
        status = "failed";
        errorCode = safeErrorCode(error);
      }
    }
    await ctx.db.insert("webhookEvents", {
      eventId: args.eventId,
      event: args.event,
      ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
      ...(entityId === undefined ? {} : { entityId }),
      createdAtProvider: args.createdAtProvider,
      receivedAt,
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
      bodyHash: args.bodyHash,
    });
    if (status === "processed" && args.callbackHandle) {
      const event = {
        eventId: args.eventId,
        event: args.event,
        ...(entityId === undefined ? {} : { entityId }),
        ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
        createdAtProvider: args.createdAtProvider,
      };
      // The app minted this opaque string with createFunctionHandle before calling ingest.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Convex transports branded function handles as strings across component boundaries.
      await ctx.runMutation(args.callbackHandle as FunctionHandle<"mutation">, event);
    }
    return {
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(status === "processed"
        ? {
            event: {
              eventId: args.eventId,
              event: args.event,
              ...(entityId === undefined ? {} : { entityId }),
              ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
              createdAtProvider: args.createdAtProvider,
            },
          }
        : {}),
    };
  },
});

async function deleteBatch(ctx: MutationCtx, before: number, batchSize: number): Promise<number> {
  if (
    !Number.isSafeInteger(before) ||
    before < 0 ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 20
  )
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid cleanup bounds");
  const rows = await ctx.db
    .query("webhookEvents")
    .withIndex("by_receivedAt", (q) => q.lt("receivedAt", before))
    .take(batchSize);
  for (const row of rows) await ctx.db.delete("webhookEvents", row._id);
  return rows.length;
}

export const cleanup = mutation({
  args: { before: v.optional(v.number()), batchSize: v.optional(v.number()) },
  returns: v.number(),
  handler: (ctx, { before, batchSize }) =>
    deleteBatch(
      ctx,
      Math.min(before ?? Date.now() - retentionMs, Date.now() - 24 * 60 * 60 * 1000),
      batchSize ?? 20,
    ),
});

export const cleanupScheduled = internalMutation({
  args: { before: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { before }): Promise<number> => {
    const cutoff = before ?? Date.now() - retentionMs;
    const count = await deleteBatch(ctx, cutoff, 20);
    if (count === 20)
      await ctx.scheduler.runAfter(0, internal.webhooks.cleanupScheduled, { before: cutoff });
    return count;
  },
});
