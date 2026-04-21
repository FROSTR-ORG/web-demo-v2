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
