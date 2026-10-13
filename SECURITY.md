# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new). Include the affected version, operation, redacted reproduction and impact. Keep exploit details private until maintainers investigate.

API and webhook credentials belong in component env variables. Signed webhooks verify the unchanged raw body before a transaction updates mirrors and invokes the callback. The app owns authentication, authorization, trusted amounts, fulfillment and erasure. Provider `raw` fields may contain personal data; exclude credentials, customer records, payment details and webhook bodies from reports.
