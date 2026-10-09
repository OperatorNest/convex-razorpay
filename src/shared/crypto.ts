const encoder = new TextEncoder();

export async function sha256Hex(message: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(message)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  const validLeft = /^[0-9a-f]{64}$/i.test(left);
  const validRight = /^[0-9a-f]{64}$/i.test(right);
  let mismatch = Number(!validLeft || !validRight);
  for (let i = 0; i < 64; i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export async function verifyHmacSha256Hex(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  return constantTimeEqualHex(await hmacSha256Hex(secret, message), signature);
}

export async function verifyOrderCheckout(
  secret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  return verifyHmacSha256Hex(secret, `${orderId}|${paymentId}`, signature);
}

export async function verifySubscriptionCheckout(
  secret: string,
  subscriptionId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  return verifyHmacSha256Hex(secret, `${paymentId}|${subscriptionId}`, signature);
}

export async function verifyPaymentLinkCallback(
  secret: string,
  paymentLinkId: string,
  referenceId: string,
  status: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  return verifyHmacSha256Hex(
    secret,
    `${paymentLinkId}|${referenceId}|${status}|${paymentId}`,
    signature,
  );
}
