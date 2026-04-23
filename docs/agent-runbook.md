# Agent Runbook

This runbook is for coding and validation agents entering `web-demo-v2`. It
collects the durable workflow rules from the internal `.factory/library` notes
without replacing those notes for mission-specific validation detail.

## First Inspection Pass

Start from the web demo repo root:

```bash
pwd
git status --short
rg --files README.md docs src package.json
sed -n '1,220p' package.json
```

Then read the smallest set of docs for the task:

- Docs-only change: `docs/README.md`, this runbook, and the target doc.
- UI or route change: `README.md`, `docs/web-demo-architecture.md`,
  `src/app/CoreRoutes.tsx`, and `src/demo/scenarios.ts`.
- Runtime or storage change: `docs/web-demo-architecture.md` and
  `docs/outside-runtime-flow-invariants.md`.
- Paper parity change: sibling `../igloo-paper/screens/...`,
  `src/demo/scenarios.ts`, and the relevant deviation entries.

## Safe Edit Boundaries

- `web-demo-v2/` is its own git repo. Check status from this directory, not the
  parent prototype folder.
- The sibling `../igloo-paper/` repo is the design reference. Read it for copy,
  layout, and screenshots; do not modify it during web-demo work.
- The sibling `../bifrost-rs/` repo is the protocol/runtime reference. Read it
  to confirm bridge behavior; do not modify it unless the user explicitly asks
  for protocol changes.
- `src/vendor/bifrost-bridge-wasm/` is generated output. Refresh it only with
  `npm run wasm:build` when the task explicitly requires a WASM update.
- Avoid editing `dist/`, `node_modules/`, `test-results/`, or TypeScript
  build-info files. They are generated or local runtime artifacts.
- Keep app-state imports stable at app edges by importing from
  `src/app/AppState.tsx` unless you are editing the app-state implementation
  itself.

## Route And Demo Orientation

Real product routes are mounted by `src/app/CoreRoutes.tsx` under the real
`AppStateProvider`. The main route families are:

- `/` for welcome/unlock.
- `/create/*` for keyset creation and distribution.
- `/restore-from-relay` for encrypted profile restore from Nostr relays.
- `/import/*` for encrypted `bfprofile` package import.
- `/onboard/*` for requester-side onboarding.
- `/onboard-sponsor/*` for source-side sponsorship.
- `/rotate-keyset/*` for keyset rotation.
- `/replace-share/*` for replacing a local share.
- `/recover/:profileId/*` for NSEC recovery.
- `/dashboard/:profileId` for the live signer dashboard.

The `/demo` and `/demo/:scenarioId` routes are deterministic Paper-review
surfaces. They use `MockAppStateProvider`, scenario fixtures, and a one-shot
`sessionStorage` bridge when a demo interaction deep-links into a real route.
Append `?chrome=0` to a demo scenario URL for clean visual capture.

## Runtime And Relay Notes

- Default runtime relays are public `wss://` Nostr relays.
- Multi-device Playwright specs use the local `bifrost-devtools` relay on
  `ws://127.0.0.1:8194`.
- Most multi-device specs spawn and tear down their own relay. Starting a relay
  manually can cause port `8194` contention.
- The user-facing restore form accepts `wss://` relays. Local
  `ws://127.0.0.1:8194` restore tests rely on a DEV-only opt-in documented in
  `docs/runtime-deviations-from-paper.md`.
- DEV-only hooks such as `window.__debug.*` and `window.__iglooTest*` are for
  validation evidence. They must not become production behavior.

## Security And Persistence Rules

- Raw share secrets, decrypted payloads, recovered `nsec` values, setup
  passwords, and decoded packages stay in React memory only.
- IndexedDB may store profile summaries and encrypted `bfprofile` package
  strings. It must not store plaintext shares or recovered keys.
- The demo bridge may serialize display-safe profile/runtime summaries only.
  It must not serialize setup sessions or secrets.
- NIP-19 encoding, secp256k1 validation, and FROST key material handling stay
  behind `src/lib/bifrost/packageService.ts` and the WASM bridge.
- `clearCredentials()` must wipe runtime state before dropping runtime refs.

## Validation Commands

For docs-only changes, use source sanity checks instead of app rebuilds:

```bash
rg -n "restore-from-relay|docs/agent-runbook|docs/README" README.md docs/*.md
rg -n "src/vendor/bifrost-bridge-wasm|bifrost-rs|igloo-paper|8194|5173" README.md docs/*.md
git diff --stat
```

For code refactors where WASM artifacts should not be rewritten:

```bash
npx tsc --noEmit -p tsconfig.json --pretty false
npx tsc --noEmit -p tsconfig.node.json --pretty false
npx vitest run --config vitest.config.ts
npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop
```

Avoid `npm test` and `npm run build` for cleanup-only or docs-only work because
they rebuild vendored WASM. Use them when the task actually includes a full
build or WASM refresh.
