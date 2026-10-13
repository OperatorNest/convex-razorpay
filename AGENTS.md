The package is `@operatornest/convex-razorpay`, component name `razorpay`.

## Scope

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), relevant [ADRs](docs/adr/) and `example/convex/_generated/ai/guidelines.md`. [Concepts](README.md#concepts) defines caller vocabulary. Contributor guides live in `.agents/skills/`.

`src/component/` owns provider transport, trust, mirrors, cron and generated bindings. `src/client/` owns app-facing calls. `src/shared/` is runtime-neutral. `src/test.ts` registers `convex-test`; `example/convex/` exercises the package.

Client groups match component modules: orders, payments, refunds, customers, plans, subscriptions and paymentLinks. Each method takes a context and one argument object, copying declared arguments explicitly. Provider identifiers name Razorpay and their entity; row identifiers name their entity. Provider fetches store nothing; get and list read mirrors. Export each status union and give every exported client method and type one TSDoc sentence.

## Runtime and security boundaries

Authored `src/` runs in Convex V8 and edge runtimes. Use platform fetch, WebCrypto and generated env; never add `"use node"`, Node built-ins, `Buffer` or `process`. Keep zero runtime dependencies and `convex` as a `^1.46.0` peer.

Credentials belong only in component env bound by app reference. Never put real credentials in arguments, rows, logs, tests or examples. Parse all component env through `readConfig(env)`; missing required values and malformed values raise `RAZORPAY_NOT_CONFIGURED`. Resolve test mode only through `resolveRazorpayTestMode`, which extends the shared `resolveTestMode`: a true client option, `RAZORPAY_TEST_MODE=true` or an `rzp_test_` key ID enables it, and a false option cannot disable either env source. Test mode with a key ID calls Razorpay's test API; test mode without a key ID simulates locally. Reject `rzp_live_` keys in test mode.

Every provider mirror stores `testMode`. Read indexes include testMode; writes reject an existing opposite-testMode row. Provider notes cannot establish app linkage or settle claims without an explicit request fingerprint. App authentication, authorization, trusted prices and fulfillment remain app responsibilities.

Provider responses and signed webhooks share internal apply mutations. Verify the unchanged raw-body HMAC with the current or previous secret before mirror updates, deduplication and the optional callback execute in one transaction. Reject missing secrets. Only provider-verified data or explicitly selected test operations may change payment state.

## Query and validator patterns

Public functions declare `args` and `returns`. Use `schema.doc` for mirrors and shared validators with `Infer` for shared shapes. Allow `v.any()` only for unindexed provider fields named `raw*`. Reads are bounded and indexed; index names list fields in order joined by `_and_`. Page reads pass `boundedPage(paginationOpts, indexKeyLength)` from `src/shared/bounds.ts` to `paginate`, where indexKeyLength is the declared index field count plus 2, and return `paginationResultValidator`. Validate page limits before database reads. Queries must not use `Date.now()`; mutations must not fan out unbounded requests.

Consumer errors come from `razorpayError` in `src/shared/errors.ts`. Maintain one `RAZORPAY_ERROR_CODES` list, fixed messages, a complete shape guard and the README error table. Error data is `{ code, message, retryable?, providerStatus?, providerCode? }`; every provider and network error passes `retryable` explicitly and no other code carries it, and provider codes are bounded to 64 code units. Never expose provider descriptions, response bodies or caller fields in errors, or throw plain `Error` to consumers.

Keep idempotency claims indefinitely; unresolved claims require reconciliation before explicit release. Webhook deduplication retention uses bounded batches in an internal function; signed events older than retention minus one day are recorded as failed receipts with `RAZORPAY_STALE_WEBHOOK`.

## Generated files

Initialize a fresh checkout with `CONVEX_AGENT_MODE=anonymous pnpm exec convex init`, then `pnpm build:codegen`. Never edit `_generated/` by hand; regenerate after schema or function changes and commit tracked output with its inputs. `dist/` is ignored build output.

## Toolchain and verification

Use tracked `.mise.toml` with `mise trust && mise install`: Node 24, pnpm 12.9.1, TS6 tooling alias and TS7 native compiler. Preserve strict TypeScript flags, all Convex lint rules at error, Oxfmt, Knip and workspace supply-chain settings. Do not patch dependencies. Disable exactOptionalPropertyTypes because convex-helpers ships TypeScript source that fails it; recheck on every convex-helpers upgrade.

Test every public client method. Keep tests beside modules and shared helpers in `src/test-helpers.ts`. Stub fabricated env and provider fetch; restore both after every test. Use `vi.setSystemTime` and restore timers in `afterEach`. Simulator proof does not establish component env binding or deployed Convex behavior.

Run affected tests and formatting first. Runtime changes require `pnpm build:codegen`, `pnpm test`, `pnpm typecheck` and `pnpm smoke`. Client and export changes require `pnpm build`, `pnpm typecheck`, affected tests and `pnpm test`. Tooling changes require `pnpm check` and `pnpm smoke`. Prose changes require `pnpm fmt:check`; executable examples also require affected tests and smoke for runtime claims.

`pnpm check` includes formatting, build, lint, typecheck, Knip, source invariants and coverage. Coverage thresholds may hold or rise, never fall. Codegen and smoke share the anonymous-backend lock; never terminate another checkout's backend. Smoke uses fabricated credentials.

The interactive e2e check requires an attended maintainer test account, never CI or production keys. Start with `pnpm e2e --dry-run`; keep `.env.e2e` ignored and inspect only redacted fixtures. Never print credentials. Before release, run the production audit and inspect `pnpm pack --dry-run`.

Update docs for public behavior and ADRs for API or persistence changes. Report commands and exit codes; distinguish simulator, local runtime and provider evidence. Publishing, pushing, deploying and registry submissions require explicit authorization.
