# Web Demo Architecture Notes

`web-demo-v2` is a Vite + React SPA that mirrors the sibling `igloo-paper`
design reference while driving a real `bifrost-bridge-wasm` signer runtime.
The primary rule for future work is to keep protocol/state transitions in
`src/app` and `src/lib`, and keep screen modules focused on rendering,
route-level orchestration, and local UI affordances.

## Layered Runtime

```text
UI screens and shared components
  |
  v
AppStateProvider / MockAppStateProvider
  |
  v
RuntimeClient and package helpers
  |
  v
bifrost-bridge-wasm
  |                         |
  v                         v
RuntimeRelayPump        WASM signer state machine
  |
  v
BrowserRelayClient
  |
  v
wss://relay.primal.net / wss://relay.damus.io / wss://nos.lol
```

The real provider owns runtime lifecycle and persistence. The mock provider
exists only for deterministic `/demo/:scenarioId` Paper-review routes.

## Module Boundaries

- `src/app/CoreRoutes.tsx` is the route map for real product surfaces.
- `src/app/AppState.tsx` is the compatibility barrel. Import from it at app
  edges so routes, screens, fixtures, and tests keep one stable public surface.
- `src/app/AppStateProvider.tsx` is the real provider. It owns saved profile
  summaries, active runtime state, setup-flow sessions, IndexedDB persistence,
  WASM package calls, relay handshakes, and the assembled `AppStateValue`.
- `src/app/AppStateContext.tsx` owns the single app-state React context and
  `useAppState`.
- `src/app/MockAppStateProvider.tsx` is the demo-gallery provider. It starts
  from scenario fixtures, keeps bridge-safe state mutable for click-through
  demos, and writes bridge snapshots when demo routes hand off to product
  routes.
- `src/app/appStateBridge.ts` is a one-shot `sessionStorage` handoff. It must
  only serialize bridge-safe summaries and runtime display state, never setup
  secrets or recovered keys.
- `src/app/profileRuntime.ts`, `src/app/sourceShareCollection.ts`, and
  `src/app/distributionPackages.ts` hold shared workflow helpers for setup
  actions. Keep protocol-shaped helper code there instead of duplicating it in
  screen components.
- `src/lib/bifrost/runtimeClient.ts` wraps the WASM runtime calls; package
  encoding/decoding and backup event helpers live in
  `src/lib/bifrost/packageService.ts`.
- `src/lib/relay/runtimeRelayPump.ts` moves outbound/inbound envelopes between
  the runtime and `src/lib/relay/browserRelayClient.ts`.

## Product Routes And Demo Routes

Product routes are mounted under the real `AppStateProvider`: welcome, create,
restore-from-relay, import, onboard requester, onboard sponsor, rotate keyset,
replace share, recover, and dashboard. They should use real package/session,
storage, and runtime methods for success paths.

The `/demo` and `/demo/:scenarioId` routes are mock Paper-review surfaces.
Scenarios in `src/demo/scenarios.ts` seed `MockAppStateProvider` with the exact
state needed to render each canonical artboard or variant. Demo click-throughs
may bridge into product routes, but the bridge carries display-safe state only.

## Setup Sessions

Create, import, onboard requester, onboard sponsor, rotate-keyset,
replace-share, recover, encrypted backup, and relay restore all run before or
around the live signer runtime. Decoded package material stays in React memory
only and must be cleared on cancel, finish, lock, credential clearing, or
invalid direct navigation.

Browser code may coordinate WASM calls and relay requests, but Nostr private-key
operations, secp256k1 validation, and FROST key material handling stay behind
`src/lib/bifrost/packageService.ts` and the vendored WASM bridge. See
`outside-runtime-flow-invariants.md` for the detailed security contract.

## Operation Data Flow

Sign, ECDH, ping, refresh, and onboarding runtime operations follow the same
shape:

1. UI invokes an `AppStateValue` action such as `handleRuntimeCommand`.
2. `AppStateProvider` forwards the command to `RuntimeClient`.
3. WASM updates pending operations and emits outbound relay envelopes on tick.
4. `RuntimeRelayPump` publishes outbound envelopes to relays and feeds inbound
   relay events back into the runtime.
5. Later ticks drain completions, failures, and runtime events.
6. `AppStateProvider` exposes the drained data as React state for dashboard
   panels, modals, and event logs.

Callers should correlate async operation state by `request_id` in pending
operations, completions, failures, and event-log rows. Do not invent
Promise-based correlation around runtime commands.

## Policies And Approvals

Policy UI writes through `RuntimeClient.setPolicyOverride({ peer, direction,
method, value })`. Runtime status exposes the merged/effective permission view
for dashboard rows and badges.

Approval prompts are reactive. The current bridge does not provide a
protocol-level "hold request until user decides" API, so the most reliable
observable for denial flows is requester-side failure. When a local
`peer_denied` event is available, the UI can queue `PolicyPromptModal`; when it
is not, validation relies on operation failure and documented deviations.

## Persistence And Security

- IndexedDB stores saved profile summaries and encrypted `bfprofile` package
  strings. Plaintext shares and recovered keys must not be stored outside those
  encrypted package strings.
- `sessionStorage` is only for the one-shot demo-to-product bridge snapshot.
  All setup sessions must serialize as empty/null.
- React memory may temporarily hold decoded payloads, package passwords, raw
  share secrets, and recovered `nsec` values during setup flows.
- Router state may carry safe retry context such as package text or profile ids.
  It must not carry passwords, decoded payloads, raw shares, or recovered keys.
- `clearCredentials()` must wipe runtime state before dropping runtime refs.
- Console output, Nostr event content, DOM text, and screenshots must not leak
  secrets.

## Dashboard State Derivation

Dashboard state is derived from runtime and relay status rather than hard-coded
route variants:

- `signerPaused` -> stopped.
- Any relay still connecting -> connecting.
- All relays offline -> relays-offline.
- Any relay online before the first completed peer refresh -> connecting.
- Pending runtime work that cannot complete because readiness is blocked ->
  signing-blocked.
- Otherwise -> running.

Demo scenarios can force a Paper state through `demoUi.dashboard`, but product
dashboard state should stay runtime-derived.

## Screen Organization

Large flows should follow the dashboard and rotate-keyset folder pattern:
route-facing exports stay stable from the legacy file, while implementation
modules group forms, progress, error states, profile creation, distribution,
mocks, and utilities by behavior. Shared UI primitives belong in
`src/components/`; flow-specific copy, guards, and demo affordances stay near
the screen modules that use them.

Recover follows the same pattern in `RecoverScreen/`: product collect/success
screens stay separate from demo collect/success screens, shared share/NSEC
display components are flow-local, and mocks are isolated from product session
logic. Sensitive setup-flow screens should keep their public `*Screens.tsx`
barrel stable while colocating masking, reveal, copy, clear, expiry, and
demo-only shortcuts beside the screen code that depends on those rules.

## Paper Parity

The sibling `../igloo-paper/` repo is the source of truth for screen copy,
layout, visual hierarchy, and reference screenshots. Each scenario in
`src/demo/scenarios.ts` names its Paper source path. Runtime-mandated
differences belong in `runtime-deviations-from-paper.md`, with the Paper
source, implementation, and validation assertion IDs recorded.

Source-side onboarding has no Paper requester-artboard equivalent; it uses
design-system-native screens and documents that constraint as a deviation.

## Testing Surfaces

- Unit tests: pure helpers, reducers, adapters, and type-shaped utilities.
- Component tests: screens, panels, modals, and app-state behavior under JSDOM.
- Demo-gallery e2e: `/demo/:scenarioId` Paper parity and console gates.
- Multi-device e2e: local `bifrost-devtools` relay on `ws://127.0.0.1:8194`
  for deterministic sign/ECDH/ping/onboard/backup flows.
- Manual/browser validation: real routes, public relays, IndexedDB inspection,
  and DEV-only `window.__debug` / `window.__iglooTest*` hooks when needed.

Prefer commands that avoid rewriting tracked WASM artifacts during refactors:

```bash
npx tsc --noEmit -p tsconfig.json --pretty false
npx tsc --noEmit -p tsconfig.node.json --pretty false
npx vitest run --config vitest.config.ts
npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop
```

Avoid `npm test` and `npm run build` for cleanup-only verification unless the
goal includes rebuilding the vendored WASM bridge.
