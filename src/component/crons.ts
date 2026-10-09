import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.interval("razorpay webhook retention", { hours: 24 }, internal.webhooks.cleanupScheduled, {});
crons.interval(
  "razorpay idempotency retention",
  { hours: 24 },
  internal.idempotency.cleanupScheduled,
  {},
);
export default crons;
