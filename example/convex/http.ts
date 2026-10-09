import { registerRoutes } from "@operatornest/convex-razorpay";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { env, httpAction } from "./_generated/server.js";

const http = httpRouter();
registerRoutes(http, components.razorpay, { onEvent: internal.webhookCallback.onEvent });

const maxE2eBodyBytes = 128 * 1024;

http.route({
  path: "/razorpay/e2e/webhook",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const recorderUrl = env.E2E_RECORDER_URL;
    if (!recorderUrl) return new Response("Not found", { status: 404 });

    const deadline = Date.now() + 4_500;
    let length = 0;
    const chunks: Uint8Array[] = [];
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          // eslint-disable-next-line eslint/no-await-in-loop -- Stream reads must be sequential to enforce the size bound before retaining chunks.
          next = await Promise.race([
            reader.read(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error("End-to-end webhook body read timed out")),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
        } catch {
          void reader.cancel();
          return new Response("Webhook body read timed out", { status: 504 });
        } finally {
          if (timer) clearTimeout(timer);
        }
        const { done, value } = next;
        if (done) break;
        length += value.byteLength;
        if (length > maxE2eBodyBytes) {
          void reader.cancel();
          return new Response("Payload too large", { status: 413 });
        }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

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
