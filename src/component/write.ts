import { getOrThrow, razorpayError } from "../shared/errors.js";
import type { MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
import { statusAdvances } from "../shared/validation.js";
import {
  customerFields,
  orderFields,
  paymentFields,
  planFields,
  refundFields,
  subscriptionFields,
} from "./mapping.js";

/**
 * Every mirrored row records the mode it was observed in. A row's mode is fixed at insert and
 * never changed by later updates; only the caller that inserts decides it.
 */
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
  subscriptionId?: string | undefined;
  invoiceId?: string | undefined;
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
  resource: "order" | "plan" | "subscription",
  link: Linkage,
  razorpayId: string,
): Promise<void> {
  const key = link.idempotencyKey;
  if (!key) return;
  const claim = await ctx.db
    .query("idempotencyRequests")
    .withIndex("by_resource_and_key", (q) => q.eq("resource", resource).eq("key", key))
    .unique();
  if (!claim) {
    if (link.requestFingerprint)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Missing idempotency claim");
    return;
  }
  if (link.requestFingerprint && claim.fingerprint !== link.requestFingerprint)
    throw razorpayError("RAZORPAY_IDEMPOTENCY_CONFLICT", "Idempotency claim mismatch");
  await ctx.db.patch("idempotencyRequests", claim["_id"], {
    status: "completed",
    razorpayId,
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
  link = {
    ...link,
    userId: link.userId ?? next.notes.userId,
    externalId: link.externalId ?? next.notes.externalId,
    idempotencyKey: link.idempotencyKey ?? next.notes.operatornestIdempotencyKey,
  };
  const current = await ctx.db
    .query("orders")
    .withIndex("by_razorpayId", (q) => q.eq("razorpayId", next.razorpayId))
    .unique();
  if (current) {
    if (current.amount !== next.amount || current.currency !== next.currency)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay order identity changed");
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
    await completeClaim(ctx, "order", link, next.razorpayId);
    return getOrThrow(await ctx.db.get("orders", current["_id"]), "Updated mirror is missing");
  }
  const id = await ctx.db.insert("orders", {
    ...next,
    ...orderLinkFields(link),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "order", link, next.razorpayId);
  return getOrThrow(await ctx.db.get("orders", id), "Updated mirror is missing");
}

export async function applyPayment(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: Pick<Linkage, "subscriptionId" | "invoiceId"> & { testMode: boolean },
): Promise<Doc<"payments">> {
  const fields = paymentFields(raw, observedAt);
  const subscriptionId = link.subscriptionId ?? fields.subscriptionId;
  const invoiceId = link.invoiceId ?? fields.invoiceId;
  const next = {
    ...fields,
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
    ...(invoiceId === undefined ? {} : { invoiceId }),
  };
  const current = await ctx.db
    .query("payments")
    .withIndex("by_razorpayId", (q) => q.eq("razorpayId", next.razorpayId))
    .unique();
  if (current) {
    if (current.amount !== next.amount || current.currency !== next.currency)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay payment identity changed");
    if (current.orderId && next.orderId && current.orderId !== next.orderId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay payment order changed");
    if (
      current.subscriptionId &&
      next.subscriptionId &&
      current.subscriptionId !== next.subscriptionId
    )
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay payment subscription changed");
    if (current.invoiceId && next.invoiceId && current.invoiceId !== next.invoiceId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay payment invoice changed");
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
        verified: current.verified,
        ...((next.orderId ?? current.orderId) === undefined
          ? {}
          : { orderId: next.orderId ?? current.orderId }),
        ...((next.subscriptionId ?? current.subscriptionId) === undefined
          ? {}
          : { subscriptionId: next.subscriptionId ?? current.subscriptionId }),
        ...((next.invoiceId ?? current.invoiceId) === undefined
          ? {}
          : { invoiceId: next.invoiceId ?? current.invoiceId }),
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
        ...(next.rawStatus === undefined ? {} : { rawStatus: next.rawStatus }),
        ...((next.subscriptionId ?? current.subscriptionId) === undefined
          ? {}
          : { subscriptionId: next.subscriptionId ?? current.subscriptionId }),
        ...((next.invoiceId ?? current.invoiceId) === undefined
          ? {}
          : { invoiceId: next.invoiceId ?? current.invoiceId }),
      });
    }
    return getOrThrow(await ctx.db.get("payments", current["_id"]), "Updated mirror is missing");
  }
  const id = await ctx.db.insert("payments", {
    ...next,
    testMode: link.testMode,
  });
  return getOrThrow(await ctx.db.get("payments", id), "Updated mirror is missing");
}

export async function applyRefund(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"refunds">> {
  const next = refundFields(raw, observedAt);
  const linked = {
    ...link,
    userId: link.userId ?? next.notes.userId,
    externalId: link.externalId ?? next.notes.externalId,
  };
  const current = await ctx.db
    .query("refunds")
    .withIndex("by_razorpayId", (q) => q.eq("razorpayId", next.razorpayId))
    .unique();
  if (current) {
    if (current.amount !== next.amount || current.paymentId !== next.paymentId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay refund identity changed");
    const advances =
      (current.status !== "processed" || next.status === "processed") &&
      statusAdvances("refund", current.status, next.status);
    await ctx.db.patch("refunds", current["_id"], {
      ...(advances ? next : next.rawStatus === undefined ? {} : { rawStatus: next.rawStatus }),
      ...refundLinkFields({
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
        requestFingerprint: current.requestFingerprint ?? link.requestFingerprint,
        userId: current.userId ?? linked.userId,
        externalId: current.externalId ?? linked.externalId,
        metadata: current.metadata ?? linked.metadata,
      }),
    });
    return getOrThrow(await ctx.db.get("refunds", current["_id"]), "Updated mirror is missing");
  }
  const id = await ctx.db.insert("refunds", {
    ...next,
    ...refundLinkFields(linked),
    testMode: link.testMode,
  });
  return getOrThrow(await ctx.db.get("refunds", id), "Updated mirror is missing");
}

export async function applyCustomer(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"customers">> {
  const next = customerFields(raw, observedAt);
  link = {
    ...link,
    userId: link.userId ?? next.notes.userId,
    externalId: link.externalId ?? next.notes.externalId,
  };
  if (link.userId && next.notes.userId && link.userId !== next.notes.userId) {
    throw razorpayError(
      "RAZORPAY_CUSTOMER_CONFLICT",
      "Provider customer is linked to a different user",
    );
  }
  const current = await ctx.db
    .query("customers")
    .withIndex("by_razorpayId", (q) => q.eq("razorpayId", next.razorpayId))
    .unique();
  if (current) {
    if (current.userId && link.userId && current.userId !== link.userId) {
      throw razorpayError(
        "RAZORPAY_CUSTOMER_CONFLICT",
        "Provider customer is linked to a different user",
      );
    }
    await ctx.db.patch("customers", current["_id"], {
      ...(next.updatedAtProvider >= current.updatedAtProvider ? next : {}),
      ...mirrorFields({
        userId: current.userId ?? link.userId,
        externalId: current.externalId ?? link.externalId,
        metadata: current.metadata ?? link.metadata,
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
      }),
    });
    return getOrThrow(await ctx.db.get("customers", current["_id"]), "Updated mirror is missing");
  }
  const id = await ctx.db.insert("customers", {
    ...next,
    ...mirrorFields(link),
    testMode: link.testMode,
  });
  return getOrThrow(await ctx.db.get("customers", id), "Updated mirror is missing");
}

export async function applyPlan(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"plans">> {
  const next = planFields(raw, observedAt);
  link = {
    ...link,
    userId: link.userId ?? next.notes.userId,
    externalId: link.externalId ?? next.notes.externalId,
    idempotencyKey: link.idempotencyKey ?? next.notes.operatornestIdempotencyKey,
  };
  const current = await ctx.db
    .query("plans")
    .withIndex("by_razorpayId", (q) => q.eq("razorpayId", next.razorpayId))
    .unique();
  if (current) {
    if (current.amount !== next.amount || current.currency !== next.currency)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay plan identity changed");
    await ctx.db.patch("plans", current["_id"], {
      ...mirrorFields({
        userId: current.userId ?? link.userId,
        externalId: current.externalId ?? link.externalId,
        metadata: current.metadata ?? link.metadata,
        idempotencyKey: current.idempotencyKey ?? link.idempotencyKey,
      }),
    });
    await completeClaim(ctx, "plan", link, next.razorpayId);
    return getOrThrow(await ctx.db.get("plans", current["_id"]), "Updated mirror is missing");
  }
  const id = await ctx.db.insert("plans", {
    ...next,
    ...mirrorFields(link),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "plan", link, next.razorpayId);
  return getOrThrow(await ctx.db.get("plans", id), "Updated mirror is missing");
}

export async function applySubscription(
  ctx: MutationCtx,
  raw: unknown,
  observedAt: number,
  link: ModeLinkage,
): Promise<Doc<"subscriptions">> {
  const next = subscriptionFields(raw, observedAt);
  link = {
    ...link,
    userId: link.userId ?? next.notes.userId,
    externalId: link.externalId ?? next.notes.externalId,
    idempotencyKey: link.idempotencyKey ?? next.notes.operatornestIdempotencyKey,
  };
  const current = await ctx.db
    .query("subscriptions")
    .withIndex("by_razorpayId", (q) => q.eq("razorpayId", next.razorpayId))
    .unique();
  if (current) {
    const advances = statusAdvances(
      "subscription",
      current.status,
      next.status,
      [current.paidCount],
      [next.paidCount],
    );
    await ctx.db.patch("subscriptions", current["_id"], {
      ...(advances
        ? {
            ...next,
            paidCount: Math.max(current.paidCount, next.paidCount),
            remainingCount: Math.min(
              next.remainingCount,
              Math.max(0, next.totalCount - Math.max(current.paidCount, next.paidCount)),
            ),
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
    await completeClaim(ctx, "subscription", link, next.razorpayId);
    return getOrThrow(
      await ctx.db.get("subscriptions", current["_id"]),
      "Updated mirror is missing",
    );
  }
  const id = await ctx.db.insert("subscriptions", {
    ...next,
    ...mirrorFields(link),
    ...(link.createdThroughComponent === true ? { createdThroughComponent: true } : {}),
    testMode: link.testMode,
  });
  await completeClaim(ctx, "subscription", link, next.razorpayId);
  return getOrThrow(await ctx.db.get("subscriptions", id), "Updated mirror is missing");
}
