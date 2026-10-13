import { action, env } from "./_generated/server.js";
import { paymentLinkStatusValidator } from "../shared/statuses.js";
import { v } from "convex/values";
import { razorpayError } from "../shared/errors.js";
import { readConfig, requireConfigValue } from "../shared/config.js";
import { readTestMode } from "./provider.js";
import { verifyPaymentLinkCallback } from "../shared/crypto.js";

export const verifyCheckout = action({
  args: {
    razorpayPaymentLinkId: v.string(),
    referenceId: v.string(),
    status: paymentLinkStatusValidator,
    razorpayPaymentId: v.string(),
    signature: v.string(),
  },
  returns: v.literal(true),
  handler: async (_ctx, args): Promise<true> => {
    readTestMode();
    const keySecret = requireConfigValue(readConfig(env).keySecret);
    if (
      !(await verifyPaymentLinkCallback(
        keySecret,
        args.razorpayPaymentLinkId,
        args.referenceId,
        args.status,
        args.razorpayPaymentId,
        args.signature,
      ))
    ) {
      throw razorpayError("RAZORPAY_INVALID_PAYMENT_SIGNATURE");
    }
    return true;
  },
});
