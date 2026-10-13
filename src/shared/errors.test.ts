import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { isRazorpayError, razorpayError } from "./errors.js";
import {
  classifyProviderError,
  getOrThrow,
  isDefinitiveNoCreate,
  providerErrorCode,
} from "./providerErrors.js";

test("error factories select one fixed message per code", () => {
  expect(razorpayError("RAZORPAY_INVALID_ARGUMENT").data).toEqual({
    code: "RAZORPAY_INVALID_ARGUMENT",
    message: "An argument is invalid, missing or out of bounds.",
  });
  expect(isRazorpayError(razorpayError("RAZORPAY_NOT_FOUND"))).toBe(true);
  expect(
    isRazorpayError(
      razorpayError("RAZORPAY_PROVIDER_ERROR", {
        providerStatus: 503,
        providerCode: "SERVER_ERROR",
      }),
    ),
  ).toBe(true);
});

test("the error guard validates every public field and rejects undeclared fields", () => {
  for (const value of [
    null,
    {},
    new Error("invalid"),
    new ConvexError({ code: "OTHER", message: "invalid" }),
    new ConvexError({ code: "RAZORPAY_NOT_FOUND", message: 1 }),
    ...[0, 600, 1.5, "503"].map(
      (providerStatus) =>
        new ConvexError({ code: "RAZORPAY_PROVIDER_ERROR", message: "failure", providerStatus }),
    ),
    ...[1, "x".repeat(65), "\ud800"].map(
      (providerCode) =>
        new ConvexError({ code: "RAZORPAY_PROVIDER_ERROR", message: "failure", providerCode }),
    ),
    new ConvexError({ code: "RAZORPAY_NOT_FOUND", message: "failure", retryable: true }),
  ])
    expect(isRazorpayError(value)).toBe(false);
});

test.each([400, 401, 404, 409, 429, 500, 503])(
  "HTTP %i classifies outcome without exposing provider descriptions",
  (status) => {
    const data = classifyProviderError(status, {
      error: { code: "PROVIDER_CODE", description: "private account value" },
    });
    expect(data).toEqual({
      code: "RAZORPAY_PROVIDER_ERROR",
      message: "Razorpay returned a failure response.",
      retryable: status >= 500 || [409, 429].includes(status),
      providerStatus: status,
      providerCode: "PROVIDER_CODE",
    });
    expect(isDefinitiveNoCreate(new ConvexError(data))).toBe(
      status < 500 && ![409, 429].includes(status),
    );
  },
);

test("provider classification handles absent fields, concurrency and Unicode boundaries", () => {
  expect(classifyProviderError(503, null)).toEqual({
    code: "RAZORPAY_PROVIDER_ERROR",
    message: "Razorpay returned a failure response.",
    retryable: true,
    providerStatus: 503,
  });
  expect(
    classifyProviderError(400, { error: { description: "Concurrent operation in progress" } }).code,
  ).toBe("RAZORPAY_PROVIDER_ERROR");
  expect(classifyProviderError(503, { error: { code: "x".repeat(63) + "😀" } }).providerCode).toBe(
    "x".repeat(63),
  );
  expect(providerErrorCode(new Error("unknown"))).toBe("RAZORPAY_PROVIDER_ERROR");
  expect(providerErrorCode(razorpayError("RAZORPAY_NOT_FOUND"))).toBe("RAZORPAY_NOT_FOUND");
  expect(getOrThrow(0)).toBe(0);
  expect(getOrThrow(false)).toBe(false);
  for (const value of [null, undefined])
    expect(() => getOrThrow(value)).toThrowError(
      expect.objectContaining({
        data: {
          code: "RAZORPAY_INVALID_RESPONSE",
          message: "The provider response is invalid or a required mirror is missing.",
        },
      }),
    );
});
