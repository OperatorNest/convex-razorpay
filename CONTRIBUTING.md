# Contributing

Read [README](README.md) and the relevant [ADR](docs/adr/) before changing a public API. Keep changes scoped to this component and its example.

Use the tracked toolchain with `mise trust && mise install`, then `mise exec -- pnpm install --frozen-lockfile` if your global pnpm is older. Consumers need Node.js 22.19 or newer. In a fresh checkout, initialize the anonymous local Convex deployment and generate bindings:

```sh
CONVEX_AGENT_MODE=anonymous pnpm exec convex init
pnpm build:codegen
```

The component owns Razorpay transport, verified webhook ingest, and payment mirrors. The consuming app owns authentication, authorization, trusted prices, and fulfillment. Keep credentials in component env variables bound by reference. Never hand-edit generated files or put real keys, customer records, or webhook bodies in tests, examples, logs, or reports.

## End-to-end testing

A maintainer runs `pnpm e2e` on macOS against
Razorpay's real API with **Test Mode** (`rzp_test_*`) keys. This is interactive
and is not part of CI. Copy `.env.e2e.example` to the ignored `.env.e2e`,
fill the three required variables locally, and run `pnpm e2e --dry-run`.
The dry run lists missing or invalid variable **names** and makes no network
calls. `pnpm e2e --wait 15` allows 15 minutes for Checkout and webhook
delivery; the default is 10.

The runner takes the shared local lock, builds, starts the existing anonymous
local Convex deployment, and loads `.env.e2e` into it. It prints a boxed
Cloudflare quick tunnel URL. In the Razorpay dashboard select **Test Mode →
Webhooks**, add that exact URL, use the existing
`RAZORPAY_WEBHOOK_SECRET` value as its secret, and enable
`payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`,
`refund.created`, `refund.processed`, `refund.failed`, and `subscription.*`.
Press Enter in the terminal after saving the webhook. The maintainer then completes
the Checkout.js payment in the locally opened page using a
[documented test card](https://razorpay.com/docs/payments/payments/test-card-details/)
or [test UPI VPA](https://razorpay.com/docs/payments/payments/test-upi-details/).
The tool attempts a refund only after capture, checks delivery, deduplication,
and the app callback, and writes redacted payload fixtures under
`tests/fixtures/e2e/`. Review generated fixtures and observation
notes before committing them. Do not run this tool with production keys or
commit `.env.e2e`; `pnpm e2e:env` remains available to load only the
credentials into the local deployment.

Changes to component behavior need `pnpm build:codegen`, `pnpm test`, `pnpm typecheck`, and `pnpm smoke`. Run `pnpm check` for the full formatting, build, lint, typecheck, Knip, and coverage gate. Before release, also run `pnpm audit --prod --audit-level high` and inspect `pnpm pack --dry-run`. Describe observed behavior and update README or ADRs only when their claims change.

For a bug report, provide the package, Convex, and Node.js versions, runtime, operation, a minimal reproduction, expected result, and actual result. Remove credentials, tokens, payment details, recipient data, and personal information from reports and logs. Security reports go through [private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new).

Follow the [OperatorNest Code of Conduct](https://github.com/OperatorNest/.github/blob/main/CODE_OF_CONDUCT.md) and [support guidance](https://github.com/OperatorNest/.github/blob/main/SUPPORT.md).

## Releasing

Add a changeset to user-facing changes with `pnpm changeset`. A maintainer runs `pnpm changeset version` on a branch and reviews the version and changelog through a PR. The release workflow validates the same commit through CI and smoke before publishing a new package version with npm trusted publishing. Publishing, pushing, deployment, and registry submissions require explicit authorization.

The end-to-end test is a maintainer-run check with their own provider test account and keys. It is never run in CI.
