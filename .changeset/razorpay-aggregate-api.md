---
"@operatornest/convex-razorpay": minor
---

BREAKING: Move Checkout verification into orders, subscriptions and paymentLinks, and claim release into orders, plans and subscriptions.
BREAKING: Name provider IDs razorpayObjectId and mirror row IDs objectId.
BREAKING: Rename stored customer and subscription reads to get and list with explicit filters.
BREAKING: Rename provider collection reads to fetchAll and make every fetch store nothing.
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
Retain idempotency claims indefinitely and retain webhook delivery deduplication for 30 days.
