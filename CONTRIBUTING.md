# Contributing

Read [README.md](README.md), [AGENTS.md](AGENTS.md) and relevant [ADRs](docs/adr/). Keep changes within the component and its example.

## Setup

Development uses Node 24 and pnpm 12.9.1 through mise; consumers need Node 24 or newer.

```sh
mise trust && mise install
mise exec -- pnpm install --frozen-lockfile
CONVEX_AGENT_MODE=anonymous pnpm exec convex init
pnpm build:codegen
```

Codegen and smoke use an anonymous local Convex deployment without cloud login. They share a backend lock; do not terminate another checkout's backend.

## Checks

Run affected tests before `pnpm check` (format, build, type-aware lint, typecheck, Knip, source invariants and coverage). Component, schema or shared runtime changes also require `pnpm build:codegen` and `pnpm smoke`. Prose-only changes require `pnpm fmt:check`; executable examples require their affected tests. Keep coverage thresholds unchanged or raise them. Commit regenerated bindings with their inputs; never edit generated files.

## Change requirements

- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); a breaking change adds `!` after the type.
- Until 1.0.0, a breaking change ships without compatibility code, deprecation periods or data
  migrations; its changeset is a `minor` bump that states what breaks.

## Maintainer provider verification

The interactive `pnpm e2e` check uses a maintainer's Razorpay test account on macOS, outside CI. Copy `.env.e2e.example` to ignored `.env.e2e`, set its three credentials and run `pnpm e2e --dry-run` to validate names without network calls. Never use production keys. `pnpm e2e:env` loads only credentials into the local component.

The runner builds under the shared lock, starts the anonymous backend and prints a Cloudflare tunnel URL. Add that URL under **Test Mode → Webhooks**, using your configured webhook secret. Enable `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, `refund.failed` and `subscription.*`, then press Enter. Complete the local Checkout with a [test card](https://razorpay.com/docs/payments/payments/test-card-details/) or [test UPI VPA](https://razorpay.com/docs/payments/payments/test-upi-details/). The runner checks capture, refund, webhook deduplication and callbacks. Review redacted fixtures in `tests/fixtures/e2e/` before committing them. `--wait` sets the timeout in minutes; its default is 10.

## Reports and releases

Bug reports need package, Convex and Node versions, deployment type, operation, a minimal reproduction, expected result and actual result. Remove credentials, payment details and personal data. Use [private vulnerability reporting](https://github.com/OperatorNest/convex-razorpay/security/advisories/new) for security defects. Follow the [Code of Conduct](https://github.com/OperatorNest/.github/blob/main/CODE_OF_CONDUCT.md) and [support guidance](https://github.com/OperatorNest/.github/blob/main/SUPPORT.md).

Add one changeset for consumer-visible changes. A maintainer versions on a branch and reviews the changelog through a PR. Before release, run `pnpm check`, `pnpm smoke`, `pnpm audit --prod --audit-level high` and `pnpm pack --dry-run`. The release workflow publishes with npm trusted publishing after CI and smoke pass on the same commit. Publishing, pushing, deploying and registry submissions require explicit authorization.
