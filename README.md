# @operatornest/convex-razorpay

Razorpay payments for Convex: server-side orders, payments, refunds, customers, plans, subscriptions, Checkout verification, and signed webhook mirroring in Convex's default V8 runtime.

[![CI](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/ci.yml) [![Release](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml/badge.svg)](https://github.com/OperatorNest/convex-razorpay/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/%40operatornest%2Fconvex-razorpay)](https://www.npmjs.com/package/@operatornest/convex-razorpay) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```sh
pnpm add @operatornest/convex-razorpay convex@^1.46.0 convex-helpers@^0.1.128
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
| `RAZORPAY_KEY_ID`                  | Provider operations outside local simulation  | Unset   | Nonempty `rzp_test_*` or `rzp_live_*` key               |
| `RAZORPAY_KEY_SECRET`              | Provider operations and Checkout verification | Unset   | Nonempty secret without surrounding whitespace          |
| `RAZORPAY_WEBHOOK_SECRET`          | Webhook ingest                                | Unset   | Nonempty secret without surrounding whitespace          |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` | No                                            | Unset   | Nonempty previous secret without surrounding whitespace |
| `RAZORPAY_TEST_MODE`               | No                                            | `false` | `true` or `false`                                       |

All declared component env is parsed by one function; a malformed value or a missing required credential raises `RAZORPAY_NOT_CONFIGURED`. Bind app values by reference. API and webhook secrets are separate; credentials never enter arguments or rows.

Test mode is enabled when the client option is `true`, `RAZORPAY_TEST_MODE` is `true`, or `RAZORPAY_KEY_ID` starts with `rzp_test_`; a false option cannot disable either env source. Test mode with a key ID calls Razorpay's test API with that key. Test mode without a key ID simulates provider operations locally and creates no provider resources. Simulation is selected only by an unset `RAZORPAY_KEY_ID`; `RAZORPAY_KEY_SECRET` may stay set, and simulated Checkout signatures are verified with it. Test mode with an `rzp_live_*` key raises `RAZORPAY_LIVE_KEY_TEST_MODE`. Outside test mode, provider operations without a key ID and key secret raise `RAZORPAY_NOT_CONFIGURED`. Every mirror stores the resolved testMode.

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

Locally simulated orders do not exist at Razorpay and cannot be used with Checkout.js. For Checkout in test mode, configure Razorpay `rzp_test_*` API credentials. `buildCheckoutOptions(order, { name: "My app" })` builds options from a provider-backed order; import this pure helper from the package.

Send Checkout's callback to an authenticated action using `razorpay.orders.verifyCheckout(ctx, { razorpayOrderId, razorpayPaymentId, signature, userId })`. Derive `userId` from the authenticated identity; omitting it skips the ownership check. Verification requires a component-created order in the selected mode and an authorized or captured payment. Full-payment orders require an equal amount; partial-payment orders accept a positive amount up to the order amount. `subscriptions.verifyCheckout` requires a component-created subscription in the selected mode. A verified callback does not prove capture; fulfill only after confirming a captured payment or paid order.

## Concepts

| Term                                                                                 | Meaning                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| orders, payments, refunds, customers, plans, subscriptions, paymentLinks             | Razorpay aggregates: payment requests, payments, returned amounts, customer profiles, recurring prices, billing agreements and payment URL callback signatures.                                                                                                                                          |
| row ID                                                                               | Component row identifier named for its entity, such as orderId.                                                                                                                                                                                                                                          |
| Razorpay ID                                                                          | Provider identifier named razorpayObjectId: razorpayOrderId, razorpayPaymentId, razorpayRefundId, razorpayCustomerId, razorpayPlanId, razorpaySubscriptionId, razorpayPaymentLinkId, razorpayInvoiceId, razorpayOfferId, razorpayAccountId or razorpayEntityId.                                          |
| userId, externalId                                                                   | Opaque app user and app resource linkage; neither grants authorization.                                                                                                                                                                                                                                  |
| testMode                                                                             | Provider test environment selected by client option, `RAZORPAY_TEST_MODE` or an `rzp_test_*` key and stored on mirrors; without a key ID it is simulated locally.                                                                                                                                        |
| idempotencyKey, receipt                                                              | Caller retry key and provider receipt reference; matching keys return the first create result.                                                                                                                                                                                                           |
| notes, metadata                                                                      | Provider key-value fields and app linkage fields merged into the provider notes limit.                                                                                                                                                                                                                   |
| amount, amountPaid, amountDue, amountRefunded, fee, tax                              | Integer amounts in the currency’s smallest unit; INR amounts are paise. Create amounts must be positive; Razorpay enforces its own currency minimums.                                                                                                                                                    |
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
| WebhookStatus                                                                        | processed after applying entities, ignored for unsupported events, failed for an invalid entity, a `RAZORPAY_STALE_WEBHOOK` event or an apply error, duplicate for an already recorded delivery; a redelivery of a failed event is processed again unless it failed as stale.                            |
| IdempotencyStatus                                                                    | pending while the provider outcome is unresolved, completed after storing its mirror, failed after definitive rejection.                                                                                                                                                                                 |

Idempotency keys are 1–128 ASCII letters, digits, underscores or hyphens. A key is scoped to its resource (order, plan, subscription, customer or refund) and testMode, not to a user; userId is part of the request, so reusing a key for another user raises `RAZORPAY_IDEMPOTENCY_CONFLICT`. A repeated key with the same arguments returns the first result without a second provider call; different arguments raise `RAZORPAY_IDEMPOTENCY_CONFLICT`. After a definitive provider refusal an order, plan, subscription or customer claim becomes failed, and the next call with that key sends a new request with any arguments. After an uncertain outcome the claim stays pending: a repeat within 10 minutes raises `RAZORPAY_IDEMPOTENCY_PENDING`, and a later repeat reconciles by finding the provider entity whose `operatornestIdempotencyKey` note carries the key. Refunds send the key, or a receipt-derived key, as Razorpay's `X-Refund-Idempotency` header, so Razorpay deduplicates a repeated refund request; a failed refund stores nothing. Only the app releases a claim, through `releaseIdempotency` on orders, plans, subscriptions or customers, and only while the claim is pending or failed. A claim lives until the app releases it; no cron removes claims.

Domain terms follow the [Razorpay API reference](https://razorpay.com/docs/api/). Raw provider fields retain provider spelling and units.

## Webhooks

Register the route in `convex/http.ts`, then configure its URL and secret in the Razorpay dashboard. The default path is `/razorpay/webhook`.

```ts
import { Razorpay } from "@operatornest/convex-razorpay";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api";

const http = httpRouter();
new Razorpay(components.razorpay).registerRoutes(http, {
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
import { webhookEventValidator } from "@operatornest/convex-razorpay";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const onEvent = internalMutation({
  args: webhookEventValidator,
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

`onEvent` is an optional internal mutation whose args are the exported `webhookEventValidator`, typed as `RazorpayWebhookEventArgs`: `{ eventId, event, razorpayEntityId?, razorpayAccountId?, providerCreatedAt }`. The component invokes it in the same transaction as mirror updates and deduplication. A callback failure rolls the transaction back and returns 500 so the provider may retry. Duplicate event ids, signed bodies and stale events return 200 without a callback. The route verifies the signature over the received bytes, including a leading UTF-8 byte order mark. It returns 400 for a body over 131072 bytes or not well-formed UTF-8, 401 for an invalid signature, and 500 when the secret is missing.

## API reference

Provider names and fields follow Razorpay’s [Orders](https://razorpay.com/docs/api/orders/), [Payments](https://razorpay.com/docs/api/payments/), [Refunds](https://razorpay.com/docs/api/refunds/), [Customers](https://razorpay.com/docs/api/customers/), [Plans](https://razorpay.com/docs/api/payments/subscriptions/create-plan/), [Subscriptions](https://razorpay.com/docs/api/payments/subscriptions/) and [Payment Links](https://razorpay.com/docs/api/payments/payment-links/) references.

Every method takes `(ctx, args)`. Constructor options select testMode and onEvent. Only declared fields are forwarded; omitted optional fields are passed as `undefined`. Mirror results expose row IDs such as orderId alongside provider IDs; fetch results contain no row IDs and store nothing. `link` is optional `{ userId?, externalId?, metadata?, idempotencyKey? }`.

| Method                             | Context  | Arguments                                                                                                                                | Result                                                                                                                                               |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.get`                       | query    | none                                                                                                                                     | `{ testMode, isSimulated, keyId, hasKeySecret, hasWebhookSecret, hasPreviousWebhookSecret }`; `keyId` is `null` when unset and no secret is returned |
| `orders.create`                    | action   | `{ amount, currency, partialPayment, receipt?, notes?, ...link }`                                                                        | Order mirror with orderId and `keyId`, which is undefined for simulated orders                                                                       |
| `orders.fetch`                     | action   | `{ razorpayOrderId }`                                                                                                                    | Provider order                                                                                                                                       |
| `orders.fetchPayments`             | action   | `{ razorpayOrderId }`                                                                                                                    | Provider payments of the order                                                                                                                       |
| `orders.get`                       | query    | `{ razorpayOrderId }`                                                                                                                    | Order mirror or `null`                                                                                                                               |
| `orders.verifyCheckout`            | action   | `{ razorpayOrderId, razorpayPaymentId, signature, userId? }`                                                                             | Verified payment mirror                                                                                                                              |
| `orders.releaseIdempotency`        | mutation | `{ idempotencyKey }`                                                                                                                     | `true` when an unresolved claim was released                                                                                                         |
| `payments.fetch`                   | action   | `{ razorpayPaymentId }`                                                                                                                  | Provider payment                                                                                                                                     |
| `payments.capture`                 | action   | `{ razorpayPaymentId, amount, currency }`                                                                                                | Captured payment mirror                                                                                                                              |
| `payments.fetchAll`                | action   | `{ count?, skip? }`                                                                                                                      | Provider page of payments                                                                                                                            |
| `payments.list`                    | query    | `{ razorpayOrderId, paginationOpts }`                                                                                                    | Page of payment mirrors, newest first                                                                                                                |
| `refunds.create`                   | action   | `{ razorpayPaymentId, amount, speed, receipt?, notes?, ...link }`                                                                        | Refund mirror                                                                                                                                        |
| `refunds.fetch`                    | action   | `{ razorpayRefundId }`                                                                                                                   | Provider refund                                                                                                                                      |
| `customers.create`                 | action   | `{ name, email, contact?, gstin?, notes?, ...link }`                                                                                     | Customer mirror                                                                                                                                      |
| `customers.getOrCreate`            | action   | Same as `customers.create`                                                                                                               | Existing keyed customer mirror for the same userId, or a new customer mirror                                                                         |
| `customers.fetch`                  | action   | `{ razorpayCustomerId }`                                                                                                                 | Provider customer                                                                                                                                    |
| `customers.edit`                   | action   | `{ razorpayCustomerId, name?, email?, contact? }`                                                                                        | Customer mirror                                                                                                                                      |
| `customers.get`                    | query    | `{ userId }`                                                                                                                             | Customer mirror or `null`                                                                                                                            |
| `customers.releaseIdempotency`     | mutation | `{ idempotencyKey }`                                                                                                                     | `true` when an unresolved claim was released                                                                                                         |
| `plans.create`                     | action   | `{ period, interval, item: { name, amount, currency, description? }, notes?, ...link }`                                                  | Plan mirror                                                                                                                                          |
| `plans.fetch`                      | action   | `{ razorpayPlanId }`                                                                                                                     | Provider plan                                                                                                                                        |
| `plans.fetchAll`                   | action   | `{ count?, skip? }`                                                                                                                      | Provider page of plans                                                                                                                               |
| `plans.releaseIdempotency`         | mutation | `{ idempotencyKey }`                                                                                                                     | `true` when an unresolved claim was released                                                                                                         |
| `subscriptions.create`             | action   | `{ razorpayPlanId, totalCount, quantity, customerNotify, startAt?, expiresAt?, razorpayOfferId?, notes?, ...link }`                      | Subscription mirror                                                                                                                                  |
| `subscriptions.fetch`              | action   | `{ razorpaySubscriptionId }`                                                                                                             | Provider subscription                                                                                                                                |
| `subscriptions.cancel`             | action   | `{ razorpaySubscriptionId }`                                                                                                             | Subscription mirror                                                                                                                                  |
| `subscriptions.cancelAtCycleEnd`   | action   | `{ razorpaySubscriptionId }`                                                                                                             | Subscription mirror                                                                                                                                  |
| `subscriptions.pause`              | action   | `{ razorpaySubscriptionId }`                                                                                                             | Subscription mirror                                                                                                                                  |
| `subscriptions.resume`             | action   | `{ razorpaySubscriptionId }`                                                                                                             | Subscription mirror                                                                                                                                  |
| `subscriptions.update`             | action   | `{ razorpaySubscriptionId, scheduleChangeAt, razorpayPlanId?, razorpayOfferId?, quantity?, remainingCount?, startAt?, customerNotify? }` | Subscription mirror                                                                                                                                  |
| `subscriptions.get`                | query    | `{ userId, statuses? }`                                                                                                                  | Preferred subscription mirror or `null`                                                                                                              |
| `subscriptions.list`               | query    | `{ userId, paginationOpts }`                                                                                                             | Page of subscription mirrors, newest first                                                                                                           |
| `subscriptions.verifyCheckout`     | action   | `{ razorpaySubscriptionId, razorpayPaymentId, signature, userId? }`                                                                      | Verified payment mirror                                                                                                                              |
| `subscriptions.releaseIdempotency` | mutation | `{ idempotencyKey }`                                                                                                                     | `true` when an unresolved claim was released                                                                                                         |
| `paymentLinks.verifyCheckout`      | action   | `{ razorpayPaymentLinkId, referenceId, status, razorpayPaymentId, signature }`                                                           | `true`                                                                                                                                               |

`buildCheckoutOptions(order, args?)` builds Checkout.js presentation options without a component call. The pure exports computeSha256Hex, computeHmacSha256Hex and compareHexSignatures compute SHA-256, sign with HMAC-SHA-256 and compare hexadecimal signatures in constant time. `client.registerRoutes(http, args?)` registers the signed webhook route; `args.onEvent` overrides the constructor's onEvent.

Provider pages default to count 10 and skip 0. Stored pages accept only cursors returned by the same list, and results use Convex's pagination result shape. Invalid page sizes and cursors raise RAZORPAY_INVALID_ARGUMENT. Subscription get prefers active, authenticated, pending, halted, then paused; otherwise it selects the newest matching mirror.

All strings reject unpaired surrogates. Caller note and metadata keys beginning with operatornest are reserved. [Limits and retention](#limits-and-retention) lists every input bound.

Refund creation requires an idempotency key or receipt. Keyed creates reject changed requests. Keyed customer creates claim the key, send it as the `operatornestIdempotencyKey` provider note, and reconcile an unresolved claim by listing provider customers, as orders, plans and subscriptions do. Refund and customer keys resolve to a separate row in each testMode. Customer getOrCreate requires exact userId equality for a keyed mirror; omitted contact is preserved. Provider notes never assign app linkage. Payment linkage comes from its recorded order and refund linkage from its payment in the same testMode.

Checkout verification requires a component-created order or subscription and an authorized or captured payment. Optional userId enforces stored linkage; derive it from authenticated identity. Full-payment orders require equal amounts; partial-payment orders accept a positive amount up to the order amount. A verified callback does not establish capture.

## Errors

Export `RAZORPAY_ERROR_CODES`, `RazorpayErrorCode`, `RazorpayErrorData` and `isRazorpayError`. Error data is `{ code, message, retryable?, providerStatus?, providerCode? }`. `retryable` is present exactly on `RAZORPAY_PROVIDER_ERROR` and `RAZORPAY_NETWORK_ERROR`. It is `true` only when repeating the identical call cannot create a second provider effect: the call is a read, the call carries an idempotency key the component or Razorpay deduplicates (keyed order, customer, plan and subscription creates, every refund, payment capture), or Razorpay definitively refused it with a 4xx status other than 409 or 429. Customer edits and subscription cancel, pause, resume and update are never retryable after an uncertain outcome, because an intervening change can make a repeat take effect. providerCode is bounded to 64 code units. The guard validates the exact message and rejects extra fields.

| Code                                 | Message                                                               | When                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_INVALID_ARGUMENT`          | An argument is missing, malformed or out of bounds.                   | Caller arguments, page sizes or cursors are invalid.                                                                   |
| `RAZORPAY_INVALID_RESPONSE`          | The provider response is invalid or a required mirror is missing.     | A response is a redirect, a success response exceeds 4194304 bytes or cannot be parsed, or a mirror result is missing. |
| `RAZORPAY_NOT_CONFIGURED`            | Razorpay component configuration is missing or invalid.               | Required component env is missing or a declared value is malformed.                                                    |
| `RAZORPAY_LIVE_KEY_TEST_MODE`        | Test mode cannot use a live Razorpay key.                             | Test operations select a recognizable live key.                                                                        |
| `RAZORPAY_MODE_MISMATCH`             | The operation and mirror have different modes.                        | A stored mirror has the opposite testMode.                                                                             |
| `RAZORPAY_CUSTOMER_CONFLICT`         | The customer belongs to another app user.                             | A keyed customer has different app user linkage.                                                                       |
| `RAZORPAY_IDEMPOTENCY_REQUIRED`      | Refund creation requires an idempotency key or receipt.               | Refund creation supplies neither key nor receipt.                                                                      |
| `RAZORPAY_IDEMPOTENCY_CONFLICT`      | The idempotency key or receipt identifies a different create request. | A key or receipt is reused with different arguments.                                                                   |
| `RAZORPAY_IDEMPOTENCY_PENDING`       | The create outcome is pending or unknown; reconcile before retrying.  | A provider create outcome remains unresolved.                                                                          |
| `RAZORPAY_NOT_FOUND`                 | The required mirror does not exist.                                   | The requested mirror is absent in the selected testMode.                                                               |
| `RAZORPAY_PROVIDER_ERROR`            | Razorpay returned a failure response.                                 | Razorpay returns a failure HTTP response.                                                                              |
| `RAZORPAY_NETWORK_ERROR`             | The request to Razorpay failed before a response arrived.             | The provider request produces no response within 10 seconds.                                                           |
| `RAZORPAY_INVALID_WEBHOOK_SIGNATURE` | The webhook signature is missing or wrong.                            | A webhook signature is missing or wrong.                                                                               |
| `RAZORPAY_MALFORMED_WEBHOOK`         | The webhook body or envelope is invalid or exceeds the size limit.    | A webhook envelope is invalid or oversized.                                                                            |
| `RAZORPAY_INVALID_ENTITY`            | The webhook entities or their relationships are invalid.              | Webhook entities or relationships fail validation.                                                                     |
| `RAZORPAY_INVALID_PAYMENT_SIGNATURE` | The Checkout payment signature is invalid.                            | An order, subscription or payment-link Checkout signature is wrong.                                                    |
| `RAZORPAY_STALE_WEBHOOK`             | The webhook event is older than the deduplication retention window.   | A signed event is older than webhook retention minus one day.                                                          |

## Testing

Register the component with `convex-test`:

```ts
import { register } from "@operatornest/convex-razorpay/test";
import { convexTest } from "convex-test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]));
register(t);
```

Set `RAZORPAY_TEST_MODE=true` and leave `RAZORPAY_KEY_ID` unset to simulate provider operations locally without provider calls. An `rzp_test_*` key ID selects test mode and calls Razorpay's test API; an `rzp_live_*` key in test mode raises `RAZORPAY_LIVE_KEY_TEST_MODE`, including during webhook ingest. Mirrors store `testMode`; writes reject an existing mirror of the opposite mode, and local reads select only the requested mode. Webhook mode follows `RAZORPAY_TEST_MODE` and the key prefix. Simulation still requires secrets for webhook and Checkout signature verification. Stub `fetch` and env values with fabricated data in tests.

## Limits and retention

| Input                                    | Limit                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider page `count`                    | 1–100; default 10                                                                                                                                        |
| Provider page `skip`                     | 0–900; default 0                                                                                                                                         |
| Stored page `paginationOpts.numItems`    | 1–100                                                                                                                                                    |
| Stored page cursor and `endCursor`       | At most 4096 characters; a JSON array of at most 16 values                                                                                               |
| Stored page reads                        | At most numItems + 1 rows and 1 MiB per page, including with `endCursor`                                                                                 |
| Subscription get `statuses`              | At most 20                                                                                                                                               |
| Notes and metadata                       | 15 entries each; keys of 1 to 256 printable ASCII characters not starting with `$`, values up to 256 UTF-16 code units; merged provider notes 15 entries |
| Linkage strings (`userId`, `externalId`) | 1–256 UTF-16 code units                                                                                                                                  |
| Idempotency key                          | 1–128 ASCII letters, digits, underscores or hyphens                                                                                                      |
| Plan item name and description           | Name 1–256 and description 1–4096 UTF-16 code units                                                                                                      |
| Customer fields                          | Name 3–50 characters; email at most 64; contact 8–15 digits with optional leading plus; gstin 15 uppercase letters or digits                             |
| Webhook body                             | At most 131072 bytes                                                                                                                                     |
| Provider response body                   | At most 4194304 bytes; a request without a response after 10 seconds raises `RAZORPAY_NETWORK_ERROR`                                                     |
| Provider error `providerCode`            | At most 64 UTF-16 code units                                                                                                                             |
| Claim reconciliation                     | At most 20 provider pages of 100 records                                                                                                                 |

Idempotency claims are kept indefinitely, including pending, completed and failed claims. Only `releaseIdempotency` on orders, plans, subscriptions or customers removes an unresolved claim, after the app establishes its provider outcome; completed claims cannot be released. Entity mirrors also have no automatic age cutoff. Apps define reconciliation and erasure workflows. Raw provider fields may contain personal data; webhook raw bodies are not stored.

The daily cron `"cleanup"` runs the internal mutation `cleanup.run`, which deletes webhook deduplication records older than 30 days in batches of 100 and reschedules itself while a batch fills; it has no public function. A signed event created more than 29 days before receipt is recorded as a failed receipt with `RAZORPAY_STALE_WEBHOOK`, returns 200 and does not invoke onEvent, so a provider retry after cleanup cannot apply it again. A reconciliation scan without a matching key leaves the claim pending, including when a short page ends the scan; absence cannot establish the original POST outcome.

Fetches return current provider data without changing mirrors. Webhooks compare only webhook timestamps stored as lastWebhookAt. Subscription state transitions and nondecreasing paid counts prevent old webhook events and provider operation responses from reversing state; local observation timestamps do not order webhooks.

Payment-link signature verification is supported; payment-link CRUD, invoice CRUD, disputes, settlements, payouts and provider token management are excluded. Provider capture settings, subscription payment-method eligibility and deployed scheduler execution require account-specific verification. The component does not automatically retry provider calls. When capture returns a 4xx response, the component fetches the payment and stores and returns it only if it is captured with the requested amount and currency; otherwise the original error is raised.

Provider test-account observations: [redacted fixtures](https://github.com/OperatorNest/convex-razorpay/tree/main/tests/fixtures/e2e).

## Security

The app must authenticate and authorize every call, own trusted prices, and gate fulfillment on confirmed payment state. The component verifies webhooks over the unchanged raw body using constant-time HMAC comparison and accepts a previous secret during rotation. Missing secrets fail closed. Report issues through [private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new).

## Development

Use Node 24 and pnpm 12.9.1 through mise. Run pnpm build:codegen after function or schema changes, pnpm check for static and simulator checks, and pnpm smoke for fabricated-credential local Convex evidence. Setup and attended provider verification are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 OperatorNest.
