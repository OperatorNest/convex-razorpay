# ADR 0004: Mode and error boundaries

Every mirror stores its mode. Client-read indexes include mode; writers reject opposite-mode rows before updates. Synthetic mode requires explicit configuration and rejects recognizable live keys. Signed webhooks follow the component env mode.

Consumer errors use one code list and one fixed message per code. Provider failures may add only HTTP status and a provider code bounded to 64 UTF-16 code units. The guard validates all declared fields and rejects undeclared fields.

Ownership comes only from explicit app linkage, stored linkage or a recorded parent. Provider notes never establish ownership. Caller note and metadata keys beginning with `operatornest` are rejected case-insensitively; component linkage notes use that namespace.

Order, plan and subscription claims, fingerprints, completed mirror lookups and claim release include mode. Subscription fetches apply current provider state; webhook freshness compares only provider event times stored separately from local observation times.
