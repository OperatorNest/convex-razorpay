import {
  stubRazorpayEnv,
  restoreRazorpayTestState,
  expectRazorpayError,
  expectRazorpayErrorDetails,
  required,
  stubFetch,
} from "../test-helpers.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { requestProvider, resolveProviderMode } from "./provider.js";
import { isRazorpayError } from "../shared/errors.js";

import { validatePage } from "./validators.js";

beforeEach(() => {
  stubRazorpayEnv({ keyId: "rzp_test_public", keySecret: "fake-secret" });
});

afterEach(() => {
  restoreRazorpayTestState();
});

test("REST helper uses platform fetch, Basic auth, and JSON body", async () => {
  const calls = stubFetch(() => new Response(JSON.stringify({ id: "order_1" }), { status: 200 }));
  expect(
    await requestProvider("POST", "/orders", { body: { amount: 50000, currency: "INR" } }),
  ).toEqual({ id: "order_1" });
  const { url, init } = required(calls[0], "fetch call");
  expect(url).toBe("https://api.razorpay.com/v1/orders");
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({
    Authorization: `Basic ${btoa("rzp_test_public:fake-secret")}`,
    "Content-Type": "application/json",
  });
  if (typeof init.body !== "string") throw new Error("Expected JSON request body");
  expect(JSON.parse(init.body)).toEqual({ amount: 50000, currency: "INR" });
});

test("refund idempotency key goes to X-Refund-Idempotency and redirects are not followed", async () => {
  const calls = stubFetch(() => new Response(JSON.stringify({ id: "rfnd_1" }), { status: 200 }));
  await requestProvider("POST", "/payments/pay_1/refund", {
    body: { amount: 100 },
    isDeduplicated: true,
    refundIdempotencyKey: "refund-key-123",
  });
  const { init } = required(calls[0], "fetch call");
  expect(init.headers).toMatchObject({ "X-Refund-Idempotency": "refund-key-123" });
  expect(init.redirect).toBe("manual");
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

const providerFailure = (
  method: "GET" | "POST",
  status: number,
  isDeduplicated: boolean,
  description = "Provider unavailable",
) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "SERVER_ERROR", description } }), {
          status,
        }),
    ),
  );
  return requestProvider(method, "/resource", { isDeduplicated });
};

test("retryable is true only for reads, deduplicated calls and definitive refusals", async () => {
  const cases: [
    method: "GET" | "POST",
    status: number,
    isDeduplicated: boolean,
    retryable: boolean,
  ][] = [
    ["GET", 500, false, true],
    ["GET", 429, false, true],
    ["POST", 500, true, true],
    ["POST", 409, true, true],
    ["POST", 500, false, false],
    ["POST", 409, false, false],
    ["POST", 429, false, false],
    ["POST", 400, false, true],
  ];
  for (const [method, status, isDeduplicated, retryable] of cases)
    await expectRazorpayErrorDetails(
      providerFailure(method, status, isDeduplicated),
      "RAZORPAY_PROVIDER_ERROR",
      { retryable, providerStatus: status },
    );
  await expectRazorpayErrorDetails(
    providerFailure("POST", 400, false, "Concurrent operation in progress"),
    "RAZORPAY_PROVIDER_ERROR",
    { retryable: false, providerStatus: 400 },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );
  for (const [method, isDeduplicated, retryable] of [
    ["GET", false, true],
    ["POST", true, true],
    ["POST", false, false],
  ] as const)
    await expectRazorpayErrorDetails(
      requestProvider(method, "/resource", { isDeduplicated }),
      "RAZORPAY_NETWORK_ERROR",
      { retryable },
    );
});

test("redirects, oversized bodies and malformed provider JSON are invalid responses", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://example.test" } }),
    new Response("not json", { status: 200 }),
    new Response("{}", { status: 200, headers: { "content-length": String(4 * 1024 * 1024 + 1) } }),
    new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 }),
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expectRazorpayError(requestProvider("GET", "/resource"), "RAZORPAY_INVALID_RESPONSE");
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>", { status: 502 })),
  );
  await expectRazorpayErrorDetails(requestProvider("GET", "/resource"), "RAZORPAY_PROVIDER_ERROR", {
    retryable: true,
    providerStatus: 502,
  });
});

test("provider error fields never expose configured credentials", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "BAD_REQUEST_ERROR",
              description: "rzp_test_public fake-secret",
              source: "fake-secret",
              step: "rzp_test_public",
              reason: "fake-secret",
              field: "rzp_test_public",
            },
          }),
          { status: 400 },
        ),
    ),
  );
  try {
    await requestProvider("POST", "/resource", { body: {} });
    throw new Error("Expected request failure");
  } catch (error) {
    const text = JSON.stringify(error);
    expect(text).not.toContain("rzp_test_public");
    expect(text).not.toContain("fake-secret");
  }
});

test("live mode without credentials fails with a typed error", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  await expectRazorpayError(
    Promise.resolve().then(() => resolveProviderMode()),
    "RAZORPAY_NOT_CONFIGURED",
  );
  try {
    resolveProviderMode();
  } catch (error) {
    expect(isRazorpayError(error)).toBe(true);
    expect(error).toMatchObject({ data: { code: "RAZORPAY_NOT_CONFIGURED" } });
    expect(error instanceof Error ? error.message : "").toMatch(
      /configuration is missing or invalid/i,
    );
  }
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  await expectRazorpayError(
    Promise.resolve().then(() => resolveProviderMode()),
    "RAZORPAY_NOT_CONFIGURED",
  );
  await expectRazorpayError(requestProvider("GET", "/orders"), "RAZORPAY_NOT_CONFIGURED");
});

test("test mode simulates only without a key ID and calls Razorpay with rzp_test_ keys", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  expect(resolveProviderMode(true)).toEqual({ testMode: true, isSimulated: true });
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "fake-secret");
  expect(resolveProviderMode()).toEqual({ testMode: true, isSimulated: true });
  vi.stubEnv("RAZORPAY_TEST_MODE", undefined);
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  expect(resolveProviderMode()).toEqual({ testMode: true, isSimulated: false });
  expect(resolveProviderMode(false)).toEqual({ testMode: true, isSimulated: false });
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_sensitive");
  expect(resolveProviderMode()).toEqual({ testMode: false, isSimulated: false });
  await expectRazorpayError(
    Promise.resolve().then(() => resolveProviderMode(true)),
    "RAZORPAY_LIVE_KEY_TEST_MODE",
  );
});

test("page validation enforces the documented skip ceiling", async () => {
  expect(validatePage(10, 900)).toEqual({ count: 10, skip: 900 });
  await expectRazorpayError(
    Promise.resolve().then(() => validatePage(10, 901)),
    "RAZORPAY_INVALID_ARGUMENT",
  );
});

test("request timer covers response parsing and is cleared on success or programming failure", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
                once: true,
              });
            },
          }),
        ),
    ),
  );
  const pending = expectRazorpayError(
    requestProvider("GET", "/resource"),
    "RAZORPAY_INVALID_RESPONSE",
  );
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "ok" }))),
  );
  await expect(requestProvider("POST", "/resource", { body: { value: "ok" } })).resolves.toEqual({
    id: "ok",
  });
  expect(vi.getTimerCount()).toBe(0);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  await expect(requestProvider("POST", "/resource", { body: circular })).rejects.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});

test("a failed provider response with malformed JSON remains a provider error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not json", { status: 502 })),
  );
  await expectRazorpayErrorDetails(requestProvider("GET", "/resource"), "RAZORPAY_PROVIDER_ERROR", {
    providerStatus: 502,
    retryable: true,
  });
});
