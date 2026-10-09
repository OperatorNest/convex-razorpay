import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const order = {
  entity: "order",
  id: "order_write",
  amount: 1000,
  currency: "INR",
  status: "created",
  amount_paid: 0,
  amount_due: 1000,
  attempts: 0,
};
const payment = {
  entity: "payment",
  id: "pay_write",
  amount: 1000,
  currency: "INR",
  status: "authorized",
  order_id: "order_write",
  captured: false,
  amount_refunded: 0,
};
const refund = {
  entity: "refund",
  id: "rfnd_write",
  payment_id: "pay_write",
  amount: 100,
  currency: "INR",
  status: "pending",
};
const customer = { entity: "customer", id: "cust_write", notes: { userId: "user_1" } };
const plan = {
  entity: "plan",
  id: "plan_write",
  period: "monthly",
  interval: 1,
  item: { name: "Pro", amount: 1000, currency: "INR" },
};
const subscription = {
  entity: "subscription",
  id: "sub_write",
  plan_id: "plan_write",
  total_count: 12,
  paid_count: 1,
  remaining_count: 11,
  status: "created",
};

function invalidArgument(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ data: { code: "RAZORPAY_INVALID_ARGUMENT" } });
}

test("order mirror preserves monotonic totals and immutable identity", async () => {
  const t = convexTest(schema, modules);
  const put = (raw: unknown, observedAt: number) =>
    t.mutation(internal.mutations.putOrder, { raw, observedAt });
  await put({ ...order, status: "paid", amount_paid: 1000, amount_due: 0, attempts: 2 }, 20);
  expect(
    await put({ ...order, status: "attempted", amount_paid: 0, amount_due: 1000, attempts: 1 }, 10),
  ).toMatchObject({ status: "paid", amountPaid: 1000, amountDue: 0, attempts: 2 });
  expect(await put({ ...order, status: "future_status" }, 30)).toMatchObject({
    status: "paid",
    rawStatus: "future_status",
  });
  await invalidArgument(put({ ...order, amount: 2000 }, 40));
  await invalidArgument(put({ ...order, currency: "USD" }, 40));
});

test("payment mirror rejects changed ownership and preserves capture and refunded totals", async () => {
  const t = convexTest(schema, modules);
  const put = (raw: unknown, observedAt: number) =>
    t.mutation(internal.mutations.putPayment, { raw, observedAt });
  await put(
    {
      ...payment,
      status: "captured",
      captured: true,
      amount_refunded: 400,
      refund_status: "partial",
      subscription_id: "sub_1",
      invoice_id: "inv_1",
    },
    20,
  );
  expect(
    await put(
      { ...payment, amount_refunded: 0, subscription_id: "sub_1", invoice_id: "inv_1" },
      10,
    ),
  ).toMatchObject({ status: "captured", captured: true, amountRefunded: 400 });
  await invalidArgument(put({ ...payment, amount: 2000 }, 30));
  await invalidArgument(put({ ...payment, order_id: "order_other" }, 30));
  await invalidArgument(put({ ...payment, subscription_id: "sub_other" }, 30));
  await invalidArgument(put({ ...payment, invoice_id: "inv_other" }, 30));
});

test("processed refund resists stale status and immutable payment or amount changes", async () => {
  const t = convexTest(schema, modules);
  const put = (raw: unknown, observedAt: number) =>
    t.mutation(internal.mutations.putRefund, { raw, observedAt });
  await put({ ...refund, status: "processed" }, 20);
  expect(await put({ ...refund, status: "pending" }, 30)).toMatchObject({ status: "processed" });
  await invalidArgument(put({ ...refund, payment_id: "pay_other" }, 30));
  await invalidArgument(put({ ...refund, amount: 200 }, 30));
});

test("customer mirror refuses cross-user links and stale provider observations", async () => {
  const t = convexTest(schema, modules);
  const put = (raw: unknown, observedAt: number, userId?: string) =>
    t.mutation(internal.mutations.putCustomer, {
      raw,
      observedAt,
      ...(userId === undefined ? {} : { userId }),
    });
  await expect(put(customer, 10, "user_2")).rejects.toMatchObject({
    data: { code: "RAZORPAY_CUSTOMER_CONFLICT" },
  });
  await put({ ...customer, name: "New" }, 20, "user_1");
  expect(await put({ ...customer, name: "Old" }, 10, "user_1")).toMatchObject({
    name: "New",
    userId: "user_1",
  });
  await expect(put({ ...customer, notes: {} }, 30, "user_2")).rejects.toMatchObject({
    data: { code: "RAZORPAY_CUSTOMER_CONFLICT" },
  });
});

test("plan identity and idempotency claim fingerprint are enforced", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.mutations.putPlan, { raw: plan, observedAt: 10 });
  await invalidArgument(
    t.mutation(internal.mutations.putPlan, {
      raw: { ...plan, item: { ...plan.item, amount: 2000 } },
      observedAt: 20,
    }),
  );
  await invalidArgument(
    t.mutation(internal.mutations.putPlan, {
      raw: plan,
      observedAt: 20,
      idempotencyKey: "missing",
      requestFingerprint: "fingerprint",
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("idempotencyRequests", {
      resource: "plan",
      key: "present",
      fingerprint: "original",
      status: "pending",
      createdAt: 10,
    });
  });
  await expect(
    t.mutation(internal.mutations.putPlan, {
      raw: plan,
      observedAt: 20,
      idempotencyKey: "present",
      requestFingerprint: "other",
    }),
  ).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_CONFLICT" } });
});

test("subscription mirror cannot regress paid count and settles its claim", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("idempotencyRequests", {
      resource: "subscription",
      key: "subscription-key",
      fingerprint: "fingerprint",
      status: "pending",
      createdAt: 10,
    });
  });
  await t.mutation(internal.mutations.putSubscription, {
    raw: { ...subscription, status: "active", paid_count: 3, remaining_count: 9 },
    observedAt: 20,
    idempotencyKey: "subscription-key",
    requestFingerprint: "fingerprint",
  });
  expect(
    await t.mutation(internal.mutations.putSubscription, { raw: subscription, observedAt: 10 }),
  ).toMatchObject({ status: "active", paidCount: 3, remainingCount: 9 });
  const claim = await t.run((ctx) =>
    ctx.db
      .query("idempotencyRequests")
      .withIndex("by_resource_and_key", (q) =>
        q.eq("resource", "subscription").eq("key", "subscription-key"),
      )
      .unique(),
  );
  expect(claim).toMatchObject({ status: "completed", razorpayId: "sub_write" });
});
