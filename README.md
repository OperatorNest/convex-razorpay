# @operatornest/convex-razorpay

Razorpay payments for Convex: server-side orders, payments, refunds, customers, plans, subscriptions, Checkout verification, and signed webhook mirroring in Convex's default V8 runtime.

Built against Razorpay's official API documentation and `razorpay-node` v2.9.8 behavior. Provider account behavior, subscription payment-method eligibility, capture settings, and some provider limits remain unconfirmed.

[![CI](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml) [![Release](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/%40operatornest%2Fconvex-razorpay)](https://www.npmjs.com/package/@operatornest/convex-razorpay) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```sh
pnpm add @operatornest/convex-razorpay convex@^1.46.0
```

`convex` is a peer dependency. This package has no runtime dependencies. Consumers need Node.js 22.19 or newer for their development toolchain.

## Configure

Mount the component and bind app environment values to component environment values by reference:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import razorpay from "@operatornest/convex-razorpay/convex.config.js";

const app = defineApp({
  env: {
    RAZORPAY_KEY_ID: v.optional(v.string()),
    RAZORPAY_KEY_SECRET: v.optional(v.string()),
    RAZORPAY_WEBHOOK_SECRET: v.optional(v.string()),
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: v.optional(v.string()),
    RAZORPAY_TEST_MODE: v.optional(v.string()),
  },
});
app.use(razorpay, {
  env: {
    RAZORPAY_KEY_ID: app.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: app.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: app.env.RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: app.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
    RAZORPAY_TEST_MODE: app.env.RAZORPAY_TEST_MODE,
  },
});
export default app;
```

| Component env variable             | Purpose                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `RAZORPAY_KEY_ID`                  | Public Checkout key id and REST API credential. Required for live operations.                    |
| `RAZORPAY_KEY_SECRET`              | REST API and checkout-signature secret. Required for live operations and signature verification. |
| `RAZORPAY_WEBHOOK_SECRET`          | Current webhook HMAC secret. Required for webhook ingest, including test mode.                   |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` | Previous webhook secret during rotation.                                                         |
| `RAZORPAY_TEST_MODE`               | Set to the string `true` for explicit local test mode.                                           |

The app sets these values on its Convex deployment. The webhook secret is separate from the API key secret. Never put credentials in component arguments or database records.

## Quick start

App functions must authenticate callers, derive prices from trusted app data, and authorize reads. This example uses an authenticated identity as a linkage key; configure the consuming app's auth provider before calling it.

```ts
// convex/billing.ts
import { Razorpay, sha256Hex } from "@operatornest/convex-razorpay";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { action, query } from "./_generated/server";

const razorpay = new Razorpay(components.razorpay);
const price = 50000; // Server-owned INR amount in paise.

export const createOrder = action({
  args: { cartId: v.string() },
  returns: v.object({
    orderId: v.string(),
    amount: v.number(),
    currency: v.string(),
    keyId: v.optional(v.string()),
  }),
  handler: async (ctx, { cartId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication required" });
    const idempotencyKey = await sha256Hex(`${identity.tokenIdentifier}|${cartId}`);
    const order = await razorpay.orders.create(ctx, {
      amount: price,
      currency: "INR",
      userId: identity.tokenIdentifier,
      idempotencyKey,
    });
    return {
      orderId: order.razorpayId,
      amount: order.amount,
      currency: order.currency,
      ...(order.keyId === undefined ? {} : { keyId: order.keyId }),
    };
  },
});

export const getOrder = query({
  args: { orderId: v.string() },
  returns: v.union(v.object({ status: v.string() }), v.null()),
  handler: async (ctx, { orderId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication required" });
    const order = await razorpay.orders.get(ctx, { orderId });
    return order?.userId === identity.tokenIdentifier ? { status: order.status } : null;
  },
});
```

An order's `keyId` is optional in explicit test mode when no key id is configured; supply a real Razorpay test key before opening Checkout.js. Build Checkout.js options with the pure helper `checkoutOptions(order, { name: "My app" })` (import it from the package; it needs no client or context) once a key id is available. Send Checkout's callback to an authenticated action using `razorpay.verification.checkout(ctx, { orderId, paymentId, signature, userId })`. Pass `userId` from your authenticated identity: when given it must equal the order's `userId`, and **omitting it skips the ownership check**. Verification requires a component-created order of the same mode and a payment that is `authorized` or `captured`; `verification.subscriptionCheckout` has the same rules for a component-created subscription. A valid callback signature does not by itself prove capture; fulfill after a captured payment or paid order is confirmed.

## Webhooks

Register the route in `convex/http.ts`, then configure its URL and secret in the Razorpay dashboard. The default path is `/razorpay/webhook`.

```ts
import { registerRoutes } from "@operatornest/convex-razorpay";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api";

const http = httpRouter();
registerRoutes(http, components.razorpay, {
  path: "/razorpay/webhook",
  onEvent: internal.webhookCallback.onEvent,
});
export default http;
```

Define the app callback and its table. The [example callback](example/convex/webhookCallback.ts) uses this pattern:

```ts
// convex/schema.ts — merge this table into your app schema
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  webhookNotifications: defineTable({ eventId: v.string(), event: v.string() }).index(
    "by_eventId",
    ["eventId"],
  ),
});
```

```ts
// convex/webhookCallback.ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const onEvent = internalMutation({
  args: {
    eventId: v.string(),
    event: v.string(),
    entityId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    createdAtProvider: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, event }) => {
    const existing = await ctx.db
      .query("webhookNotifications")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (!existing) await ctx.db.insert("webhookNotifications", { eventId, event });
    return null;
  },
});
```

`onEvent` is an optional internal mutation accepting the exported `RazorpayWebhookEventArgs` shape: `{ eventId, event, entityId?, accountId?, createdAtProvider }`. The component invokes it in the same transaction as mirror updates and deduplication. A callback failure rolls the transaction back and returns 500 so the provider may retry. Duplicate event ids or signed bodies return 200 without a second callback. The route returns 413 for oversized bodies, 400 for undecodable bodies, 401 for invalid signatures, and 500 when the secret is missing.

## API reference

Create `new Razorpay(components.razorpay, { testMode?: boolean, onEvent? })`; `onEvent` is checked against the exported `RazorpayWebhookEventArgs` type. `testMode` is tri-state: `true` enables test mode, an explicit `false` forces live mode even when the component env has `RAZORPAY_TEST_MODE=true`, and `undefined` (the default) defers to that env variable. Every grouped method takes `(ctx, args)`; `args` is an object. Provider calls use app actions, while local mirror reads use app queries. App linkage fields (`userId`, `externalId`, `metadata`) are metadata, never authorization.

| Client methods                                                                           | `args` after `ctx`                                                                                                                                                | Result                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `orders.create`                                                                          | `{ amount, currency, receipt?, notes?, partialPayment?, ...link }`                                                                                                | Order mirror with optional `keyId`.                           |
| `orders.fetch`, `orders.fetchPayments`, `orders.get`                                     | `{ orderId }`                                                                                                                                                     | Order mirror, payment mirrors, or mirror/`null`.              |
| `payments.fetch`, `payments.capture`                                                     | `{ paymentId }`; `{ paymentId, amount, currency }`                                                                                                                | Payment mirror.                                               |
| `payments.list`, `payments.listForOrder`                                                 | `{ count?, skip? }`; `{ orderId, limit? }`                                                                                                                        | Payment mirror arrays.                                        |
| `refunds.create`, `refunds.fetch`                                                        | `{ paymentId, amount?, speed?, receipt?, notes?, ...link }`; `{ refundId }`                                                                                       | Refund mirror. Create requires `idempotencyKey` or `receipt`. |
| `customers.create`, `customers.getOrCreate`                                              | `{ name, email, contact?, gstin?, notes?, ...link }`                                                                                                              | Customer mirror.                                              |
| `customers.fetch`, `customers.edit`, `customers.getByUser`                               | `{ customerId }`; `{ customerId, name?, email?, contact? }`; `{ userId }`                                                                                         | Customer mirror or mirror/`null` for local read.              |
| `plans.create`, `plans.fetch`, `plans.list`                                              | `{ period, interval, item, notes?, ...link }`; `{ planId }`; `{ count?, skip? }`                                                                                  | Plan mirror or list of mirrors.                               |
| `subscriptions.create`, `subscriptions.fetch`                                            | `{ planId, totalCount, quantity?, startAt?, expireBy?, notes?, ...link }`; `{ subscriptionId }`                                                                   | Subscription mirror.                                          |
| `subscriptions.cancel`, `subscriptions.pause`, `subscriptions.resume`                    | `{ subscriptionId, cancelAtCycleEnd? }`; `{ subscriptionId }`; `{ subscriptionId }`                                                                               | Subscription mirror.                                          |
| `subscriptions.update`                                                                   | `{ subscriptionId, planId?, offerId?, quantity?, remainingCount?, startAt?, scheduleChangeAt?, customerNotify? }`                                                 | Subscription mirror.                                          |
| `subscriptions.getForUser`, `subscriptions.listByUser`                                   | `{ userId }`; `{ userId, limit? }`                                                                                                                                | Subscription mirror/`null` or a bounded list.                 |
| `verification.checkout`, `verification.subscriptionCheckout`, `verification.paymentLink` | `{ orderId, paymentId, signature, userId? }`; `{ subscriptionId, paymentId, signature, userId? }`; `{ paymentLinkId, referenceId, status, paymentId, signature }` | Verified payment mirror or `true` for payment link.           |
| `webhooks.cleanup`, `idempotency.release`                                                | `{ before?, batchSize? }`; `{ resource: "order" \| "plan" \| "subscription", key }`                                                                               | Deleted count or release boolean.                             |

`link` means optional `{ userId?, externalId?, metadata?, idempotencyKey? }`. `checkoutOptions(order, options?)` is a standalone pure export that returns Checkout.js options for an `orders.create` result. Mirrored rows expose a `testMode` boolean. `registerRoutes(http, component, { path?, onEvent? })` is also exported, with `client.registerRoutes(http, options?)` as a shortcut that carries the client's callback.

The provider list methods accept `{ count?, skip? }`; local list methods use indexed bounded reads. `webhooks.ingest` is the component action behind `registerRoutes`; it accepts `{ body, signature, eventId, callbackHandle? }` and returns `processed`, `duplicate`, `ignored`, or `failed` with an optional safe `errorCode`. App code should use the route so the exact raw body is verified.

## Error codes

Component errors are `ConvexError` instances with `{ code, message, retryable? }` data. `isRazorpayError(error)` narrows them; `RazorpayErrorCode` is the exported code union. The message is sanitized and never includes credentials.

| Code                                                                                                  | Meaning                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_INVALID_ARGUMENT`                                                                           | Input failed local validation.                                                                                                                                    |
| `RAZORPAY_NOT_CONFIGURED`                                                                             | Required API credentials are missing.                                                                                                                             |
| `RAZORPAY_LIVE_KEY_TEST_MODE`                                                                         | Explicit test mode was requested with a live key id.                                                                                                              |
| `RAZORPAY_MODE_MISMATCH`                                                                              | A cached create is reused in a different mode, or a test-mode operation targets a live row.                                                                       |
| `RAZORPAY_IDEMPOTENCY_REQUIRED`, `RAZORPAY_IDEMPOTENCY_CONFLICT`, `RAZORPAY_IDEMPOTENCY_PENDING`      | A required key is missing; a key was reused with a different request on any create path; or a same-key create is in flight or ambiguous and needs reconciliation. |
| `RAZORPAY_CUSTOMER_CONFLICT`                                                                          | A provider customer belongs to another app user.                                                                                                                  |
| `RAZORPAY_NOT_FOUND`                                                                                  | A required mirrored entity (test-mode fetch, checkout order, subscription, or payment, claim mirror) is absent.                                                   |
| `RAZORPAY_INVALID_RESPONSE`, `RAZORPAY_INVALID_ENTITY`                                                | Provider data failed validation.                                                                                                                                  |
| `RAZORPAY_INVALID_WEBHOOK_SIGNATURE`, `RAZORPAY_MALFORMED_WEBHOOK`, `RAZORPAY_WEBHOOK_SECRET_MISSING` | Webhook authentication, encoding/envelope, or configuration failed.                                                                                               |
| `RAZORPAY_NETWORK_ERROR`, `RAZORPAY_HTTP_ERROR`, `RAZORPAY_PROVIDER_REJECTED`                         | Provider transport or rejection; inspect `retryable` before retrying.                                                                                             |

## Testing

Register the component with `convex-test`:

```ts
import { register } from "@operatornest/convex-razorpay/test";
import { convexTest } from "convex-test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]));
register(t);
```

Client `testMode: true` or component `RAZORPAY_TEST_MODE=true` enables deterministic local entities; an explicit client `testMode: false` overrides the env variable. Key prefixes never select the mode, and `rzp_live_` keys are refused in test mode. Every mirrored row carries `testMode`; signed webhook entities are live unless `RAZORPAY_TEST_MODE=true`, and test-mode operations refuse live rows with `RAZORPAY_MODE_MISMATCH`. Stub provider `fetch` and component env with fabricated values in tests. Test mode still verifies webhook and checkout signatures when those paths require them. Run `pnpm test` for coverage thresholds and `pnpm smoke` for the real local Convex runtime.

## Data retention

The daily cron removes webhook deduplication records and completed or failed idempotency claims older than 30 days in batches. Entity mirrors and unresolved claims have no automatic age cutoff; the consuming app must define reconciliation and erasure workflows. Provider `raw` passthrough fields may contain personal data; webhook raw bodies are not stored. See [ADR 0003](docs/adr/0003-financial-mirror-retention.md).

## Known limitations

Razorpay live-provider and deployed-scheduler behavior need separate qualification. Payment links, invoices, disputes, settlements, payouts, and provider token management are outside v0.1. Orders, plans and subscriptions lack a confirmed provider idempotency header; ambiguous creates use a local claim and bounded reconciliation, and a concurrent same-key call receives `RAZORPAY_IDEMPOTENCY_PENDING`. Subscription payment-method eligibility and certain provider limits remain unconfirmed against provider accounts.

## Security

The app must authenticate and authorize every call, own trusted prices, and gate fulfillment on confirmed payment state. The component verifies webhooks over the unchanged raw body using constant-time HMAC comparison and accepts a previous secret during rotation. Missing secrets fail closed. Report issues through [private vulnerability reporting](SECURITY.md).

## Development

Use `.mise.toml` for Node 26 and pnpm 12.9.1. Run `mise trust && mise install`, `pnpm install --frozen-lockfile`, `CONVEX_AGENT_MODE=anonymous pnpm exec convex init`, and `pnpm build:codegen` for a fresh checkout. `pnpm check` runs formatting, build, type-aware lint, typecheck, Knip, and coverage. `pnpm smoke` starts an anonymous local backend with fabricated values. For authorized Razorpay test-dashboard verification, `.env.e2e.example` and `pnpm e2e:env` configure the local deployment; keep `.env.e2e` private.

## License

[MIT](LICENSE) © 2026 OperatorNest.
