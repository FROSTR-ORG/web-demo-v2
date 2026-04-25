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

## Change Recipes

### Docs-only

1. Stay inside `README.md` and `docs/*.md` unless the task explicitly asks for
   code or generated assets.
2. Verify every path, command, route, and script name from the repo before
   documenting it.
3. Prefer `rg` source checks and `git diff --stat`; do not run `npm test` or
   `npm run build` just to validate prose.

### UI or Paper parity

1. Read the relevant Paper source under `../igloo-paper/screens/...`.
2. Find the route in `src/app/CoreRoutes.tsx` and the scenario in
   `src/demo/scenarios.ts`.
3. Make the screen change near the owning screen module. Keep shared primitives
   in `src/components/` only when another flow already needs the same behavior.
4. Update `docs/runtime-deviations-from-paper.md` only when the live app must
   intentionally differ from Paper or a validation-contract phrase.
5. Run focused component tests first. Use `npm run paper:drift` for
   synced-reference integrity and `npm run paper:drift -- --mode=live` when
   you need a ranked live DOM versus Paper work queue.

### Demo scenario or Paper-reference asset

1. Use `docs/demo-scenario-guide.md` as the source of truth.
2. Update `src/demo/scenarios.ts`; for a new flow also update `demoFlows` and
   `src/demo/DemoGallery.tsx`.
3. Run `npm run paper:sync` after the scenario registry points at the right
   Paper path.
4. Run `npx vitest run src/demo/__tests__/scenarios.test.tsx src/demo/__tests__/crossAreaFinalGate.test.tsx --config vitest.config.ts`.
5. Run `npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop`
   for any gallery-visible change.

### Runtime, storage, or security boundary

1. Read `docs/web-demo-architecture.md` and
   `docs/outside-runtime-flow-invariants.md`.
2. Keep protocol-shaped work in `src/app` or `src/lib`; keep screen modules
   focused on rendering, guards, and user interactions.
3. Check that setup sessions clear on cancel, finish, lock, credential clear,
   and invalid direct navigation.
4. Add or update tests around persistence, demo bridge serialization, and
   console/event-log redaction when the change touches secrets.

## Safe Edit Boundaries

- `web-demo-v2/` is its own git repo. Check status from this directory, not the
  parent prototype folder.
- The sibling `../igloo-paper/` repo is the design reference. Read it for copy,
  layout, and screenshots. Modify/export it only when the user explicitly asks
  for Paper work or the active plan names Paper as the fix source.
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
Append `?chrome=0` to a demo scenario URL only for Paper-reference raster
capture; raw mode renders the synced Paper PNG rather than the live mock DOM.
Use `/demo/:scenarioId` without that query for live mock UI review, and use
the real product routes for runtime/protocol behavior.

## Paper Parity Workflow

There are two parity modes, and they answer different questions:

- `npm run paper:drift -- --threshold=0.02` captures
  `/demo/:scenarioId?chrome=0`. This is the synced-reference integrity check:
  Paper PNG versus the same Paper PNG in the app shell. It should pass after
  `npm run paper:sync` unless a reference path, image dimension, or capture
  pipeline is broken.
- `npm run paper:drift -- --mode=live --threshold=0.02` captures the live mock
  React DOM at `/demo/:scenarioId`. Treat failures here as a ranked design
  work queue, not as proof that runtime behavior is wrong.

For web-demo parity work, patch the live mock DOM to match Paper by default.
Patch Paper only when the web demo reflects real protocol/runtime behavior or
when Paper is visibly stale. After any Paper mutation, run the Paper export and
verify commands in `../igloo-paper`, then return here for `npm run paper:sync`
and the raw drift audit.

When Paper and bifrost reality disagree, keep the real route truthful and put
visual-only matching behind existing demo controls such as `demoUi` presets or
`dashboard.paperPanels`. Add a focused test for both sides of the split so the
next agent can see which behavior is intentional.

## Runtime And Relay Notes

- Default runtime relays are public `wss://` Nostr relays.
- Multi-device Playwright specs use the local `bifrost-devtools` relay on
  `ws://127.0.0.1:8194`.
- Most multi-device specs spawn and tear down their own relay. Starting a relay
  manually can cause port `8194` contention.
- Relay backup publish/restore is not surfaced in the web demo. Onboarding and
  profile transfer use `bfonboard` / `bfprofile` import-export flows instead.
- DEV-only hooks such as `window.__debug.*` and `window.__iglooTest*` are for
  validation evidence. They must not become production behavior.

## Real-Peer Dashboard Workability

Use the focused real-peer dashboard suite when a change touches dashboard
state derivation, runtime event logs, signer operations, peer policies, relay
telemetry, or permission chips:

```bash
npm run test:e2e:dashboard-real-peers
```

The suite lives in `src/e2e/multi-device/dashboard-real-peers.spec.ts` and
uses `src/e2e/support/realPeers.ts`. It starts the local
`bifrost-devtools` relay on `ws://127.0.0.1:8194`, creates a real 2-of-3
keyset through the WASM bridge, seeds two browser contexts as real peers, and
then drives the Dashboard UI from page A. It covers Running, Stopped,
Relays Offline, and Signing Blocked dashboard states plus Event Log,
Sign Activity, Policies, request-sign permission deny/recovery, and dev
sign/ECDH/ping dispatches.

Keep this suite as the workability proof, not the visual parity gate. It may
use DEV-only `__iglooTest*` hooks to set up a real runtime quickly, but the
assertions should stay focused on user-visible dashboard behavior and
`AppState` observability sourced from real bifrost peers. Run it alone with
`--workers=1`; the local relay port is fixed at `8194`, so parallel specs or
a manually started relay will contend with it.

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
rg -n "Publish Backup|Restore from Relay|restore-from-relay" README.md docs/*.md
rg -n "src/vendor/bifrost-bridge-wasm|bifrost-rs|igloo-paper|8194|5173" README.md docs/*.md
rg -n "T[O]DO|T[B]D|F[I]XME" README.md docs/*.md
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
