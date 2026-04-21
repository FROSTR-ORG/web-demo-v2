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
