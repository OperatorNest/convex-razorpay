# 0004: Mode and error boundaries

Every mirror stores the resolved testMode. Client-read indexes include mode; writers reject opposite-mode rows before updates. `resolveTestMode` enables test mode when the client option is true, `RAZORPAY_TEST_MODE` is `true`, or `RAZORPAY_KEY_ID` starts with `rzp_test_`; a false option cannot disable either env source. Test mode with an `rzp_live_` key raises `RAZORPAY_LIVE_KEY_TEST_MODE`. Test mode with a key ID calls Razorpay's test API. Test mode without a key ID simulates provider operations locally. Outside test mode, missing provider credentials raise `RAZORPAY_NOT_CONFIGURED`. Signed webhooks follow the env mode resolved without a client option.

Consumer errors use one code list and one fixed message per code. Provider and network failures include retryable; provider failures may add HTTP status and a provider code bounded to 64 UTF-16 code units. The guard validates all declared fields and rejects undeclared fields. Checkout signature failures raise `RAZORPAY_INVALID_PAYMENT_SIGNATURE`; argument validation failures raise `RAZORPAY_INVALID_ARGUMENT`.

Ownership comes only from explicit app linkage, stored linkage or a recorded parent. Provider notes never establish ownership. Caller note and metadata keys beginning with `operatornest` are rejected case-insensitively; component linkage notes use that namespace.

Order, plan, subscription and customer claims, fingerprints, completed mirror lookups and claim release include mode. Refund and customer idempotency lookups use `by_idempotencyKey_and_testMode`. Provider fetches store nothing; webhook freshness compares only provider event times stored separately from local observation times.
