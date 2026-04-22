# User Testing

Runtime surface, testing tools, and validator concurrency.

## Validation Surface

**Primary:** web browser via `agent-browser` (mandatory per mission rule: web apps use agent-browser unless user specifies otherwise).

**Routes for validation:**
- `http://127.0.0.1:5173/` — Welcome / Unlock (entry)
- `http://127.0.0.1:5173/demo` — Demo gallery index
- `http://127.0.0.1:5173/demo/:scenarioId` — Individual Paper-reference scenarios (deterministic, seeded via MockAppStateProvider)
- `http://127.0.0.1:5173/dashboard/:profileId` — Real-profile dashboard (requires prior unlock/create)
- Flow routes: `/create/*`, `/import/*`, `/onboard/*`, `/rotate-keyset/*`, `/replace-share/*`, `/recover/*`

**Test query params:**
- `?chrome=0` strips demo chrome (toolbar) for clean capture

## Validation Tools

- **agent-browser** — primary. Supports multiple independent sessions. Has Playwright underneath for deep interactions.
- **Direct curl / ws client** — for protocol-level checks (relay reachability, published event inspection).
- **DevTools** — network panel for WebSocket frame inspection, Application panel for IndexedDB state, Console panel for error capture.

## Multi-Device Validation Pattern

For sign/ECDH round-trip tests requiring multiple peers, copy the frostr-infra `chrome-pwa-pairing.spec.ts` pattern:

1. Spawn a local `bifrost-devtools` relay on a random port (or use public relays per user preference).
2. Generate a threshold keyset via WASM `create_keyset_bundle` (use the vendored bridge directly in Node for test setup).
3. Seed profile A into agent-browser session #1 by driving the Create flow OR by pre-writing IndexedDB.
4. Deliver bfonboard packages to sessions #2, #3; drive the Onboard flow in each.
5. Trigger operations on session #1 (sign / ECDH / ping); verify completion on all sessions.

Multiple agent-browser sessions share the same dev server but use isolated storage states (IndexedDB namespaced by browser profile).

## Local `bifrost-devtools` Relay (multi-device e2e)

Multi-device Playwright specs under `src/e2e/multi-device/` rely on a locally-spawned `bifrost-devtools relay` instead of the public Nostr relays, so that two browser contexts can share inbound/outbound envelopes with zero external dependencies.

### Binary bootstrap

The relay binary lives in the sibling `bifrost-rs` workspace and is NOT produced by `npm install`. It is bootstrapped by `.factory/init.sh` on session start:

- If `/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs/target/release/bifrost-devtools` already exists, the build step is skipped (idempotent).
- If `cargo` is not available (e.g. a CI image without the Rust toolchain), `init.sh` prints a warning and continues. Multi-device specs auto-skip with a clear reason in that case.
- Manual build: `cargo build --release -p bifrost-devtools --manifest-path ../bifrost-rs/Cargo.toml` from the repo root, or run `commands.build_devtools` from `.factory/services.yaml`.

### Service: `local_relay`

`services.local_relay` in `.factory/services.yaml` pins the relay to **port 8194** (the only relay port allocated in AGENTS.md Mission Boundaries — do not change it):

- `start`: `…/bifrost-devtools relay --host 127.0.0.1 --port 8194`
- `stop`: `lsof -ti :8194 | xargs kill -9` (port-based kill is allowed because the port is declared in the manifest)
- `healthcheck`: `nc -z 127.0.0.1 8194` (returns 0 once the listener is bound)

### Running the multi-device ECDH spec

```
# One-time: ensure the binary is built (idempotent; skipped if present)
bash .factory/init.sh

# Run the spec (auto-skips if cargo / binary missing; otherwise spawns
# its own relay on port 8194 and tears it down in afterAll)
npx playwright test src/e2e/multi-device/ecdh-roundtrip.spec.ts \
  --project=desktop --workers 1
```

The spec is self-contained: it spawns and tears down the relay itself, so you do NOT need to start `services.local_relay` separately when invoking Playwright. Conversely, if you start `services.local_relay` manually for exploratory work, stop it (via `services.local_relay.stop`) before running the spec to avoid port contention.

### Teardown

- Specs: the Playwright `test.afterAll` hook kills the spawned relay process by PID and waits for `exit`/`close`.
- Manual: `lsof -ti :8194 | xargs kill -9` (the `stop` command from `services.local_relay`).
- Always verify the port is free (`nc -z 127.0.0.1 8194` returns non-zero) before exiting the worker session, per the "no orphaned processes" rule in AGENTS.md.

## Validation Concurrency

**Machine:** 128 GB RAM, 18 cores, ~51 GB free at baseline.

**Per-session footprint (measured in dry run):** ~366 MB RSS per agent-browser session; +4 Chromium procs each.

**Dev server footprint:** negligible (~200 MB).

**Max concurrent validators:**
- **Multi-device surface** (tests that spin up N>1 browsers simultaneously): **4** (allows 3 device instances + 1 spare within 70% of available RAM headroom)
- **Single-device surface** (per-scenario functional tests): **5**

CPU (18 cores, ~35% baseline load) is the practical limiter well before RAM. Tests should avoid CPU-intensive parallelism beyond the recommended concurrency.

## Paper Parity Reference

For every UI surface, reference `/Users/plebdev/Desktop/igloo-web-v2-prototype/igloo-paper/screens/<area>/` for copy, layout, and visual style. Each scenario in `src/demo/scenarios.ts` links to its Paper source. Deviations (e.g., reactive denial surface) documented in `/Users/plebdev/Desktop/igloo-web-v2-prototype/web-demo-v2/docs/runtime-deviations-from-paper.md`.

## Known Pre-Existing Issues (Do Not Fix)

(To be populated mid-mission as discovered.)

## Flow Validator Guidance: agent-browser

- Isolation boundary: each subagent must use its own `agent-browser` session id and must not reuse another subagent's session.
- Shared service boundary: all subagents may use the same app server `http://127.0.0.1:5173` and local relay `ws://127.0.0.1:8194`, but must keep storage isolated per browser session.
- State safety: do not clear global data (Clear Credentials / full DB wipe) unless the assigned assertion explicitly requires it.
- Evidence minimum: include screenshots and observable snapshots for every assigned assertion, plus console error summary.
- Teardown: close every `agent-browser` session opened by the subagent before it exits.

## Observed Tooling Notes (m1-ops)

- In headless `agent-browser` runs, `document.visibilityState` transitions may not reliably emit `hidden` during tab-switch simulations.
- Network capture in this surface did not consistently provide websocket frame-level telemetry (reconnect events and close-frame codes). For assertions that depend on those details, capture app-level request-id observables and explicit WS send hooks as backup evidence.

## Flow Validator Guidance: test-observability hooks (DEV only)

These dev-gated hooks (`import.meta.env.DEV`) surface evidence that agent-browser can't reliably observe through the headless DOM/Network layers alone. All hooks are stripped from production builds (verified via `rg -i '__iglooTest|__debug\.(relayHistory|visibilityHistory|noncePoolSnapshot)' dist/` → 0 matches after `npm run build`). Install the provider (`AppStateProvider`) in the route you're validating; then use the hooks below.

### `window.__debug.relayHistory` — per-relay WS telemetry (VAL-OPS-023, VAL-OPS-028)

- Array of `{ type: "open" | "close" | "error", url, at: ISOString, code?, wasClean? }` entries, one per socket lifecycle transition.
- Populated by `BrowserRelayClient` via `RuntimeRelayPump`'s `onSocketEvent` hook; capped at ~200 entries (FIFO).
- Also exposed on `runtimeRelays[*]` via new fields: `reconnectCount`, `lastConnectedAt`, `lastDisconnectedAt`, `lastCloseCode`. Use `window.__appState.runtimeRelays` to read them from a validator session.
- Evidence pattern: `JSON.stringify((window as any).__debug.relayHistory)` inside `page.evaluate`.

### `window.__debug.visibilityHistory` — tab-hide/show evidence (VAL-OPS-021)

- Array of `{ state: "visible" | "hidden", at: ISOString }` entries, seeded with the initial state on mount and appended on every `document.visibilitychange` event.
- Use this instead of relying on the headless runtime re-emitting the DOM event: drive the transition with `await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }))` + `document.dispatchEvent(new Event('visibilitychange'))` and then assert `window.__debug.visibilityHistory.some(e => e.state === 'hidden')`.

### `window.__debug.noncePoolSnapshot` — nonce-pool accounting shim (VAL-OPS-024)

- Getter returning `{ nonce_pool_size, nonce_pool_threshold }` derived from `RuntimeSnapshotExport.state.nonce_pool`, or `null` when no runtime is attached.
- When `window.__iglooTestSimulateNonceDepletion()` is active, returns the overridden values.
- See `docs/runtime-deviations-from-paper.md` for the nonce-pool shim rationale (WASM bridge does not expose these fields directly).

### `window.__iglooTestDropRelays(code = 1006)` / `window.__iglooTestRestoreRelays()` — VAL-OPS-016 harness

- `__iglooTestDropRelays(code = 1006)` forcibly closes every live relay socket with the supplied simulated close code. Updates `runtimeRelays[*].lastCloseCode` and `.lastDisconnectedAt`. Does NOT synchronously mutate `sign_ready` — any in-flight pending sign must still transition to failure via the runtime's existing TTL-driven path (drainFailures).
- `__iglooTestRestoreRelays()` reopens the previously-configured relay set. Each successful reconnect increments that relay's `reconnectCount` by 1.
- Evidence pattern: dispatch a sign → `window.__iglooTestDropRelays()` → observe `SigningFailedModal` open with an `OperationFailure` (code `timeout`) and `runtimeRelays[*].lastCloseCode === 1006`.

### `window.__iglooTestSimulateNonceDepletion(input?)` / `window.__iglooTestRestoreNonce()` — VAL-OPS-024 harness

- `__iglooTestSimulateNonceDepletion({ nonce_pool_size?, nonce_pool_threshold?, reason? })` pushes a `nonce_pool_depleted` entry into `runtime_status.readiness.degraded_reasons` and flips `sign_ready` to `false`. The existing `isNoncePoolDepleted` heuristic fires and the `Syncing nonces` / `Trigger Sync` overlay renders.
- `__iglooTestRestoreNonce()` clears the override and forces an immediate `runtimeStatus` refresh so the overlay disappears without waiting for the next 2.5s poll tick.
- Evidence pattern: call simulate → screenshot the overlay → call restore → screenshot the overlay gone.

All hooks are **DEV-only**. If your validation runs a production build (`vite build` / served from `dist/`), the hooks are absent by design — fall back to capturing app-level state via `window.__appState.runtimeStatus` / `.runtimeRelays` only.

## Observed Tooling Notes (m2-approvals)

- For policy-prompt queue assertions, sample modal/queue DOM state after a short post-enqueue wait (~250-350ms) to avoid React commit race conditions.
- Fresh deep-links to `/dashboard/:profileId` can redirect to `/` before bridge hydration in headless runs; seed dashboard context from `/demo` first, then navigate in-session for stable approvals validation.

## Observed Tooling Notes (m3-policies)

- Existing m3 Playwright + Vitest suites provide strong coverage for most policy assertions, but no direct automated proof for:
  - `VAL-POLICIES-007` strict `<=500ms` propagation bound
  - `VAL-POLICIES-009` explicit full-matrix `clear_policy_overrides()` reset
  - `VAL-POLICIES-023` conflicting cross-tab writes (`deny -> allow`) with 2s convergence bound
  - `VAL-CROSS-003` full allow-once retry-success loop (beyond denial-only round-trip)
- For future user-testing reruns, prefer dedicated agent-browser flows for the four assertions above, capturing DOM timing snapshots and request-id correlation artifacts directly from `window.__appState`.
