# @operatornest/convex-razorpay

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
