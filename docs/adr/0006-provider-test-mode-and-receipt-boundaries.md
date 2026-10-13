# 0006: Provider test mode and receipt boundaries

Test mode selects Razorpay's test environment instead of always simulating. An `rzp_test_` key ID enables test mode and calls the test API, so mirrors created with test keys store `testMode: true`. Local simulation runs only when test mode is resolved and `RAZORPAY_KEY_ID` is unset; `RAZORPAY_KEY_SECRET` may remain set for Checkout signature verification.

Webhook deduplication cleanup is an internal mutation scheduled by the daily cron; its cutoff is never newer than the retention cutoff. A signed event whose `created_at` is older than retention minus one day is recorded as a failed receipt with `RAZORPAY_STALE_WEBHOOK` and acknowledged with HTTP 200 without invoking onEvent, so a provider retry after its deduplication row expires cannot reapply it.

Customer creates with an idempotency key use the same claim scoped by resource, testMode and supplied userId, `operatornestIdempotencyKey` provider note and listing reconciliation as orders, plans and subscriptions; the claim resource union includes `customer`. Keyed mirror indexes include testMode and supplied userId so one key resolves to a separate row for each user and mode; refund indexes use idempotencyUserId because mirror userId may inherit payment ownership.

Subscription provider operation responses pass through the same status-advance rule as webhooks. A capture 4xx is recovered only when a fetched payment is captured with the requested amount and currency. A simulated duplicate receipt is a definitive refusal, so it leaves its keyed claim failed; retryable is false because a 400 is not transient.

Checkout signature failures raise `RAZORPAY_INVALID_PAYMENT_SIGNATURE`. Order and plan amounts require a positive integer; Razorpay enforces currency minimums. The package exports `webhookEventValidator` for app callback args.
