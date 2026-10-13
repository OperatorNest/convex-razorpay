import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { runSmoke, step } from "./smoke-harness.mjs";

const ENVIRONMENT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

const hmac = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");

function assertSmoke(condition, detail = "assertion failed") {
  if (!condition) throw new Error(detail);
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

async function postWebhook(url, body, headers) {
  const response = await fetch(url, { method: "POST", body, headers });
  return response.status;
}

function readSiteUrl(workspace) {
  const config = JSON.parse(
    readFileSync(join(workspace, ".convex/local/default/config.json"), "utf8"),
  );
  return `http://127.0.0.1:${config.ports.site}`;
}

await runSmoke(async ({ workspace, runFunction, setEnvironmentVariable }) => {
  const webhookSecret = randomBytes(24).toString("hex");
  const keySecret = randomBytes(24).toString("hex");
  const runId = randomBytes(6).toString("hex");
  const userId = `smoke-${runId}`;
  const runComponent = (name, args) => runFunction(name, args, { component: "razorpay" });
  const readState = (razorpayOrderId) => runFunction("smoke:state", { userId, razorpayOrderId });
  const countFor = (eventId) => runFunction("smoke:notificationCount", { eventId });
  const sign = (body) => ({
    "content-type": "application/json",
    "x-razorpay-signature": hmac(webhookSecret, body),
  });

  await step("component environment simulates test mode without a key ID", async () => {
    await setEnvironmentVariable("RAZORPAY_TEST_MODE", "true");
    await setEnvironmentVariable("RAZORPAY_KEY_SECRET", keySecret);
    await setEnvironmentVariable("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
    const deadline = Date.now() + ENVIRONMENT_TIMEOUT_MS;
    for (;;) {
      const status = await runFunction("smoke:environment");
      if (
        status.testMode === true &&
        status.keyIdConfigured === false &&
        status.keySecretConfigured === true
      )
        return;
      assertSmoke(Date.now() < deadline, `environment not loaded: ${JSON.stringify(status)}`);
      await sleep(POLL_INTERVAL_MS);
    }
  });

  const setup = await runFunction("smoke:setup", { userId, runId });
  await step("customer getOrCreate creates a stable customer", () => {
    assertSmoke(setup.razorpayCustomerId.startsWith("cust_"), setup.razorpayCustomerId);
    assertSmoke(setup.sameCustomerOnRetry === true);
  });
  await step("order, plan and subscription are created in test mode", () => {
    assertSmoke(setup.razorpayOrderId.startsWith("order_") && setup.amount === 50000);
    assertSmoke(setup.razorpayPlanId.startsWith("plan_"));
    assertSmoke(setup.razorpaySubscriptionId.startsWith("sub_"));
  });
  await step("simulated orders omit the Checkout key", () => {
    assertSmoke(setup.checkoutKeyIdOmitted === true);
  });
  await step("customer, order and subscription mirrors are readable", async () => {
    const before = await readState(setup.razorpayOrderId);
    assertSmoke(before.customer?.razorpayCustomerId === setup.razorpayCustomerId);
    assertSmoke(before.order?.status === "created" && before.order.amount === 50000);
    assertSmoke(before.subscription?.razorpaySubscriptionId === setup.razorpaySubscriptionId);
    assertSmoke(before.payments.length === 0, "payments exist before the webhook");
  });

  const hook = `${readSiteUrl(workspace)}/razorpay/webhook`;
  const razorpayPaymentId = `pay_${randomBytes(7).toString("hex")}`;
  const capturedBody = envelope(runId, {
    id: razorpayPaymentId,
    entity: "payment",
    amount: setup.amount,
    currency: "INR",
    status: "captured",
    captured: true,
    order_id: setup.razorpayOrderId,
    method: "upi",
  });
  const eventId = `evt_${runId}_1`;

  await step("signed payment.captured returns 200 and runs onEvent once", async () => {
    const status = await postWebhook(hook, capturedBody, {
      ...sign(capturedBody),
      "x-razorpay-event-id": eventId,
    });
    assertSmoke(status === 200, `status ${status}`);
    const state = await readState(setup.razorpayOrderId);
    assertSmoke(
      state.payments.length === 1 &&
        state.payments[0].razorpayPaymentId === razorpayPaymentId &&
        state.payments[0].status === "captured",
    );
    assertSmoke((await countFor(eventId)) === 1);
  });

  await step("a replayed body or event id returns 200 without another callback", async () => {
    const replayId = `evt_${runId}_2`;
    const replayStatus = await postWebhook(hook, capturedBody, {
      ...sign(capturedBody),
      "x-razorpay-event-id": replayId,
    });
    assertSmoke(replayStatus === 200, `status ${replayStatus}`);
    assertSmoke((await countFor(replayId)) === 0);
    const sameIdStatus = await postWebhook(hook, capturedBody, {
      ...sign(capturedBody),
      "x-razorpay-event-id": eventId,
    });
    assertSmoke(sameIdStatus === 200, `status ${sameIdStatus}`);
    assertSmoke((await countFor(eventId)) === 1);
  });

  await step("a bad signature returns 401 without a callback", async () => {
    const badId = `evt_${runId}_bad`;
    const status = await postWebhook(hook, envelope(`bad-${runId}`, {}), {
      "content-type": "application/json",
      "x-razorpay-signature": "0".repeat(64),
      "x-razorpay-event-id": badId,
    });
    assertSmoke(status === 401, `status ${status}`);
    assertSmoke((await countFor(badId)) === 0);
  });

  await step("an oversized body returns 413 without a callback", async () => {
    const oversizedId = `evt_${runId}_oversized`;
    const oversized = "x".repeat(200_000);
    const status = await postWebhook(hook, oversized, {
      ...sign(oversized),
      "x-razorpay-event-id": oversizedId,
    });
    assertSmoke(status === 413, `status ${status}`);
    assertSmoke((await countFor(oversizedId)) === 0);
  });

  await step("an undecodable body returns 400 without a callback", async () => {
    const undecodableId = `evt_${runId}_undecodable`;
    const undecodable = Uint8Array.of(0xff, 0xfe, 0xff);
    const status = await postWebhook(hook, undecodable, {
      "content-type": "application/json",
      "x-razorpay-signature": createHmac("sha256", webhookSecret).update(undecodable).digest("hex"),
      "x-razorpay-event-id": undecodableId,
    });
    assertSmoke(status === 400, `status ${status}`);
    assertSmoke((await countFor(undecodableId)) === 0);
  });

  await step("a signed malformed entity returns 200 without a callback", async () => {
    const malformedId = `evt_${runId}_malformed`;
    const malformed = envelope(`malformed-${runId}`, {
      id: `pay_${randomBytes(7).toString("hex")}`,
      entity: "payment",
      amount: -5,
      currency: "INR",
      status: "captured",
    });
    const status = await postWebhook(hook, malformed, {
      ...sign(malformed),
      "x-razorpay-event-id": malformedId,
    });
    assertSmoke(status === 200, `status ${status}`);
    assertSmoke((await countFor(malformedId)) === 0);
  });

  await step("a signed unexpected status is stored as unknown", async () => {
    const oddPaymentId = `pay_${randomBytes(7).toString("hex")}`;
    const odd = envelope(`odd-${runId}`, {
      id: oddPaymentId,
      entity: "payment",
      amount: setup.amount,
      currency: "INR",
      status: "mystery",
      order_id: setup.razorpayOrderId,
    });
    const status = await postWebhook(hook, odd, {
      ...sign(odd),
      "x-razorpay-event-id": `evt_${runId}_odd`,
    });
    assertSmoke(status === 200, `status ${status}`);
    const state = await readState(setup.razorpayOrderId);
    assertSmoke(
      state.payments.find((payment) => payment.razorpayPaymentId === oddPaymentId)?.status ===
        "unknown",
    );
  });

  await step("verifyCheckout rejects a tampered signature and another user", async () => {
    const signature = hmac(keySecret, `${setup.razorpayOrderId}|${razorpayPaymentId}`);
    const verify = (candidate, candidateUserId) =>
      runFunction("smoke:verifyCheckout", {
        razorpayOrderId: setup.razorpayOrderId,
        razorpayPaymentId,
        signature: candidate,
        userId: candidateUserId,
      });
    const tampered = await verify(
      signature.replace(/.$/, signature.endsWith("0") ? "1" : "0"),
      userId,
    );
    assertSmoke(tampered.ok === false, "tampered signature verified");
    assertSmoke((await verify(signature, "someone-else")).ok === false, "another user verified");
    const verified = await verify(signature, userId);
    assertSmoke(verified.ok === true && verified.verified, verified.error);
    const state = await readState(setup.razorpayOrderId);
    assertSmoke(
      state.payments.find((payment) => payment.razorpayPaymentId === razorpayPaymentId)
        ?.verified === true,
    );
  });

  await step("a keyed refund retries to one result and an over-refund fails", async () => {
    const refund = await runFunction("smoke:refund", { razorpayPaymentId, runId });
    assertSmoke(refund.razorpayRefundId.startsWith("rfnd_") && refund.amount === 20000);
    assertSmoke(refund.stableOnRetry === true);
    assertSmoke(refund.overRefundRejected === true);
  });

  await step("subscription activation, pause, resume and update apply", async () => {
    const subscriptionBody = JSON.stringify({
      entity: "event",
      account_id: "acc_smoke",
      event: "subscription.activated",
      contains: ["subscription"],
      payload: {
        subscription: {
          entity: {
            id: setup.razorpaySubscriptionId,
            entity: "subscription",
            plan_id: setup.razorpayPlanId,
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
    const status = await postWebhook(hook, subscriptionBody, {
      ...sign(subscriptionBody),
      "x-razorpay-event-id": `evt_${runId}_subscription`,
    });
    assertSmoke(status === 200, `status ${status}`);
    const changes = await runFunction("smoke:changeSubscription", {
      razorpaySubscriptionId: setup.razorpaySubscriptionId,
    });
    assertSmoke(changes.paused === true && changes.resumed === true && changes.updated === true);
  });

  await step("plan, payment and subscription lists return distinct pages", async () => {
    const pages = await runFunction("smoke:paginate", {
      runId,
      userId,
      razorpayOrderId: setup.razorpayOrderId,
    });
    assertSmoke(pages.firstCount === 1 && pages.secondCount === 1 && pages.distinct === true);
    assertSmoke(pages.paymentPages === true && pages.subscriptionPages === true);
  });

  await step("cleanup clamps to the retention window and preserves recent events", async () => {
    const removedCount = await runComponent("webhooks:cleanupScheduled", { before: Date.now() });
    assertSmoke(removedCount === 0, `removed ${removedCount}`);
  });

  await step("completed idempotency claims cannot be released", async () => {
    const isReleased = await runComponent("plans:releaseIdempotency", {
      idempotencyKey: `smoke-plan-${runId}`,
    });
    assertSmoke(isReleased === false);
  });

  await step("cleanup preserves keyed retries and event deduplication", async () => {
    const afterCleanup = await runFunction("smoke:setup", { userId, runId });
    assertSmoke(
      afterCleanup.razorpayPlanId === setup.razorpayPlanId &&
        afterCleanup.razorpaySubscriptionId === setup.razorpaySubscriptionId,
    );
    const status = await postWebhook(hook, capturedBody, {
      ...sign(capturedBody),
      "x-razorpay-event-id": eventId,
    });
    assertSmoke(status === 200 && (await countFor(eventId)) === 1);
  });
});
