# 0005: Component pagination

Stored payment and subscription lists use `paginator` from `convex-helpers/server/pagination` because native database pagination is unsupported inside components. Queries retain their mode-scoped indexes and descending order.

Page sizes are integers from 1 through 100. `boundedPage` in `src/shared/bounds.ts` builds every page request: it reads at most `numItems + 1` rows and 1 MiB, including requests with `endCursor`, and ignores caller read budgets. Each cursor has at most 4096 characters and serializes a JSON array of at most 16 primitive values; other cursors raise `RAZORPAY_INVALID_ARGUMENT`. Callers reuse cursors returned by the same list. Results are validated by Convex's `paginationResultValidator`.
