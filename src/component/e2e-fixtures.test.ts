import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { hmacSha256Hex, sha256Hex } from "../shared/crypto.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

type Fixture = {
  capturedAt: string;
  headers: Record<string, string | null>;
  body: unknown;
  forwardStatus: number;
  verified?: boolean;
  ingestStatus?: string | null;
};

const fixtures = import.meta.glob<{ default: Fixture }>("../../tests/fixtures/e2e/*.json");
const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.unstubAllEnvs());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("observed Razorpay webhook fixtures", () => {
  test.skipIf(Object.keys(fixtures).length === 0)(
    "redacted real payloads retain event shapes accepted by the component",
    async ({ skip }) => {
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_redacted_fixture_test");
      vi.stubEnv("RAZORPAY_TEST_MODE", "true");
      let exercised = 0;
      for (const [path, load] of Object.entries(fixtures)) {
        const { default: fixture } = await load();
        expect(fixture.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (fixture.verified !== true || fixture.ingestStatus !== "processed") continue;
        expect(fixture.headers["x-razorpay-signature"]).toBe("REDACTED");
        expect(fixture.forwardStatus, path).toBe(200);
        if (!isRecord(fixture.body)) continue;
        exercised += 1;
        const envelope = fixture.body;
        expect(envelope.entity, path).toBe("event");
        expect(typeof envelope.event, path).toBe("string");
        expect(Number.isSafeInteger(envelope.created_at), path).toBe(true);

        const body = JSON.stringify(fixture.body);
        const bodyHash = await sha256Hex(body);
        const eventId = fixture.headers["x-razorpay-event-id"] ? "evt_redacted_fixture" : "";
        const signature = await hmacSha256Hex("whsec_redacted_fixture_test", body);
        const t = convexTest(schema, modules);
        const first = await t.action(api.webhooks.ingest, { body, signature, eventId });
        expect(first.status, path).toBe(fixture.ingestStatus);

        const recordedEventId = eventId || `sha256:${bodyHash}`;
        const receipt = await t.query(internal.webhooks.e2eReceipt, {
          eventId: recordedEventId,
          bodyHash,
        });
        expect(receipt.byEventId?.status, path).toBe("processed");
        expect(receipt.byEventId?.bodyHash, path).toBe(bodyHash);
        expect(receipt.byBodyHash?.event, path).toBe(envelope.event);

        const retryEventId = eventId ? `${eventId}_retry` : "";
        const duplicate = await t.action(api.webhooks.ingest, {
          body,
          signature,
          eventId: retryEventId,
        });
        expect(duplicate.status, path).toBe("duplicate");
        const retryReceipt = await t.query(internal.webhooks.e2eReceipt, {
          eventId: retryEventId || `sha256:${bodyHash}`,
          bodyHash,
        });
        expect(retryReceipt.byBodyHash?.eventId, path).toBe(recordedEventId);
      }
      if (exercised === 0)
        skip("No verified processed end-to-end webhook fixtures are present yet");
    },
  );
});
