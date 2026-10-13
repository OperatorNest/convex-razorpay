import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, vi, describe } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import { restoreRazorpayTestState, stubRazorpayEnv } from "../test-helpers.js";

describe("plans", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const plan = {
    period: "monthly" as const,
    interval: 1,
    item: { name: "Plan", amount: 1000, currency: "INR" },
    testMode: true,
  };

  beforeEach(() =>
    stubRazorpayEnv({
      keyId: "rzp_test_fixture",
      keySecret: "fixture_secret",
      webhookSecret: "fixture_webhook",
    }),
  );

  afterEach(restoreRazorpayTestState);

  test("completed create claims survive retention and preserve deduplication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const t = harness();
    const args = { ...plan, idempotencyKey: "retained_plan_key" };
    const first = await t.action(api.plans.create, args);
    vi.setSystemTime(1000000 + 31 * 86400000);
    expect((await t.action(api.plans.create, args)).razorpayPlanId).toBe(first.razorpayPlanId);
    await expect(
      t.action(api.plans.create, { ...args, item: { ...args.item, amount: 2000 } }),
    ).rejects.toMatchObject({ data: { code: "RAZORPAY_IDEMPOTENCY_CONFLICT" } });
  });
});

describe("plans", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const rejected = { data: { code: "RAZORPAY_PROVIDER_ERROR", providerStatus: 400 } };

  const planArgs = {
    period: "monthly" as const,
    interval: 1,
    item: { name: "Monthly Plan", amount: 1000, currency: "INR" },
  };

  beforeEach(() => {
    stubRazorpayEnv({
      keyId: "rzp_test_fixture",
      keySecret: "fixture_secret",
      webhookSecret: "fixture_webhook",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Unexpected HTTP"))),
    );
  });

  afterEach(restoreRazorpayTestState);

  test("claim release and failure affect only the selected mode", async () => {
    const t = harness();
    const keyed = { ...planArgs, idempotencyKey: "fixture_release_key" };
    const simulated = await t.action(api.plans.create, { ...keyed, testMode: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })),
      ),
    );
    await expect(t.action(api.plans.create, { ...keyed, testMode: false })).rejects.toMatchObject(
      rejected,
    );
    expect(
      await t.mutation(internal.idempotency.release, {
        resource: "plan",
        idempotencyKey: keyed.idempotencyKey,
        testMode: true,
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.idempotency.release, {
        resource: "plan",
        idempotencyKey: keyed.idempotencyKey,
        testMode: false,
      }),
    ).toBe(true);
    expect(await t.action(api.plans.create, { ...keyed, testMode: true })).toEqual(simulated);
    expect(await t.run((ctx) => ctx.db.query("idempotencyRequests").take(10))).toMatchObject([
      { testMode: true, status: "completed" },
    ]);
  });
});
