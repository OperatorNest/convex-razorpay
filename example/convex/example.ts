import { Razorpay, sha256Hex } from "@operatornest/convex-razorpay";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api.js";
import { action, env, query } from "./_generated/server.js";

const razorpay = new Razorpay(components.razorpay, {
  testMode: env.RAZORPAY_TEST_MODE === "true",
});
const demoPrice = 50000;
const demoCurrency = "INR";

export const createOrder = action({
  args: { cartId: v.string() },
  returns: v.object({
    orderId: v.string(),
    amount: v.number(),
    currency: v.string(),
    keyId: v.optional(v.string()),
  }),
  handler: async (ctx, { cartId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication required" });
    if (!cartId || cartId.length > 128)
      throw new ConvexError({ code: "APP_INVALID_CART", message: "Invalid cart id" });
    const idempotencyKey = await sha256Hex(`${identity.tokenIdentifier}|${cartId}`);
    const order = await razorpay.orders.create(ctx, {
      amount: demoPrice,
      currency: demoCurrency,
      userId: identity.tokenIdentifier,
      idempotencyKey,
    });
    return {
      orderId: order.razorpayId,
      amount: order.amount,
      currency: order.currency,
      ...(order.keyId === undefined ? {} : { keyId: order.keyId }),
    };
  },
});

export const getOrder = query({
  args: { orderId: v.string() },
  returns: v.union(
    v.object({ orderId: v.string(), amount: v.number(), currency: v.string(), status: v.string() }),
    v.null(),
  ),
  handler: async (ctx, { orderId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication required" });
    const order = await razorpay.orders.get(ctx, { orderId });
    if (!order || order.userId !== identity.tokenIdentifier) return null;
    return {
      orderId: order.razorpayId,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
    };
  },
});
