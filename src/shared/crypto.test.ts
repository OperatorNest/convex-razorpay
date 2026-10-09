import { describe, expect, test } from "vitest";
import {
  constantTimeEqualHex,
  hmacSha256Hex,
  verifyHmacSha256Hex,
  verifyOrderCheckout,
  verifyPaymentLinkCallback,
  verifySubscriptionCheckout,
} from "./crypto.js";

// Public test vector from docs/spec.md.
const signingFixture = "EnLs21M47BllR3X8PSFtjtbd";
const order = "efeceae0e93bd41a7096ecce1d1cf69979db6c1d91a8116a21965faa42177a62";
const subscription = "460acecf881994c1fb48d8bddb43b971181207b8d9403687aaeacd5f4433404b";
const link = "382e72222f660d836ec37add68edb5844459fa1642c2812cca8bf6df4e639d05";
const webhook = "50389d12aae5cc398dd32babe40e775b171a2d9df8890763bf7ca52e0c74ac68";
const rawBody =
  '{"entity":"event","account_id":"acc_BFQ7uQEaa7j2z7","event":"payment.captured","contains":["payment"],"payload":{"payment":{"entity":{"id":"pay_IH4NVgf4wjLNgR","entity":"payment","amount":50000,"currency":"INR","status":"captured","order_id":"order_IluGWxBm9U8zJ8"}}},"created_at":1567674599}';

describe("Razorpay signature vectors", () => {
  test("order checkout", async () => {
    expect(await hmacSha256Hex(signingFixture, "order_IluGWxBm9U8zJ8|pay_IH4NVgf4wjLNgR")).toBe(
      order,
    );
    expect(
      await verifyOrderCheckout(
        signingFixture,
        "order_IluGWxBm9U8zJ8",
        "pay_IH4NVgf4wjLNgR",
        order,
      ),
    ).toBe(true);
    expect(
      await verifyOrderCheckout(signingFixture, "order_IluGWxBm9U8zJ8", "pay_tampered", order),
    ).toBe(false);
  });

  test("subscription checkout uses payment id first", async () => {
    expect(await hmacSha256Hex(signingFixture, "pay_IH4NVgf4wjLNgR|sub_ID6MOhgkcoHjE7")).toBe(
      subscription,
    );
    expect(
      await verifySubscriptionCheckout(
        signingFixture,
        "sub_ID6MOhgkcoHjE7",
        "pay_IH4NVgf4wjLNgR",
        subscription,
      ),
    ).toBe(true);
    expect(
      await verifySubscriptionCheckout(
        signingFixture,
        "pay_IH4NVgf4wjLNgR",
        "sub_ID6MOhgkcoHjE7",
        subscription,
      ),
    ).toBe(false);
  });

  test("payment link callback including empty reference", async () => {
    expect(
      await hmacSha256Hex(signingFixture, "plink_ID6MOhgkcoHjE7|inv-001|paid|pay_IH4NVgf4wjLNgR"),
    ).toBe(link);
    expect(
      await verifyPaymentLinkCallback(
        signingFixture,
        "plink_ID6MOhgkcoHjE7",
        "inv-001",
        "paid",
        "pay_IH4NVgf4wjLNgR",
        link,
      ),
    ).toBe(true);
    const emptyReference = await hmacSha256Hex(
      signingFixture,
      "plink_ID6MOhgkcoHjE7||paid|pay_IH4NVgf4wjLNgR",
    );
    expect(
      await verifyPaymentLinkCallback(
        signingFixture,
        "plink_ID6MOhgkcoHjE7",
        "",
        "paid",
        "pay_IH4NVgf4wjLNgR",
        emptyReference,
      ),
    ).toBe(true);
  });

  test("webhook body must be exact raw text", async () => {
    expect(await hmacSha256Hex("whsec_test_secret_123", rawBody)).toBe(webhook);
    expect(await verifyHmacSha256Hex("whsec_test_secret_123", rawBody, webhook)).toBe(true);
    expect(await verifyHmacSha256Hex("whsec_test_secret_123", rawBody + "\n", webhook)).toBe(false);
  });

  test("rejects malformed, truncated, and altered hex", () => {
    expect(constantTimeEqualHex(order, order)).toBe(true);
    expect(constantTimeEqualHex(order, order.slice(0, -1))).toBe(false);
    expect(constantTimeEqualHex(order, "z" + order.slice(1))).toBe(false);
    expect(constantTimeEqualHex(order, "0" + order.slice(1))).toBe(false);
  });
});
