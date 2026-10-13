import { classifyProviderError, razorpayError } from "../shared/errors.js";
import { env } from "./_generated/server.js";
import { collectionItems } from "./mapping.js";
import { isRecord } from "../shared/validation.js";

export function envTestMode(): boolean {
  return env.RAZORPAY_TEST_MODE === "true";
}

export function resolveMode(requested?: boolean): boolean {
  const enabled = requested ?? envTestMode();
  if (enabled && env.RAZORPAY_KEY_ID?.startsWith("rzp_live_")) {
    throw razorpayError("RAZORPAY_LIVE_KEY_TEST_MODE");
  }
  return enabled;
}

export function isTestMode(requested?: boolean): boolean {
  const enabled = resolveMode(requested);
  if (!enabled && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) {
    throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  }
  return enabled;
}

export function assertModeMatches(row: { testMode: boolean }, testMode: boolean): void {
  if (row.testMode !== testMode) {
    throw razorpayError("RAZORPAY_MODE_MISMATCH");
  }
}

export async function requestProvider(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  options: { body?: unknown; idempotent?: boolean; refund?: boolean; idempotencyKey?: string } = {},
): Promise<unknown> {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw razorpayError("RAZORPAY_NOT_CONFIGURED");
  }
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.refund && options.idempotencyKey)
    headers["X-Refund-Idempotency"] = options.idempotencyKey;
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  init.signal = controller.signal;
  let response: Response;
  let body: unknown;
  try {
    try {
      response = await fetch(`https://api.razorpay.com/v1${path}`, init);
    } catch {
      throw razorpayError("RAZORPAY_NETWORK_ERROR");
    }
    try {
      body = await response.json();
    } catch {
      throw razorpayError("RAZORPAY_INVALID_RESPONSE");
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const error = classifyProviderError(response.status, body);
    throw razorpayError(error.code, {
      providerStatus: response.status,
      ...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
    });
  }
  return body;
}

export function listPath(path: string, count?: number, skip?: number): string {
  const search = new URLSearchParams();
  search.set("count", String(count ?? 10));
  search.set("skip", String(skip ?? 0));
  return `${path}?${search.toString()}`;
}

export async function findByIdempotencyKey(
  resource: "order" | "plan" | "subscription",
  key: string,
  receipt?: string,
): Promise<Record<string, unknown>> {
  const pageSize = 100;
  const path = resource === "order" ? "/orders" : resource === "plan" ? "/plans" : "/subscriptions";
  const filter = resource === "order" && receipt ? `&receipt=${encodeURIComponent(receipt)}` : "";
  for (let page = 0; page < 20; page++) {
    const response = await requestProvider(
      "GET",
      `${listPath(path, pageSize, page * pageSize)}${filter}`,
      { idempotent: true },
    );
    const items = collectionItems(response);
    const found = items.find(
      (item): item is Record<string, unknown> =>
        isRecord(item) && isRecord(item.notes) && item.notes.operatornestIdempotencyKey === key,
    );
    if (found) return found;
    if (items.length < pageSize) break;
  }
  throw razorpayError("RAZORPAY_IDEMPOTENCY_PENDING");
}
