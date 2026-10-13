import { readConfig, requireConfigValue, resolveRazorpayTestMode } from "../shared/config.js";
import { razorpayError } from "../shared/errors.js";
import { classifyProviderError } from "../shared/providerErrors.js";
import { env } from "./_generated/server.js";
import { collectionItems } from "./mapping.js";
import { dropInvalidFieldNames, isRecord } from "../shared/validation.js";

export function readTestMode(option?: boolean): boolean {
  return resolveRazorpayTestMode(option, env);
}

export function assertEnvModeConsistent(): void {
  resolveRazorpayTestMode(undefined, env);
}

export function resolveProviderMode(option?: boolean): { testMode: boolean; isSimulated: boolean } {
  const testMode = resolveRazorpayTestMode(option, env);
  const config = readConfig(env);
  if (testMode && config.keyId === undefined) return { testMode, isSimulated: true };
  requireConfigValue(config.keyId);
  requireConfigValue(config.keySecret);
  return { testMode, isSimulated: false };
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
  const config = readConfig(env);
  const keyId = requireConfigValue(config.keyId);
  const keySecret = requireConfigValue(config.keySecret);
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
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
      throw razorpayError("RAZORPAY_NETWORK_ERROR", { retryable: true });
    }
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw razorpayError("RAZORPAY_INVALID_RESPONSE");
      body = undefined;
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw classifyProviderError(response.status, body);
  }
  return dropInvalidFieldNames(body);
}

export function listPath(path: string, count?: number, skip?: number): string {
  const search = new URLSearchParams();
  search.set("count", String(count ?? 10));
  search.set("skip", String(skip ?? 0));
  return `${path}?${search.toString()}`;
}

const providerCollectionPaths = {
  order: "/orders",
  plan: "/plans",
  subscription: "/subscriptions",
  customer: "/customers",
} as const;

export async function findByIdempotencyKey(
  resource: "order" | "plan" | "subscription" | "customer",
  idempotencyKey: string,
  receipt?: string,
): Promise<Record<string, unknown>> {
  const pageSize = 100;
  const path = providerCollectionPaths[resource];
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
        isRecord(item) &&
        isRecord(item.notes) &&
        item.notes.operatornestIdempotencyKey === idempotencyKey,
    );
    if (found) return found;
    if (items.length < pageSize) break;
  }
  throw razorpayError("RAZORPAY_IDEMPOTENCY_PENDING");
}
