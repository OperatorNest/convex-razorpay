# ADR 0003: Financial mirror retention

The daily cron deletes webhook deduplication rows and failed idempotency claims older than 30 days in bounded batches. Entity mirrors, completed claims and pending claims have no automatic age cutoff. Completed claims preserve create deduplication; pending claims retain evidence of uncertain provider outcomes.

Apps must define reconciliation and erasure workflows. Indexed reads bound individual requests, not total retained storage.
