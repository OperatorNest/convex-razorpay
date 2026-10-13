import schema from "./schema.js";
import { afterEach, beforeEach, expect, test, describe, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api.js";
import { restoreRazorpayTestState, stubRazorpayEnv, expectRazorpayError } from "../test-helpers.js";
import { computeHmacSha256Hex } from "../shared/crypto.js";

describe("subscriptions", () => {
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

  test("stored subscription pages continue without overlap and bound endCursor reads", async () => {
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" });
    const t = harness();
    const subscriptions = [];
    for (let index = 0; index < 5; index++) {
      subscriptions.push(
        await t.action(api.subscriptions.create, {
          razorpayPlanId: "plan_fixture",
          totalCount: 12,
          quantity: 1,
          customerNotify: false,
          userId: "owner",
          testMode: true,
        }),
      );
    }
    const read = (paginationOpts: {
      numItems: number;
      cursor: string | null;
      endCursor?: string;
    }) => t.query(api.subscriptions.list, { userId: "owner", paginationOpts, testMode: true });
    const first = await read({ numItems: 1, cursor: null });
    const second = await read({ numItems: 1, cursor: first.continueCursor });
    expect(first.isDone).toBe(false);
    expect(first.page.map((subscription) => subscription.razorpaySubscriptionId)).toEqual([
      subscriptions[4]?.razorpaySubscriptionId,
    ]);
    expect(second.page.map((subscription) => subscription.razorpaySubscriptionId)).toEqual([
      subscriptions[3]?.razorpaySubscriptionId,
    ]);
    const full = await read({ numItems: 5, cursor: null });
    const bounded = await read({ numItems: 1, cursor: null, endCursor: full.continueCursor });
    expect(bounded.page.map((subscription) => subscription.razorpaySubscriptionId)).toEqual([
      subscriptions[4]?.razorpaySubscriptionId,
      subscriptions[3]?.razorpaySubscriptionId,
    ]);
    expect(bounded.isDone).toBe(false);
    const next = await read({ numItems: 1, cursor: bounded.continueCursor });
    expect(next.page.map((subscription) => subscription.razorpaySubscriptionId)).toEqual([
      subscriptions[2]?.razorpaySubscriptionId,
    ]);
  });

  test("unkeyed simulated creates allocate independent resources", async () => {
    stubRazorpayEnv({ keySecret: "fixture_secret", webhookSecret: "fixture_webhook" });
    const t = harness();
    const a = await t.action(api.subscriptions.create, {
      quantity: 1,
      customerNotify: true,
      razorpayPlanId: "plan_fixture",
      totalCount: 12,
      externalId: "a",
      testMode: true,
    });
    const b = await t.action(api.subscriptions.create, {
      customerNotify: true,
      razorpayPlanId: "plan_fixture",
      totalCount: 12,
      externalId: "b",
      quantity: 2,
      testMode: true,
    });
    expect(a.razorpaySubscriptionId).not.toBe(b.razorpaySubscriptionId);
    const p = await t.action(api.plans.create, plan);
    const q = await t.action(api.plans.create, {
      ...plan,
      item: { ...plan.item, currency: "USD" },
    });
    expect(p.razorpayPlanId).not.toBe(q.razorpayPlanId);
  });

  test("subscription timestamps use milliseconds with provider second precision", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (typeof init.body !== "string")
        throw new Error("The provider request body must be JSON text.");
      const body = JSON.parse(init.body);
      return Response.json({
        ...body,
        entity: "subscription",
        id: "sub_timestamps",
        status: "created",
        paid_count: 0,
        remaining_count: 12,
      });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await harness().action(api.subscriptions.create, {
      razorpayPlanId: "plan_fixture",
      totalCount: 12,
      quantity: 1,
      customerNotify: false,
      startAt: 1700000000123,
      expiresAt: 1700001000456,
    });
    expect(result).toMatchObject({ startAt: 1700000000000, expiresAt: 1700001000000 });
    const requestBody = fetch.mock.calls[0]?.[1].body;
    if (typeof requestBody !== "string")
      throw new Error("The provider request body must be JSON text.");
    expect(JSON.parse(requestBody)).toMatchObject({
      start_at: 1700000000,
      expire_by: 1700001000,
      customer_notify: false,
    });
  });

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "subscription creation rejects timestamp %s before provider HTTP",
    async (startAt) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expectRazorpayError(
        harness().action(api.subscriptions.create, {
          razorpayPlanId: "plan_fixture",
          totalCount: 12,
          quantity: 1,
          customerNotify: false,
          startAt,
        }),
        "RAZORPAY_INVALID_ARGUMENT",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("subscriptions", () => {
  const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

  const harness = () => convexTest(schema, modules);

  const subscription = {
    entity: "subscription",
    id: "sub_fixture",
    plan_id: "plan_fixture",
    status: "active",
    total_count: 12,
    paid_count: 1,
    remaining_count: 11,
  };

  async function ingest(
    t: ReturnType<typeof harness>,
    event: string,
    payload: Record<string, unknown>,
    createdAt: number,
    eventId: string,
  ) {
    const body = JSON.stringify({ entity: "event", event, created_at: createdAt, payload });
    return t.action(api.webhooks.ingest, {
      body,
      signature: await computeHmacSha256Hex("fixture_webhook", body),
      eventId,
    });
  }

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

  test("subscription webhook after fetch ignores local clock and orders only webhook times", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000);
    const t = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json(subscription))),
    );
    await t.action(api.subscriptions.fetch, { razorpaySubscriptionId: subscription.id });
    expect(
      await ingest(
        t,
        "subscription.paused",
        { subscription: { entity: { ...subscription, status: "paused", quantity: 2 } } },
        100,
        "evt_pause",
      ),
    ).toMatchObject({ status: "processed" });
    expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
      status: "paused",
      quantity: 2,
    });
    await ingest(
      t,
      "subscription.resumed",
      { subscription: { entity: { ...subscription, quantity: 1 } } },
      90,
      "evt_old_resume",
    );
    expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
      status: "paused",
      quantity: 2,
    });
    await ingest(
      t,
      "subscription.resumed",
      { subscription: { entity: { ...subscription, quantity: 3 } } },
      110,
      "evt_resume",
    );
    expect(await t.run((ctx) => ctx.db.query("subscriptions").first())).toMatchObject({
      status: "active",
      quantity: 3,
    });
  });

  test("subscription fetch always applies current provider state", async () => {
    const t = harness();
    await ingest(
      t,
      "subscription.paused",
      { subscription: { entity: { ...subscription, status: "paused", quantity: 2 } } },
      1000,
      "evt_pause",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ ...subscription, updated_at: 1, quantity: 4 }))),
    );
    expect(
      await t.action(api.subscriptions.fetch, { razorpaySubscriptionId: subscription.id }),
    ).toMatchObject({ status: "active", quantity: 4 });
  });

  test("a provider subscription response cannot revive a terminal status or lower paidCount", async () => {
    stubRazorpayEnv({ keyId: "rzp_live_fixture", keySecret: "fixture_secret" });
    const stored = {
      entity: "subscription",
      id: "sub_terminal_fixture",
      plan_id: "plan_fixture",
      status: "active",
      quantity: 1,
      total_count: 12,
      paid_count: 3,
      remaining_count: 9,
      created_at: 1_567_674_500,
    };
    const t = harness();
    await t.mutation(internal.mutations.putSubscription, {
      raw: stored,
      observedAt: 1_567_674_500_000,
      testMode: false,
    });
    const respond = (raw: Record<string, unknown>) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ ...stored, ...raw })),
      );
    respond({ status: "active", paid_count: 2, remaining_count: 10 });
    expect(
      await t.action(api.subscriptions.pause, { razorpaySubscriptionId: stored.id }),
    ).toMatchObject({ status: "active", paidCount: 3, remainingCount: 9 });
    respond({ status: "cancelled" });
    expect(
      await t.action(api.subscriptions.cancel, { razorpaySubscriptionId: stored.id }),
    ).toMatchObject({ status: "cancelled", paidCount: 3 });
    respond({ status: "active", paid_count: 4, remaining_count: 8 });
    expect(
      await t.action(api.subscriptions.resume, { razorpaySubscriptionId: stored.id }),
    ).toMatchObject({ status: "cancelled", paidCount: 3, testMode: false });
  });
});
