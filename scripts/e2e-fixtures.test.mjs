// @vitest-environment node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { fixtureFor, redactWebhook } from "./e2e-fixtures.mjs";
import { validateLocalSelection } from "./e2e-env.mjs";
import { stopChild } from "./e2e-process.mjs";

test("redacts identifiers and arbitrary personal fields without breaking entity links", () => {
  const body = {
    entity: "event",
    event: "payment.captured",
    account_id: "acc_private",
    payload: {
      payment: {
        entity: {
          id: "pay_private",
          order_id: "order_private",
          amount: 50000,
          created_at: 1_781_234_567,
          status: "captured",
          email: "someone@example.com",
          contact: "9999999999",
          card: { last4: "1234", name: "Someone" },
          acquirer_data: { rrn: "123456789012" },
          notes: { "person@example.com": "Someone" },
          mystery: { "someone@example.com": "192.0.2.1" },
        },
      },
      order: { entity: { id: "order_private", amount: 50000 } },
    },
  };
  const redacted = redactWebhook(body);
  assert.equal(redacted.event, "payment.captured");
  assert.equal(redacted.payload.payment.entity.status, "captured");
  assert.equal(redacted.payload.payment.entity.amount, 50000);
  assert.equal(redacted.payload.payment.entity.created_at, 1_700_000_000);
  assert.equal(redacted.payload.payment.entity.order_id, redacted.payload.order.entity.id);
  const text = JSON.stringify(redacted);
  for (const privateValue of [
    "private",
    "someone@example.com",
    "Someone",
    "9999999999",
    "1234",
    "123456789012",
    "192.0.2.1",
  ]) {
    assert.equal(text.includes(privateValue), false);
  }
});

test("a fixture keeps only safe headers and handles malformed bodies", () => {
  const headers = {
    "content-type": "application/json; name=someone@example.com",
    "x-razorpay-event-id": "evt_private",
    "x-razorpay-signature": "0123456789abcdef",
    "x-forwarded-for": "192.0.2.1",
  };
  const valid = fixtureFor(
    '{"entity":"event","event":"payment.captured"}',
    headers,
    200,
    "2026-10-04",
  );
  assert.equal(valid.headers["content-type"], "application/json");
  assert.equal(valid.headers["x-razorpay-event-id"], "evt_REDACTED_1");
  assert.equal(JSON.stringify(valid).includes("192.0.2.1"), false);
  const malformed = fixtureFor("secret@example.com", headers, 400, "2026-10-04");
  assert.equal(malformed.body, "REDACTED_NON_JSON_BODY");
  assert.equal(JSON.stringify(malformed).includes("secret@example.com"), false);
});

test("e2e selection rejects inherited and dotenv overrides by name only", () => {
  const directory = mkdtempSync(join(tmpdir(), "razorpay-e2e-selection-"));
  try {
    writeFileSync(join(directory, ".env.local"), "CONVEX_DEPLOYMENT=anonymous:local\n");
    assert.deepEqual(validateLocalSelection(directory, {}), []);
    const inherited = validateLocalSelection(directory, {
      CONVEX_DEPLOY_KEY: "secret-key",
      CONVEX_DEPLOYMENT_TOKEN: "secret-token",
      CONVEX_DEPLOYMENT: "prod:other",
    });
    assert.deepEqual(inherited, [
      "process environment: CONVEX_DEPLOY_KEY",
      "process environment: CONVEX_DEPLOYMENT_TOKEN",
      "process environment: CONVEX_DEPLOYMENT",
    ]);
    writeFileSync(join(directory, ".env"), "export CONVEX_DEPLOY_KEY=hidden-secret\n");
    writeFileSync(
      join(directory, ".env.local"),
      "CONVEX_DEPLOYMENT=anonymous:local\nCONVEX_SELF_HOSTED_URL=https://private.example\n",
    );
    const dotenv = validateLocalSelection(directory, {});
    assert.deepEqual(dotenv, [".env: CONVEX_DEPLOY_KEY", ".env.local: CONVEX_SELF_HOSTED_URL"]);
    assert.equal(JSON.stringify([inherited, dotenv]).includes("secret-key"), false);
    assert.equal(JSON.stringify([inherited, dotenv]).includes("hidden-secret"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cleanup returns promptly after a child already exited by signal", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  let timer;
  try {
    await once(child, "spawn");
    child.kill("SIGTERM");
    await once(child, "exit");
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, "SIGTERM");
    await Promise.race([
      stopChild(child),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("stopChild hung after signal exit")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
