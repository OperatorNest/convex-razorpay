const encoder = new TextEncoder();

/** Compute the hexadecimal SHA-256 hash of a message. */
export async function computeSha256Hex(message: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(message)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compute the hexadecimal HMAC-SHA-256 signature of a message. */
export async function computeHmacSha256Hex(secret: string, message: string): Promise<string> {
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

/** Compare two hexadecimal SHA-256 signatures in constant time. */
export function compareHexSignatures(left: string, right: string): boolean {
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
  return compareHexSignatures(await computeHmacSha256Hex(secret, message), signature);
}

export async function verifyOrderCheckout(
  secret: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): Promise<boolean> {
  return verifyHmacSha256Hex(secret, `${razorpayOrderId}|${razorpayPaymentId}`, signature);
}

export async function verifySubscriptionCheckout(
  secret: string,
  razorpaySubscriptionId: string,
  razorpayPaymentId: string,
  signature: string,
): Promise<boolean> {
  return verifyHmacSha256Hex(secret, `${razorpayPaymentId}|${razorpaySubscriptionId}`, signature);
}

export async function verifyPaymentLinkCallback(
  secret: string,
  razorpayPaymentLinkId: string,
  referenceId: string,
  status: string,
  razorpayPaymentId: string,
  signature: string,
): Promise<boolean> {
  return verifyHmacSha256Hex(
    secret,
    `${razorpayPaymentLinkId}|${referenceId}|${status}|${razorpayPaymentId}`,
    signature,
  );
}
