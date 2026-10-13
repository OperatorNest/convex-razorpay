# 0003: Financial mirror retention

The daily cron deletes webhook deduplication rows older than 30 days in bounded batches. Entity mirrors and every idempotency claim have no automatic age cutoff. Completed claims preserve create deduplication; pending and failed claims preserve evidence of provider outcomes. Explicit aggregate release can remove an unresolved claim after the app establishes its provider outcome; completed claims cannot be released.

Apps define reconciliation and erasure workflows. Indexed reads bound individual requests, not total retained storage.
