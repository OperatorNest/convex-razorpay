# @operatornest/convex-razorpay

Razorpay payments for Convex: server-side orders, payments, refunds, customers, plans, subscriptions, Checkout verification, and signed webhook mirroring in Convex's default V8 runtime.

[![CI](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml) [![Release](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/%40operatornest%2Fconvex-razorpay)](https://www.npmjs.com/package/@operatornest/convex-razorpay) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```sh
pnpm add @operatornest/convex-razorpay convex@^1.46.0
```

`convex` is a peer dependency. This package has no runtime dependencies. Consumers need Node.js 24 or newer for their development toolchain.

## Configure

Mount the component and bind app environment values to component environment values by reference:

```ts
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
import { Razorpay, sha256Hex } from "@operatornest/convex-razorpay";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { action, query } from "./_generated/server";

const razorpay = new Razorpay(components.razorpay);
const priceInPaise = 50000;

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
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication is required." });
    const idempotencyKey = await sha256Hex(`${identity.tokenIdentifier}|${cartId}`);
    const order = await razorpay.orders.create(ctx, {
      amount: priceInPaise,
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
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication is required." });
    const order = await razorpay.orders.get(ctx, { orderId });
    return order?.userId === identity.tokenIdentifier ? { status: order.status } : null;
  },
});
```

Synthetic orders cannot be used with Checkout.js. For provider Checkout, leave local test mode disabled and configure Razorpay `rzp_test_*` API credentials. `checkoutOptions(order, { name: "My app" })` builds options from a provider-backed order; import this pure helper from the package.

Send Checkout's callback to an authenticated action using `razorpay.verification.checkout(ctx, { orderId, paymentId, signature, userId })`. Derive `userId` from the authenticated identity; omitting it skips the ownership check. Verification requires a component-created order in the selected mode and an authorized or captured payment. Full-payment orders require an equal amount; partial-payment orders accept a positive amount up to the order amount. `verification.subscriptionCheckout` requires a component-created subscription in the selected mode. A verified callback does not prove capture; fulfill only after confirming a captured payment or paid order.

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

Define the app callback and its table. The [example callback](https://github.com/OperatorNest/convex-razorpay/blob/main/example/convex/webhookCallback.ts) uses this pattern:

```ts
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

Create `new Razorpay(components.razorpay, { testMode?, onEvent? })`. `testMode` defaults to the component env: `true` enables synthetic operations, `false` forces provider operations, and omission defers to `RAZORPAY_TEST_MODE=true`. This selection also filters local reads. Methods accept only their declared fields; extra fields, including per-call `testMode`, are ignored by the client. Provider calls require action contexts; local reads require query contexts. App linkage fields are metadata, never authorization.

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
| `subscriptions.create`, `subscriptions.fetch`                                            | `{ planId, totalCount, quantity?, startAt?, expireBy?, customerNotify?, offerId?, notes?, ...link }`; `{ subscriptionId }`                                        | Subscription mirror.                                          |
| `subscriptions.cancel`, `subscriptions.pause`, `subscriptions.resume`                    | `{ subscriptionId, cancelAtCycleEnd? }`; `{ subscriptionId }`; `{ subscriptionId }`                                                                               | Subscription mirror.                                          |
| `subscriptions.update`                                                                   | `{ subscriptionId, planId?, offerId?, quantity?, remainingCount?, startAt?, scheduleChangeAt?, customerNotify? }`                                                 | Subscription mirror.                                          |
| `subscriptions.getForUser`, `subscriptions.listByUser`                                   | `{ userId, statuses? }`; `{ userId, limit? }`                                                                                                                     | Subscription mirror/`null` or a bounded list.                 |
| `verification.checkout`, `verification.subscriptionCheckout`, `verification.paymentLink` | `{ orderId, paymentId, signature, userId? }`; `{ subscriptionId, paymentId, signature, userId? }`; `{ paymentLinkId, referenceId, status, paymentId, signature }` | Verified payment mirror or `true` for payment link.           |
| `webhooks.cleanup`, `idempotency.release`                                                | `{ before?, batchSize? }`; `{ resource: "order" \| "plan" \| "subscription", key }`                                                                               | Deleted count or release boolean.                             |

`link` means optional `{ userId?, externalId?, metadata?, idempotencyKey? }`. `checkoutOptions(order, options?)` is a standalone pure export that returns Checkout.js options for an `orders.create` result. Mirrored rows expose a `testMode` boolean. `registerRoutes(http, component, { path?, onEvent? })` is also exported, with `client.registerRoutes(http, options?)` as a shortcut that carries the client's callback.

Provider lists default to `count: 10, skip: 0`; `count` must be an integer from 1 to 100 and `skip` from 0 to 900. Local lists default to `limit: 50` and require an integer from 1 to 100. `subscriptions.getForUser` accepts at most 20 statuses. It prefers active, authenticated, pending, halted, then paused among allowed statuses, choosing the newest mirror in the first matching status. Otherwise it selects the newest matching mirror; without a filter, it selects the newest mirror of any status.

Notes and metadata each allow at most 15 entries, with nonempty keys of up to 256 UTF-16 code units and values of up to 256 code units; their merged provider notes also allow at most 15 entries. `userId` and `externalId` require 1–256 code units. These fields must contain no unpaired surrogate. Caller notes and metadata cannot use any key starting with `operatornest`, case-insensitively. The component writes `operatornestUserId`, `operatornestExternalId` and `operatornestIdempotencyKey`. Provider notes never assign mirror ownership: `userId` and `externalId` come from explicit app arguments, stored linkage or a recorded parent (payment from order, refund from payment). Plan names require 1–256 code units and optional descriptions 1–4096.

Keyed creates reject changed requests. Customer `getOrCreate` returns or refreshes a keyed mirror only when its `userId` equals the argument exactly, including omission; any other owner or an unowned mirror requested with a user ID returns `RAZORPAY_CUSTOMER_CONFLICT`. Omitted contact is preserved. Unkeyed synthetic creates receive independent IDs. Synthetic orders reject duplicate receipts; live duplicate-receipt recovery requires the provider order’s `operatornestIdempotencyKey` to equal the claim key and all request fields to match. Order, plan and subscription claims and their request fingerprints include `testMode`, so the same key can be used independently in both modes. Completed claims remain reserved; a concurrent or ambiguous create returns `RAZORPAY_IDEMPOTENCY_PENDING`. Reuse the same key to reconcile after ten minutes; an unresolved claim returns `RAZORPAY_IDEMPOTENCY_PENDING` and never sends another POST. `idempotency.release` releases a pending or failed claim in the client’s selected mode only after your app has resolved its provider outcome.

`webhooks.ingest` is the component action behind `registerRoutes`; it accepts `{ body, signature, eventId, callbackHandle? }` and returns `processed`, `duplicate`, `ignored`, or `failed` with an optional safe `errorCode`. App code should use the route so the exact raw body is verified.

## Error codes

Component errors contain `{ code, message }`; provider failures may also contain `providerStatus` (HTTP status) and `providerCode` (at most 64 UTF-16 code units). Messages are fixed per code. Provider descriptions, fields and response bodies never enter error data. `isRazorpayError` validates the complete shape; `RazorpayErrorCode` is the exported union. No `retryable` flag is returned. For an uncertain create outcome, reuse its key and reconcile before issuing another create.

| Code                                 | Fixed message                                                         |
| ------------------------------------ | --------------------------------------------------------------------- |
| `RAZORPAY_INVALID_ARGUMENT`          | An argument is invalid, missing or out of bounds.                     |
| `RAZORPAY_INVALID_RESPONSE`          | The provider response is invalid or a required mirror is missing.     |
| `RAZORPAY_NOT_CONFIGURED`            | Razorpay API credentials are missing.                                 |
| `RAZORPAY_LIVE_KEY_TEST_MODE`        | Test mode cannot use a live Razorpay key.                             |
| `RAZORPAY_MODE_MISMATCH`             | The operation and mirror have different modes.                        |
| `RAZORPAY_CUSTOMER_CONFLICT`         | The customer belongs to another app user.                             |
| `RAZORPAY_IDEMPOTENCY_REQUIRED`      | Refund creation requires an idempotency key or receipt.               |
| `RAZORPAY_IDEMPOTENCY_CONFLICT`      | The idempotency key or receipt identifies a different create request. |
| `RAZORPAY_IDEMPOTENCY_PENDING`       | The create outcome is pending or unknown; reconcile before retrying.  |
| `RAZORPAY_NOT_FOUND`                 | The required mirror does not exist.                                   |
| `RAZORPAY_PROVIDER_REJECTED`         | Razorpay rejected the request.                                        |
| `RAZORPAY_HTTP_ERROR`                | Razorpay returned an HTTP failure with an uncertain outcome.          |
| `RAZORPAY_NETWORK_ERROR`             | The Razorpay network request failed with an uncertain outcome.        |
| `RAZORPAY_WEBHOOK_SECRET_MISSING`    | The webhook signing secret is missing.                                |
| `RAZORPAY_INVALID_WEBHOOK_SIGNATURE` | The webhook signature is invalid.                                     |
| `RAZORPAY_MALFORMED_WEBHOOK`         | The webhook body or envelope is invalid or exceeds the size limit.    |
| `RAZORPAY_INVALID_ENTITY`            | The webhook entities or their relationships are invalid.              |

## Testing

Register the component with `convex-test`:

```ts
import { register } from "@operatornest/convex-razorpay/test";
import { convexTest } from "convex-test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]));
register(t);
```

Synthetic operations make no provider calls and do not create provider resources. Key prefixes do not select the mode; `rzp_live_` keys are rejected when synthetic mode is enabled, including during webhook ingest. Mirrors store `testMode`; writes reject an existing mirror of the opposite mode, and local reads select only the requested mode. Webhook mode follows `RAZORPAY_TEST_MODE`. Test mode still requires secrets for webhook and Checkout signature verification. Stub `fetch` and env values with fabricated data in tests.

## Limits and retention

Reconciliation scans at most 20 provider pages of 100 records (2000 records). A scan without a matching component key leaves the claim pending, including when a shorter page ends the scan; it cannot establish the original POST outcome. Resolve that outcome before releasing the claim.

Subscription fetches always apply the provider’s current state. Webhooks order only against other webhook `created_at` values stored as `lastWebhookCreatedAtProvider`; they also enforce subscription status transitions and nondecreasing paid counts. Local observation timestamps never order webhook events.

The daily cron removes webhook deduplication records and failed idempotency claims older than 30 days in batches. Entity mirrors and completed or pending claims have no automatic age cutoff; the consuming app must define reconciliation and erasure workflows. Provider `raw` passthrough fields may contain personal data; webhook raw bodies are not stored. See [ADR 0003](https://github.com/OperatorNest/convex-razorpay/blob/main/docs/adr/0003-financial-mirror-retention.md).

## Known limitations

Payment-link signature verification is supported; payment-link CRUD, invoice CRUD, disputes, settlements, payouts and provider token management are excluded. Provider capture settings, subscription payment-method eligibility and deployed scheduler execution require account-specific verification. The component does not automatically retry provider calls.

Provider test-account observations: [redacted fixtures](https://github.com/OperatorNest/convex-razorpay/tree/main/tests/fixtures/e2e).

## Security

The app must authenticate and authorize every call, own trusted prices, and gate fulfillment on confirmed payment state. The component verifies webhooks over the unchanged raw body using constant-time HMAC comparison and accepts a previous secret during rotation. Missing secrets fail closed. Report issues through [private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new).

## Contributing

Setup, checks and maintainer verification are in [CONTRIBUTING.md](https://github.com/OperatorNest/convex-razorpay/blob/main/CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 OperatorNest.
