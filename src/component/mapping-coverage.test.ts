import { describe, expect, test } from "vitest";
import {
  collectionItems,
  customerFields,
  orderFields,
  paymentFields,
  planFields,
  refundFields,
  subscriptionFields,
} from "./mapping.js";

const now = 1_700_000_000_000;
const order = { entity: "order", id: "order_1", amount: 1000, currency: "INR", status: "created" };
const payment = {
  entity: "payment",
  id: "pay_1",
  amount: 1000,
  currency: "INR",
  status: "authorized",
};
const refund = {
  entity: "refund",
  id: "rfnd_1",
  payment_id: "pay_1",
  amount: 100,
  currency: "INR",
  status: "pending",
};
const customer = { entity: "customer", id: "cust_1" };
const plan = {
  entity: "plan",
  id: "plan_1",
  period: "monthly",
  interval: 1,
  item: { name: "Pro", amount: 1000, currency: "INR" },
};
const subscription = {
  entity: "subscription",
  id: "sub_1",
  plan_id: "plan_1",
  total_count: 12,
  status: "created",
};

function invalidArgument(run: () => unknown) {
  expect(run).toThrowError(
    expect.objectContaining({
      data: expect.objectContaining({ code: "RAZORPAY_INVALID_ARGUMENT" }),
    }),
  );
}

describe("provider mapping optionals and authority checks", () => {
  test("all entities reject missing or empty ids and malformed observations", () => {
    const fixtures = [
      [orderFields, order],
      [paymentFields, payment],
      [refundFields, refund],
      [customerFields, customer],
      [planFields, plan],
      [subscriptionFields, subscription],
    ] as const;
    for (const [parse, raw] of fixtures) {
      invalidArgument(() => parse(null, now));
      invalidArgument(() => parse({ ...raw, id: "" }, now));
      invalidArgument(() => parse({ ...raw, id: raw.id.slice(0, raw.id.indexOf("_") + 1) }, now));
      invalidArgument(() => parse(raw, -1));
    }
  });

  test("order fills absent counters, retains unknown status, and rejects inconsistent totals", () => {
    expect(orderFields(order, now)).toMatchObject({
      amountPaid: 0,
      amountDue: 1000,
      attempts: 0,
      createdAt: now,
      updatedAtProvider: now,
    });
    expect(
      orderFields({ ...order, status: "new_order", receipt: "", notes: [] }, now),
    ).toMatchObject({ status: "unknown", rawStatus: "new_order" });
    expect(
      orderFields({ ...order, receipt: "receipt_1", amount_paid: 400, amount_due: 600 }, now)
        .receipt,
    ).toBe("receipt_1");
    for (const raw of [
      { ...order, amount_paid: 1001 },
      { ...order, amount_due: 1001 },
      { ...order, amount_paid: 500, amount_due: 600 },
      { ...order, receipt: 3 },
      { ...order, attempts: -1 },
    ])
      invalidArgument(() => orderFields(raw, now));
  });

  test("payment retains valid optional provider fields and rejects contradictory authority", () => {
    const rich = paymentFields(
      {
        ...payment,
        status: "captured",
        captured: true,
        amount_refunded: 200,
        refund_status: "partial",
        order_id: "order_1",
        subscription_id: "sub_1",
        invoice_id: "inv_1",
        method: "upi",
        international: false,
        email: "a@example.test",
        contact: "123",
        customer_id: "cust_1",
        fee: 20,
        tax: 4,
        error_code: "E",
        error_description: "Description",
        error_reason: "Reason",
        error_source: "Source",
        error_step: "Step",
        notes: { method: "upi" },
        created_at: 1_600_000_000,
        updated_at: 1_600_000_001,
      },
      now,
    );
    expect(rich).toMatchObject({
      captured: true,
      verified: false,
      amountRefunded: 200,
      refundStatus: "partial",
      subscriptionId: "sub_1",
      invoiceId: "inv_1",
      customerId: "cust_1",
      fee: 20,
      tax: 4,
      errorCode: "E",
      errorDescription: "Description",
      errorReason: "Reason",
      errorSource: "Source",
      errorStep: "Step",
      createdAt: 1_600_000_000_000,
      updatedAtProvider: 1_600_000_001_000,
    });
    expect(paymentFields({ ...payment, status: "refunded" }, now).captured).toBe(true);
    expect(paymentFields({ ...payment, status: "new_state", captured: true }, now)).toMatchObject({
      status: "unknown",
      rawStatus: "new_state",
      captured: true,
    });
    for (const raw of [
      { ...payment, amount_refunded: 1001 },
      { ...payment, refund_status: "other" },
      { ...payment, captured: "true" },
      { ...payment, status: "authorized", captured: true },
      { ...payment, order_id: "bad" },
      { ...payment, subscription_id: "bad" },
      { ...payment, invoice_id: "bad" },
      { ...payment, customer_id: "bad" },
      { ...payment, international: "false" },
      { ...payment, fee: -1 },
      { ...payment, tax: 1.2 },
    ])
      invalidArgument(() => paymentFields(raw, now));
  });

  test("refund, customer, and plan preserve valid optional fields", () => {
    expect(
      refundFields(
        {
          ...refund,
          status: "new_state",
          speed_requested: "normal",
          speed_processed: "normal",
          receipt: "r-1",
          notes: { a: "b" },
        },
        now,
      ),
    ).toMatchObject({
      status: "unknown",
      rawStatus: "new_state",
      speedRequested: "normal",
      speedProcessed: "normal",
      receipt: "r-1",
    });
    expect(
      customerFields(
        {
          ...customer,
          name: "A",
          email: "a@example.test",
          contact: "123",
          gstin: "GST",
          notes: { a: "b" },
        },
        now,
      ),
    ).toMatchObject({ name: "A", email: "a@example.test", contact: "123", gstin: "GST" });
    expect(
      planFields(
        {
          ...plan,
          period: "daily",
          interval: 7,
          item: { name: "Pro", amount: 1000, currency: "INR", description: "Daily" },
        },
        now,
      ),
    ).toMatchObject({ period: "daily", interval: 7, description: "Daily" });
    for (const raw of [
      { ...refund, payment_id: "pay_" },
      { ...refund, speed_requested: 1 },
      { ...refund, receipt: 1 },
    ])
      invalidArgument(() => refundFields(raw, now));
    for (const raw of [
      { ...customer, name: 1 },
      { ...customer, email: 1 },
      { ...customer, contact: 1 },
      { ...customer, gstin: 1 },
    ])
      invalidArgument(() => customerFields(raw, now));
    for (const raw of [
      { ...plan, period: "hourly" },
      { ...plan, period: "daily", interval: 1 },
      { ...plan, item: [] },
    ])
      invalidArgument(() => planFields(raw, now));
  });

  test("subscription validates counts, optional ids, times, and flags", () => {
    const rich = subscriptionFields(
      {
        ...subscription,
        status: "active",
        customer_id: "cust_1",
        quantity: 2,
        paid_count: 2,
        remaining_count: 10,
        current_start: 1,
        current_end: 2,
        charge_at: 3,
        start_at: 4,
        end_at: 5,
        ended_at: 6,
        expire_by: 7,
        paused_at: 8,
        short_url: "https://example.test/sub",
        has_scheduled_changes: true,
      },
      now,
    );
    expect(rich).toMatchObject({
      customerId: "cust_1",
      quantity: 2,
      paidCount: 2,
      remainingCount: 10,
      currentStart: 1000,
      currentEnd: 2000,
      chargeAt: 3000,
      startAt: 4000,
      endAt: 5000,
      endedAt: 6000,
      expireBy: 7000,
      pausedAt: 8000,
      hasScheduledChanges: true,
    });
    expect(subscriptionFields(subscription, now)).toMatchObject({
      quantity: 1,
      paidCount: 0,
      remainingCount: 12,
      hasScheduledChanges: false,
    });
    expect(subscriptionFields({ ...subscription, status: "new_state" }, now)).toMatchObject({
      status: "unknown",
      rawStatus: "new_state",
    });
    for (const raw of [
      { ...subscription, plan_id: "plan_" },
      { ...subscription, customer_id: "bad" },
      { ...subscription, paid_count: 13 },
      { ...subscription, remaining_count: 13 },
      { ...subscription, paid_count: 8, remaining_count: 8 },
      { ...subscription, current_end: -1 },
      { ...subscription, has_scheduled_changes: "true" },
      { ...subscription, short_url: 1 },
    ])
      invalidArgument(() => subscriptionFields(raw, now));
  });

  test("collection requires an array no longer than the provider bound", () => {
    expect(collectionItems({ entity: "collection", items: [] })).toEqual([]);
    for (const raw of [
      null,
      {},
      { entity: "collection", items: {} },
      { entity: "collection", items: Array.from({ length: 1001 }) },
    ])
      invalidArgument(() => collectionItems(raw));
  });
});
