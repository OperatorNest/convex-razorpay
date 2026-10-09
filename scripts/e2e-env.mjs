// Loads provider credentials from the gitignored .env.e2e into the local
// Convex deployment. Values go through stdin and are never printed.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED = new Set([
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_WEBHOOK_SECRET_PREVIOUS",
]);
const TEST_MODE_VAR = "RAZORPAY_TEST_MODE";
const REQUIRED = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const SELECTORS = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
];

function fileEntries(path) {
  if (!existsSync(path)) return new Map();
  const entries = new Map();
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    entries.set(key, value);
  }
  return entries;
}

export function validateLocalSelection(directory = ".", inherited = process.env) {
  const problems = [];
  for (const name of SELECTORS) {
    if (inherited[name]) problems.push(`process environment: ${name}`);
  }
  const shared = fileEntries(join(directory, ".env"));
  for (const name of SELECTORS) {
    if (shared.get(name)) problems.push(`.env: ${name}`);
  }
  const local = fileEntries(join(directory, ".env.local"));
  for (const name of SELECTORS.filter((selector) => selector !== "CONVEX_DEPLOYMENT")) {
    if (local.get(name)) problems.push(`.env.local: ${name}`);
  }
  if (!local.get("CONVEX_DEPLOYMENT")?.startsWith("anonymous:"))
    problems.push(".env.local: CONVEX_DEPLOYMENT (must be anonymous)");
  return problems;
}

export function readE2eEnv(path = ".env.e2e") {
  if (!existsSync(path)) return { entries: new Map(), missing: REQUIRED };
  const entries = new Map();
  let testModeRequested = false;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (key === TEST_MODE_VAR && value.toLowerCase() === "true") testModeRequested = true;
    if (ALLOWED.has(key) && value) entries.set(key, value);
  }
  return { entries, missing: REQUIRED.filter((name) => !entries.get(name)), testModeRequested };
}

export function validateE2eEnv({ entries, missing, testModeRequested }) {
  const problems = [...missing, ...validateLocalSelection()];
  const keyId = entries.get("RAZORPAY_KEY_ID");
  if (keyId && !/^rzp_test_.+/.test(keyId)) problems.push("RAZORPAY_KEY_ID (must be rzp_test_*)");
  if (testModeRequested) problems.push("RAZORPAY_TEST_MODE (must not be true in .env.e2e)");
  if (process.env.RAZORPAY_TEST_MODE?.toLowerCase() === "true")
    problems.push("RAZORPAY_TEST_MODE (must not be true in process environment)");
  return problems;
}

function requireAnonymousDeployment() {
  if (!existsSync(".env.local")) throw new Error("Missing .env.local anonymous deployment");
  const deployment = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("CONVEX_DEPLOYMENT="))
    ?.slice("CONVEX_DEPLOYMENT=".length)
    .trim();
  if (!deployment?.startsWith("anonymous:"))
    throw new Error("End-to-end env loading requires this repo's anonymous local deployment");
}

const convex = (args, input) =>
  spawnSync("pnpm", ["exec", "convex", ...args], {
    input,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });

export function applyE2eEnv(config) {
  const problems = validateE2eEnv(config);
  if (problems.length) throw new Error(`Missing or invalid .env.e2e: ${problems.join(", ")}`);
  requireAnonymousDeployment();
  for (const [key, value] of config.entries) {
    const result = convex(["env", "set", key], value);
    if (result.status !== 0) throw new Error(`Failed to set ${key}`);
    console.log(`set ${key}`);
  }
  const removal = convex(["env", "remove", TEST_MODE_VAR]);
  if (removal.status !== 0) throw new Error(`Failed to remove ${TEST_MODE_VAR}`);
  console.log(`removed ${TEST_MODE_VAR} (provider API mode)`);
  if (!config.entries.has("RAZORPAY_WEBHOOK_SECRET_PREVIOUS")) {
    const previous = convex(["env", "remove", "RAZORPAY_WEBHOOK_SECRET_PREVIOUS"]);
    if (previous.status !== 0) throw new Error("Failed to remove RAZORPAY_WEBHOOK_SECRET_PREVIOUS");
    console.log("removed RAZORPAY_WEBHOOK_SECRET_PREVIOUS (not supplied)");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    applyE2eEnv(readE2eEnv());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not load .env.e2e");
    process.exitCode = 1;
  }
}
