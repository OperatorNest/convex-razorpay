# Working in this repository

## Scope

Read `README.md`, `CONTRIBUTING.md`, and the ADRs in `docs/adr/` for supported behavior and decisions.

Read `example/convex/_generated/ai/guidelines.md` for official Convex API guidance. The runtime and dependency rules below apply to this package.

`src/component/` owns the schema, functions, cron, and generated bindings. `src/client/` provides the grouped app-facing `Razorpay` client. `src/shared/` contains runtime-neutral validation and crypto. `src/test.ts` registers the component for `convex-test`; `example/convex/` exercises the installed component.

Read the contributor guides in `.agents/skills/` when relevant to the change.

## Runtime and security boundaries

Shipped code runs in Convex's default V8 runtime and edge runtimes. Never add `"use node"`, Node built-ins, `Buffer`, or `process` in authored `src/` files. Use platform `fetch`, WebCrypto, and generated `env`. Keep credentials only in component env variables, bind app env by reference, and never pass secrets through public args, tables, logs, tests, or examples. The package has zero runtime dependencies; `convex` is a peer.

Provider responses and signed webhooks use the same internal `apply*` mutations. Webhooks verify HMAC on the raw body, accept current/previous secrets, deduplicate by event id and body hash, then update the mirror and call the optional app callback in one transaction. Reject missing secrets. Only verified provider data may change payment state. Test behavior requires explicit client `testMode: true` or `RAZORPAY_TEST_MODE=true` (an explicit client `false` overrides the env); reject a recognizable live key in test mode. Tag every mirrored row with its mode and refuse test-mode operations on live rows.

Bad: accept `keySecret` as a public mutation argument or update an order from an unsigned webhook. Good: read generated component `env`, verify the raw-body HMAC, then use the internal `apply*` mutation. The client owns app-facing calls; the component owns provider trust.

## Query and validator patterns

Public functions declare `args` and `returns`. Use `schema.doc("orders")` for a mirrored order and `paginationResultValidator(...)` for pages. Shared shapes come from one validator via `Infer`. `v.any()` is allowed only for provider passthrough fields named `raw*`, which are never indexed. Reads are bounded and index-backed; for example `orders.by_razorpayId` resolves an order by its provider id. Do not use `Date.now()` in queries or large `Promise.all` fan-outs in mutations. Do not edit `_generated/` by hand.

## Consumer errors

Consumer-reachable errors must use the single `razorpayError` factory in `src/shared/errors.ts` to construct `ConvexError<{ code, message, retryable? }>`. Error codes retain the `RAZORPAY_` prefix and are documented in the README error-code table. Keep the exported `RazorpayErrorCode` union and `isRazorpayError` guard in sync with those codes. Never throw plain `Error` on consumer-reachable paths.

## Generated files

The `src/component/_generated/` and `example/convex/_generated/` bindings are generated output, excluded from authored-source lint rules. Edit their schema/function inputs, regenerate, review the diff, and commit changed tracked generated output with the source change. `dist/` remains ignored build output.

In a fresh checkout, use `CONVEX_AGENT_MODE=anonymous pnpm exec convex init`, then `pnpm build:codegen`. That script generates the component bindings, builds `dist` for the example's config import, and generates example-app bindings. It uses a local anonymous deployment and needs no cloud login.

## Environment and test behavior

The component declares `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`, and `RAZORPAY_TEST_MODE`. Missing API credentials fail unless test mode is explicitly selected; webhook verification always needs its secret. Tests stub fabricated env values with `vi.stubEnv` and provider `fetch` with `vi.stubGlobal`, restoring both afterward. `convex-test` is a simulator; it does not prove app env binding or the real runtime.

The end-to-end test is a maintainer-run interactive check with their own provider test account and keys, never CI. Copy `.env.e2e.example` to ignored `.env.e2e` and start with `pnpm e2e --dry-run`, which validates names without network calls. `pnpm e2e:env` loads only the component credentials. The interactive command uses the shared lock and anonymous local backend; review redacted fixtures in `tests/fixtures/e2e` before committing them. Never print or commit credentials or use production accounts.

Every public client method must be exercised by tests. Keep tests beside the modules they cover and shared helpers in `src/test-helpers.ts`, never in a `*.test.ts` file. Use `vi.setSystemTime` instead of real-clock margins and restore timers in `afterEach` after every test.

## Toolchain

Use tracked `.mise.toml` (Node 26, pnpm 12.9.1) with `mise trust && mise install`; if global pnpm is older, use `mise exec -- pnpm ...`. Keep `convex` as a peer at `^1.46.0`. Keep the TS6 tooling alias and TS7 native compiler, strict TypeScript flags, oxlint Convex plugin, Oxfmt, Knip, Vitest coverage, and workspace-level pnpm supply-chain settings aligned with the tracked tool configuration. Do not patch dependencies or generated files by hand.

## Verification by change type

Start with affected tests and formatting, then run the required gate. `pnpm build:codegen` and `pnpm smoke` start or use the anonymous local backend under the shared lock; they cost more than `pnpm test` or `pnpm fmt:check`. Do not run interactive `pnpm e2e` as a routine check; use its documented `--dry-run` first and require an attended maintainer-run session.

| Change                                         | Checks                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Component functions, schema, or shared runtime | `pnpm build:codegen`, `pnpm test`, `pnpm typecheck`, `pnpm smoke`                            |
| Client behavior or package exports             | `pnpm build`, `pnpm typecheck`, affected client tests, `pnpm test`                           |
| Tooling or repository rules                    | `pnpm check`, `pnpm smoke`                                                                   |
| Prose-only docs                                | `pnpm fmt:check`                                                                             |
| Executable docs or API claims                  | `pnpm fmt:check`, affected example/client tests; `pnpm smoke` if runtime behavior is claimed |

`pnpm check` runs formatting, build, type-aware lint, typecheck, `pnpm knip`, and coverage-threshold tests. `pnpm smoke` runs the example in the real local Convex runtime, under the shared local lock, with fabricated credentials. Run `pnpm audit --prod --audit-level high` and `pnpm pack --dry-run` before release. The lock coordinates local backend use; do not terminate another repo's backend.

Coverage is a ratchet: the thresholds in `vitest.config.js` may hold or rise, never fall. `pnpm test` enforces the current floor; review threshold changes against the prior commit and add meaningful tests when coverage drops.

## Contribution boundaries

Keep changes within this component and its example. Update docs for public behavior; add an ADR for intentional contract deviations. Treat app authentication, authorization, pricing, and fulfillment as app responsibilities. Report exact checks and distinguish local proof from provider or deployed behavior. Publishing, pushing, deploying, and registry submissions require explicit authorization.
