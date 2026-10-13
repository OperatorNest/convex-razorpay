import { computeSha256Hex } from "./crypto.js";
import { boundedString } from "./bounds.js";
import { razorpayError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  return value;
}

export function stringField(value: unknown): string {
  if (typeof value !== "string") throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return boundedString(value, 4096);
}

export function integerField(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  return value;
}

export function validateNotes(notes: Record<string, string> | undefined): Record<string, string> {
  if (!notes) return {};
  const entries = Object.entries(notes);
  if (
    entries.length > 15 ||
    entries.some(
      ([key, value]) =>
        !isConvexFieldName(key) || key.length > 256 || value.length > 256 || !value.isWellFormed(),
    )
  ) {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
  return notes;
}

export function linkedNotes(
  notes: Record<string, string> | undefined,
  userId?: string,
  externalId?: string,
  metadata?: Record<string, string>,
): Record<string, string> {
  validateNotes(notes);
  validateNotes(metadata);
  if (
    [...Object.keys(notes ?? {}), ...Object.keys(metadata ?? {})].some((key) =>
      key.toLowerCase().startsWith("operatornest"),
    )
  )
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  for (const value of [userId, externalId]) if (value !== undefined) boundedString(value, 256);
  const linked = { ...notes, ...metadata };
  if (userId) linked.operatornestUserId = userId;
  if (externalId) linked.operatornestExternalId = externalId;
  return validateNotes(linked);
}

export function statusAdvances(
  kind: "order" | "payment" | "refund" | "subscription",
  currentStatus: string,
  nextStatus: string,
  currentCounters: readonly number[] = [],
  nextCounters: readonly number[] = [],
): boolean {
  const countersDoNotDecrease = currentCounters.every((value, index) => {
    const next = nextCounters[index];
    return next === undefined || next >= value;
  });
  if (kind === "subscription") {
    const terminal = new Set(["cancelled", "completed", "expired"]);
    if (terminal.has(currentStatus)) {
      return currentStatus === nextStatus && countersDoNotDecrease;
    }
    if (terminal.has(nextStatus)) return true;
    const allowed: Record<string, string[]> = {
      created: ["authenticated", "active", "pending", "halted", "paused"],
      authenticated: ["active", "pending", "halted", "paused"],
      active: ["pending", "halted", "paused"],
      pending: ["active", "halted", "paused"],
      halted: ["active", "pending", "paused"],
      paused: ["active", "pending", "halted"],
    };
    if (currentStatus === nextStatus) return countersDoNotDecrease;
    if (currentStatus === "unknown") return Object.hasOwn(allowed, nextStatus);
    return allowed[currentStatus]?.includes(nextStatus) ?? false;
  }
  if (kind === "refund" && currentStatus !== "pending" && currentStatus !== "unknown") {
    return currentStatus === nextStatus;
  }
  const ranks: Record<string, Record<string, number>> = {
    order: { created: 0, attempted: 1, paid: 2 },
    payment: { created: 0, failed: 1, authorized: 2, captured: 3, refunded: 4 },
    refund: { pending: 0, failed: 1, processed: 2 },
  };
  const ranksForKind = ranks[kind];
  if (!ranksForKind) return false;
  const currentRank = ranksForKind[currentStatus] ?? -1;
  const nextRank = ranksForKind[nextStatus] ?? -1;
  if (currentRank < 0 && nextRank >= 0) return true;
  if (currentRank < 0 || nextRank < currentRank) return false;
  if (currentRank === nextRank) return countersDoNotDecrease;
  return true;
}

export async function deterministicTestId(
  prefix: string,
  parts: readonly (string | number | undefined)[],
): Promise<string> {
  const digest = await computeSha256Hex(JSON.stringify(parts.map((part) => part ?? null)));
  return `${prefix}_test_${digest.slice(0, 20)}`;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(record(value))
    .filter(([, item]) => item !== undefined)
    .toSorted(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function omitUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefined(item)]),
    );
  }
  return value;
}

export function isConvexFieldName(key: string): boolean {
  return /^[\x20-\x7E]+$/u.test(key) && !key.startsWith("$");
}

export function dropInvalidFieldNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropInvalidFieldNames);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => isConvexFieldName(key))
        .map(([key, item]) => [key, dropInvalidFieldNames(item)]),
    );
  }
  return value;
}

export function boundedLimit(limit = 50): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  return limit;
}
