import { defineApp } from "convex/server";
import { v } from "convex/values";
import razorpay from "@operatornest/convex-razorpay/convex.config.js";

const app = defineApp({
  env: {
    RAZORPAY_KEY_ID: v.optional(v.string()),
    RAZORPAY_KEY_SECRET: v.optional(v.string()),
    RAZORPAY_WEBHOOK_SECRET: v.optional(v.string()),
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: v.optional(v.string()),
    RAZORPAY_TEST_MODE: v.optional(v.string()),
    E2E_RECORDER_URL: v.optional(v.string()),
  },
});

app.use(razorpay, {
  env: {
    RAZORPAY_KEY_ID: app.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: app.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: app.env.RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: app.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
    RAZORPAY_TEST_MODE: app.env.RAZORPAY_TEST_MODE,
  },
});

export default app;
