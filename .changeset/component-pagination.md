---
"@operatornest/convex-razorpay": patch
---

Fix stored payment and subscription pagination in the Convex component runtime. Add convex-helpers as a peer dependency and bound reads to numItems + 1 rows, including with endCursor.
