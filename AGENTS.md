# Working in this repository

Read `README.md`, `CONTRIBUTING.md`, relevant `docs/adr/` files and `example/convex/_generated/ai/guidelines.md`. Contributor guides live in `.agents/skills/`.

## Boundaries

`src/component/` owns provider transport, trust, mirrors, cron and generated bindings. `src/client/` owns app-facing calls. `src/shared/` is runtime-neutral. `src/test.ts` registers `convex-test`; `example/convex/` exercises the package.

Authored `src/` runs in Convex V8 and edge runtimes. Use platform fetch, WebCrypto and generated env; never add `"use node"`, Node built-ins, `Buffer` or `process`. Keep zero runtime dependencies and `convex` as a `^1.46.0` peer. Credentials belong only in component env bound by app reference; never put real credentials in arguments, rows, logs, tests or examples.

Provider responses and signed webhooks share internal apply mutations. Verify the unchanged raw-body HMAC with the current or previous secret before mirror updates, deduplication and the optional callback execute in one transaction. Reject missing secrets. Only provider-verified data or explicitly selected synthetic operations may change payment state.

Every mirror stores its mode. Client reads use mode-inclusive indexes; every write rejects an existing opposite-mode row. Client `testMode: false` overrides the env; omission defers to `RAZORPAY_TEST_MODE=true`. Reject `rzp_live_` keys when test mode is enabled. Provider notes cannot settle local claims without an explicit request fingerprint.

## Functions and errors

Public functions declare `args` and `returns`. Use `schema.doc` for mirrors and shared validators with `Infer` for shared shapes. Allow `v.any()` only for unindexed provider fields named `raw*`. Reads are bounded and indexed; index names list fields in order joined by `_and_`. Validate page limits before database reads. Queries must not use `Date.now()`; mutations must not fan out unbounded requests. Client calls copy declared arguments explicitly.

Consumer errors come from `razorpayError` in `src/shared/errors.ts`. Maintain one `RAZORPAY_` code list, fixed messages, a complete shape guard and matching README table. Error data is `{ code, message, providerStatus?, providerCode? }`; provider codes are bounded to 64 code units. Never expose descriptions, response bodies or field values in errors, or throw plain `Error` to consumers.

## Toolchain and proof

Use tracked `.mise.toml` with `mise trust && mise install`: Node 24, pnpm 12.9.1, TS6 tooling alias and TS7 native compiler. Preserve strict TypeScript flags, all Convex lint rules at error, Oxfmt, Knip and workspace supply-chain settings. Do not patch dependencies.

Initialize a fresh checkout with `CONVEX_AGENT_MODE=anonymous pnpm exec convex init`, then `pnpm build:codegen`. Never edit `_generated/` by hand; regenerate after schema or function changes and commit tracked output with its inputs. `dist/` is ignored build output.

Test every public client method. Keep tests beside modules and shared helpers in `src/test-helpers.ts`. Stub fabricated env and provider fetch; restore both after every test. Use `vi.setSystemTime` and restore timers in `afterEach`. Simulator proof does not establish component env binding or real Convex behavior.

Run affected tests and formatting first. Required checks:

| Change                              | Checks                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| Component, schema or shared runtime | `pnpm build:codegen`, `pnpm test`, `pnpm typecheck`, `pnpm smoke` |
| Client or exports                   | `pnpm build`, `pnpm typecheck`, affected tests, `pnpm test`       |
| Tooling or repository rules         | `pnpm check`, `pnpm smoke`                                        |
| Prose                               | `pnpm fmt:check`                                                  |
| Executable docs                     | Formatting and affected tests; smoke for runtime claims           |

`pnpm check` includes formatting, build, lint, typecheck, Knip, source invariants and coverage. Coverage thresholds may hold or rise, never fall. Codegen and smoke use the shared anonymous-backend lock; never terminate another checkout's backend. Smoke uses fabricated credentials, not a provider account.

The interactive e2e check requires an attended maintainer test account, never CI or production keys. Start with `pnpm e2e --dry-run`; keep `.env.e2e` ignored and review only redacted fixtures. Never print credentials. Before release, run the production audit and inspect `pnpm pack --dry-run`.

Update docs for public behavior and ADRs for contract changes. App authentication, authorization, trusted prices and fulfillment remain app responsibilities. Report commands and exit codes; distinguish simulator, local runtime and provider evidence. Publishing, pushing, deploying and registry submissions require explicit authorization.
