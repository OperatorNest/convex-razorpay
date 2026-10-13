---
"@operatornest/convex-razorpay": patch
---

Fix stored payment and subscription pagination in the Convex component runtime. Add convex-helpers `^0.1.128` as a peer dependency. Bound each page read to numItems + 1 rows and 1 MiB, including with endCursor, reject cursors longer than 4096 characters or holding more than 4 payment values or 5 subscription values with RAZORPAY_INVALID_ARGUMENT, and validate page results with Convex's paginationResultValidator.
