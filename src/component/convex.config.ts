import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("razorpay", {
  env: {
    RAZORPAY_KEY_ID: v.optional(v.string()),
    RAZORPAY_KEY_SECRET: v.optional(v.string()),
    RAZORPAY_WEBHOOK_SECRET: v.optional(v.string()),
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: v.optional(v.string()),
    RAZORPAY_TEST_MODE: v.optional(v.string()),
  },
});
