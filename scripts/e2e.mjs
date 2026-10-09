// Interactive, maintainer-only Razorpay test-dashboard verification.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireLock } from "./with-local-lock.mjs";
import { applyE2eEnv, readE2eEnv, validateE2eEnv } from "./e2e-env.mjs";
import { fixtureFor, writeFixture } from "./e2e-fixtures.mjs";
import { stopChild } from "./e2e-process.mjs";

const WEBHOOK_PATH = "/razorpay/e2e/webhook";
const EVENTS = new Set([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.created",
  "refund.processed",
  "refund.failed",
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.completed",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.paused",
  "subscription.resumed",
]);
const args = process.argv.slice(2);
let dryRun = false;
let waitMinutes = 10;
let waitSeen = false;
let badArgs = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--dry-run" && !dryRun) dryRun = true;
  else if (arg === "--wait" && !waitSeen) {
    waitSeen = true;
    waitMinutes = Number(args[++index]);
  } else badArgs = true;
}
if (badArgs || !Number.isFinite(waitMinutes) || waitMinutes <= 0 || waitMinutes > 120) {
  console.error("Usage: pnpm e2e [--dry-run] [--wait <minutes (0-120)>]");
  process.exit(2);
}

const config = readE2eEnv();
const problems = validateE2eEnv(config);
if (dryRun) {
  console.log("End-to-end verification dry run (no network calls or local deployment changes)");
  console.log(
    "Required .env.e2e names: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET",
  );
  console.log(`Missing or invalid: ${problems.length ? problems.join(", ") : "none"}`);
  console.log(
    "Plan: shared lock → build → anonymous local Convex dev → apply env and force provider API mode → Cloudflare quick tunnel → dashboard webhook → provider calls → local Checkout.js payment → webhook/callback/dedupe assertions → redacted fixtures and observed docs → cleanup.",
  );
  process.exitCode = problems.length ? 1 : 0;
} else {
  if (problems.length) throw new Error(`Missing or invalid .env.e2e: ${problems.join(", ")}`);
  await main();
}

function cli(functionName, value = {}, component = false) {
  const command = ["exec", "convex", "run", functionName, JSON.stringify(value)];
  if (component) command.push("--component", "razorpay");
  const result = spawnSync("pnpm", command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${functionName} failed (Convex CLI exit ${result.status})`);
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`${functionName} returned invalid JSON`);
  }
}

function setEnv(name, value) {
  const result = spawnSync("pnpm", ["exec", "convex", "env", "set", name], {
    input: value,
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  if (result.status !== 0) throw new Error(`Could not set ${name}`);
}

function removeEnv(name) {
  const result = spawnSync("pnpm", ["exec", "convex", "env", "remove", name], {
    stdio: "ignore",
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  return result.status === 0;
}

function localEnv(name) {
  const raw = readFileSync(".env.local", "utf8");
  return raw
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim();
}

function checkLocal() {
  if (!localEnv("CONVEX_DEPLOYMENT")?.startsWith("anonymous:"))
    throw new Error(
      "End-to-end verification requires this repo's existing anonymous local deployment",
    );
  const url = localEnv("CONVEX_SITE_URL");
  if (!url || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(url))
    throw new Error("CONVEX_SITE_URL must be a loopback URL in .env.local");
  return url;
}

function startDev(register) {
  const child = spawn("pnpm", ["exec", "convex", "dev", "--tail-logs", "disable"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
  register(child);
  return new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error("convex dev did not become ready")), 180_000);
    const consume = (chunk) => {
      tail = (tail + chunk.toString()).slice(-4096);
      if (tail.includes("Convex functions ready")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("convex dev exited before readiness"));
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not start convex dev"));
    });
  });
}

function startTunnel(siteUrl, register) {
  const binary = spawnSync("which", ["cloudflared"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const command =
    binary.status === 0 ? binary.stdout.trim() : join(process.env.HOME, ".local/bin/cloudflared");
  const child = spawn(command, ["tunnel", "--url", siteUrl], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  register(child);
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Quick tunnel URL did not become ready")),
      90_000,
    );
    const consume = (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (url) {
        clearTimeout(timer);
        resolve({ child, url: url[0] });
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("cloudflared exited before publishing a URL"));
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not start cloudflared"));
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

function boundedBody(request, limit = 200_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error("Body exceeded e2e verifier limit"));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function signatureValid(body, signature, secret) {
  if (typeof signature !== "string" || !/^[\da-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function recorder(secret, token, deliveries) {
  return createServer(async (request, response) => {
    if (request.url !== `/${token}` || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await boundedBody(request);
      const headers = request.headers;
      const signature = headers["x-razorpay-signature"];
      const verified = signatureValid(body, signature, secret);
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        parsed = null;
      }
      const eventId =
        typeof headers["x-razorpay-event-id"] === "string" ? headers["x-razorpay-event-id"] : null;
      const forwardStatus = Number(headers["x-e2e-forward-status"]);
      const safeEvent =
        typeof parsed?.event === "string" && EVENTS.has(parsed.event) ? parsed.event : "unknown";
      const date = new Date().toISOString().slice(0, 10);
      const fixture = fixtureFor(body.toString("utf8"), headers, forwardStatus, date);
      fixture.verified = verified;
      const fixturePath = writeFixture(fixture, safeEvent, date);
      deliveries.push({
        body,
        headers,
        eventId,
        verified,
        forwardStatus,
        event: safeEvent,
        fixturePath,
        fixture,
        paymentId: parsed?.payload?.payment?.entity?.id,
        orderId: parsed?.payload?.order?.entity?.id ?? parsed?.payload?.payment?.entity?.order_id,
        refundId: parsed?.payload?.refund?.entity?.id,
      });
      response.writeHead(204).end();
    } catch {
      response.writeHead(400).end();
    }
  });
}

function checkoutServer(onCheckout, orderId, token) {
  return createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response
        .writeHead(204, {
          "access-control-allow-origin": "null",
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": "content-type",
        })
        .end();
      return;
    }
    if (request.url === `/checkout/${token}` && request.method === "POST") {
      try {
        const body = await boundedBody(request, 10_000);
        const data = JSON.parse(body.toString("utf8"));
        if (
          data.razorpay_order_id !== orderId ||
          typeof data.razorpay_payment_id !== "string" ||
          !/^pay_[A-Za-z0-9]+$/.test(data.razorpay_payment_id) ||
          typeof data.razorpay_signature !== "string" ||
          !/^[\da-f]{64}$/i.test(data.razorpay_signature)
        )
          throw new Error("Invalid Checkout.js response");
        onCheckout(data);
        response.writeHead(204, { "access-control-allow-origin": "null" }).end();
      } catch {
        response.writeHead(400, { "access-control-allow-origin": "null" }).end();
      }
      return;
    }
    response.writeHead(404).end();
  });
}

function checkoutHtml(options, port, token) {
  const safe = JSON.stringify(options).replaceAll("<", "\\u003c");
  return `<!doctype html><meta charset="utf-8"><title>Razorpay local verification</title>
<h1>Razorpay test payment</h1><p>Use only a Razorpay documented test card or test UPI VPA.</p>
<button id="pay">Open test Checkout</button><p id="status"></p>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
document.getElementById("pay").onclick = () => {
  const options = ${safe};
  options.handler = async (reply) => {
    const response = await fetch("http://127.0.0.1:${port}/checkout/${token}", {
      method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(reply)
    });
    document.getElementById("status").textContent = response.ok ? "Response received. Return to terminal." : "Local callback failed.";
  };
  new Razorpay(options).open();
};
</script>`;
}

function pass(name, assertion) {
  if (!assertion) {
    console.log(`FAIL  ${name}`);
    throw new Error(`${name} failed`);
  }
  console.log(`PASS  ${name}`);
}

async function until(name, predicate, deadline, signal) {
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Interrupted");
    try {
      const value = await predicate();
      if (value) return value;
    } catch {
      // Provider deliveries and Convex function propagation can lag.
    }
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    process.stdout.write(
      `\rWaiting for ${name}: ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s  `,
    );
    await sleep(1000, undefined, { signal });
  }
  process.stdout.write("\n");
  throw new Error(`Timed out waiting for ${name}`);
}

function printWebhook(url) {
  const lines = [
    "Razorpay Dashboard → Test Mode → Webhooks",
    `URL: ${url}${WEBHOOK_PATH}`,
    "Secret: use the value already in .env.e2e as RAZORPAY_WEBHOOK_SECRET",
    "Enable payment.authorized, payment.captured, payment.failed, order.paid",
    "       refund.created, refund.processed, refund.failed",
    "       subscription.*: authenticated, activated, charged, completed,",
    "       updated, pending, halted, cancelled, paused, resumed",
  ];
  const width = Math.max(...lines.map((line) => line.length));
  console.log(`\n┌${"─".repeat(width + 2)}┐`);
  for (const line of lines) console.log(`│ ${line.padEnd(width)} │`);
  console.log(`└${"─".repeat(width + 2)}┘\n`);
}

function writeObservedDocs(deliveries, subscription, refund) {
  const date = new Date().toISOString().slice(0, 10);
  const events = [...new Set(deliveries.map((delivery) => delivery.event))].toSorted((a, b) =>
    a.localeCompare(b),
  );
  const eventIds = deliveries.map((delivery) => Boolean(delivery.eventId));
  const envelopeCount = deliveries.filter((delivery) => {
    try {
      const body = JSON.parse(delivery.body.toString("utf8"));
      return (
        body?.entity === "event" &&
        typeof body?.event === "string" &&
        typeof body?.payload === "object" &&
        Array.isArray(body?.contains)
      );
    } catch {
      return false;
    }
  }).length;
  const lines = [
    `> Provider test account observations from ${date}; these do not qualify production behavior.`,
    "",
    `# Razorpay Test Mode e2e verification — ${date}`,
    "",
    "Observed against the real Razorpay API using test keys and the anonymous local Convex deployment. This is a dated run, not a production qualification. See the redacted payload fixtures in this directory.",
    "",
    `- Received and verified ${deliveries.length} webhook deliveries: ${events.join(", ")}.`,
    `- x-razorpay-event-id was present in ${eventIds.filter(Boolean).length}/${eventIds.length} deliveries.`,
    `- ${envelopeCount}/${deliveries.length} received bodies had the event envelope with entity, event, contains, and payload.`,
    "- A Checkout.js test payment reached captured state without an explicit capture API call during this run. This observes this account's capture setting, not the general capture window.",
    `- The refund create call returned status \`${String(refund.status).replace(/[^a-z_]/g, "")}\`; a \`refund.processed\` webhook was received and applied.`,
    subscription
      ? `- Cancellation with \`cancelAtCycleEnd: true\` returned status \`${String(subscription.status).replace(/[^a-z_]/g, "")}\`. The built component sends numeric \`1\` for this option (source inspection), so this run shows that the API accepted the numeric form. Boolean acceptance and eventual cancellation timing were not observed.`
      : "- Cycle-end cancellation was attempted but not accepted in this run. Numeric and Boolean provider acceptance and eventual behavior remain unqualified.",
    "- Each recorded delivery passed local HMAC verification, component receipt and callback assertions. Event-id checks used a locally re-signed whitespace variant of the observed JSON body, and body-hash checks used an identical body with an alternate event ID. These replays were generated locally and were not provider deliveries.",
    "",
  ];
  const report = `tests/fixtures/e2e/verification-${date}.md`;
  mkdirSync("tests/fixtures/e2e", { recursive: true });
  writeFileSync(report, lines.join("\n"));
  const readmePath = "README.md";
  const readme = readFileSync(readmePath, "utf8");
  const next = readme.replace(
    /^Built against:?.*$/m,
    `Built against Razorpay's official API documentation and \`razorpay-node\` v2.9.8 behavior. A [${date} Razorpay Test Mode end-to-end run](${report}) observed payment capture, refund processing, and verified webhooks. Production account behavior and other provider limits remain unconfirmed.`,
  );
  writeFileSync(readmePath, next);
  console.log(`PASS  observed findings recorded in ${report} and README.md`);
}

function writePartialObservations(deliveries) {
  const date = new Date().toISOString().slice(0, 10);
  const report = `tests/fixtures/e2e/verification-${date}-partial.md`;
  const events = [...new Set(deliveries.map((delivery) => delivery.event))].toSorted((a, b) =>
    a.localeCompare(b),
  );
  const lines = [
    `> Provider test account observations from ${date}; these do not qualify production behavior.`,
    "",
    `# Partial Razorpay Test Mode observation — ${date}`,
    "",
    "The interactive verification did not complete. These observations are limited to the deliveries captured in redacted fixtures; they do not qualify the full payment and refund flow.",
    "",
    `- Received ${deliveries.length} deliveries with event types: ${events.join(", ")}.`,
    `- x-razorpay-event-id was present in ${deliveries.filter((delivery) => delivery.eventId).length}/${deliveries.length} deliveries.`,
    `- Local HMAC verification passed for ${deliveries.filter((delivery) => delivery.verified).length}/${deliveries.length} deliveries.`,
    `- Normal webhook forwarding returned HTTP 200 for ${deliveries.filter((delivery) => delivery.forwardStatus === 200).length}/${deliveries.length} deliveries.`,
    `- Component metadata confirmed processed status for ${deliveries.filter((delivery) => delivery.fixture.ingestStatus === "processed").length}/${deliveries.length} deliveries.`,
    "",
  ];
  mkdirSync("tests/fixtures/e2e", { recursive: true });
  writeFileSync(report, lines.join("\n"));
  console.log(`PASS  partial observed findings recorded in ${report}`);
}

function receipt(delivery) {
  const bodyHash = createHash("sha256").update(delivery.body).digest("hex");
  return cli("webhooks:e2eReceipt", { eventId: delivery.eventId ?? "", bodyHash }, true);
}

async function verifyDelivery(delivery, siteUrl, webhookSecret) {
  pass(`${delivery.event} signature verified`, delivery.verified);
  pass(`${delivery.event} endpoint accepted`, delivery.forwardStatus === 200);
  const first = receipt(delivery);
  delivery.fixture.ingestStatus = first.byBodyHash?.status ?? null;
  writeFileSync(delivery.fixturePath, `${JSON.stringify(delivery.fixture, null, 2)}\n`);
  pass(`${delivery.event} applied once`, first.byBodyHash?.status === "processed");
  const callbackId = first.byBodyHash.eventId;
  const count = cli("e2e:notificationCount", { eventId: callbackId });
  pass(`${delivery.event} onEvent callback`, count === 1);
  if (delivery.eventId && delivery.eventId !== callbackId)
    pass(
      `${delivery.event} duplicate delivery callback suppressed`,
      cli("e2e:notificationCount", { eventId: delivery.eventId }) === 0,
    );
  const headers = {
    "content-type": "application/json",
    "x-razorpay-signature": delivery.headers["x-razorpay-signature"],
    ...(delivery.eventId ? { "x-razorpay-event-id": delivery.eventId } : {}),
  };
  const replay = await fetch(`${siteUrl}/razorpay/webhook`, {
    method: "POST",
    body: delivery.body,
    headers,
  });
  pass(`${delivery.event} event-id replay accepted`, replay.status === 200);
  pass(
    `${delivery.event} event-id deduplicated`,
    cli("e2e:notificationCount", { eventId: callbackId }) === 1,
  );
  const variantBody = Buffer.concat([delivery.body, Buffer.from(" ")]);
  const variantHash = createHash("sha256").update(variantBody).digest("hex");
  const variantSignature = createHmac("sha256", webhookSecret).update(variantBody).digest("hex");
  const variant = await fetch(`${siteUrl}/razorpay/webhook`, {
    method: "POST",
    body: variantBody,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": variantSignature,
      "x-razorpay-event-id": callbackId,
    },
  });
  pass(`${delivery.event} changed-body event-id replay accepted`, variant.status === 200);
  const variantReceipt = cli(
    "webhooks:e2eReceipt",
    { eventId: callbackId, bodyHash: variantHash },
    true,
  );
  pass(
    `${delivery.event} event-id deduplicated independently`,
    variantReceipt.byEventId?._id === first.byBodyHash._id &&
      variantReceipt.byBodyHash === null &&
      cli("e2e:notificationCount", { eventId: callbackId }) === 1,
  );
  const alternateId = `evt_e2e_${randomBytes(8).toString("hex")}`;
  const other = await fetch(`${siteUrl}/razorpay/webhook`, {
    method: "POST",
    body: delivery.body,
    headers: { ...headers, "x-razorpay-event-id": alternateId },
  });
  pass(`${delivery.event} body-hash replay accepted`, other.status === 200);
  const alternateReceipt = cli(
    "webhooks:e2eReceipt",
    { eventId: alternateId, bodyHash: createHash("sha256").update(delivery.body).digest("hex") },
    true,
  );
  pass(
    `${delivery.event} body-hash deduplicated`,
    alternateReceipt.byEventId === null &&
      alternateReceipt.byBodyHash?._id === first.byBodyHash._id &&
      cli("e2e:notificationCount", { eventId: callbackId }) === 1 &&
      cli("e2e:notificationCount", { eventId: alternateId }) === 0,
  );
  const after = receipt(delivery);
  pass(`${delivery.event} receipt stable`, after.byBodyHash?._id === first.byBodyHash?._id);
}

async function main() {
  let release;
  let dev;
  let tunnel;
  let tunnelChild;
  let recordServer;
  let paymentServer;
  let tempDir;
  let recorderSet = false;
  let cancelFailure = false;
  let completed = false;
  let interrupted = false;
  const controller = new AbortController();
  const onSignal = () => {
    interrupted = true;
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const aborted = new Promise((_, reject) =>
    controller.signal.addEventListener("abort", () => reject(new Error("Interrupted")), {
      once: true,
    }),
  );
  const abortable = (promise) => Promise.race([promise, aborted]);
  const deliveries = [];
  try {
    console.log("Acquiring shared local Convex lock...");
    const locking = acquireLock().then((unlock) => {
      if (controller.signal.aborted) unlock();
      return unlock;
    });
    release = await abortable(locking);
    console.log("Building package...");
    execFileSync("pnpm", ["build"], { stdio: "ignore" });
    const siteUrl = checkLocal();
    await abortable(
      startDev((child) => {
        dev = child;
      }),
    );
    applyE2eEnv(config);
    const env = cli("e2e:environment");
    pass(
      "component is in provider API mode",
      env.testMode === false && env.keyIdConfigured && env.testKey,
    );

    const token = randomBytes(24).toString("hex");
    recordServer = recorder(config.entries.get("RAZORPAY_WEBHOOK_SECRET"), token, deliveries);
    const recordPort = await listen(recordServer);
    recorderSet = true;
    setEnv("E2E_RECORDER_URL", `http://127.0.0.1:${recordPort}/${token}`);
    tunnel = await abortable(
      startTunnel(siteUrl, (child) => {
        tunnelChild = child;
      }),
    );
    printWebhook(tunnel.url);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await prompt.question(
        "Press Enter after the maintainer saves this Test Mode webhook and enables those events: ",
        { signal: controller.signal },
      );
    } finally {
      prompt.close();
    }
    if (interrupted) throw new Error("Interrupted");

    const runId = randomBytes(6).toString("hex");
    const setup = cli("e2e:setup", { runId });
    pass(
      "customers.getOrCreate",
      typeof setup.customerId === "string" && setup.customerId.startsWith("cust_"),
    );
    pass("orders.create", typeof setup.orderId === "string" && setup.orderId.startsWith("order_"));
    pass("plans.create", typeof setup.planId === "string" && setup.planId.startsWith("plan_"));
    pass(
      "subscriptions.create",
      typeof setup.subscriptionId === "string" && setup.subscriptionId.startsWith("sub_"),
    );
    const fetched = cli("e2e:fetches", {
      orderId: setup.orderId,
      planId: setup.planId,
      subscriptionId: setup.subscriptionId,
    });
    pass("orders.fetch", fetched.orderId === setup.orderId);
    pass("plans.fetch", fetched.planId === setup.planId);
    pass("subscriptions.fetch", fetched.subscriptionId === setup.subscriptionId);
    let cancelled;
    try {
      cancelled = cli("e2e:cancelSubscription", { subscriptionId: setup.subscriptionId });
      pass(
        "subscriptions.cancel at cycle end API response",
        cancelled.subscriptionId === setup.subscriptionId && typeof cancelled.status === "string",
      );
    } catch {
      cancelFailure = true;
      console.log("FAIL  subscriptions.cancel at cycle end (continuing payment flow)");
    }
    const before = cli("e2e:paymentsForOrder", { orderId: setup.orderId });
    pass("orders.fetchPayments", Array.isArray(before));

    let checkoutReply;
    const checkoutToken = randomBytes(24).toString("hex");
    paymentServer = checkoutServer(
      (reply) => {
        checkoutReply = reply;
      },
      setup.orderId,
      checkoutToken,
    );
    const checkoutPort = await listen(paymentServer);
    tempDir = mkdtempSync(join(tmpdir(), "razorpay-e2e-"));
    const page = join(tempDir, "checkout.html");
    writeFileSync(page, checkoutHtml(setup.checkoutOptions, checkoutPort, checkoutToken), {
      mode: 0o600,
    });
    console.log("Opening local Checkout.js page. Razorpay's documented test inputs:");
    console.log("Visa debit 4100 2800 0000 1007, future expiry, any CVV; UPI success@razorpay.");
    console.log("Use failure@razorpay only to exercise a failure path. Check current guidance:");
    console.log("https://razorpay.com/docs/payments/payments/test-card-details/");
    console.log("https://razorpay.com/docs/payments/payments/test-upi-details/");
    const opened = spawnSync("open", [page], { stdio: "ignore" });
    pass("local checkout page opened", opened.status === 0);
    const deadline = Date.now() + waitMinutes * 60_000;
    const reply = await until(
      "Checkout.js callback",
      () => checkoutReply,
      deadline,
      controller.signal,
    );
    pass("Checkout.js returned expected order", reply.razorpay_order_id === setup.orderId);
    await until(
      "payment webhook mirror",
      () => {
        const state = cli("e2e:state", { orderId: setup.orderId, eventIds: [] });
        return state.payments.find(
          (payment) =>
            payment.paymentId === reply.razorpay_payment_id &&
            (payment.status === "authorized" || payment.status === "captured"),
        );
      },
      deadline,
      controller.signal,
    );
    const verify = cli("e2e:verifyCheckout", {
      orderId: setup.orderId,
      paymentId: reply.razorpay_payment_id,
      signature: reply.razorpay_signature,
    });
    pass(
      "checkout signature verified through client",
      verify === true || verify?.verified === true,
    );
    await until(
      "payment.captured webhook",
      () =>
        deliveries.find(
          (d) =>
            d.event === "payment.captured" &&
            d.paymentId === reply.razorpay_payment_id &&
            d.orderId === setup.orderId,
        ),
      deadline,
      controller.signal,
    );
    const captured = await until(
      "captured payment mirror",
      () => {
        const state = cli("e2e:state", { orderId: setup.orderId, eventIds: [] });
        return state.payments.find(
          (payment) =>
            payment.paymentId === reply.razorpay_payment_id && payment.status === "captured",
        );
      },
      deadline,
      controller.signal,
    );
    pass("payment mirror captured", Boolean(captured));
    const refund = cli("e2e:refund", { paymentId: reply.razorpay_payment_id, runId });
    pass(
      "refund created with idempotency key",
      typeof refund.refundId === "string" && refund.refundId.startsWith("rfnd_"),
    );
    await until(
      "refund.processed webhook",
      () =>
        deliveries.find((d) => d.event === "refund.processed" && d.refundId === refund.refundId),
      deadline,
      controller.signal,
    );
    const refunded = await until(
      "processed refund mirror",
      () => {
        const mirror = cli("refunds:e2eRefund", { refundId: refund.refundId }, true);
        return mirror?.status === "processed" &&
          mirror.paymentId === reply.razorpay_payment_id &&
          mirror.amount === refund.amount &&
          mirror.testMode === false
          ? mirror
          : null;
      },
      deadline,
      controller.signal,
    );
    pass("refund.processed mirror linked to captured payment", Boolean(refunded));
    await until(
      "payment.authorized webhook",
      () =>
        deliveries.find(
          (delivery) =>
            delivery.event === "payment.authorized" &&
            delivery.paymentId === reply.razorpay_payment_id,
        ),
      deadline,
      controller.signal,
    );
    pass(
      "payment.authorized webhook",
      deliveries.some(
        (d) => d.event === "payment.authorized" && d.paymentId === reply.razorpay_payment_id,
      ),
    );
    await until(
      "order.paid webhook",
      () =>
        deliveries.find(
          (delivery) => delivery.event === "order.paid" && delivery.orderId === setup.orderId,
        ),
      deadline,
      controller.signal,
    );
    pass(
      "order.paid webhook",
      deliveries.some((d) => d.event === "order.paid" && d.orderId === setup.orderId),
    );
    const paidOrder = await until(
      "paid order mirror",
      () => {
        const state = cli("e2e:state", { orderId: setup.orderId, eventIds: [] });
        return state.order?.status === "paid" &&
          state.order.amountPaid === state.order.amount &&
          state.order.amountDue === 0
          ? state.order
          : null;
      },
      deadline,
      controller.signal,
    );
    pass("order mirror paid in full", Boolean(paidOrder));
    for (const delivery of deliveries) {
      if (interrupted) throw new Error("Interrupted");
      await verifyDelivery(delivery, siteUrl, config.entries.get("RAZORPAY_WEBHOOK_SECRET"));
      console.log(`PASS  redacted fixture ${delivery.fixturePath}`);
    }
    writeObservedDocs(deliveries, cancelled, refund);
    completed = true;
    console.log("PASS  e2e verification complete");
    if (cancelFailure) process.exitCode = 1;
  } catch (error) {
    console.error(
      `FAIL  ${interrupted ? "interrupted" : error instanceof Error ? error.message : "e2e verification"}`,
    );
    process.exitCode = interrupted ? 130 : 1;
  } finally {
    if (!completed && deliveries.length > 0) {
      try {
        writePartialObservations(deliveries);
      } catch {
        console.error("FAIL  write partial provider observations");
        process.exitCode = 1;
      }
    }
    try {
      if (recorderSet && !removeEnv("E2E_RECORDER_URL")) {
        console.error("FAIL  remove E2E_RECORDER_URL");
        process.exitCode = 1;
      }
    } catch {
      console.error("FAIL  remove E2E_RECORDER_URL");
      process.exitCode = 1;
    } finally {
      try {
        const stopped = await Promise.allSettled([
          stopChild(tunnelChild),
          stopChild(dev),
          paymentServer ? close(paymentServer) : Promise.resolve(),
          recordServer ? close(recordServer) : Promise.resolve(),
        ]);
        if (stopped.some((result) => result.status === "rejected")) {
          console.error("FAIL  stop verifier processes");
          process.exitCode = 1;
        }
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      } finally {
        release?.();
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        if (interrupted) process.exit(130);
      }
    }
  }
}
