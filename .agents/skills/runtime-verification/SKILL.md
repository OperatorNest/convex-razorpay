---
name: runtime-verification
description: Contributor guidance for runtime verification.
---

# Runtime verification

Read AGENTS, package scripts and smoke. Run affected tests and the required gate. For schema or component changes, generate bindings with build:codegen and run smoke; never edit generated output. Executable docs require their affected tests; prose requires formatting.

Report simulator, anonymous local runtime and provider proof separately. Smoke uses fabricated credentials and does not qualify provider accounts. Interactive e2e requires an attended maintainer test account outside CI; start with dry-run. Keep secrets ignored and review redacted fixtures. Shared locks serialize backend access; never terminate another checkout's backend.
