import { vi } from "vitest";

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

export function restoreRazorpayTestState(): void {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}
