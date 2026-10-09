---
"@operatornest/convex-razorpay": minor
---

The repository was re-created with a clean history; package code and public API are unchanged from 0.1.1 except for the internal query renames described below. The maintainer provider check is now `pnpm e2e`. Internal queries `webhooks.liveReceipt` and `refunds.liveRefund` are renamed to `webhooks.e2eReceipt` and `refunds.e2eRefund`; the public client API is unchanged.
