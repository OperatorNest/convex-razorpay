# @operatornest/convex-razorpay

## 0.3.0

### Minor Changes

- d9900e7: - Breaking: test mode is also enabled by an `rzp_test_` key ID and calls Razorpay's test API; local simulation runs only in test mode without `RAZORPAY_KEY_ID`.
  - Breaking: the public `webhooks.cleanup` mutation is removed; retention cleanup runs only from the internal cron.
  - Breaking: Checkout signature failures raise `RAZORPAY_INVALID_PAYMENT_SIGNATURE` instead of `RAZORPAY_INVALID_ARGUMENT`.
  - Breaking: signed events older than webhook retention minus one day are recorded as failed receipts with `RAZORPAY_STALE_WEBHOOK` and acknowledged with 200 without invoking onEvent.
  - Breaking: refunds use `by_idempotencyKey_and_testMode_and_idempotencyUserId`, customers use `by_idempotencyKey_and_testMode_and_userId`, and claims accept the `customer` resource.
  - Breaking: order and plan amounts accept positive safe integers below 100; Razorpay enforces its own currency minimums.
  - Keyed customer creates claim the key, send the `operatornestIdempotencyKey` note and reconcile by listing provider customers.
  - Breaking: customers.create compares the complete request fingerprint when reusing a key, including gstin, notes, externalId and metadata; keep these fields identical on retries or use a new key for a distinct create.
  - Subscription provider operation responses cannot revive a terminal status or lower paidCount.
  - A capture 4xx returns the payment when a fetch shows it captured with the requested amount and currency.
  - A simulated duplicate receipt is a definitive refusal: it is not retryable and leaves the keyed claim failed.
  - The package exports `webhookEventValidator` for app webhook callback args.
  - Breaking: onEvent callbacks must return null; declare `returns: v.null()` and return null from the handler.
  - Breaking: `isRazorpayError` rejects `RAZORPAY_PROVIDER_ERROR` and `RAZORPAY_NETWORK_ERROR` data without a boolean `retryable`.
  - The package exports the `QueryContext`, `MutationContext` and `ActionContext` types that client methods accept.
  - Client methods pass omitted optional arguments to component functions as `undefined` fields.
  - `buildCheckoutOptions` returns every Checkout field, with `undefined` for omitted options and for the key of simulated orders.
  - Customers add `releaseIdempotency`, which removes an unresolved customer claim after the app establishes its provider outcome.
  - Breaking: a failed webhook receipt no longer deduplicates a redelivery of the same event; the redelivery is applied again and replaces the receipt, except a `RAZORPAY_STALE_WEBHOOK` receipt, which still deduplicates.
  - Breaking: note and metadata keys must be 1 to 256 printable ASCII characters not starting with `$`; client methods raise `RAZORPAY_INVALID_ARGUMENT` for other keys before calling the component.
  - Breaking: supplied userId and externalId must be nonempty, well-formed strings of at most 256 UTF-16 code units; plan item names allow 1–256 and supplied descriptions allow 1–4096 code units, and note and metadata values must be well-formed Unicode; omit optional empty strings or update invalid values.
  - Breaking: caller note and metadata keys beginning with `operatornest`, case-insensitively, raise `RAZORPAY_INVALID_ARGUMENT`; rename these keys, and update integrations reading generated linkage notes from `userId` and `externalId` to `operatornestUserId` and `operatornestExternalId`.
  - Provider responses and signed webhook bodies drop keys that are not Convex field names before storing mirrors.
  - Breaking: provider notes no longer establish app linkage or complete idempotency claims; supply linkage through component create arguments and reconcile unresolved creates through their original keyed request.
  - A subscription stored with status `unknown` advances to any known status.
  - A capture 4xx whose reconcile fetch fails rethrows the capture error instead of the fetch error.
  - Refund request fingerprints include testMode and serialize fields in stable key order.
  - Breaking: `retryable` requires both a transient failure (network failure, timeout, 408, 429 or 5xx) and repeat safety (a read, a deduplicated key, 429 or a failure before sending). Every other 4xx and uncertain unkeyed creates, customer edits and subscription changes have `retryable: false`. A create timeout with status 408 leaves its claim pending.
  - Breaking: the free `registerRoutes(http, component, options)` export is removed; register the webhook route with `client.registerRoutes(http, options)`.
  - Breaking: the webhook route answers 400 instead of 413 for a body over 131072 bytes.
  - Breaking: idempotency keys accept 1 to 128 characters; the minimum length of 10 is removed.
  - Breaking: the `RAZORPAY_INVALID_ARGUMENT`, `RAZORPAY_NETWORK_ERROR` and `RAZORPAY_INVALID_WEBHOOK_SIGNATURE` messages change to "An argument is missing, malformed or out of bounds.", "The request to Razorpay failed before a response arrived." and "The webhook signature is missing or wrong.".
  - Breaking: provider requests do not follow redirects; a redirect, or a success response over 4194304 bytes or not well-formed UTF-8, raises `RAZORPAY_INVALID_RESPONSE`.
  - `config.get` returns the effective test mode, whether calls are simulated, the key ID and which secrets are set, without any secret.

  - Breaking: idempotency keys are scoped by resource, testMode and supplied userId; an omitted userId selects a separate scope. Claims, completed mirror lookups, release, provider reconciliation notes, generated order receipts, refund headers and simulated IDs use that scope. Existing claims and provider notes require app reconciliation before using the new scope.
  - Breaking: orders, plans, subscriptions and customers accept optional userId on releaseIdempotency; callers pass the same userId as the create. Refund mirrors add idempotencyUserId to preserve caller scope when userId inherits payment ownership.
  - The registered webhook route returns 500 for failed ingest results except stale events, allowing provider redelivery after an apply failure; processed, ignored, duplicate and stale events return 200.
  - Breaking: stored payment cursors reject more than 4 values and subscription cursors reject more than 5 values, matching each paginated index's declared fields plus _creationTime and _id; shorter prefix cursors remain valid.
- 59c6180: BREAKING: Move Checkout verification into orders, subscriptions and paymentLinks, and claim release into orders, plans and subscriptions.
  BREAKING: Name provider IDs razorpayObjectId and mirror row IDs objectId.
  BREAKING: Existing 0.2.0 rows fail schema validation on push; before upgrading, reconcile outstanding provider operations and clear the component's orders, payments, refunds, customers, plans, subscriptions, webhookEvents and idempotencyRequests tables, or remove and re-add the component; no migration is provided.
  BREAKING: Rename stored customer and subscription reads to get and list with explicit filters.
  BREAKING: Stored order, customer, payment and subscription reads now filter by the client's effective testMode; select the matching mode to read existing mirrors.
  BREAKING: Rename provider collection reads to fetchAll and make every fetch store nothing.
  BREAKING: Client mirror results omit `_creationTime` and replace `_id` with the entity-specific row ID; provider fetch results contain neither system field nor a mirror row ID, so update result validators and code reading those fields.
  BREAKING: Require paginationOpts for stored lists and return Convex pages.
  BREAKING: Rename checkoutOptions to buildCheckoutOptions.
  BREAKING: Require explicit order partialPayment, refund amount and speed, subscription quantity, customerNotify and update scheduleChangeAt.
  BREAKING: Replace cancellation timing flags with cancel and cancelAtCycleEnd methods.
  BREAKING: Use millisecond subscription timestamps and name expiresAt, currentStartAt, currentEndAt, providerCreatedAt, providerUpdatedAt and lastWebhookAt.
  BREAKING: A false testMode option cannot disable component env test mode.
  BREAKING: Export RAZORPAY_ERROR_CODES and remove the RazorpayError alias.
  BREAKING: Replace provider rejection and HTTP codes with RAZORPAY_PROVIDER_ERROR and use RAZORPAY_NOT_CONFIGURED for missing webhook secrets.
  BREAKING: Rename crypto helpers to computeSha256Hex, computeHmacSha256Hex and compareHexSignatures.
  Report unparseable provider success responses as RAZORPAY_INVALID_RESPONSE.
  Reject malformed component env and invalid fixed-message error shapes.
  Expose status unions and aggregate method documentation in declaration files.
  BREAKING: subscriptions.get statuses must use SubscriptionStatus values, and paymentLinks.verifyCheckout status must use PaymentLinkStatus values; arbitrary strings are no longer accepted.
  Retain idempotency claims indefinitely and retain webhook delivery deduplication for 30 days.
  BREAKING: An unresolved keyed create whose provider reconciliation scan finds no match remains pending and raises RAZORPAY_IDEMPOTENCY_PENDING instead of issuing another create; establish the provider outcome before explicitly releasing the claim.

### Patch Changes

- 59c6180: Fix stored payment and subscription pagination in the Convex component runtime. Add convex-helpers `^0.1.128` as a peer dependency. Bound each page read to numItems + 1 rows and 1 MiB, including with endCursor, reject cursors longer than 4096 characters or holding more than 4 payment values or 5 subscription values with RAZORPAY_INVALID_ARGUMENT, and validate page results with Convex's paginationResultValidator.
- Breaking: Node.js 24 or newer is required; Node.js 22 is no longer supported.

## 0.2.0

### Minor Changes

- 96daa46: The repository was re-created with a clean history; package code and public API are unchanged from 0.1.1 except for the internal query renames described below. The maintainer provider check is now `pnpm e2e`. Internal queries `webhooks.liveReceipt` and `refunds.liveRefund` are renamed to `webhooks.e2eReceipt` and `refunds.e2eRefund`; the public client API is unchanged.

## 0.1.1

### Patch Changes

- Publish from GitHub Actions through npm trusted publishing, with signed npm provenance attestations. No API or behavior changes.

## 0.1.0

- First public release: grouped Razorpay client for orders, payments, refunds, customers, plans, subscriptions, and checkout verification.
- Verified webhook ingest with event and body-hash deduplication, transactional app callback, and batched retention.
- Explicit local test mode, typed error codes, example app, and real-runtime smoke checks.
- Tri-state `testMode`, mode-tagged rows with `RAZORPAY_MODE_MISMATCH` isolation, idempotency claims for orders, `RAZORPAY_IDEMPOTENCY_CONFLICT` and `RAZORPAY_NOT_FOUND` on every relevant path, stricter checkout verification, and the pure `checkoutOptions` helper.
