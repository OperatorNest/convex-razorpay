import { convexTest } from "convex-test";
import { expect, vi } from "vitest";
import schema from "./component/schema.js";
import {
  isRazorpayError,
  type RazorpayErrorCode,
  type RazorpayErrorData,
} from "./shared/errors.js";

// shared-block:begin
type GlobImportMeta = ImportMeta & {
  glob: (patterns: string[]) => Record<string, () => Promise<unknown>>;
};
const modules = (import.meta as GlobImportMeta).glob([
  "./component/**/*.ts",
  "!./component/**/*.test.ts",
]);

export function setupTest() {
  const t = convexTest(schema, modules);
  return t;
}

export type TestCtx = ReturnType<typeof setupTest>;

export async function drain(t: Pick<TestCtx, "finishAllScheduledFunctions">): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}

export type FetchCall = { url: string; init: RequestInit };

export function stubFetch(
  respond: (call: FetchCall, index: number) => Response | Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: input instanceof Request ? input.url : String(input), init };
    calls.push(call);
    return respond(call, calls.length - 1);
  });
  return calls;
}

export async function expectRazorpayError(
  promise: Promise<unknown>,
  code: RazorpayErrorCode,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(isRazorpayError(error), String(error)).toBe(true);
  if (isRazorpayError(error)) expect(error.data.code).toBe(code);
}
// shared-block:end

export async function expectRazorpayErrorDetails(
  promise: Promise<unknown>,
  code: RazorpayErrorCode,
  details: Partial<RazorpayErrorData>,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  await expectRazorpayError(Promise.reject(error), code);
  expect(error).toMatchObject({ data: details });
}

export function stubRazorpayEnv({
  keyId,
  keySecret,
  webhookSecret,
  previousWebhookSecret,
  testMode,
}: {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  previousWebhookSecret?: string;
  testMode?: string;
} = {}): void {
  vi.stubEnv("RAZORPAY_KEY_ID", keyId);
  vi.stubEnv("RAZORPAY_KEY_SECRET", keySecret);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET_PREVIOUS", previousWebhookSecret);
  vi.stubEnv("RAZORPAY_TEST_MODE", testMode);
}

export function stubSimulatedRazorpayEnv(): void {
  stubRazorpayEnv({
    testMode: "true",
    keySecret: "fixture_secret",
    webhookSecret: "fixture_webhook",
  });
}

export function stubLiveRazorpayEnv(): void {
  stubRazorpayEnv({
    keyId: "rzp_live_fixture",
    keySecret: "fixture_secret",
    webhookSecret: "fixture_webhook",
  });
}

export function restoreRazorpayTestState(): void {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string | string[]): Record<string, () => Promise<T>>;
  }
}
