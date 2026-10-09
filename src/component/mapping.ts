import { razorpayError } from "../shared/errors.js";
import { integerField, record, stringField } from "../shared/validation.js";

type ProviderKind = "order" | "payment" | "refund" | "customer" | "plan" | "subscription";

function entity(value: unknown, kind: ProviderKind, prefix: string): Record<string, unknown> {
  const raw = record(value, kind);
  if (raw.entity !== kind)
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${kind} entity`);
  const id = stringField(raw.id, `${kind} id`);
  if (!id.startsWith(prefix) || id.length <= prefix.length) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${kind} id`);
  }
  return raw;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string")
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${label}`);
  return value;
}

function optionalId(value: unknown, label: string, prefix: string): string | undefined {
  const id = optionalText(value, label);
  if (id && (!id.startsWith(prefix) || id.length <= prefix.length)) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${label}`);
  }
  return id;
}

function currency(value: unknown): string {
  const code = stringField(value, "currency");
  if (!/^[A-Z]{3}$/.test(code))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay currency");
  return code;
}

function statusFields(value: unknown, statuses: readonly string[]) {
  const rawStatus = stringField(value, "status");
  return statuses.includes(rawStatus) ? { status: rawStatus } : { status: "unknown", rawStatus };
}

function enumField(value: unknown, values: readonly string[], label: string): string {
  const result = stringField(value, label);
  if (!values.includes(result))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${label}`);
  return result;
}

function notes(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value) && value.length === 0) return {};
  const input = record(value, "notes");
  const entries = Object.entries(input).slice(0, 15);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    const normalizedKey = key.slice(0, 256);
    if (!normalizedKey) continue;
    result[normalizedKey] = String(item).slice(0, 256);
  }
  return result;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${label}`);
  return value;
}

function optionalCounter(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  return integerField(value, `Razorpay ${label}`);
}

function counterOrDefault(value: unknown, label: string, fallback: number): number {
  return value === undefined ? fallback : integerField(value, `Razorpay ${label}`);
}

function milliseconds(value: unknown, label: string): number {
  const seconds = integerField(value, `Razorpay ${label}`);
  const converted = seconds * 1000;
  if (!Number.isSafeInteger(converted))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", `Invalid Razorpay ${label}`);
  return converted;
}

function optionalMilliseconds(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  return milliseconds(value, label);
}

function at(raw: Record<string, unknown>, observedAt: number) {
  const observation = integerField(observedAt, "Razorpay observation time");
  return {
    createdAt:
      raw.created_at === undefined || raw.created_at === null
        ? observation
        : milliseconds(raw.created_at, "created_at"),
    updatedAtProvider:
      raw.updated_at === undefined || raw.updated_at === null
        ? observation
        : milliseconds(raw.updated_at, "updated_at"),
  };
}

export function orderFields(value: unknown, observedAt: number) {
  const raw = entity(value, "order", "order_");
  const amount = integerField(raw.amount, "Razorpay order amount", 1);
  const amountPaid = counterOrDefault(raw.amount_paid, "order amount_paid", 0);
  const amountDue = counterOrDefault(raw.amount_due, "order amount_due", amount - amountPaid);
  if (amountPaid > amount || amountDue > amount || amountPaid + amountDue !== amount) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay order totals");
  }
  const receipt = optionalText(raw.receipt, "order receipt");
  return {
    razorpayId: stringField(raw.id, "order id"),
    amount,
    amountPaid,
    amountDue,
    currency: currency(raw.currency),
    ...(receipt === undefined ? {} : { receipt }),
    ...statusFields(raw.status, ["created", "attempted", "paid"]),
    attempts: counterOrDefault(raw.attempts, "order attempts", 0),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function paymentFields(value: unknown, observedAt: number) {
  const raw = entity(value, "payment", "pay_");
  const amount = integerField(raw.amount, "Razorpay payment amount", 1);
  const amountRefunded = counterOrDefault(raw.amount_refunded, "payment amount_refunded", 0);
  if (amountRefunded > amount)
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay payment amount_refunded");
  const refundStatus = optionalText(raw.refund_status, "payment refund_status");
  if (refundStatus && !["partial", "full"].includes(refundStatus)) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay refund status");
  }
  const paymentStatusFields = statusFields(raw.status, [
    "created",
    "failed",
    "authorized",
    "captured",
    "refunded",
  ]);
  const knownPaymentStatus =
    paymentStatusFields.status === "unknown" ? "created" : paymentStatusFields.status;
  const captured =
    optionalBoolean(raw.captured, "payment captured") ??
    ["captured", "refunded"].includes(knownPaymentStatus);
  if (
    paymentStatusFields.status !== "unknown" &&
    captured !== ["captured", "refunded"].includes(knownPaymentStatus)
  ) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay captured status");
  }
  const orderId = optionalId(raw.order_id, "payment order_id", "order_");
  const subscriptionId = optionalId(raw.subscription_id, "payment subscription_id", "sub_");
  const invoiceId = optionalId(raw.invoice_id, "payment invoice_id", "inv_");
  const method = optionalText(raw.method, "payment method");
  const international = optionalBoolean(raw.international, "payment international");
  const email = optionalText(raw.email, "payment email");
  const contact = optionalText(raw.contact, "payment contact");
  const customerId = optionalId(raw.customer_id, "payment customer_id", "cust_");
  const fee = optionalCounter(raw.fee, "payment fee");
  const tax = optionalCounter(raw.tax, "payment tax");
  const errorCode = optionalText(raw.error_code, "payment error_code");
  const errorDescription = optionalText(raw.error_description, "payment error_description");
  const errorReason = optionalText(raw.error_reason, "payment error_reason");
  const errorSource = optionalText(raw.error_source, "payment error_source");
  const errorStep = optionalText(raw.error_step, "payment error_step");
  return {
    razorpayId: stringField(raw.id, "payment id"),
    ...(orderId === undefined ? {} : { orderId }),
    amount,
    currency: currency(raw.currency),
    ...paymentStatusFields,
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
    ...(invoiceId === undefined ? {} : { invoiceId }),
    ...(method === undefined ? {} : { method }),
    captured,
    verified: false,
    amountRefunded,
    ...(refundStatus === undefined ? {} : { refundStatus }),
    ...(international === undefined ? {} : { international }),
    ...(email === undefined ? {} : { email }),
    ...(contact === undefined ? {} : { contact }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(fee === undefined ? {} : { fee }),
    ...(tax === undefined ? {} : { tax }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorDescription === undefined ? {} : { errorDescription }),
    ...(errorReason === undefined ? {} : { errorReason }),
    ...(errorSource === undefined ? {} : { errorSource }),
    ...(errorStep === undefined ? {} : { errorStep }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function refundFields(value: unknown, observedAt: number) {
  const raw = entity(value, "refund", "rfnd_");
  const paymentId = stringField(raw.payment_id, "refund payment_id");
  if (!paymentId.startsWith("pay_") || paymentId.length <= 4) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay refund payment_id");
  }
  const speedRequested = optionalText(raw.speed_requested, "refund speed_requested");
  const speedProcessed = optionalText(raw.speed_processed, "refund speed_processed");
  const receipt = optionalText(raw.receipt, "refund receipt");
  return {
    razorpayId: stringField(raw.id, "refund id"),
    paymentId,
    amount: integerField(raw.amount, "Razorpay refund amount", 1),
    currency: currency(raw.currency),
    ...statusFields(raw.status, ["pending", "processed", "failed"]),
    ...(speedRequested === undefined ? {} : { speedRequested }),
    ...(speedProcessed === undefined ? {} : { speedProcessed }),
    ...(receipt === undefined ? {} : { receipt }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function customerFields(value: unknown, observedAt: number) {
  const raw = entity(value, "customer", "cust_");
  const name = optionalText(raw.name, "customer name");
  const email = optionalText(raw.email, "customer email");
  const contact = optionalText(raw.contact, "customer contact");
  const gstin = optionalText(raw.gstin, "customer gstin");
  return {
    razorpayId: stringField(raw.id, "customer id"),
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
    ...(contact === undefined ? {} : { contact }),
    ...(gstin === undefined ? {} : { gstin }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function planFields(value: unknown, observedAt: number) {
  const raw = entity(value, "plan", "plan_");
  const item = record(raw.item, "plan item");
  const period = enumField(
    raw.period,
    ["daily", "weekly", "monthly", "quarterly", "yearly"],
    "period",
  );
  const description = optionalText(item.description, "plan item description");
  return {
    razorpayId: stringField(raw.id, "plan id"),
    period,
    interval: integerField(raw.interval, "Razorpay plan interval", period === "daily" ? 7 : 1),
    itemName: stringField(item.name, "plan item name"),
    amount: integerField(item.amount, "Razorpay plan amount", 1),
    currency: currency(item.currency),
    ...(description === undefined ? {} : { description }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function subscriptionFields(value: unknown, observedAt: number) {
  const raw = entity(value, "subscription", "sub_");
  const planId = stringField(raw.plan_id, "subscription plan_id");
  if (!planId.startsWith("plan_") || planId.length <= 5) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay subscription plan_id");
  }
  const totalCount = integerField(raw.total_count, "Razorpay subscription total_count", 1);
  const paidCount = counterOrDefault(raw.paid_count, "subscription paid_count", 0);
  const remainingCount = counterOrDefault(
    raw.remaining_count,
    "subscription remaining_count",
    totalCount - paidCount,
  );
  if (
    paidCount > totalCount ||
    remainingCount > totalCount ||
    paidCount + remainingCount > totalCount
  ) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay subscription counts");
  }
  const customerId = optionalId(raw.customer_id, "subscription customer_id", "cust_");
  const currentStart = optionalMilliseconds(raw.current_start, "current_start");
  const currentEnd = optionalMilliseconds(raw.current_end, "current_end");
  const chargeAt = optionalMilliseconds(raw.charge_at, "charge_at");
  const startAt = optionalMilliseconds(raw.start_at, "start_at");
  const endAt = optionalMilliseconds(raw.end_at, "end_at");
  const endedAt = optionalMilliseconds(raw.ended_at, "ended_at");
  const expireBy = optionalMilliseconds(raw.expire_by, "expire_by");
  const pausedAt = optionalMilliseconds(raw.paused_at, "paused_at");
  const shortUrl = optionalText(raw.short_url, "subscription short_url");
  return {
    razorpayId: stringField(raw.id, "subscription id"),
    planId,
    ...(customerId === undefined ? {} : { customerId }),
    ...statusFields(raw.status, [
      "created",
      "authenticated",
      "active",
      "pending",
      "halted",
      "paused",
      "cancelled",
      "expired",
      "completed",
    ]),
    quantity:
      raw.quantity === undefined
        ? 1
        : integerField(raw.quantity, "Razorpay subscription quantity", 1),
    totalCount,
    paidCount,
    remainingCount,
    ...(currentStart === undefined ? {} : { currentStart }),
    ...(currentEnd === undefined ? {} : { currentEnd }),
    ...(chargeAt === undefined ? {} : { chargeAt }),
    ...(startAt === undefined ? {} : { startAt }),
    ...(endAt === undefined ? {} : { endAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(expireBy === undefined ? {} : { expireBy }),
    ...(pausedAt === undefined ? {} : { pausedAt }),
    hasScheduledChanges:
      optionalBoolean(raw.has_scheduled_changes, "subscription has_scheduled_changes") ?? false,
    ...(shortUrl === undefined ? {} : { shortUrl }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function collectionItems(value: unknown): unknown[] {
  const raw = record(value, "collection");
  if (raw.entity !== "collection" || !Array.isArray(raw.items) || raw.items.length > 1000) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid Razorpay collection");
  }
  return raw.items;
}
