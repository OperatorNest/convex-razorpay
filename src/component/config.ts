import { v } from "convex/values";
import { readConfig, resolveRazorpayTestMode } from "../shared/config.js";
import { env, query } from "./_generated/server.js";

/** Returns the effective configuration with secrets omitted: test mode, whether calls are simulated, the public key ID and which secrets are set. */
export const get = query({
  args: { testMode: v.optional(v.boolean()) },
  returns: v.object({
    testMode: v.boolean(),
    isSimulated: v.boolean(),
    keyId: v.union(v.string(), v.null()),
    hasKeySecret: v.boolean(),
    hasWebhookSecret: v.boolean(),
    hasPreviousWebhookSecret: v.boolean(),
  }),
  handler: (_ctx, args) => {
    const config = readConfig(env);
    const testMode = resolveRazorpayTestMode(args.testMode, env);
    return {
      testMode,
      isSimulated: testMode && config.keyId === undefined,
      keyId: config.keyId ?? null,
      hasKeySecret: config.keySecret !== undefined,
      hasWebhookSecret: config.webhookSecret !== undefined,
      hasPreviousWebhookSecret: config.previousWebhookSecret !== undefined,
    };
  },
});
