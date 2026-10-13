# @operatornest/convex-razorpay

Razorpay payments for Convex: server-side orders, payments, refunds, customers, plans, subscriptions, Checkout verification, and signed webhook mirroring in Convex's default V8 runtime.

[![CI](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml) [![Release](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/%40operatornest%2Fconvex-razorpay)](https://www.npmjs.com/package/@operatornest/convex-razorpay) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```sh
pnpm add @operatornest/convex-razorpay convex@^1.46.0 convex-helpers@^0.1.106
```

`convex` and `convex-helpers` are peer dependencies. This package has no runtime dependencies. Consumers need Node.js 24 or newer for their development toolchain.

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

| Variable                           | Required                                      | Default | Valid values                                            |
| ---------------------------------- | --------------------------------------------- | ------- | ------------------------------------------------------- |
| `RAZORPAY_KEY_ID`                  | Provider operations                           | Unset   | Nonempty `rzp_test_*` or `rzp_live_*` key               |
| `RAZORPAY_KEY_SECRET`              | Provider operations and Checkout verification | Unset   | Nonempty secret without surrounding whitespace          |
| `RAZORPAY_WEBHOOK_SECRET`          | Webhook ingest                                | Unset   | Nonempty secret without surrounding whitespace          |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` | No                                            | Unset   | Nonempty previous secret without surrounding whitespace |
| `RAZORPAY_TEST_MODE`               | No                                            | `false` | `true` or `false`                                       |

All declared component env is parsed by one function; a malformed value or a missing required credential raises `RAZORPAY_NOT_CONFIGURED`. Bind app values by reference. API and webhook secrets are separate; credentials never enter arguments or rows.

Test operations are enabled by a true client option or component env `true`; a false option cannot disable component env test mode. Recognizable live keys are rejected in test mode. Use provider `rzp_test_*` credentials with test mode disabled for Checkout.js, because local test orders do not exist at Razorpay.

## Quick start

App functions must authenticate callers, derive prices from trusted app data, and authorize reads. This example uses an authenticated identity as a linkage key; configure the consuming app's auth provider before calling it.

```ts
import { Razorpay, computeSha256Hex } from "@operatornest/convex-razorpay";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { action, query } from "./_generated/server";

const razorpay = new Razorpay(components.razorpay);
const priceInPaise = 50000;

export const createOrder = action({
  args: { cartId: v.string() },
  returns: v.object({
    razorpayOrderId: v.string(),
    amount: v.number(),
    currency: v.string(),
    keyId: v.optional(v.string()),
  }),
  handler: async (ctx, { cartId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication is required." });
    const idempotencyKey = await computeSha256Hex(`${identity.tokenIdentifier}|${cartId}`);
    const order = await razorpay.orders.create(ctx, {
      amount: priceInPaise,
      currency: "INR",
      partialPayment: false,
      userId: identity.tokenIdentifier,
      idempotencyKey,
    });
    return {
      razorpayOrderId: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      ...(order.keyId === undefined ? {} : { keyId: order.keyId }),
    };
  },
});

export const getOrder = query({
  args: { razorpayOrderId: v.string() },
  returns: v.union(v.object({ status: v.string() }), v.null()),
  handler: async (ctx, { razorpayOrderId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({ code: "APP_AUTH_REQUIRED", message: "Authentication is required." });
    const order = await razorpay.orders.get(ctx, { razorpayOrderId });
    return order?.userId === identity.tokenIdentifier ? { status: order.status } : null;
  },
});
```

Test orders cannot be used with Checkout.js. For provider Checkout, leave local test mode disabled and configure Razorpay `rzp_test_*` API credentials. `buildCheckoutOptions(order, { name: "My app" })` builds options from a provider-backed order; import this pure helper from the package.

Send Checkout's callback to an authenticated action using `razorpay.orders.verifyCheckout(ctx, { razorpayOrderId, razorpayPaymentId, signature, userId })`. Derive `userId` from the authenticated identity; omitting it skips the ownership check. Verification requires a component-created order in the selected mode and an authorized or captured payment. Full-payment orders require an equal amount; partial-payment orders accept a positive amount up to the order amount. `subscriptions.verifyCheckout` requires a component-created subscription in the selected mode. A verified callback does not prove capture; fulfill only after confirming a captured payment or paid order.

## Concepts

| Term                                                                                 | Meaning                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orders, payments, refunds, customers, plans, subscriptions, paymentLinks             | Razorpay aggregates: payment requests, payments, returned amounts, customer profiles, recurring prices, billing agreements and payment URL callback signatures.                                                                                                                                          |
| row ID                                                                               | Component row identifier named for its entity, such as orderId.                                                                                                                                                                                                                                          |
| Razorpay ID                                                                          | Provider identifier named razorpayObjectId: razorpayOrderId, razorpayPaymentId, razorpayRefundId, razorpayCustomerId, razorpayPlanId, razorpaySubscriptionId, razorpayPaymentLinkId, razorpayInvoiceId, razorpayOfferId, razorpayAccountId or razorpayEntityId.                                          |
| userId, externalId                                                                   | Opaque app user and app resource linkage; neither grants authorization.                                                                                                                                                                                                                                  |
| testMode                                                                             | Local simulation selected by client option or component env and stored on mirrors.                                                                                                                                                                                                                       |
| idempotencyKey, receipt                                                              | Caller retry key and provider receipt reference; matching keys return the first create result.                                                                                                                                                                                                           |
| notes, metadata                                                                      | Provider key-value fields and app linkage fields merged into the provider notes limit.                                                                                                                                                                                                                   |
| amount, amountPaid, amountDue, amountRefunded, fee, tax                              | Integer amounts in the currency’s smallest unit; INR amounts are paise.                                                                                                                                                                                                                                  |
| currency                                                                             | Explicit uppercase three-letter currency code.                                                                                                                                                                                                                                                           |
| partialPayment, attempts                                                             | Permission for partial order payments and the order payment-attempt count.                                                                                                                                                                                                                               |
| method, captured, verified, international                                            | Payment method, capture state, verified Checkout callback and international-payment flag.                                                                                                                                                                                                                |
| refundStatus                                                                         | partial after part of a payment is refunded, full after its whole amount is refunded.                                                                                                                                                                                                                    |
| speed, speedRequested, speedProcessed                                                | Requested normal or optimum refund speed and provider processing speed.                                                                                                                                                                                                                                  |
| name, email, contact, gstin                                                          | Customer name, email address, phone number and GST identification number.                                                                                                                                                                                                                                |
| period, interval, item, itemName, description                                        | Plan billing period (daily, weekly, monthly, quarterly, yearly), period count and price item.                                                                                                                                                                                                            |
| quantity, totalCount, paidCount, remainingCount                                      | Subscription units per charge, total billing cycles, paid cycles and remaining cycles.                                                                                                                                                                                                                   |
| customerNotify, scheduleChangeAt                                                     | Explicit customer-notification choice and subscription update timing: now or cycle_end.                                                                                                                                                                                                                  |
| startAt, expiresAt, currentStartAt, currentEndAt, chargeAt, endAt, endedAt, pausedAt | Subscription timestamps in milliseconds since the Unix epoch; provider requests retain whole-second precision.                                                                                                                                                                                           |
| createdAt, providerUpdatedAt, providerCreatedAt, lastWebhookAt                       | Creation, provider observation and webhook ordering timestamps in milliseconds since the Unix epoch.                                                                                                                                                                                                     |
| hasScheduledChanges, shortUrl                                                        | Subscription scheduled-change flag and provider payment URL.                                                                                                                                                                                                                                             |
| signature, referenceId                                                               | Provider HMAC signature and payment-link reference string.                                                                                                                                                                                                                                               |
| onEvent, eventId, event                                                              | Internal callback, webhook delivery identifier and Razorpay event name.                                                                                                                                                                                                                                  |
| raw, rawStatus                                                                       | Provider passthrough fields and an unrecognized provider status retained without interpretation.                                                                                                                                                                                                         |
| paginationOpts, page, isDone, continueCursor                                         | Convex page request and bounded page result.                                                                                                                                                                                                                                                             |
| count, skip                                                                          | Provider page size and offset.                                                                                                                                                                                                                                                                           |
| keyId, key, order_id, prefill, theme                                                 | Public Checkout key and Razorpay Checkout.js options.                                                                                                                                                                                                                                                    |
| errorCode, errorDescription, errorReason, errorSource, errorStep                     | Provider payment-failure metadata on mirrors, separate from component errors.                                                                                                                                                                                                                            |
| OrderStatus                                                                          | created on creation, attempted after an attempt, paid after payment; unknown preserves an unrecognized state.                                                                                                                                                                                            |
| PaymentStatus                                                                        | created initially, authorized after authorization, captured after capture, refunded after full refund, failed after failure; unknown preserves an unrecognized state.                                                                                                                                    |
| RefundStatus                                                                         | pending on acceptance, processed after completion, failed after failure; unknown preserves an unrecognized state.                                                                                                                                                                                        |
| SubscriptionStatus                                                                   | created on creation, authenticated after authentication, active when billing starts, pending after a failed charge, halted after retry exhaustion, paused on pause, cancelled on cancellation, completed after all cycles, expired after authentication expiry; unknown preserves an unrecognized state. |
| PaymentLinkStatus                                                                    | created on creation, partially_paid after partial payment, paid after payment, expired at expiry, cancelled on cancellation.                                                                                                                                                                             |
| WebhookStatus                                                                        | processed after applying entities, ignored for unsupported events, failed for invalid entities, duplicate for an already applied delivery.                                                                                                                                                               |
| IdempotencyStatus                                                                    | pending while the provider outcome is unresolved, completed after storing its mirror, failed after definitive rejection.                                                                                                                                                                                 |

Domain terms follow the [Razorpay API reference](https://razorpay.com/docs/api/). Raw provider fields retain provider spelling and units.

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
    razorpayEntityId: v.optional(v.string()),
    razorpayAccountId: v.optional(v.string()),
    providerCreatedAt: v.number(),
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

`onEvent` is an optional internal mutation accepting the exported `RazorpayWebhookEventArgs` shape: `{ eventId, event, razorpayEntityId?, razorpayAccountId?, providerCreatedAt }`. The component invokes it in the same transaction as mirror updates and deduplication. A callback failure rolls the transaction back and returns 500 so the provider may retry. Duplicate event ids or signed bodies return 200 without a second callback. The route returns 413 for oversized bodies, 400 for undecodable bodies, 401 for invalid signatures, and 500 when the secret is missing.

## API reference

Provider names and fields follow Razorpay’s [Orders](https://razorpay.com/docs/api/orders/), [Payments](https://razorpay.com/docs/api/payments/), [Refunds](https://razorpay.com/docs/api/refunds/), [Customers](https://razorpay.com/docs/api/customers/), [Plans](https://razorpay.com/docs/api/payments/subscriptions/create-plan/), [Subscriptions](https://razorpay.com/docs/api/payments/subscriptions/) and [Payment Links](https://razorpay.com/docs/api/payments/payment-links/) references.

All aggregate methods take `(ctx, args)`. Provider operations require an action context, stored reads a query context, and claim release a mutation context. Constructor options select testMode and onEvent. Only declared fields are forwarded. Mirror results expose row IDs such as orderId alongside provider IDs; fetch results contain no row IDs and store nothing.

| Group           | Methods                                                                                                                             | Arguments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders`        | `create`, `fetch`, `fetchPayments`, `get`, `verifyCheckout`, `releaseIdempotency`                                                   | Create: `{ amount, currency, partialPayment, receipt?, notes?, ...link }`; reads: `{ razorpayOrderId }`; verification: `{ razorpayOrderId, razorpayPaymentId, signature, userId? }`; release: `{ idempotencyKey }`.                                                                                                                                                                                                                                                                               |
| `payments`      | `fetch`, `capture`, `fetchAll`, `list`                                                                                              | `{ razorpayPaymentId }`; capture adds `{ amount, currency }`; provider page: `{ count?, skip? }`; stored page: `{ razorpayOrderId, paginationOpts }`.                                                                                                                                                                                                                                                                                                                                             |
| `refunds`       | `create`, `fetch`                                                                                                                   | Create: `{ razorpayPaymentId, amount, speed, receipt?, notes?, ...link }`; fetch: `{ razorpayRefundId }`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `customers`     | `create`, `getOrCreate`, `fetch`, `edit`, `get`                                                                                     | Create: `{ name, email, contact?, gstin?, notes?, ...link }`; fetch: `{ razorpayCustomerId }`; edit adds `{ name?, email?, contact? }`; get: `{ userId }`.                                                                                                                                                                                                                                                                                                                                        |
| `plans`         | `create`, `fetch`, `fetchAll`, `releaseIdempotency`                                                                                 | Create: `{ period, interval, item: { name, amount, currency, description? }, notes?, ...link }`; fetch: `{ razorpayPlanId }`; provider page: `{ count?, skip? }`; release: `{ idempotencyKey }`.                                                                                                                                                                                                                                                                                                  |
| `subscriptions` | `create`, `fetch`, `cancel`, `cancelAtCycleEnd`, `pause`, `resume`, `update`, `get`, `list`, `verifyCheckout`, `releaseIdempotency` | Create: `{ razorpayPlanId, totalCount, quantity, customerNotify, startAt?, expiresAt?, razorpayOfferId?, notes?, ...link }`; operations: `{ razorpaySubscriptionId }`; update adds required scheduleChangeAt and optional razorpayPlanId, razorpayOfferId, quantity, remainingCount, startAt, customerNotify; get: `{ userId, statuses? }`; list: `{ userId, paginationOpts }`; verification: `{ razorpaySubscriptionId, razorpayPaymentId, signature, userId? }`; release: `{ idempotencyKey }`. |
| `paymentLinks`  | `verifyCheckout`                                                                                                                    | `{ razorpayPaymentLinkId, referenceId, status, razorpayPaymentId, signature }`.                                                                                                                                                                                                                                                                                                                                                                                                                   |

`link` is optional `{ userId?, externalId?, metadata?, idempotencyKey? }`. `buildCheckoutOptions(order, args?)` builds Checkout.js presentation options without a component call. The pure exports computeSha256Hex, computeHmacSha256Hex and compareHexSignatures compute SHA-256, sign with HMAC-SHA-256 and compare hexadecimal signatures in constant time. `registerRoutes(http, component, args?)` and `client.registerRoutes(http, args?)` register the signed webhook route.

Provider pages default to count 10 and skip 0; count is 1–100 and skip 0–900. Stored pages require paginationOpts with 1–100 items and cursors returned by the same list. Rows read are capped at numItems + 1, including with endCursor. Invalid page sizes and cursors raise RAZORPAY_INVALID_ARGUMENT. Subscription get accepts at most 20 statuses and prefers active, authenticated, pending, halted, then paused; otherwise it selects the newest matching mirror.

Notes and metadata each permit 15 entries, nonempty keys up to 256 UTF-16 code units and values up to 256 code units. Merged provider notes also permit 15 entries. Linkage strings require 1–256 code units; all strings reject unpaired surrogates. Caller keys beginning with operatornest are reserved. Plan names permit 1–256 code units and descriptions 1–4096. Customer names require 3–50 characters, email at most 64, contact 8–15 digits with optional leading plus, and gstin 15 uppercase letters or digits.

Idempotency keys require 10–128 ASCII letters, digits, underscores or hyphens. Refund creation requires an idempotency key or receipt. Keyed creates reject changed requests. Customer getOrCreate requires exact userId equality for a keyed mirror; omitted contact is preserved. Provider notes never assign app linkage. Payment linkage comes from its recorded order and refund linkage from its payment in the same testMode.

Checkout verification requires a component-created order or subscription and an authorized or captured payment. Optional userId enforces stored linkage; derive it from authenticated identity. Full-payment orders require equal amounts; partial-payment orders accept a positive amount up to the order amount. A verified callback does not establish capture.

## Errors

Export `RAZORPAY_ERROR_CODES`, `RazorpayErrorCode`, `RazorpayErrorData` and `isRazorpayError`. Error data is `{ code, message, retryable?, providerStatus?, providerCode? }`. Retryable appears only for provider and network failures; providerCode is bounded to 64 code units. The guard validates the exact message and rejects extra fields.

| Code                                 | Message                                                               | When                                                                |
| ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `RAZORPAY_INVALID_ARGUMENT`          | An argument is invalid, missing or out of bounds.                     | Caller arguments, page sizes or cursors are invalid.                |
| `RAZORPAY_INVALID_RESPONSE`          | The provider response is invalid or a required mirror is missing.     | A success response cannot be parsed or a mirror result is missing.  |
| `RAZORPAY_NOT_CONFIGURED`            | Razorpay component configuration is missing or invalid.               | Required component env is missing or a declared value is malformed. |
| `RAZORPAY_LIVE_KEY_TEST_MODE`        | Test mode cannot use a live Razorpay key.                             | Test operations select a recognizable live key.                     |
| `RAZORPAY_MODE_MISMATCH`             | The operation and mirror have different modes.                        | A stored mirror has the opposite testMode.                          |
| `RAZORPAY_CUSTOMER_CONFLICT`         | The customer belongs to another app user.                             | A keyed customer has different app user linkage.                    |
| `RAZORPAY_IDEMPOTENCY_REQUIRED`      | Refund creation requires an idempotency key or receipt.               | Refund creation supplies neither key nor receipt.                   |
| `RAZORPAY_IDEMPOTENCY_CONFLICT`      | The idempotency key or receipt identifies a different create request. | A key or receipt is reused with different arguments.                |
| `RAZORPAY_IDEMPOTENCY_PENDING`       | The create outcome is pending or unknown; reconcile before retrying.  | A provider create outcome remains unresolved.                       |
| `RAZORPAY_NOT_FOUND`                 | The required mirror does not exist.                                   | The requested mirror is absent in the selected testMode.            |
| `RAZORPAY_PROVIDER_ERROR`            | Razorpay returned a failure response.                                 | Razorpay returns a failure HTTP response.                           |
| `RAZORPAY_NETWORK_ERROR`             | The Razorpay network request failed with an uncertain outcome.        | The provider request produces no response.                          |
| `RAZORPAY_INVALID_WEBHOOK_SIGNATURE` | The webhook signature is invalid.                                     | A webhook signature is missing or wrong.                            |
| `RAZORPAY_MALFORMED_WEBHOOK`         | The webhook body or envelope is invalid or exceeds the size limit.    | A webhook envelope is invalid or oversized.                         |
| `RAZORPAY_INVALID_ENTITY`            | The webhook entities or their relationships are invalid.              | Webhook entities or relationships fail validation.                  |

## Testing

Register the component with `convex-test`:

```ts
import { register } from "@operatornest/convex-razorpay/test";
import { convexTest } from "convex-test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]));
register(t);
```

Test operations make no provider calls and do not create provider resources. Key prefixes do not select the mode; `rzp_live_` keys are rejected when test mode is enabled, including during webhook ingest. Mirrors store `testMode`; writes reject an existing mirror of the opposite mode, and local reads select only the requested mode. Webhook mode follows `RAZORPAY_TEST_MODE`. Test mode still requires secrets for webhook and Checkout signature verification. Stub `fetch` and env values with fabricated data in tests.

## Limits and retention

Idempotency claims are kept indefinitely, including pending, completed and failed claims. Only explicit aggregate release removes an unresolved claim after the app establishes its provider outcome; completed claims cannot be released. Entity mirrors also have no automatic age cutoff. Apps define reconciliation and erasure workflows. Raw provider fields may contain personal data; webhook raw bodies are not stored.

The daily cron removes webhook deduplication records older than 30 days in bounded batches. Reconciliation scans at most 20 pages of 100 records. A scan without a matching key leaves the claim pending, including when a short page ends the scan; absence cannot establish the original POST outcome.

Fetches return current provider data without changing mirrors. Webhooks compare only webhook timestamps stored as lastWebhookAt. Subscription state transitions and nondecreasing paid counts prevent old webhook events from reversing state; local observation timestamps do not order webhooks.

Payment-link signature verification is supported; payment-link CRUD, invoice CRUD, disputes, settlements, payouts and provider token management are excluded. Provider capture settings, subscription payment-method eligibility and deployed scheduler execution require account-specific verification. The component does not automatically retry provider calls.

Provider test-account observations: [redacted fixtures](https://github.com/OperatorNest/convex-razorpay/tree/main/tests/fixtures/e2e).

## Security

The app must authenticate and authorize every call, own trusted prices, and gate fulfillment on confirmed payment state. The component verifies webhooks over the unchanged raw body using constant-time HMAC comparison and accepts a previous secret during rotation. Missing secrets fail closed. Report issues through [private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new).

## Development

Use Node 24 and pnpm 12.9.1 through mise. Run pnpm build:codegen after function or schema changes, pnpm check for static and simulator checks, and pnpm smoke for fabricated-credential local Convex evidence. Setup and attended provider verification are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 OperatorNest.
