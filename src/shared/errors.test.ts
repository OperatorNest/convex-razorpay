import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  classifyProviderError,
  getOrThrow,
  isDefinitiveNoCreate,
  isRazorpayError,
  providerErrorCode,
  razorpayError,
  retryableStatus,
} from "./errors.js";

describe("unified Razorpay errors", () => {
  test("factory emits only structured, prefixed ConvexError data", () => {
    const error = razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid amount");
    expect(error).toBeInstanceOf(ConvexError);
    expect(error.data).toEqual({ code: "RAZORPAY_INVALID_ARGUMENT", message: "Invalid amount" });
    expect(razorpayError("RAZORPAY_NETWORK_ERROR", "Connection failed", true).data).toEqual({
      code: "RAZORPAY_NETWORK_ERROR",
      message: "Connection failed",
      retryable: true,
    });
    expect(isRazorpayError(error)).toBe(true);
    expect(isRazorpayError(razorpayError("RAZORPAY_HTTP_ERROR", "Unavailable", false))).toBe(true);
  });

  test("guard rejects malformed and non-Razorpay errors", () => {
    for (const value of [
      null,
      {},
      new Error("bad"),
      new ConvexError({ code: "OTHER", message: "bad" }),
      new ConvexError({ code: "RAZORPAY_NOT_FOUND", message: 1 }),
      new ConvexError({ code: "RAZORPAY_NOT_FOUND", message: "bad", retryable: "yes" }),
    ]) {
      expect(isRazorpayError(value)).toBe(false);
    }
  });

  test("provider code and definitive classification use the structured data", () => {
    expect(providerErrorCode(razorpayError("RAZORPAY_NOT_FOUND", "Missing"))).toBe(
      "RAZORPAY_NOT_FOUND",
    );
    expect(providerErrorCode(new Error("unknown"))).toBe("RAZORPAY_HTTP_ERROR");
    expect(isDefinitiveNoCreate(razorpayError("RAZORPAY_PROVIDER_REJECTED", "Rejected"))).toBe(
      true,
    );
    expect(isDefinitiveNoCreate(razorpayError("RAZORPAY_HTTP_ERROR", "Unavailable"))).toBe(false);
  });

  test("getOrThrow preserves values and rejects absence with a code", () => {
    expect(getOrThrow(0, "missing")).toBe(0);
    expect(getOrThrow(false, "missing")).toBe(false);
    for (const absent of [null, undefined]) {
      expect(() => getOrThrow(absent, "Missing provider field")).toThrowError(
        expect.objectContaining({
          data: { code: "RAZORPAY_INVALID_RESPONSE", message: "Missing provider field" },
        }),
      );
    }
  });
});

describe("provider error classification", () => {
  test.each([429, 500, 502, 503, 504])("HTTP %i only retries idempotent calls", (status) => {
    expect(retryableStatus(status, true)).toBe(true);
    expect(retryableStatus(status, false)).toBe(false);
  });

  test("refund conflict and concurrent operation retry under guard", () => {
    expect(retryableStatus(409, true, "", true)).toBe(true);
    expect(retryableStatus(409, true, "", false)).toBe(false);
    expect(retryableStatus(400, true, "Concurrent operation in progress")).toBe(true);
    expect(retryableStatus(400, false, "Concurrent operation in progress")).toBe(false);
  });

  test("validation, auth, and missing objects are permanent", () => {
    for (const status of [400, 401, 404]) expect(retryableStatus(status, true)).toBe(false);
  });

  test("provider fields become a sanitized message and classified code", () => {
    expect(
      classifyProviderError(
        502,
        { error: { code: "FUTURE_ERROR", description: "Temporary failure", source: "new_source" } },
        true,
      ),
    ).toEqual({
      code: "RAZORPAY_HTTP_ERROR",
      message: "Temporary failure",
      retryable: true,
    });
    expect(classifyProviderError(400, { error: { description: "Invalid amount" } }, true)).toEqual({
      code: "RAZORPAY_PROVIDER_REJECTED",
      message: "Invalid amount",
      retryable: false,
    });
    expect(
      classifyProviderError(409, { error: { description: "Conflict" } }, true, true).retryable,
    ).toBe(true);
  });

  test("malformed provider error has a safe fallback", () => {
    expect(classifyProviderError(503, {}, false)).toEqual({
      code: "RAZORPAY_HTTP_ERROR",
      message: "Razorpay request failed (503)",
      retryable: false,
    });
    expect(classifyProviderError(400, { error: { description: "" } }, false).message).toBe(
      "Razorpay request failed (400)",
    );
  });
});
