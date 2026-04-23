# Igloo Web Demo V2

A FROST threshold signing web application for Nostr — Paper-parity prototype UI
plus a fully wired `bifrost-bridge-wasm` signer runtime for multi-device key
management, keyset creation, rotation, replace-share, source-side onboarding
sponsorship, recovery, and encrypted profile file import/export.

## Current State

All UI screens are implemented and wired for navigation, brought to full Paper
reference content parity (`igloo-paper`) across 10 flows. The `bifrost-rs` WASM
bridge is fully integrated — the app runs real FROST key generation, real
multi-device sign / ECDH / ping / onboard round-trips over Nostr relays
(`wss://relay.primal.net` / `wss://relay.damus.io` / `wss://nos.lol` by default,
plus an optional local `bifrost-devtools` relay for e2e), encrypted
`bfprofile` file import/export, and persistent
IndexedDB-backed profile storage. The Dashboard, Policies, Approvals, Event
Log, and Settings surfaces all read from the live runtime; the deterministic
`/demo/:scenarioId` gallery is the only mocked rendering path. The validation
contract enumerates **223 behavioral assertions** covering the full UI +
runtime surface and is reproduced below by 1059+ Vitest cases plus the
Playwright demo-gallery + multi-device e2e suites.

## Prerequisites

- **Node.js 22+** (required by `@types/node@^22`, `@playwright/test@^1.49`,
  and the vendored WASM loader under `src/lib/wasm/`).
- **`bifrost-devtools` local relay** — optional for single-device dev, required
  for any multi-device spec under `src/e2e/multi-device/**`. The binary lives
  in the sibling `bifrost-rs` workspace. Build it once:
  ```bash
  cargo build --release -p bifrost-devtools \
    --manifest-path ../bifrost-rs/Cargo.toml
  ```
  then start a dev-time instance when running multi-device specs:
  ```bash
  ../bifrost-rs/target/release/bifrost-devtools relay \
    --host 127.0.0.1 --port 8194
  ```
  This listens on `ws://127.0.0.1:8194` (NOT `wss://`) — transport-only, so it
  is suitable for publish/subscribe/sign/ECDH/ping/onboard tests. Most
  multi-device specs self-host the relay in
  `beforeAll` / kill it in `afterAll`, so you usually do not need to start it
  manually; starting it by hand will cause port 8194 contention with those
  specs.
- If you do not have a Rust toolchain, `.factory/init.sh` gracefully skips the
  `bifrost-devtools` build and individual multi-device specs self-skip with a
  clear reason.

## Docs for Agents

Start with `docs/README.md` for the docs map and `docs/agent-runbook.md` for
safe agent workflow. The expanded architecture notes live in
`docs/web-demo-architecture.md`; `/demo` scenario workflow lives in
`docs/demo-scenario-guide.md`; runtime-vs-Paper exceptions live in
`docs/runtime-deviations-from-paper.md`.

## Flows Implemented

All flows follow their Paper design reference exactly (copy, typography,
layout), except for the runtime-constrained deviations documented under
`docs/runtime-deviations-from-paper.md`.

### Welcome — `/`
- First-visit variant ("Split your Nostr key.") and returning-user variant
  ("Welcome back.")
- Password unlock for existing profiles, `Create New Keyset` /
  `Import Device Profile` CTAs.

### Import Device Profile — `/import` → `/import/decrypt` → `/import/review` → `/import/error`
Load encrypted `bfprofile` package, decrypt, review & save, plus error variants
(wrong password, corrupted package).

### Onboard Device (requester) — `/onboard` → `/onboard/handshake` → `/onboard/failed` → `/onboard/complete`
Package validation + CTA gating, real relay handshake, rejected vs timeout
variants, success.

### Onboard Sponsor — `/onboard-sponsor` → `/onboard-sponsor/handoff` → (success / failed)
Issue a real `bfonboard` package for a peer device, run the source-side
sponsorship ceremony over relays, and surface handoff UI (QR + copyable
package). Wired in `src/app/AppStateProvider.tsx > createOnboardSponsorPackage`.

### Create Keyset — `/create` → `/create/progress` → `/create/profile` → `/create/distribute` → `/create/complete`
3-phase progress (generate keyset, derive shares, publish metadata), shared
profile screen, distribution, completion.

### Recover NSEC — `/recover/:profileId` → `/recover/:profileId/success`
Paste share packages, collect across peers, reveal recovered `nsec` via WASM.

### Rotate Keyset — `/rotate-keyset` → `/rotate-keyset/review` → `/rotate-keyset/progress` → `/rotate-keyset/profile` → `/rotate-keyset/distribute` → `/rotate-keyset/complete`
Full adaptation flow with 3 error states (wrong password, group mismatch,
generation failed).

### Replace Share — `/replace-share` → `/replace-share/applying` → `/replace-share/failed` → `/replace-share/replaced`
Enter onboarding package, drive real replacement over the runtime, surface
failure and success.

### Dashboard — `/dashboard/:profileId`
Five runtime states (running, stopped, connecting, relays-offline,
signing-blocked) with paper-faithful peer rows (online count, ready capacity,
per-peer permission badges SIGN/ECDH/PING/ONBOARD), policies view, pending
approvals, event log, modals (clear credentials, export profile, export
complete, policy prompt, signing failed), and Settings sidebar with Device
Profile / Group Profile / Replace Share + Rotate Keyset / Export & Backup /
Profile Security sections. Relay backup publish/restore is intentionally not
surfaced in this web demo; onboarding happens through `bfonboard` packages and
profile transfer happens through `bfprofile` import/export. Source is organized under
`src/screens/DashboardScreen/` (index, states/, panels/, modals/, sidebar/,
mocks.ts, types.ts).

## Real Routes vs Demo Gallery

Product routes are mounted through `src/app/CoreRoutes.tsx` under the real
`AppStateProvider`. The `/demo` route hosts a first-class gallery of every
canonical screen + variant, keyed by scenario id and rendered through
`MockAppStateProvider`. Demo scenarios are deterministic review fixtures; real
routes are the source of truth for runtime behavior.

Each demo scenario is reachable via a stable `/demo/{scenario-id}` URL. The
gallery toolbar exposes `All screens / Prev / Next / Raw / Reference`; append
`?chrome=0` to any scenario URL to strip the chrome for clean capture.
See `docs/demo-scenario-guide.md` before adding scenario ids, changing
Paper-reference assets, or relying on the demo bridge.

## Setup & Run

```bash
npm install
npm run dev            # Vite dev server on 127.0.0.1:5173
npm run build          # Production build (rebuilds vendored WASM + tsc + vite)
npm run test           # Vitest unit/integration suite (1059+ tests)
npm run test:e2e       # Playwright desktop + mobile end-to-end suites
npm run lint           # Lightweight pass-through (see docs/allowed-console-warnings.md)
npm run format:check   # Lightweight pass-through (see docs/allowed-console-warnings.md)
```

Fast typecheck without rebuilding WASM:

```bash
npx tsc --noEmit -p tsconfig.json --pretty false
npx tsc --noEmit -p tsconfig.node.json --pretty false
```

Multi-device specs (require the local relay — either self-hosted by the spec
or started manually as documented in Prerequisites):

```bash
npx playwright test src/e2e/multi-device \
  --project=desktop --workers 1
```

## Tech Stack

- React 19, TypeScript, Vite 6
- react-router-dom v7 (client-side routing)
- Tailwind CSS v4 + custom CSS (`src/styles/global.css`)
- lucide-react (icons), qrcode, zod (validation)
- idb-keyval (IndexedDB storage)
- Vitest + Testing Library (unit tests), Playwright (e2e)
- Vendored `bifrost-bridge-wasm` (`src/vendor/bifrost-bridge-wasm`) — only
  refreshed via `npm run wasm:build`, never hand-edited.

## App State & Demo Bridge

Two providers implement the same `useAppState()` API:

- **AppStateProvider** (`src/app/AppStateProvider.tsx`, re-exported from
  `src/app/AppState.tsx`) — real runtime: reads from IndexedDB, polls
  `RuntimeClient` every 2500 ms (paused while the demo bridge is hydrated),
  drives the `RuntimeRelayPump`, drains completions/failures/events into React
  state.
- **MockAppStateProvider** — stateful demo provider used by `/demo/:scenarioId`
  routes. Initialized from `scenario.appState`; `clearCredentials` truly
  empties `profiles` and `lockProfile` truly clears `runtimeStatus` so demo
  flows behave end-to-end. `DemoScenarioPage` passes `key={scenario.id}` so
  the provider remounts on scenario change.
- **App-state bridge** (`src/app/appStateBridge.ts`) — one-shot
  `sessionStorage` handoff so the real `AppStateProvider` can rehydrate from
  the demo state when a `/demo/...` click deep-links into a real-app route
  like `/dashboard/:profileId`. Serializes display state only, never setup
  secrets or recovered keys.

## Further Reading

- `docs/README.md` — public docs hub and recommended read order for agents.
- `docs/agent-runbook.md` — first inspection pass, safe edit boundaries, route
  orientation, local relay caveats, and validation commands.
- `docs/web-demo-architecture.md` — layered runtime overview, module
  boundaries, data flows, persistence rules, and testing surfaces.
- `docs/demo-scenario-guide.md` — `/demo/:scenarioId` registry rules,
  Paper-reference sync, variant behavior, and demo bridge safety.
- `docs/outside-runtime-flow-invariants.md` — security and phase-gating rules
  for setup, backup, restore, and recovery flows.
- `docs/runtime-deviations-from-paper.md` — every intentional deviation from
  `igloo-paper`, each cited back to the Paper source and the covering
  `VAL-*` assertion IDs.
- `docs/allowed-console-warnings.md` — zero-warn policy + the (currently
  empty) allowlist.
- `.factory/library/user-testing.md` — internal validator detail for
  agent-browser, Playwright, local relay harnesses, and DEV-only hooks.

## Design Reference

The sibling `igloo-paper` repo is the source of truth for every screen. Each
scenario in `src/demo/scenarios.ts` links to its Paper source.
