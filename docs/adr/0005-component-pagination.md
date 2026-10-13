# ADR 0005: Component pagination

Stored payment and subscription lists use `paginator` from `convex-helpers/server/pagination` because native database pagination is unsupported inside components. Queries retain their mode-scoped indexes and descending order.

Page sizes are integers from 1 through 100. Each request reads at most `numItems + 1` rows, including requests with `endCursor`. Both cursors must serialize Convex arrays; malformed cursors raise `RAZORPAY_INVALID_ARGUMENT`. Callers reuse cursors returned by the same list. Results contain `page`, `isDone` and `continueCursor`.
