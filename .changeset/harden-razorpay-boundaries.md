---
"@operatornest/convex-razorpay": minor
---

Harden provider trust, mode isolation and create deduplication for 0.3.0.

Breaking changes:

- Use Node 24 or newer for the development toolchain.
- Replace `retryable` and variable error messages with fixed `{ code, message }` data. Provider failures optionally add `providerStatus` and `providerCode` (64 code units maximum). Branch on codes and reconcile uncertain creates with their original key; the error guard rejects undeclared fields.
- Select local-read mode through the Razorpay client constructor. Direct component queries accept optional `testMode`; omission follows component env. Reads omit opposite-mode mirrors and writes reject them. Signed webhooks in synthetic mode reject live API keys.
- Recreate stored component data for the changed schema and indexes: orders require `partialPayment`, customers retain a request fingerprint, and client-read indexes include mode. No data migration is provided.
- Supply local list limits as integers from 1 to 100; the default remains 50. Provider count and skip bounds remain 1–100 and 0–900.
- Keep notes and metadata within 15 entries each and the merged notes within 15; keys and values are bounded to 256 code units. Linkage IDs require 1–256 code units; plan names 1–256 and descriptions 1–4096. Reject unpaired surrogates.
- Do not rely on extra per-call client fields: only declared arguments are forwarded, including declared nested plan-item fields. Set `testMode` only on the client.
- Reuse customer create keys only for identical requests, including ownership, GSTIN, notes and metadata. `getOrCreate` can refresh a same-owner profile while preserving omitted contact.
- Unkeyed synthetic creates now receive independent IDs; use a key for deduplication. Completed order, plan and subscription claims remain retained beyond 30 days.
- Duplicate-receipt order recovery requires matching receipt, amount, currency, notes and partial-payment policy. Malformed or contradictory invoice linkage rejects the webhook transaction.
- Maintainer queries `webhooks.e2eReceipt` and `refunds.e2eRefund` are removed from the published component; the harness reads local tables through the Convex CLI.

Checkout verification accepts positive partial payments up to a partial-payment order's amount. Synthetic orders cannot open provider Checkout.js. Webhook HTTP decoding preserves signed byte-order marks; malformed UTF-8 is rejected.

- Derive mirror ownership only from explicit app linkage, stored linkage or a recorded parent; ignore provider ownership notes, write component notes as `operatornestUserId` and `operatornestExternalId`, and reject all caller note or metadata keys starting with `operatornest`, case-insensitively.
- Allocate independent unkeyed synthetic order IDs and reject duplicate receipts without returning another user's order.
- Reject keyed customer `getOrCreate` unless the stored and requested `userId` are exactly equal, including omission; never attach an unowned keyed customer to a new owner.
- Always apply current provider subscription fetches; order webhook updates by their separate `lastWebhookCreatedAtProvider` field and enforce webhook status transitions.
- Scope order, plan and subscription claims, request fingerprints, completed reads and claim release by `testMode`; the same key can be used independently in both modes.
- Adopt a duplicate-receipt provider order only when its `operatornestIdempotencyKey` equals the claim key and its request fields match; otherwise preserve the provider rejection.
- Return `RAZORPAY_IDEMPOTENCY_PENDING` for unresolved reconciliation after scanning at most 2000 provider records; never repeat its POST until the app resolves the outcome and releases the claim.
