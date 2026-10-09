import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SAFE_VALUES = new Set([
  "event",
  "payment",
  "order",
  "refund",
  "subscription",
  "customer",
  "plan",
  "collection",
  "card",
  "upi",
  "netbanking",
  "wallet",
  "INR",
  "authorized",
  "captured",
  "failed",
  "created",
  "processed",
  "paid",
  "active",
  "authenticated",
  "pending",
  "cancelled",
  "halted",
  "paused",
  "completed",
  "attempted",
  "refunded",
  "partially_refunded",
  "issued",
  "normal",
  "optimum",
  "instant",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "partial",
  "full",
  "queued",
  "reversed",
  "speed_changed",
]);
const SAFE_NUMBER_KEYS = new Set([
  "attempts",
  "quantity",
  "total_count",
  "paid_count",
  "remaining_count",
  "count",
  "skip",
  "amount",
  "amount_paid",
  "amount_due",
  "amount_refunded",
  "base_amount",
  "fee",
  "tax",
  "total",
  "total_amount",
  "refund_amount",
]);
const TIMESTAMP_KEYS = new Set([
  "created_at",
  "updated_at",
  "authorized_at",
  "captured_at",
  "current_start",
  "current_end",
  "charge_at",
  "start_at",
  "end_at",
]);
const PREFIXES = /^(?:pay|order|rfnd|sub|plan|cust|evt|acc|card|token|plink)_/;
const SAFE_EVENTS = new Set([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.created",
  "refund.processed",
  "refund.failed",
  "refund.speed_changed",
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.completed",
  "subscription.cancelled",
  "subscription.halted",
  "subscription.paused",
  "subscription.resumed",
  "subscription.pending",
  "subscription.updated",
]);
const SAFE_KEYS = new Set([
  "entity",
  "account_id",
  "event",
  "contains",
  "payload",
  "created_at",
  "updated_at",
  "payment",
  "order",
  "refund",
  "subscription",
  "customer",
  "plan",
  "id",
  "status",
  "amount",
  "amount_paid",
  "amount_due",
  "amount_refunded",
  "base_amount",
  "fee",
  "tax",
  "total",
  "total_amount",
  "refund_amount",
  "currency",
  "method",
  "order_id",
  "payment_id",
  "refund_id",
  "subscription_id",
  "customer_id",
  "plan_id",
  "email",
  "contact",
  "name",
  "ip",
  "card",
  "upi",
  "vpa",
  "bank",
  "wallet",
  "acquirer_data",
  "notes",
  "description",
  "receipt",
  "reference_id",
  "invoice_id",
  "short_url",
  "error_code",
  "error_description",
  "error_source",
  "error_step",
  "error_reason",
  "captured",
  "international",
  "attempts",
  "quantity",
  "total_count",
  "paid_count",
  "remaining_count",
  "count",
  "skip",
  "authorized_at",
  "captured_at",
  "current_start",
  "current_end",
  "charge_at",
  "start_at",
  "end_at",
  "speed_requested",
  "speed_processed",
  "batch_id",
  "tax_id",
  "offer_id",
  "source",
  "step",
  "reason",
  "code",
  "message",
  "type",
  "period",
  "partial_payment",
  "first_payment_min_amount",
  "offer_id",
  "transfer_id",
  "channel",
  "auth_type",
  "emi",
  "recurring",
  "late_authorized",
  "bank_transaction_id",
  "payer_account_type",
  "refund_status",
  "charge_at",
  "expire_by",
  "start_at",
  "end_at",
  "cancel_at_cycle_end",
  "cancelled_at",
  "ended_at",
  "paid_at",
]);

export function redactWebhook(value) {
  const ids = new Map();
  function visit(item, key = "") {
    if (Array.isArray(item)) return item.map((part) => visit(part, key));
    if (item && typeof item === "object") {
      if (["notes", "acquirer_data", "card", "upi"].includes(key)) return {};
      let unknown = 0;
      return Object.fromEntries(
        Object.entries(item).map(([field, part]) => {
          const safeField = SAFE_KEYS.has(field) ? field : `REDACTED_FIELD_${++unknown}`;
          return [safeField, visit(part, field)];
        }),
      );
    }
    if (typeof item === "string") {
      if (key === "event" && SAFE_EVENTS.has(item)) return item;
      if (
        SAFE_VALUES.has(item) &&
        [
          "entity",
          "status",
          "currency",
          "method",
          "contains",
          "period",
          "speed_requested",
          "speed_processed",
        ].includes(key)
      )
        return item;
      const prefix = item.match(PREFIXES)?.[0];
      if (prefix) {
        if (!ids.has(item)) ids.set(item, `${prefix}REDACTED_${ids.size + 1}`);
        return ids.get(item);
      }
      return "REDACTED";
    }
    if (typeof item === "number") {
      if (TIMESTAMP_KEYS.has(key)) return 1_700_000_000;
      return SAFE_NUMBER_KEYS.has(key) ? item : 0;
    }
    return item;
  }
  return visit(value);
}

export function fixtureFor(body, headers, forwardStatus, date) {
  let parsed;
  let validJson = true;
  try {
    parsed = JSON.parse(body);
  } catch {
    validJson = false;
    parsed = "REDACTED_NON_JSON_BODY";
  }
  return {
    capturedAt: date,
    headers: {
      "content-type": headers["content-type"]?.startsWith("application/json")
        ? "application/json"
        : "REDACTED",
      "x-razorpay-event-id": headers["x-razorpay-event-id"] ? "evt_REDACTED_1" : null,
      "x-razorpay-signature": headers["x-razorpay-signature"] ? "REDACTED" : null,
    },
    body: validJson ? redactWebhook(parsed) : parsed,
    forwardStatus,
  };
}

export function writeFixture(fixture, event, date) {
  const dir = "tests/fixtures/e2e";
  mkdirSync(dir, { recursive: true });
  const safeEvent = SAFE_EVENTS.has(event) ? event.replace(".", "-") : "unknown";
  let index = 0;
  let path;
  do {
    const suffix = index ? `-${index}` : "";
    path = join(dir, `${date}-${safeEvent}${suffix}.json`);
    index += 1;
  } while (existsSync(path));
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, { flag: "wx" });
  return path;
}
