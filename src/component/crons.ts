import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();
crons.interval("razorpay webhook retention", { hours: 24 }, internal.webhooks.cleanupScheduled, {});
export default crons;
