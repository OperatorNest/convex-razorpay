# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new). Include the affected version or revision, the Razorpay operation or webhook path, a minimal redacted reproduction, and the possible impact. Do not post exploit details in public issues or pull requests before maintainers can investigate.

The component holds Razorpay API and webhook credentials in Convex component environment variables. It verifies webhook signatures on the raw request body before changing mirror state. The consuming app is responsible for authentication, authorization, trusted amounts, fulfillment, and its own data-retention policy. A mirror's `raw` provider field can contain personal information. Never include credentials, customer records, payment details, or raw webhook bodies in a report.
