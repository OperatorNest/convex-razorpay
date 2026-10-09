// Runs the example app against an anonymous local Convex deployment.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { acquireLock } from "./with-local-lock.mjs";

const results = [];
const failures = [];

function convex(...args) {
  return execFileSync("pnpm", ["exec", "convex", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
}

function run(fn, args = {}) {
  return JSON.parse(convex("run", fn, JSON.stringify(args)).trim());
}

function runComponent(fn, args = {}) {
  return JSON.parse(convex("run", fn, JSON.stringify(args), "--component", "razorpay").trim());
}

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const hmac = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");

// The CLI starts the anonymous backend only while a command runs and stops it afterwards, which
// leaves no HTTP site to POST webhooks to. Keep one `convex dev` we started alive for the run and
// stop only that process afterwards.
let devServer;
let devOutput = "";

function stopDevServer() {
  if (devServer && devServer.exitCode === null) devServer.kill("SIGTERM");
  if (!devServer || devServer.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (devServer.exitCode === null) devServer.kill("SIGKILL");
      resolve();
    }, 10_000);
    devServer.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
process.on("exit", () => {
  if (devServer?.exitCode === null) devServer.kill("SIGTERM");
});
process.once("SIGINT", async () => {
  await stopDevServer();
  process.exit(130);
});
process.once("SIGTERM", async () => {
  await stopDevServer();
  process.exit(143);
});

function startDevServer() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "convex", "dev", "--tail-logs", "disable"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    });
    devServer = child;
    devOutput = "";
    const timer = setTimeout(
      () => reject(new Error(`convex dev not ready:\n${devOutput}`)),
      180_000,
    );
    const onData = (chunk) => {
      devOutput += chunk;
      if (/Convex functions ready/.test(devOutput)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`convex dev exited with ${code}:\n${devOutput}`));
    });
  });
}

async function startDevServerWithRetry() {
  try {
    await startDevServer();
  } catch (error) {
    // Another process may have restarted the shared local backend; retry once.
    console.log(`convex dev failed (${String(error.message).split("\n")[0]}); retrying once`);
    await stopDevServer();
    await startDevServer();
  }
}

function localEnv(name) {
  if (!existsSync(".env.local")) return undefined;
  const line = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim();
}

async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function siteUrl() {
  const fromEnv = localEnv("CONVEX_SITE_URL");
  const fromCli = [...devOutput.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g)].map(
    ([url]) => url,
  );
  const candidates = [...new Set([fromEnv, ...fromCli].filter(Boolean))];
  for (const url of candidates) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url))
      throw new Error(`Refusing to run against a non-local site URL: ${url}`);
    if (await reachable(url)) return url.replace(/\/$/, "");
  }
  throw new Error(`No reachable local site URL (tried ${candidates.join(", ") || "none"})`);
}

async function poll(name, assertion, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await assertion();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${name} did not become ready${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

function setLocalEnv(name, value) {
  const result = spawnSync("pnpm", ["exec", "convex", "env", "set", name], {
    input: value,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  if (result.status !== 0) throw new Error(`Could not set local ${name}`);
}

const envelope = (id, payment) =>
  JSON.stringify({
    entity: "event",
    account_id: "acc_smoke",
    event: "payment.captured",
    contains: ["payment"],
    payload: { payment: { entity: payment } },
    created_at: Math.floor(Date.now() / 1000),
    id,
  });

async function post(url, body, headers) {
  const response = await fetch(url, { method: "POST", body, headers });
  return response.status;
}

const release = await acquireLock();
try {
  console.log("1. Building the package and starting an anonymous local deployment...");
  execFileSync("pnpm", ["build"], { stdio: "ignore" });
  if (!localEnv("CONVEX_DEPLOYMENT")) convex("init");
  if (!localEnv("CONVEX_DEPLOYMENT")?.startsWith("anonymous:"))
    throw new Error("Smoke requires an anonymous local Convex deployment");
  await startDevServerWithRetry();

  // Fabricated credentials. Test mode never contacts Razorpay.
  const webhookSecret = randomBytes(24).toString("hex");
  const keySecret = randomBytes(24).toString("hex");
  for (const [name, value] of Object.entries({
    RAZORPAY_TEST_MODE: "true",
    RAZORPAY_KEY_ID: "rzp_test_smoke",
    RAZORPAY_KEY_SECRET: keySecret,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  })) {
    setLocalEnv(name, value);
  }
  const environmentReady = await poll("component environment", () => {
    const status = run("smoke:environment");
    return status.testMode === true && status.keyIdConfigured === true;
  });
  check("component environment loaded", environmentReady === true);

  const runId = randomBytes(6).toString("hex");
  const userId = `smoke-${runId}`;

  console.log("2. Creating test-mode entities and reading mirrored state...");
  const setup = run("smoke:setup", { userId, runId });
  check("customer getOrCreate", setup.customerId.startsWith("cust_"));
  check("customer getOrCreate is stable", setup.sameCustomerOnRetry === true);
  check("order created in test mode", setup.orderId.startsWith("order_") && setup.amount === 50000);
  check("plan created", setup.planId.startsWith("plan_"));
  check("subscription created", setup.subscriptionId.startsWith("sub_"));
  check("checkout options use configured key", setup.checkoutKeyIdPresent === true);
  const before = run("smoke:state", { userId, orderId: setup.orderId });
  check("customer mirror readable", before.customer?.razorpayId === setup.customerId);
  check(
    "order mirror readable",
    before.order?.status === "created" && before.order.amount === 50000,
  );
  check("subscription mirror readable", before.subscription?.razorpayId === setup.subscriptionId);
  check("no payments before the webhook", before.payments.length === 0);

  // c. Webhook end to end (payment.captured arrives before the app verifies the callback).
  const paymentId = `pay_${randomBytes(7).toString("hex")}`;
  const capturedBody = envelope(runId, {
    id: paymentId,
    entity: "payment",
    amount: setup.amount,
    currency: "INR",
    status: "captured",
    captured: true,
    order_id: setup.orderId,
    method: "upi",
  });
  const hook = `${await siteUrl()}/razorpay/webhook`;
  const eventId = `evt_${runId}_1`;
  const sign = (body) => ({
    "content-type": "application/json",
    "x-razorpay-signature": hmac(webhookSecret, body),
  });
  const countFor = (id) => run("smoke:notificationCount", { eventId: id });

  check(
    "webhook: signed payment.captured returns 200",
    (await post(hook, capturedBody, { ...sign(capturedBody), "x-razorpay-event-id": eventId })) ===
      200,
  );
  const afterHook = run("smoke:state", { userId, orderId: setup.orderId });
  check(
    "webhook: payment mirror is captured",
    afterHook.payments.length === 1 &&
      afterHook.payments[0].razorpayId === paymentId &&
      afterHook.payments[0].status === "captured",
  );
  check("webhook: onEvent callback ran once", countFor(eventId) === 1);

  const replayId = `evt_${runId}_2`;
  check(
    "webhook: replay with a new event id returns 200",
    (await post(hook, capturedBody, { ...sign(capturedBody), "x-razorpay-event-id": replayId })) ===
      200,
  );
  check("webhook: replay did not run the callback", countFor(replayId) === 0);
  check("webhook: original callback count unchanged", countFor(eventId) === 1);
  check(
    "webhook: replay with the same event id returns 200",
    (await post(hook, capturedBody, { ...sign(capturedBody), "x-razorpay-event-id": eventId })) ===
      200,
  );
  check("webhook: same-id replay did not rerun the callback", countFor(eventId) === 1);

  const badId = `evt_${runId}_bad`;
  check(
    "webhook: bad signature returns 401",
    (await post(hook, envelope(`bad-${runId}`, {}), {
      "content-type": "application/json",
      "x-razorpay-signature": "0".repeat(64),
      "x-razorpay-event-id": badId,
    })) === 401,
  );
  check("webhook: bad signature ran no callback", countFor(badId) === 0);

  const oversizedId = `evt_${runId}_oversized`;
  const oversized = "x".repeat(200_000);
  check(
    "webhook: oversized body returns 413",
    (await post(hook, oversized, { ...sign(oversized), "x-razorpay-event-id": oversizedId })) ===
      413,
  );
  check("webhook: oversized body ran no callback", countFor(oversizedId) === 0);

  const undecodableId = `evt_${runId}_undecodable`;
  const undecodable = Uint8Array.of(0xff, 0xfe, 0xff);
  check(
    "webhook: undecodable body returns 400",
    (await post(hook, undecodable, {
      "content-type": "application/json",
      "x-razorpay-signature": createHmac("sha256", webhookSecret).update(undecodable).digest("hex"),
      "x-razorpay-event-id": undecodableId,
    })) === 400,
  );
  check("webhook: undecodable body ran no callback", countFor(undecodableId) === 0);

  const malformedId = `evt_${runId}_malformed`;
  const malformed = envelope(`malformed-${runId}`, {
    id: `pay_${randomBytes(7).toString("hex")}`,
    entity: "payment",
    amount: -5,
    currency: "INR",
    status: "captured",
  });
  check(
    "webhook: signed malformed entity returns 200 (recorded failed)",
    (await post(hook, malformed, { ...sign(malformed), "x-razorpay-event-id": malformedId })) ===
      200,
  );
  check("webhook: malformed entity ran no callback", countFor(malformedId) === 0);

  const oddPaymentId = `pay_${randomBytes(7).toString("hex")}`;
  const oddId = `evt_${runId}_odd`;
  const odd = envelope(`odd-${runId}`, {
    id: oddPaymentId,
    entity: "payment",
    amount: setup.amount,
    currency: "INR",
    status: "mystery",
    order_id: setup.orderId,
  });
  check(
    "webhook: signed unexpected status returns 200",
    (await post(hook, odd, { ...sign(odd), "x-razorpay-event-id": oddId })) === 200,
  );
  const afterOdd = run("smoke:state", { userId, orderId: setup.orderId });
  check(
    "webhook: unexpected status is stored as unknown, never captured",
    afterOdd.payments.find((p) => p.razorpayId === oddPaymentId)?.status === "unknown",
  );

  // b. Checkout verification (test mode confirms against the mirrored payment, no Razorpay call).
  const signature = hmac(keySecret, `${setup.orderId}|${paymentId}`);
  const verify = (sig, user = userId) =>
    run("smoke:verifyCheckout", {
      orderId: setup.orderId,
      paymentId,
      signature: sig,
      userId: user,
    });
  const tampered = verify(signature.replace(/.$/, signature.endsWith("0") ? "1" : "0"));
  check("verifyCheckout: tampered signature fails", tampered.ok === false, tampered.error);
  check("verifyCheckout: another user fails", verify(signature, "someone-else").ok === false);
  const verified = verify(signature);
  check(
    "verifyCheckout: valid signature succeeds",
    verified.ok === true && verified.verified,
    verified.error,
  );
  const final = run("smoke:state", { userId, orderId: setup.orderId });
  check(
    "verifyCheckout: payment mirror marked verified",
    final.payments.find((p) => p.razorpayId === paymentId)?.verified === true,
  );

  console.log("3. Refunding, changing a subscription, paging, and cleaning up...");
  const refund = run("smoke:refund", { paymentId, runId });
  check(
    "refund: test-mode refund created",
    refund.refundId.startsWith("rfnd_") && refund.amount === 20000,
  );
  check("refund: keyed retry reused the result", refund.stableOnRetry === true);
  check("refund: over-refund rejected with structured error", refund.overRefundRejected === true);

  const subscriptionEventId = `evt_${runId}_subscription`;
  const subscriptionBody = JSON.stringify({
    entity: "event",
    account_id: "acc_smoke",
    event: "subscription.activated",
    contains: ["subscription"],
    payload: {
      subscription: {
        entity: {
          id: setup.subscriptionId,
          entity: "subscription",
          plan_id: setup.planId,
          status: "active",
          quantity: 1,
          total_count: 12,
          paid_count: 0,
          remaining_count: 12,
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });
  check(
    "subscription: signed activation webhook returns 200",
    (await post(hook, subscriptionBody, {
      ...sign(subscriptionBody),
      "x-razorpay-event-id": subscriptionEventId,
    })) === 200,
  );
  const changes = run("smoke:changeSubscription", { subscriptionId: setup.subscriptionId });
  check("subscription: pause applies", changes.paused === true);
  check("subscription: resume applies", changes.resumed === true);
  check("subscription: quantity update applies", changes.updated === true);

  const pages = run("smoke:paginate", { runId });
  check(
    "paginated plan list returns distinct pages",
    pages.firstCount === 1 && pages.secondCount === 1 && pages.distinct === true,
  );
  const cleanup = run("smoke:cleanup");
  check("cleanup preserves recent events", cleanup.removedRecent === 0);
  const releasedClaims = runComponent("idempotency:cleanupScheduled");
  check("cleanup preserves recent idempotency claims", releasedClaims === 0);
  const afterCleanup = run("smoke:setup", { userId, runId });
  check(
    "cleanup preserved keyed plan and subscription retries",
    afterCleanup.planId === setup.planId && afterCleanup.subscriptionId === setup.subscriptionId,
  );
  check(
    "cleanup preserved event deduplication",
    (await post(hook, capturedBody, {
      ...sign(capturedBody),
      "x-razorpay-event-id": eventId,
    })) === 200 && countFor(eventId) === 1,
  );
} catch (error) {
  failures.push(`fatal: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await stopDevServer();
  release();
}

console.log("\nSmoke summary");
for (const r of results)
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : ` (${r.detail})`}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed in the real Convex runtime.`);
