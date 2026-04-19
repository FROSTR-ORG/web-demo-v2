# User Testing

Testing surface, tools, and resource cost classification for this mission.

---

## Validation Surface

- **Browser UI** at `http://127.0.0.1:5173` (Vite dev server).
- **DemoGallery entry points** at `http://127.0.0.1:5173/demo/{scenario-id}` — each scenario in `src/demo/scenarios.ts` maps one URL to one Paper screen reference and mounts the component with its mock app state preset. This is the PRIMARY testing surface for every UI fidelity assertion.
- **Main app routes** at `http://127.0.0.1:5173/*` — used for cross-flow navigation assertions (e.g. VAL-CROSS-005..014).
- **Tool:** `agent-browser` (Playwright-based headless Chromium) is mandatory per mission rules for web-app surfaces.
- **Viewport:** 1440×1080 (desktop). For mobile-specific assertions, use 390×844 (Pixel 5).

## Validation Setup

1. Start the Vite dev server: see `.factory/services.yaml` → `services.web.start`.
2. Wait for healthcheck: `curl -sf http://127.0.0.1:5173`.
3. Launch `agent-browser` and navigate to target URL.

## Validation Concurrency

- **Machine:** 128 GB RAM, 18 CPU cores.
- **Per-instance footprint:** ~642 MB (Vite dev server ~257 MB shared + Chrome instance ~385 MB per validator).
- **Usable headroom (70%):** > 75 GB — plenty of room.
- **Max concurrent validators:** **5** (conservative, matches upper guidance cap).
- **Shared Vite dev server:** all validators share one dev server on 5173; only Chrome instances multiply.

## Testing Approach for This Mission

For UI fidelity assertions:
1. Navigate to the scenario's `/demo/{id}` URL.
2. Wait for `networkidle`.
3. Assert expected text (headings, labels, CTAs, help text) is visible in the DOM — quote from the Paper `screen.html` as the source of truth.
4. For interaction assertions: click/type/press as specified, then assert the expected post-state (URL change, modal appearance, updated copy, etc.).
5. Capture screenshots + console errors as evidence.

**SPA content is client-rendered.** Do NOT rely on `curl | grep` to verify in-page text — the raw HTML only returns `<div id="root"></div>` + `<title>Igloo Web</title>`. Always use `agent-browser` with `wait --load networkidle`.

## DemoGallery Quick Reference

- Gallery index: `/demo` shows all canonical scenarios grouped by flow.
- Canonical scenario page: `/demo/{id}` renders the app shell + demo chrome toolbar (All screens, Previous, Next, Raw, Reference).
- Raw mode: `/demo/{id}?chrome=0` hides the demo chrome (useful for visual parity screenshots against Paper screenshots).
- Variant scenarios (`canonical: false`, e.g. `import-error-corrupted`, `onboard-failed-rejected`) are reachable only by direct URL — they do NOT appear in the gallery index.

## Scenario-Level Setup

Every DemoGallery scenario injects its own mock `AppStateValue` via `MockAppStateProvider` — validators do NOT need to manually create profiles, unlock, or seed fixtures. The scenario's `appState` preset (see `src/demo/fixtures.ts` and `src/demo/scenarios.ts`) is the ground truth for what the user would see for that particular runtime state.

For cross-flow assertions starting from the main app `/`, the initial state is defined by the `AppStateProvider` in `src/app/AppState.tsx`, which loads profiles from IndexedDB. For a clean state, validators may need to clear IndexedDB between tests (`indexedDB.deleteDatabase` or agent-browser storage clear).

## Known Constraints

- WASM loading may add 2–3 seconds to initial page load.
- IndexedDB state persists between test runs — clear storage if you need a clean main-app flow.
- Some cross-flow assertions require pre-existing profile state; create it in the same validator session via the Create flow rather than relying on another validator.
- On some screens, accessible text extraction may concatenate adjacent number+label text (example: `12saved profiles`); for such cases, combine URL/screenshot evidence with robust text checks instead of a single exact-string wait.
- Some list screens reuse identical button labels (e.g., multiple `Rotate` buttons in welcome variants); prefer row-scoped selectors or snapshot refs to avoid ambiguous clicks.

## Flow Validator Guidance: browser-ui

- Surface/tool: browser UI via `agent-browser` only.
- Isolation boundary: each validator must use its own browser session and its own assigned assertion IDs; never use the default session.
- Shared-state constraint: validators may navigate app routes but must not modify app source, shared service config, or other validators' evidence/report files.
- Allowed app origin: `http://127.0.0.1:5173` only.
- Evidence boundary: write screenshots/log artifacts only inside the assigned mission evidence folder.
- Evidence priority for SPA assertions: URL checks + screenshots + console/page errors are primary; network capture is secondary context.

## Mission Tool Mandates

- **agent-browser is mandatory** for every UI fidelity assertion (mission rule for web-app surfaces).
- **Shell (bash)** is used only for: TypeScript build (`npx tsc -b`), Vitest (`npx vitest run --config vitest.config.ts`), Playwright (`npx playwright test`) — see VAL-CROSS-016..019.
