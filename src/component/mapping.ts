import { razorpayError } from "../shared/errors.js";
import { integerField, record, stringField, truncateText } from "../shared/validation.js";

type ProviderKind = "order" | "payment" | "refund" | "customer" | "plan" | "subscription";

function entity(value: unknown, kind: ProviderKind, prefix: string): Record<string, unknown> {
  const raw = record(value);
  if (raw.entity !== kind) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  const id = stringField(raw.id);
  if (!id.startsWith(prefix) || id.length <= prefix.length) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  return raw;
}

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return value;
}

function optionalId(value: unknown, prefix: string): string | undefined {
  const id = optionalText(value);
  if (id && (!id.startsWith(prefix) || id.length <= prefix.length)) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  return id;
}

function currency(value: unknown): string {
  const code = stringField(value);
  if (!/^[A-Z]{3}$/.test(code)) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return code;
}

function statusFields(value: unknown, statuses: readonly string[]) {
  const rawStatus = stringField(value);
  return statuses.includes(rawStatus) ? { status: rawStatus } : { status: "unknown", rawStatus };
}

function enumField(value: unknown, values: readonly string[]): string {
  const result = stringField(value);
  if (!values.includes(result)) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return result;
}

function notes(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value) && value.length === 0) return {};
  const input = record(value);
  const entries = Object.entries(input).slice(0, 15);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    const normalizedKey = truncateText(key, 256);
    if (!normalizedKey) continue;
    result[normalizedKey] = truncateText(String(item), 256);
  }
  return result;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean") throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return value;
}

function optionalCounter(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return integerField(value);
}

function counterOrDefault(value: unknown, fallback: number): number {
  return value === undefined ? fallback : integerField(value);
}

function milliseconds(value: unknown): number {
  const seconds = integerField(value);
  const converted = seconds * 1000;
  if (!Number.isSafeInteger(converted)) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return converted;
}

function optionalMilliseconds(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return milliseconds(value);
}

function at(raw: Record<string, unknown>, observedAt: number) {
  const observation = integerField(observedAt);
  return {
    createdAt:
      raw.created_at === undefined || raw.created_at === null
        ? observation
        : milliseconds(raw.created_at),
    updatedAtProvider:
      raw.updated_at === undefined || raw.updated_at === null
        ? observation
        : milliseconds(raw.updated_at),
  };
}

export function orderFields(value: unknown, observedAt: number) {
  const raw = entity(value, "order", "order_");
  const amount = integerField(raw.amount, 1);
  const amountPaid = counterOrDefault(raw.amount_paid, 0);
  const amountDue = counterOrDefault(raw.amount_due, amount - amountPaid);
  if (amountPaid > amount || amountDue > amount || amountPaid + amountDue !== amount) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  const receipt = optionalText(raw.receipt);
  return {
    razorpayId: stringField(raw.id),
    amount,
    partialPayment: optionalBoolean(raw.partial_payment) ?? false,
    amountPaid,
    amountDue,
    currency: currency(raw.currency),
    ...(receipt === undefined ? {} : { receipt }),
    ...statusFields(raw.status, ["created", "attempted", "paid"]),
    attempts: counterOrDefault(raw.attempts, 0),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function paymentFields(value: unknown, observedAt: number) {
  const raw = entity(value, "payment", "pay_");
  const amount = integerField(raw.amount, 1);
  const amountRefunded = counterOrDefault(raw.amount_refunded, 0);
  if (amountRefunded > amount) throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  const refundStatus = optionalText(raw.refund_status);
  if (refundStatus && !["partial", "full"].includes(refundStatus)) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
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
    optionalBoolean(raw.captured) ?? ["captured", "refunded"].includes(knownPaymentStatus);
  if (
    paymentStatusFields.status !== "unknown" &&
    captured !== ["captured", "refunded"].includes(knownPaymentStatus)
  ) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  const orderId = optionalId(raw.order_id, "order_");
  const subscriptionId = optionalId(raw.subscription_id, "sub_");
  const invoiceId = optionalId(raw.invoice_id, "inv_");
  const method = optionalText(raw.method);
  const international = optionalBoolean(raw.international);
  const email = optionalText(raw.email);
  const contact = optionalText(raw.contact);
  const customerId = optionalId(raw.customer_id, "cust_");
  const fee = optionalCounter(raw.fee);
  const tax = optionalCounter(raw.tax);
  const errorCode = optionalText(raw.error_code);
  const errorDescription = optionalText(raw.error_description);
  const errorReason = optionalText(raw.error_reason);
  const errorSource = optionalText(raw.error_source);
  const errorStep = optionalText(raw.error_step);
  return {
    razorpayId: stringField(raw.id),
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
  const paymentId = stringField(raw.payment_id);
  if (!paymentId.startsWith("pay_") || paymentId.length <= 4) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  const speedRequested = optionalText(raw.speed_requested);
  const speedProcessed = optionalText(raw.speed_processed);
  const receipt = optionalText(raw.receipt);
  return {
    razorpayId: stringField(raw.id),
    paymentId,
    amount: integerField(raw.amount, 1),
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
  const name = optionalText(raw.name);
  const email = optionalText(raw.email);
  const contact = optionalText(raw.contact);
  const gstin = optionalText(raw.gstin);
  return {
    razorpayId: stringField(raw.id),
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
  const item = record(raw.item);
  const period = enumField(raw.period, ["daily", "weekly", "monthly", "quarterly", "yearly"]);
  const description = optionalText(item.description);
  return {
    razorpayId: stringField(raw.id),
    period,
    interval: integerField(raw.interval, period === "daily" ? 7 : 1),
    itemName: stringField(item.name),
    amount: integerField(item.amount, 1),
    currency: currency(item.currency),
    ...(description === undefined ? {} : { description }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function subscriptionFields(value: unknown, observedAt: number) {
  const raw = entity(value, "subscription", "sub_");
  const planId = stringField(raw.plan_id);
  if (!planId.startsWith("plan_") || planId.length <= 5) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  const totalCount = integerField(raw.total_count, 1);
  const paidCount = counterOrDefault(raw.paid_count, 0);
  const remainingCount = counterOrDefault(raw.remaining_count, totalCount - paidCount);
  if (
    paidCount > totalCount ||
    remainingCount > totalCount ||
    paidCount + remainingCount > totalCount
  ) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  const customerId = optionalId(raw.customer_id, "cust_");
  const currentStart = optionalMilliseconds(raw.current_start);
  const currentEnd = optionalMilliseconds(raw.current_end);
  const chargeAt = optionalMilliseconds(raw.charge_at);
  const startAt = optionalMilliseconds(raw.start_at);
  const endAt = optionalMilliseconds(raw.end_at);
  const endedAt = optionalMilliseconds(raw.ended_at);
  const expireBy = optionalMilliseconds(raw.expire_by);
  const pausedAt = optionalMilliseconds(raw.paused_at);
  const shortUrl = optionalText(raw.short_url);
  return {
    razorpayId: stringField(raw.id),
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
    quantity: raw.quantity === undefined ? 1 : integerField(raw.quantity, 1),
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
    hasScheduledChanges: optionalBoolean(raw.has_scheduled_changes) ?? false,
    ...(shortUrl === undefined ? {} : { shortUrl }),
    notes: notes(raw.notes),
    ...at(raw, observedAt),
    raw: value,
  };
}

export function collectionItems(value: unknown): unknown[] {
  const raw = record(value);
  if (raw.entity !== "collection" || !Array.isArray(raw.items) || raw.items.length > 1000) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  return raw.items;
}
