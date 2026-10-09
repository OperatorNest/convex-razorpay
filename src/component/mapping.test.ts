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

const observedAt = 1_600_000_000_000;
const cases = [
  {
    kind: "order",
    id: "order_1",
    parse: orderFields,
    raw: {
      entity: "order",
      id: "order_1",
      amount: 50000,
      amount_paid: 0,
      amount_due: 50000,
      currency: "INR",
      status: "created",
      attempts: 0,
      notes: [],
      created_at: 1567674599,
    },
  },
  {
    kind: "payment",
    id: "pay_1",
    parse: paymentFields,
    raw: {
      entity: "payment",
      id: "pay_1",
      amount: 50000,
      currency: "INR",
      status: "authorized",
      captured: false,
      amount_refunded: 0,
      order_id: "order_1",
      notes: null,
      created_at: 1567674599,
    },
  },
  {
    kind: "refund",
    id: "rfnd_1",
    parse: refundFields,
    raw: {
      entity: "refund",
      id: "rfnd_1",
      payment_id: "pay_1",
      amount: 50000,
      currency: "INR",
      status: "pending",
      notes: {},
      created_at: 1567674599,
    },
  },
  {
    kind: "customer",
    id: "cust_1",
    parse: customerFields,
    raw: {
      entity: "customer",
      id: "cust_1",
      name: null,
      email: null,
      contact: null,
      notes: [],
      created_at: 1567674599,
    },
  },
  {
    kind: "plan",
    id: "plan_1",
    parse: planFields,
    raw: {
      entity: "plan",
      id: "plan_1",
      period: "monthly",
      interval: 1,
      item: { name: "Pro", amount: 69900, currency: "INR", description: null },
      notes: {},
      created_at: 1567674599,
    },
  },
  {
    kind: "subscription",
    id: "sub_1",
    parse: subscriptionFields,
    raw: {
      entity: "subscription",
      id: "sub_1",
      plan_id: "plan_1",
      status: "created",
      quantity: 1,
      total_count: 12,
      paid_count: 0,
      remaining_count: 12,
      current_start: null,
      customer_id: null,
      notes: {},
      created_at: 1567674599,
    },
  },
] as const;

describe("provider entity parsing", () => {
  for (const fixture of cases) {
    test(`${fixture.kind}: accepts documented shape and nullable optionals`, () => {
      const parsed = fixture.parse(fixture.raw, observedAt);
      expect(parsed.razorpayId).toBe(fixture.id);
      expect(parsed.notes).toEqual({});
      expect(parsed.createdAt).toBe(1567674599000);
      expect(parsed.updatedAtProvider).toBe(observedAt);
      expect(
        fixture.parse({ ...fixture.raw, updated_at: 1567674600 }, observedAt).updatedAtProvider,
      ).toBe(1567674600000);
    });

    test(`${fixture.kind}: rejects wrong entity, id, currency, and malformed notes`, () => {
      expect(() => fixture.parse({ ...fixture.raw, entity: "wrong" }, observedAt)).toThrow();
      expect(() => fixture.parse({ ...fixture.raw, id: "bad_1" }, observedAt)).toThrow();
      expect(() => fixture.parse({ ...fixture.raw, notes: ["bad"] }, observedAt)).toThrow();
      expect(fixture.parse({ ...fixture.raw, notes: { a: 1 } }, observedAt).notes).toEqual({
        a: "1",
      });
      expect(() =>
        fixture.parse({ ...fixture.raw, created_at: Number.MAX_SAFE_INTEGER }, observedAt),
      ).toThrow();
      expect(() =>
        fixture.parse({ ...fixture.raw, updated_at: Number.MAX_SAFE_INTEGER }, observedAt),
      ).toThrow();
    });
  }

  test("order totals and safe integer amounts are required", () => {
    const raw = cases[0].raw;
    expect(() => orderFields({ ...raw, amount: 100.5 }, observedAt)).toThrow();
    expect(() => orderFields({ ...raw, amount_paid: -1 }, observedAt)).toThrow();
    expect(() => orderFields({ ...raw, amount_due: 1 }, observedAt)).toThrow();
    expect(() => orderFields({ ...raw, currency: "inr" }, observedAt)).toThrow();
  });

  test("notes coerce scalar values and retain only the first fifteen keys", () => {
    const input = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`key${index}`, index]),
    );
    const parsed = paymentFields(
      {
        entity: "payment",
        id: "pay_notes_fixture",
        amount: 500,
        currency: "INR",
        status: "authorized",
        notes: input,
      },
      observedAt,
    );
    expect(Object.keys(parsed.notes)).toHaveLength(15);
    expect(parsed.notes.key0).toBe("0");
    expect(parsed.notes).not.toHaveProperty("key15");
  });

  test("payment authority fields reject invalid capture and optional numeric types", () => {
    const raw = cases[1].raw;
    expect(() =>
      paymentFields({ ...raw, status: "captured", captured: false }, observedAt),
    ).toThrow();
    expect(() => paymentFields({ ...raw, amount_refunded: "1" }, observedAt)).toThrow();
    expect(() => paymentFields({ ...raw, fee: "100" }, observedAt)).toThrow();
    expect(() => paymentFields({ ...raw, order_id: 1 }, observedAt)).toThrow();
    expect(() => paymentFields({ ...raw, currency: "inr" }, observedAt)).toThrow();
  });

  test("refund, plan, and subscription reject malformed money and counts", () => {
    expect(() => refundFields({ ...cases[2].raw, amount: -1 }, observedAt)).toThrow();
    expect(() => refundFields({ ...cases[2].raw, payment_id: "other_1" }, observedAt)).toThrow();
    expect(() =>
      planFields(
        { ...cases[4].raw, item: { name: "Pro", amount: "69900", currency: "INR" } },
        observedAt,
      ),
    ).toThrow();
    expect(() =>
      planFields(
        { ...cases[4].raw, item: { name: "Pro", amount: 69900, currency: "inr" } },
        observedAt,
      ),
    ).toThrow();
    expect(() => subscriptionFields({ ...cases[5].raw, total_count: 1.5 }, observedAt)).toThrow();
    expect(() => subscriptionFields({ ...cases[5].raw, quantity: 0 }, observedAt)).toThrow();
    expect(() => subscriptionFields({ ...cases[5].raw, paid_count: 13 }, observedAt)).toThrow();
    expect(() =>
      subscriptionFields({ ...cases[5].raw, current_start: Number.MAX_SAFE_INTEGER }, observedAt),
    ).toThrow();
  });

  test("collections are bounded and shape checked", () => {
    expect(collectionItems({ entity: "collection", items: [cases[0].raw] })).toHaveLength(1);
    expect(() => collectionItems({ entity: "wrong", items: [] })).toThrow();
    expect(() =>
      collectionItems({ entity: "collection", items: Array.from({ length: 1001 }) }),
    ).toThrow();
  });

  test("unknown statuses and oversized notes are retained without rejecting a signed entity", () => {
    const raw = cases[1].raw;
    const manyNotes = Object.fromEntries(
      Array.from({ length: 18 }, (_, index) => [`n${index}`, index]),
    );
    const mapped = paymentFields(
      { ...raw, status: "authorized_new", notes: manyNotes },
      observedAt,
    );
    expect(mapped.status).toBe("unknown");
    expect(mapped.rawStatus).toBe("authorized_new");
    expect(Object.keys(mapped.notes)).toHaveLength(15);
    expect(mapped.notes.n0).toBe("0");
  });
});
