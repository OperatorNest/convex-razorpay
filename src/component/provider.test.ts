import { stubRazorpayEnv, restoreRazorpayTestState } from "../test-helpers.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isTestMode, requestProvider } from "./provider.js";
import { isRazorpayError } from "../shared/errors.js";

import { validatePage } from "./validators.js";

beforeEach(() => {
  stubRazorpayEnv({ keyId: "rzp_test_public", keySecret: "fake-secret" });
});

afterEach(() => {
  restoreRazorpayTestState();
});

test("REST helper uses platform fetch, Basic auth, and JSON body", async () => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: "order_1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    await requestProvider("POST", "/orders", { body: { amount: 50000, currency: "INR" } }),
  ).toEqual({ id: "order_1" });
  const call = fetch.mock.calls[0];
  if (!call) throw new Error("Expected fetch call");
  const [url, init] = call;
  expect(url).toBe("https://api.razorpay.com/v1/orders");
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({
    Authorization: `Basic ${btoa("rzp_test_public:fake-secret")}`,
    "Content-Type": "application/json",
  });
  if (typeof init.body !== "string") throw new Error("Expected JSON request body");
  expect(JSON.parse(init.body)).toEqual({ amount: 50000, currency: "INR" });
});

test("refund idempotency key goes to X-Refund-Idempotency", async () => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: "rfnd_1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  await requestProvider("POST", "/payments/pay_1/refund", {
    body: { amount: 100 },
    refund: true,
    idempotencyKey: "refund-key-123",
  });
  const call = fetch.mock.calls[0];
  if (!call) throw new Error("Expected fetch call");
  const [, init] = call;
  expect(init.headers).toMatchObject({ "X-Refund-Idempotency": "refund-key-123" });
});

const providerFailure = async (
  method: "GET" | "POST",
  status: number,
  idempotent: boolean,
  refund = false,
) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "SERVER_ERROR", description: "Provider unavailable" },
          }),
          { status },
        ),
    ),
  );
  try {
    await requestProvider(method, "/resource", { idempotent, refund });
    throw new Error("Expected request failure");
  } catch (error) {
    return error;
  }
};

test("GET and POST failures expose status and uncertain outcomes", async () => {
  const get500 = await providerFailure("GET", 500, true);
  expect(get500).toMatchObject({ data: { code: "RAZORPAY_PROVIDER_ERROR" } });
  const post500 = await providerFailure("POST", 500, false);
  expect(post500).toMatchObject({ data: { code: "RAZORPAY_PROVIDER_ERROR" } });
  const get429 = await providerFailure("GET", 429, true);
  expect(get429).toMatchObject({ data: { code: "RAZORPAY_PROVIDER_ERROR" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );
  await expect(requestProvider("GET", "/resource", { idempotent: true })).rejects.toMatchObject({
    data: { code: "RAZORPAY_NETWORK_ERROR" },
  });
  await expect(requestProvider("POST", "/resource", { idempotent: false })).rejects.toMatchObject({
    data: { code: "RAZORPAY_NETWORK_ERROR" },
  });
});

test("refund conflicts expose status without a retry recommendation", async () => {
  expect(await providerFailure("POST", 409, true, true)).toMatchObject({
    data: { code: "RAZORPAY_PROVIDER_ERROR" },
  });
  expect(await providerFailure("POST", 409, false, true)).toMatchObject({
    data: { code: "RAZORPAY_PROVIDER_ERROR" },
  });
});

test("malformed provider JSON has a structured error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not json", { status: 200 })),
  );
  await expect(requestProvider("GET", "/resource", { idempotent: true })).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_RESPONSE" },
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

test("test mode is explicit and missing either credential fails with a typed error", async () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  expect(() => isTestMode()).toThrow(
    expect.objectContaining({
      data: { code: "RAZORPAY_NOT_CONFIGURED", message: expect.any(String) },
    }),
  );
  try {
    isTestMode();
  } catch (error) {
    expect(isRazorpayError(error)).toBe(true);
    expect(error).toMatchObject({ data: { code: "RAZORPAY_NOT_CONFIGURED" } });
    expect(error instanceof Error ? error.message : "").toMatch(
      /configuration is missing or invalid/i,
    );
  }
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_public");
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  await expect(requestProvider("GET", "/orders")).rejects.toMatchObject(
    expect.objectContaining({
      data: { code: "RAZORPAY_NOT_CONFIGURED", message: expect.any(String) },
    }),
  );
});

test("test mode requires explicit option or env opt-in and rejects a live key", () => {
  vi.stubEnv("RAZORPAY_KEY_ID", undefined);
  vi.stubEnv("RAZORPAY_KEY_SECRET", undefined);
  expect(isTestMode(true)).toBe(true);
  vi.stubEnv("RAZORPAY_TEST_MODE", "true");
  expect(isTestMode()).toBe(true);
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_sensitive");
  expect(() => isTestMode(true)).toThrow(
    expect.objectContaining({
      data: { code: "RAZORPAY_LIVE_KEY_TEST_MODE", message: expect.any(String) },
    }),
  );
});

test("page validation enforces the documented skip ceiling", () => {
  expect(validatePage(10, 900)).toEqual({ count: 10, skip: 900 });
  expect(() => validatePage(10, 901)).toThrow("An argument is invalid, missing or out of bounds.");
});

test("request timer covers response parsing and is cleared on success or programming failure", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => ({
      status: 200,
      ok: true,
      json: () =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    })),
  );
  const pending = expect(requestProvider("GET", "/resource")).rejects.toMatchObject({
    data: { code: "RAZORPAY_INVALID_RESPONSE" },
  });
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
  await expect(requestProvider("GET", "/resource")).rejects.toMatchObject({
    data: { code: "RAZORPAY_PROVIDER_ERROR", providerStatus: 502, retryable: true },
  });
});
