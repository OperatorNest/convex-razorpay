import { razorpayError } from "../shared/errors.js";
import { getOrThrow } from "../shared/providerErrors.js";
import type { MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { assertModeMatches } from "./provider.js";
import { statusAdvances } from "../shared/validation.js";
import {
  customerFields,
  orderFields,
  paymentFields,
  planFields,
  refundFields,
  subscriptionFields,
} from "./mapping.js";

export interface ModeLinkage extends Linkage {
  testMode: boolean;
}

export interface Linkage {
  userId?: string | undefined;
  externalId?: string | undefined;
  metadata?: Record<string, string> | undefined;
  idempotencyKey?: string | undefined;
  requestFingerprint?: string | undefined;
  createdThroughComponent?: boolean | undefined;
  razorpaySubscriptionId?: string | undefined;
  razorpayInvoiceId?: string | undefined;
}

function mirrorFields(link: Linkage) {
  return {
    ...(link.userId === undefined ? {} : { userId: link.userId }),
    ...(link.externalId === undefined ? {} : { externalId: link.externalId }),
    ...(link.metadata === undefined ? {} : { metadata: link.metadata }),
    ...(link.idempotencyKey === undefined ? {} : { idempotencyKey: link.idempotencyKey }),
  };
}

function orderLinkFields(link: Linkage) {
  return {
    ...mirrorFields(link),
    ...(link.createdThroughComponent === undefined
      ? {}
      : { createdThroughComponent: link.createdThroughComponent }),
  };
}

function refundLinkFields(link: Linkage) {
  return {
    ...mirrorFields(link),
    ...(link.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: link.requestFingerprint }),
  };
}

async function completeClaim(
  ctx: MutationCtx,
  resource: Doc<"idempotencyRequests">["resource"],
  link: ModeLinkage,
  razorpayEntityId: string,
): Promise<void> {
  const idempotencyKey = link.idempotencyKey;
  if (!idempotencyKey || !link.requestFingerprint) return;
  const claim = await ctx.db
    .query("idempotencyRequests")
    .withIndex("by_resource_and_testMode_and_userId_and_idempotencyKey", (q) =>
      q
        .eq("resource", resource)
        .eq("testMode", link.testMode)
        .eq("userId", link.userId)
        .eq("idempotencyKey", idempotencyKey),
    )
    .unique();
  if (!claim) throw razorpayError("RAZORPAY_INVALID_RESPONSE");
  if (claim.requestFingerprint !== link.requestFingerprint)
    throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT");
  await ctx.db.patch("idempotencyRequests", claim["_id"], {
    status: "completed",
    razorpayEntityId,
    settledAt: Date.now(),
  });
}

export async function applyOrder(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"orders">> {
  const next = orderFields(raw, observedAt);
  const current = await ctx.db
    .query("orders")
    .withIndex("by_razorpayOrderId", (q) => q.eq("razorpayOrderId", next.razorpayOrderId))
    .unique();
  if (current) {
    assertModeMatches(current, link.testMode);
    if (current.amount !== next.amount || current.currency !== next.currency)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    const advances = statusAdvances(
      "order",
      current.status,
      next.status,
      [current.amountPaid, current.attempts],
      [next.amountPaid, next.attempts],
    );
    await ctx.db.patch("orders", current["_id"], {
      ...(advances
        ? {
            ...next,
            amountPaid: Math.max(current.amountPaid, next.amountPaid),
            amountDue: Math.min(current.amountDue, next.amountDue),
            attempts: Math.max(current.attempts, next.attempts),
          }
        : next.rawStatus === undefined
          ? {}
          : { rawStatus: next.rawStatus }),
      ...orderLinkFields({
        userId: current.userId ?? link.userId,
        externalId: current.externalId ?? link.externalId,
        metadata: current.metadata ?? link.metadata,
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
        createdThroughComponent: current.createdThroughComponent ?? link.createdThroughComponent,
      }),
    });
    await completeClaim(ctx, "order", link, next.razorpayOrderId);
    return getOrThrow(await ctx.db.get("orders", current["_id"]));
  }
  if (link.testMode && link.createdThroughComponent && next.receipt) {
    const duplicate = await ctx.db
      .query("orders")
      .withIndex("by_testMode_and_receipt", (q) =>
        q.eq("testMode", true).eq("receipt", next.receipt),
      )
      .first();
    if (duplicate)
      throw razorpayError("RAZORPAY_PROVIDER_ERROR", { providerStatus: 400, retryable: false });
  }
  const id = await ctx.db.insert("orders", {
    ...next,
    ...orderLinkFields(link),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "order", link, next.razorpayOrderId);
  return getOrThrow(await ctx.db.get("orders", id));
}

export async function applyPayment(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: Pick<Linkage, "razorpaySubscriptionId" | "razorpayInvoiceId"> & { testMode: boolean },
): Promise<Doc<"payments">> {
  const fields = paymentFields(raw, observedAt);
  const razorpaySubscriptionId = link.razorpaySubscriptionId ?? fields.razorpaySubscriptionId;
  const razorpayInvoiceId = link.razorpayInvoiceId ?? fields.razorpayInvoiceId;
  const next = {
    ...fields,
    ...(razorpaySubscriptionId === undefined ? {} : { razorpaySubscriptionId }),
    ...(razorpayInvoiceId === undefined ? {} : { razorpayInvoiceId }),
  };
  const current = await ctx.db
    .query("payments")
    .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", next.razorpayPaymentId))
    .unique();
  const razorpayOrderId = next.razorpayOrderId ?? current?.razorpayOrderId;
  const order = razorpayOrderId
    ? await ctx.db
        .query("orders")
        .withIndex("by_testMode_and_razorpayOrderId", (q) =>
          q.eq("testMode", link.testMode).eq("razorpayOrderId", razorpayOrderId),
        )
        .unique()
    : null;
  const ownership = mirrorFields({
    userId: current?.userId ?? order?.userId,
    externalId: current?.externalId ?? order?.externalId,
  });
  if (current) {
    assertModeMatches(current, link.testMode);
    if (current.amount !== next.amount || current.currency !== next.currency)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    if (
      current.razorpayOrderId &&
      next.razorpayOrderId &&
      current.razorpayOrderId !== next.razorpayOrderId
    )
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    if (
      current.razorpaySubscriptionId &&
      next.razorpaySubscriptionId &&
      current.razorpaySubscriptionId !== next.razorpaySubscriptionId
    )
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    if (
      current.razorpayInvoiceId &&
      next.razorpayInvoiceId &&
      current.razorpayInvoiceId !== next.razorpayInvoiceId
    )
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    if (
      statusAdvances(
        "payment",
        current.status,
        next.status,
        [current.amountRefunded],
        [next.amountRefunded],
      )
    ) {
      const amountRefunded = Math.max(current.amountRefunded, next.amountRefunded);
      await ctx.db.patch("payments", current["_id"], {
        ...next,
        ...ownership,
        verified: current.verified,
        ...((next.razorpayOrderId ?? current.razorpayOrderId) === undefined
          ? {}
          : { razorpayOrderId: next.razorpayOrderId ?? current.razorpayOrderId }),
        ...((next.razorpaySubscriptionId ?? current.razorpaySubscriptionId) === undefined
          ? {}
          : {
              razorpaySubscriptionId: next.razorpaySubscriptionId ?? current.razorpaySubscriptionId,
            }),
        ...((next.razorpayInvoiceId ?? current.razorpayInvoiceId) === undefined
          ? {}
          : { razorpayInvoiceId: next.razorpayInvoiceId ?? current.razorpayInvoiceId }),
        captured: current.captured || next.captured,
        amountRefunded,
        ...((amountRefunded > next.amountRefunded ? current.refundStatus : next.refundStatus) ===
        undefined
          ? {}
          : {
              refundStatus:
                amountRefunded > next.amountRefunded ? current.refundStatus : next.refundStatus,
            }),
      });
    } else {
      await ctx.db.patch("payments", current["_id"], {
        ...ownership,
        ...(next.rawStatus === undefined ? {} : { rawStatus: next.rawStatus }),
        ...((next.razorpaySubscriptionId ?? current.razorpaySubscriptionId) === undefined
          ? {}
          : {
              razorpaySubscriptionId: next.razorpaySubscriptionId ?? current.razorpaySubscriptionId,
            }),
        ...((next.razorpayInvoiceId ?? current.razorpayInvoiceId) === undefined
          ? {}
          : { razorpayInvoiceId: next.razorpayInvoiceId ?? current.razorpayInvoiceId }),
      });
    }
    return getOrThrow(await ctx.db.get("payments", current["_id"]));
  }
  const id = await ctx.db.insert("payments", {
    ...next,
    ...ownership,
    testMode: link.testMode,
  });
  return getOrThrow(await ctx.db.get("payments", id));
}

export async function applyRefund(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"refunds">> {
  const next = refundFields(raw, observedAt);
  const payment = await ctx.db
    .query("payments")
    .withIndex("by_razorpayPaymentId", (q) => q.eq("razorpayPaymentId", next.razorpayPaymentId))
    .unique();
  const linked = {
    ...link,
    userId: link.userId ?? (payment?.testMode === link.testMode ? payment.userId : undefined),
    externalId:
      link.externalId ?? (payment?.testMode === link.testMode ? payment.externalId : undefined),
  };
  const current = await ctx.db
    .query("refunds")
    .withIndex("by_razorpayRefundId", (q) => q.eq("razorpayRefundId", next.razorpayRefundId))
    .unique();
  if (current) {
    assertModeMatches(current, link.testMode);
    if (current.amount !== next.amount || current.razorpayPaymentId !== next.razorpayPaymentId)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    const advances =
      (current.status !== "processed" || next.status === "processed") &&
      statusAdvances("refund", current.status, next.status);
    await ctx.db.patch("refunds", current["_id"], {
      ...(advances ? next : next.rawStatus === undefined ? {} : { rawStatus: next.rawStatus }),
      ...(current.idempotencyKey === undefined && link.idempotencyKey !== undefined
        ? { idempotencyUserId: link.userId }
        : {}),
      ...refundLinkFields({
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
        requestFingerprint: current.requestFingerprint ?? link.requestFingerprint,
        userId: current.userId ?? linked.userId,
        externalId: current.externalId ?? linked.externalId,
        metadata: current.metadata ?? linked.metadata,
      }),
    });
    return getOrThrow(await ctx.db.get("refunds", current["_id"]));
  }
  const id = await ctx.db.insert("refunds", {
    ...next,
    ...refundLinkFields(linked),
    idempotencyUserId: link.userId,
    testMode: link.testMode,
  });
  return getOrThrow(await ctx.db.get("refunds", id));
}

export async function applyCustomer(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"customers">> {
  const next = customerFields(raw, observedAt);
  const current = await ctx.db
    .query("customers")
    .withIndex("by_razorpayCustomerId", (q) => q.eq("razorpayCustomerId", next.razorpayCustomerId))
    .unique();
  if (current) {
    assertModeMatches(current, link.testMode);
    if (current.userId && link.userId && current.userId !== link.userId) {
      throw razorpayError("RAZORPAY_CUSTOMER_CONFLICT");
    }
    await ctx.db.patch("customers", current["_id"], {
      ...(next.providerUpdatedAt >= current.providerUpdatedAt ? next : {}),
      ...mirrorFields({
        userId: current.userId ?? link.userId,
        externalId: current.externalId ?? link.externalId,
        metadata: current.metadata ?? link.metadata,
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
      }),
      ...(link.requestFingerprint === undefined
        ? {}
        : { requestFingerprint: current.requestFingerprint ?? link.requestFingerprint }),
    });
    await completeClaim(ctx, "customer", link, next.razorpayCustomerId);
    return getOrThrow(await ctx.db.get("customers", current["_id"]));
  }
  const id = await ctx.db.insert("customers", {
    ...next,
    ...mirrorFields(link),
    ...(link.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: link.requestFingerprint }),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "customer", link, next.razorpayCustomerId);
  return getOrThrow(await ctx.db.get("customers", id));
}

export async function applyPlan(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"plans">> {
  const next = planFields(raw, observedAt);
  const current = await ctx.db
    .query("plans")
    .withIndex("by_razorpayPlanId", (q) => q.eq("razorpayPlanId", next.razorpayPlanId))
    .unique();
  if (current) {
    assertModeMatches(current, link.testMode);
    if (current.amount !== next.amount || current.currency !== next.currency)
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    await ctx.db.patch("plans", current["_id"], {
      ...mirrorFields({
        userId: current.userId ?? link.userId,
        externalId: current.externalId ?? link.externalId,
        metadata: current.metadata ?? link.metadata,
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
      }),
    });
    await completeClaim(ctx, "plan", link, next.razorpayPlanId);
    return getOrThrow(await ctx.db.get("plans", current["_id"]));
  }
  const id = await ctx.db.insert("plans", {
    ...next,
    ...mirrorFields(link),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "plan", link, next.razorpayPlanId);
  return getOrThrow(await ctx.db.get("plans", id));
}

export async function applySubscription(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage & { webhookAt?: number },
): Promise<Doc<"subscriptions">> {
  const next = subscriptionFields(raw, observedAt);
  const current = await ctx.db
    .query("subscriptions")
    .withIndex("by_razorpaySubscriptionId", (q) =>
      q.eq("razorpaySubscriptionId", next.razorpaySubscriptionId),
    )
    .unique();
  if (current) {
    assertModeMatches(current, link.testMode);
    const webhookTime = link.webhookAt;
    const isCurrentWebhook =
      webhookTime !== undefined &&
      (current.lastWebhookAt === undefined || webhookTime >= current.lastWebhookAt);
    const advances =
      (webhookTime === undefined || isCurrentWebhook) &&
      statusAdvances(
        "subscription",
        current.status,
        next.status,
        [current.paidCount],
        [next.paidCount],
      );
    const paidCount = Math.max(current.paidCount, next.paidCount);
    await ctx.db.patch("subscriptions", current["_id"], {
      ...(isCurrentWebhook ? { lastWebhookAt: webhookTime } : {}),
      ...(advances
        ? {
            ...next,
            paidCount,
            remainingCount: Math.min(next.remainingCount, Math.max(0, next.totalCount - paidCount)),
          }
        : next.rawStatus === undefined
          ? {}
          : { rawStatus: next.rawStatus }),
      ...mirrorFields({
        userId: current.userId ?? link.userId,
        externalId: current.externalId ?? link.externalId,
        metadata: current.metadata ?? link.metadata,
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
      }),
      ...(current.createdThroughComponent === true || link.createdThroughComponent === true
        ? { createdThroughComponent: true }
        : {}),
    });
    await completeClaim(ctx, "subscription", link, next.razorpaySubscriptionId);
    return getOrThrow(await ctx.db.get("subscriptions", current["_id"]));
  }
  const id = await ctx.db.insert("subscriptions", {
    ...next,
    ...(link.webhookAt === undefined ? {} : { lastWebhookAt: link.webhookAt }),
    ...mirrorFields(link),
    ...(link.createdThroughComponent === true ? { createdThroughComponent: true } : {}),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "subscription", link, next.razorpaySubscriptionId);
  return getOrThrow(await ctx.db.get("subscriptions", id));
}
