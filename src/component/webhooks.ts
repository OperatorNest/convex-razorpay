import { readConfig, requireConfigValue } from "../shared/config.js";
import { razorpayError, isRazorpayError } from "../shared/errors.js";

import { dayMs, maxWebhookBodyBytes, webhookRetentionDays } from "../shared/constants.js";
import { computeSha256Hex } from "../shared/crypto.js";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { action, internalMutation } from "./_generated/server.js";
import type { FunctionHandle } from "convex/server";
import { internal } from "./_generated/api.js";
import { env } from "./_generated/server.js";
import { compareHexSignatures, computeHmacSha256Hex } from "../shared/crypto.js";
import { dropInvalidFieldNames, integerField, record, stringField } from "../shared/validation.js";
import { readTestMode } from "./provider.js";
import { orderFields, paymentFields, refundFields, subscriptionFields } from "./mapping.js";
import { applyOrder, applyPayment, applyRefund, applySubscription } from "./write.js";

import { webhookIngestResultValidator } from "../shared/validators.js";

type IngestResult = Infer<typeof webhookIngestResultValidator>;

function isMutationHandle(handle: string): handle is FunctionHandle<"mutation"> {
  return handle.startsWith("function://");
}

type Parsed = {
  event: string;
  razorpayAccountId?: string | undefined;
  providerCreatedAt: number;
  entity?: Record<string, unknown> | undefined;
  secondary?: Record<string, unknown> | undefined;
  razorpaySubscriptionId?: string | undefined;
  razorpayInvoiceId?: string | undefined;
};

function parseEnvelopeUnsafe(body: string): Parsed {
  let value: unknown;
  try {
    value = dropInvalidFieldNames(JSON.parse(body));
  } catch {
    throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK");
  }
  const envelope = record(value);
  if (envelope.entity !== "event") throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK");
  const event = stringField(envelope.event);
  const razorpayAccountId =
    typeof envelope.account_id === "string" ? envelope.account_id : undefined;
  const providerCreatedAt = integerField(envelope.created_at) * 1000;
  if (!Number.isSafeInteger(providerCreatedAt)) throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK");
  const payload = record(envelope.payload);
  const readEntity = (key: string) => {
    const wrapped = record(payload[key]);
    return record(wrapped.entity);
  };
  let entity: Record<string, unknown> | undefined;
  let secondary: Record<string, unknown> | undefined;
  let razorpaySubscriptionId: string | undefined;
  let razorpayInvoiceId: string | undefined;
  if (
    event.startsWith("payment.") &&
    ["authorized", "captured", "failed"].includes(event.slice(8))
  ) {
    entity = readEntity("payment");
    paymentFields(entity, providerCreatedAt);
  } else if (event === "order.paid") {
    entity = readEntity("order");
    orderFields(entity, providerCreatedAt);
    if (payload.payment) {
      secondary = readEntity("payment");
      paymentFields(secondary, providerCreatedAt);
      if (secondary.order_id !== entity.id) throw razorpayError("RAZORPAY_INVALID_ENTITY");
    }
  } else if (
    event.startsWith("refund.") &&
    ["created", "processed", "failed", "speed_changed"].includes(event.slice(7))
  ) {
    entity = readEntity("refund");
    refundFields(entity, providerCreatedAt);
    if (payload.payment) {
      secondary = readEntity("payment");
      paymentFields(secondary, providerCreatedAt);
      if (secondary.id !== entity.payment_id) throw razorpayError("RAZORPAY_INVALID_ENTITY");
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
    subscriptionFields(entity, providerCreatedAt);
    razorpaySubscriptionId = typeof entity.id === "string" ? entity.id : undefined;
    if (payload.payment) {
      secondary = readEntity("payment");
      paymentFields(secondary, providerCreatedAt);
      if (secondary.subscription_id !== undefined && secondary.subscription_id !== entity.id) {
        throw razorpayError("RAZORPAY_INVALID_ENTITY");
      }
    }
    if (payload.invoice !== undefined) {
      const invoice = readEntity("invoice");
      if (
        typeof invoice.id !== "string" ||
        !/^inv_[A-Za-z0-9_]+$/.test(invoice.id) ||
        (invoice.subscription_id !== undefined &&
          invoice.subscription_id !== razorpaySubscriptionId) ||
        (secondary?.invoice_id !== undefined && secondary.invoice_id !== invoice.id) ||
        (invoice.payment_id !== undefined && invoice.payment_id !== secondary?.id)
      )
        throw razorpayError("RAZORPAY_INVALID_ENTITY");
      razorpayInvoiceId = invoice.id;
    }
  }
  if (secondary) {
    razorpaySubscriptionId ??=
      typeof secondary.subscription_id === "string" ? secondary.subscription_id : undefined;
    razorpayInvoiceId ??=
      typeof secondary.invoice_id === "string" ? secondary.invoice_id : undefined;
  }
  return {
    event,
    razorpayAccountId,
    providerCreatedAt,
    entity,
    secondary,
    razorpaySubscriptionId,
    razorpayInvoiceId,
  };
}

function parseEnvelope(body: string): Parsed {
  try {
    return parseEnvelopeUnsafe(body);
  } catch (error) {
    if (isRazorpayError(error)) {
      if (error.data.code === "RAZORPAY_INVALID_RESPONSE")
        throw razorpayError("RAZORPAY_INVALID_ENTITY");
      throw error;
    }
    throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK");
  }
}

function safeErrorCode(error: unknown): string {
  if (isRazorpayError(error))
    return error.data.code === "RAZORPAY_INVALID_RESPONSE"
      ? "RAZORPAY_INVALID_ENTITY"
      : error.data.code;
  return "RAZORPAY_INVALID_ENTITY";
}

/** Verifies and applies a signed webhook in the mode the component env selects; webhooks carry no `testMode` argument, so a client `testMode` option never applies. */
export const ingest = action({
  args: {
    body: v.string(),
    signature: v.string(),
    eventId: v.string(),
    callbackHandle: v.optional(v.string()),
  },
  returns: webhookIngestResultValidator,
  handler: async (ctx, args): Promise<IngestResult> => {
    if (args.callbackHandle !== undefined && !isMutationHandle(args.callbackHandle))
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    if (!readConfig(env).webhookSecret) throw razorpayError("RAZORPAY_NOT_CONFIGURED");
    const current = await computeHmacSha256Hex(
      requireConfigValue(readConfig(env).webhookSecret),
      args.body,
    );
    const validCurrent = compareHexSignatures(current, args.signature);
    const previous = readConfig(env).previousWebhookSecret
      ? await computeHmacSha256Hex(
          requireConfigValue(readConfig(env).previousWebhookSecret),
          args.body,
        )
      : current;
    const validPrevious = compareHexSignatures(previous, args.signature);
    if (!validCurrent && !validPrevious) throw razorpayError("RAZORPAY_INVALID_WEBHOOK_SIGNATURE");
    const bodyHash = await computeSha256Hex(args.body);
    let parsed: Parsed | undefined;
    let errorCode: string | undefined;
    try {
      if (new TextEncoder().encode(args.body).byteLength > maxWebhookBodyBytes)
        throw razorpayError("RAZORPAY_MALFORMED_WEBHOOK");
      parsed = parseEnvelope(args.body);
    } catch (error) {
      errorCode = safeErrorCode(error);
    }
    const fallbackNow = Date.now();
    return ctx.runMutation(internal.webhooks.apply, {
      eventId: args.eventId || `sha256:${bodyHash}`,
      event: parsed?.event ?? "unknown",
      ...(parsed?.razorpayAccountId === undefined
        ? {}
        : { razorpayAccountId: parsed.razorpayAccountId }),
      ...(parsed?.entity === undefined ? {} : { rawEntity: parsed.entity }),
      ...(parsed?.secondary === undefined ? {} : { rawSecondary: parsed.secondary }),
      ...(parsed?.razorpaySubscriptionId === undefined
        ? {}
        : { razorpaySubscriptionId: parsed.razorpaySubscriptionId }),
      ...(parsed?.razorpayInvoiceId === undefined
        ? {}
        : { razorpayInvoiceId: parsed.razorpayInvoiceId }),
      providerCreatedAt: parsed?.providerCreatedAt ?? fallbackNow,

      testMode: readTestMode(),
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
    providerCreatedAt: v.number(),
    testMode: v.boolean(),
    razorpaySubscriptionId: v.optional(v.string()),
    razorpayInvoiceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.rawEntity) {
      const { testMode } = args;
      if (args.event.startsWith("payment."))
        await applyPayment(ctx, args.rawEntity, args.providerCreatedAt, { testMode });
      else if (args.event === "order.paid") {
        await applyOrder(ctx, args.rawEntity, args.providerCreatedAt, { testMode });
        if (args.rawSecondary)
          await applyPayment(ctx, args.rawSecondary, args.providerCreatedAt, { testMode });
      } else if (args.event.startsWith("refund.")) {
        if (args.rawSecondary)
          await applyPayment(ctx, args.rawSecondary, args.providerCreatedAt, { testMode });
        await applyRefund(ctx, args.rawEntity, args.providerCreatedAt, { testMode });
      } else if (args.event.startsWith("subscription.")) {
        await applySubscription(ctx, args.rawEntity, args.providerCreatedAt, {
          testMode,
          webhookAt: args.providerCreatedAt,
        });
        if (args.rawSecondary)
          await applyPayment(ctx, args.rawSecondary, args.providerCreatedAt, {
            testMode,
            ...(args.razorpaySubscriptionId === undefined
              ? {}
              : { razorpaySubscriptionId: args.razorpaySubscriptionId }),
            ...(args.razorpayInvoiceId === undefined
              ? {}
              : { razorpayInvoiceId: args.razorpayInvoiceId }),
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
    razorpayAccountId: v.optional(v.string()),
    rawEntity: v.optional(v.record(v.string(), v.any())),
    rawSecondary: v.optional(v.record(v.string(), v.any())),
    providerCreatedAt: v.number(),
    testMode: v.boolean(),
    bodyHash: v.string(),
    errorCode: v.optional(v.string()),
    callbackHandle: v.optional(v.string()),
    razorpaySubscriptionId: v.optional(v.string()),
    razorpayInvoiceId: v.optional(v.string()),
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
    const receipts = [byEventId, byBodyHash].filter((receipt) => receipt !== null);
    if (
      receipts.some(
        (receipt) => receipt.status !== "failed" || receipt.errorCode === "RAZORPAY_STALE_WEBHOOK",
      )
    )
      return { status: "duplicate" };
    const receivedAt = Date.now();
    const razorpayEntityId = typeof args.rawEntity?.id === "string" ? args.rawEntity.id : undefined;
    let errorCode =
      args.errorCode ??
      (args.providerCreatedAt < receivedAt - (webhookRetentionDays - 1) * dayMs
        ? "RAZORPAY_STALE_WEBHOOK"
        : undefined);
    let status: "processed" | "ignored" | "failed" = errorCode
      ? "failed"
      : args.rawEntity
        ? "processed"
        : "ignored";
    if (status === "processed") {
      try {
        await ctx.runMutation(internal.webhooks.applyEntities, {
          event: args.event,
          ...(args.rawEntity === undefined ? {} : { rawEntity: args.rawEntity }),
          ...(args.rawSecondary === undefined ? {} : { rawSecondary: args.rawSecondary }),
          providerCreatedAt: args.providerCreatedAt,
          testMode: args.testMode,
          ...(args.razorpaySubscriptionId === undefined
            ? {}
            : { razorpaySubscriptionId: args.razorpaySubscriptionId }),
          ...(args.razorpayInvoiceId === undefined
            ? {}
            : { razorpayInvoiceId: args.razorpayInvoiceId }),
        });
      } catch (error) {
        status = "failed";
        errorCode = safeErrorCode(error);
      }
    }
    for (const receiptId of new Set(receipts.map((receipt) => receipt._id)))
      await ctx.db.delete("webhookEvents", receiptId);
    await ctx.db.insert("webhookEvents", {
      eventId: args.eventId,
      event: args.event,
      ...(args.razorpayAccountId === undefined
        ? {}
        : { razorpayAccountId: args.razorpayAccountId }),
      ...(razorpayEntityId === undefined ? {} : { razorpayEntityId }),
      providerCreatedAt: args.providerCreatedAt,
      receivedAt,
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
      bodyHash: args.bodyHash,
    });
    if (
      status === "processed" &&
      args.callbackHandle !== undefined &&
      isMutationHandle(args.callbackHandle)
    ) {
      const event = {
        eventId: args.eventId,
        event: args.event,
        ...(razorpayEntityId === undefined ? {} : { razorpayEntityId }),
        ...(args.razorpayAccountId === undefined
          ? {}
          : { razorpayAccountId: args.razorpayAccountId }),
        providerCreatedAt: args.providerCreatedAt,
      };
      await ctx.runMutation(args.callbackHandle, event);
    }
    return {
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(status === "processed"
        ? {
            event: {
              eventId: args.eventId,
              event: args.event,
              ...(razorpayEntityId === undefined ? {} : { razorpayEntityId }),
              ...(args.razorpayAccountId === undefined
                ? {}
                : { razorpayAccountId: args.razorpayAccountId }),
              providerCreatedAt: args.providerCreatedAt,
            },
          }
        : {}),
    };
  },
});
