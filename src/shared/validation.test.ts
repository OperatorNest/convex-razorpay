import { describe, expect, test } from "vitest";
import {
  deterministicTestId,
  integerField,
  isRecord,
  linkedNotes,
  omitUndefined,
  record,
  stableStringify,
  statusAdvances,
  stringField,
  validateNotes,
} from "./validation.js";

describe("shared validation and state", () => {
  test("record and string fields reject invalid provider shapes with a code", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(record({ id: "pay_1" })).toEqual({ id: "pay_1" });
    expect(stringField("pay_1", "payment id")).toBe("pay_1");
    for (const value of [null, [], "bad"]) {
      expect(() => record(value)).toThrowError(
        expect.objectContaining({
          data: expect.objectContaining({ code: "RAZORPAY_INVALID_ARGUMENT" }),
        }),
      );
    }
    for (const value of [undefined, "", 1]) {
      expect(() => stringField(value, "payment id")).toThrowError(
        expect.objectContaining({
          data: expect.objectContaining({ code: "RAZORPAY_INVALID_ARGUMENT" }),
        }),
      );
    }
  });

  test("money requires a safe integer in subunits", () => {
    expect(integerField(50000, "amount", 100)).toBe(50000);
    for (const value of [99, 100.5, Number.MAX_SAFE_INTEGER + 1, "50000", -1]) {
      expect(() => integerField(value, "amount", 100)).toThrow();
    }
  });

  test("notes enforce 15 keys and 256 characters, including linkage", () => {
    expect(validateNotes({ invoice: "abc" })).toEqual({ invoice: "abc" });
    expect(() =>
      validateNotes(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, "v"]))),
    ).toThrow();
    expect(() => validateNotes({ a: "x".repeat(257) })).toThrow();
    expect(() => linkedNotes({}, "u", undefined, { ["x".repeat(257)]: "v" })).toThrow();
    expect(linkedNotes({}, "u-1", "external-1", { tier: "pro" })).toEqual({
      userId: "u-1",
      externalId: "external-1",
      tier: "pro",
    });
  });

  test("late payment authorization can recover a failure but cannot regress capture", () => {
    expect(statusAdvances("payment", "failed", "authorized")).toBe(true);
    expect(statusAdvances("payment", "captured", "authorized")).toBe(false);
    expect(statusAdvances("payment", "authorized", "captured")).toBe(true);
  });

  test("same status updates preserve monotonic counters", () => {
    expect(statusAdvances("payment", "captured", "captured", [100], [120])).toBe(true);
    expect(statusAdvances("payment", "captured", "captured", [100], [90])).toBe(false);
    expect(statusAdvances("order", "attempted", "paid", [0, 2], [10, 1])).toBe(true);
  });

  test("subscription pending and halted recover while terminal states stay terminal", () => {
    expect(statusAdvances("subscription", "halted", "active")).toBe(true);
    expect(statusAdvances("subscription", "paused", "active")).toBe(true);
    expect(statusAdvances("subscription", "cancelled", "active")).toBe(false);
    expect(statusAdvances("subscription", "active", "cancelled")).toBe(true);
    expect(statusAdvances("subscription", "completed", "active")).toBe(false);
  });

  test("terminal subscription snapshots still enforce nondecreasing paid_count", () => {
    expect(statusAdvances("subscription", "cancelled", "cancelled", [5], [5])).toBe(true);
    expect(statusAdvances("subscription", "cancelled", "cancelled", [5], [4])).toBe(false);
  });

  test("fake ids are deterministic, input-sensitive and use a long digest", async () => {
    const id = await deterministicTestId("order", ["u", 500]);
    expect(id).toMatch(/^order_test_[0-9a-f]{20}$/);
    expect(await deterministicTestId("order", ["u", 500])).toBe(id);
    expect(await deterministicTestId("order", ["u", 501])).not.toBe(id);
    expect(await deterministicTestId("order", ["a|b", "c"])).not.toBe(
      await deterministicTestId("order", ["a", "b|c"]),
    );
    expect(await deterministicTestId("order", [undefined, "x"])).not.toBe(
      await deterministicTestId("order", ["", "x"]),
    );
  });

  test("stable serialization and omission ignore undefined fields without changing arrays", () => {
    expect(stableStringify({ b: 2, a: { z: undefined, x: [1, undefined] } })).toBe(
      '{"a":{"x":[1,null]},"b":2}',
    );
    expect(stableStringify(undefined)).toBe("null");
    expect(omitUndefined({ a: 1, b: undefined, c: [undefined, { d: undefined, e: 2 }] })).toEqual({
      a: 1,
      c: [undefined, { e: 2 }],
    });
  });
});
