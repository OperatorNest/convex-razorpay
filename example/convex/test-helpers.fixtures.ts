import { createFunctionHandle, makeFunctionReference } from "convex/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
  webhookEventValidator,
  webhookIngestResultValidator,
} from "../../src/shared/validators.js";
import { components, internal } from "./_generated/api.js";
import { internalAction, internalMutation } from "./_generated/server.js";

/** Fixtures used only by the example app's convex-test suite. */
export const onEventFailingFixture = internalMutation({
  args: webhookEventValidator,
  returns: v.null(),
  handler: async (ctx, { eventId, event }) => {
    await ctx.db.insert("webhookNotifications", { eventId, event });
    throw new Error("deliberate callback retry test");
  },
});

export const ingestWithCallback = internalAction({
  args: {
    body: v.string(),
    signature: v.string(),
    eventId: v.string(),
    shouldFail: v.optional(v.boolean()),
  },
  returns: webhookIngestResultValidator,
  handler: async (ctx, args) => {
    const { shouldFail, ...ingestArgs } = args;
    const callback = shouldFail
      ? makeFunctionReference<"mutation", Infer<typeof webhookEventValidator>, null>(
          "test-helpers.fixtures:onEventFailingFixture",
        )
      : internal.webhookCallback.onEvent;
    const callbackHandle = await createFunctionHandle(callback);
    return ctx.runAction(components.razorpay.webhooks.ingest, { ...ingestArgs, callbackHandle });
  },
});
