import { Razorpay } from "@operatornest/convex-razorpay";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { env, httpAction } from "./_generated/server.js";

const http = httpRouter();
new Razorpay(components.razorpay, { onEvent: internal.webhookCallback.onEvent }).registerRoutes(
  http,
);

const maxE2eBodyBytes = 128 * 1024;

async function readChunkBefore(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("End-to-end webhook body read timed out")),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBodyBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
  chunks: Uint8Array[],
): Promise<Uint8Array<ArrayBuffer> | "timeout" | "too-large"> {
  let next: ReadableStreamReadResult<Uint8Array>;
  try {
    next = await readChunkBefore(reader, deadline);
  } catch {
    void reader.cancel();
    return "timeout";
  }
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (next.done) {
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  }
  if (length + next.value.byteLength > maxE2eBodyBytes) {
    void reader.cancel();
    return "too-large";
  }
  return readBodyBytes(reader, deadline, [...chunks, next.value]);
}

http.route({
  path: "/razorpay/e2e/webhook",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const recorderUrl = env.E2E_RECORDER_URL;
    if (!recorderUrl) return new Response("Not found", { status: 404 });

    const deadline = Date.now() + 4_500;
    const reader = request.body?.getReader();
    const body = reader ? await readBodyBytes(reader, deadline, []) : new Uint8Array();
    if (body === "timeout") return new Response("Webhook body read timed out", { status: 504 });
    if (body === "too-large") return new Response("Payload too large", { status: 413 });

    const providerHeaders = new Headers();
    for (const name of ["content-type", "x-razorpay-signature", "x-razorpay-event-id"]) {
      const value = request.headers.get(name);
      if (value !== null) providerHeaders.set(name, value);
    }
    let forwarded: Response;
    try {
      const origin = `${env.CONVEX_SITE_URL.replace(/\/$/, "")}/razorpay/webhook`;
      const originTimeout = Math.max(1, Math.min(3_500, deadline - Date.now()));
      forwarded = await fetch(origin, {
        method: "POST",
        headers: providerHeaders,
        body,
        signal: AbortSignal.timeout(originTimeout),
      });
    } catch {
      forwarded = new Response("Webhook forwarding failed", { status: 502 });
    }

    try {
      const captureHeaders = new Headers(providerHeaders);
      captureHeaders.set("x-e2e-forward-status", String(forwarded.status));
      const captured = await fetch(recorderUrl, {
        method: "POST",
        headers: captureHeaders,
        body,
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (!captured.ok) return new Response("Webhook recording failed", { status: 503 });
    } catch {
      return new Response("Webhook recording failed", { status: 503 });
    }

    return new Response(await forwarded.arrayBuffer(), {
      status: forwarded.status,
      headers: { "content-type": forwarded.headers.get("content-type") ?? "text/plain" },
    });
  }),
});

export default http;
