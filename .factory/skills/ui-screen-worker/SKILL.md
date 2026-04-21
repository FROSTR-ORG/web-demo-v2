---
name: ui-screen-worker
description: Builds or modifies React screens/panels/modals to Paper parity, wires settings persistence, handles IndexedDB writes, and implements UI affordances (QR scan, camera, Copy/Download). Handles features under M5 / M6 settings + backup + QR + nsec-split flows.
---

# UI Screen Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that:
- Build or rewire React screens, panels, modals in `src/screens/` to Paper reference.
- Persist user-entered data to IndexedDB via AppStateProvider mutators.
- Implement UI affordances: password prompts, Copy/Download, QR scan & generation, camera permission flows.
- Rename UI labels / CSS classes / routes (e.g., "Rotate Share" → "Replace Share").

Do NOT use for protocol-level runtime wiring (`runtime-worker`) or core protocol package codec additions (`library-worker`).

## Required Skills

- **ui-builder** — use when building a new React screen component from a Paper reference. Invoke at the start of Paper-derived UI work to ensure layout, typography, and styling follow the established conventions.
- **agent-browser** — manual verification of every new/changed screen and modal against Paper reference. Required whenever the feature renders a new/changed user-visible element. **Pure copy-string / neutral-fallback / data-wiring fixes** that change what text is rendered but not what the user does (e.g., replacing synthesized copy with a neutral fallback rendered from the same component path) may skip agent-browser IF the new text is fully covered by Vitest component tests. If you omit agent-browser you MUST set `followedProcedure: false` and list the omission under `deviations`.

## Work Procedure

1. **Read the Paper reference** at `/Users/plebdev/Desktop/igloo-web-v2-prototype/igloo-paper/screens/<area>/` (README.md, screen.html, screenshot.png, export-metadata.json artboard id). Capture exact copy and layout.

2. **Read the target surface** in `src/screens/...`. Identify where the stubbed or missing behavior lives today. Follow the DashboardScreen/RotateKeysetScreen/RecoverScreen folder pattern for new large flows.

3. **Check AppStateProvider mutator surface.** If the feature needs new persistence (e.g., updateProfileName, updateRelayList, publishProfileBackup), add the mutator to `AppStateValue` / `AppStateProvider.tsx` / `MockAppStateProvider.tsx` together. Include IndexedDB write via existing idb-keyval helpers.

4. **Write failing tests first (RED):**
   - Vitest + Testing Library component test: renders, validates input, calls mutator, handles error states.
   - If persistence is involved: test reading the stored profile back from idb-keyval round-trips the update.
   - If an e2e flow is involved: add a demo-gallery scenario at `/demo/<new-scenario-id>` seeded by MockAppStateProvider, then extend `src/e2e/demo-gallery.spec.ts` to cover it.
   - Verify tests FAIL before implementation.

5. **Implement (GREEN):**
   - Match Paper copy verbatim. Use the design system primitives (`.settings-section`, `.settings-card`, `.settings-btn-blue`, `.settings-btn-red`, `.event-log-list`, etc.). Import icons from `lucide-react`.
   - For IndexedDB writes: use existing helpers (`saveProfile`, `removeProfile`, `readProfiles`); do NOT add a second storage path.
   - For camera/QR (M6): use `getUserMedia({video: {facingMode: 'environment'}})` + `jsQR` to decode frames; on permission denied fall back gracefully with a paste option.
   - For QR generation: use `qrcode` (already a dep) to render on a `<canvas>`.
   - For Copy/Download: use `navigator.clipboard.writeText` and `Blob` + `download` link.
   - When renaming "Rotate Share" → "Replace Share": use `rg -i "rotate.share" src/ test/ docs/` to find matches, change them all in one feature, verify `rg` returns only intentional matches afterward.

6. **Verify:**
   - `npx tsc --noEmit -p tsconfig.json --pretty false` — 0 errors.
   - `npx vitest run --config vitest.config.ts` — all pass. Tests MUST have been written RED first — capture the initial failing run in your handoff's `verification.commandsRun` (a pre-implementation vitest invocation that shows the new tests failing).
   - `npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop --workers 1` — all pass, **except** for the known pre-existing failures documented under `AGENTS.md > Known Pre-Existing Issues` (do not re-fail the feature on those; call them out explicitly in your verification log and continue).
   - Visual check via agent-browser: screenshot new/changed screens, compare to Paper screenshot.

7. **Manual verification via agent-browser.** Walk through every user flow in the UI, paste real input, observe persistence across Lock/Unlock/reload, test error paths.

8. **Clean up.** Stop dev server and agent-browser sessions. Do not leave the camera stream live.

## Example Handoff

```json
{
  "successState": "success",
  "salientSummary": "Persisted Device Profile Name and Relay List edits in SettingsSidebar; added validation, IndexedDB round-trip, and relay hot-reload. Renamed all 'Rotate Share' occurrences to 'Replace Share'. Verified persistence across Lock/Unlock/reload via agent-browser and Paper parity via visual diff.",
  "whatWasImplemented": "1) AppStateValue.updateProfileName(name) writes through to stored profile; empty/whitespace rejected with inline error. 2) AppStateValue.updateRelays(relays[]) validates wss:// URLs, rejects duplicates, writes to stored profile, and calls RuntimeRelayPump.restartConnections(newList) so sockets hot-reload. 3) SettingsSidebar: name field with Save/Cancel, editable relay list with Add/Remove/Edit rows + inline validation, Group Profile threshold/npub/created/updated now read from real IndexedDB record (no hardcoded Feb 2026 string). 4) Rename sweep: 14 occurrences of 'Rotate Share' renamed to 'Replace Share' across src/screens/, src/styles/global.css, src/demo/scenarios.ts, src/e2e/. Route /rotate-share removed; no redirect needed (it was never linked). Tests: 18 new vitest + 2 new playwright scenarios.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "npx tsc --noEmit -p tsconfig.json --pretty false", "exitCode": 0, "observation": "clean"},
      {"command": "npx vitest run", "exitCode": 0, "observation": "403 passing (18 new)"},
      {"command": "npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop --workers 1", "exitCode": 0, "observation": "44 passing (2 new scenarios)"},
      {"command": "rg -i 'rotate.share' src/ docs/ test/ 2>&1 | grep -v 'Rotate Share →' || true", "exitCode": 0, "observation": "only 1 intentional match in docs/runtime-deviations-from-paper.md (history note)"}
    ],
    "interactiveChecks": [
      {"action": "Unlock profile; open Settings; change Profile Name to '🦀 Alice 中文'; Save; Lock; Unlock", "observed": "Name renders identically after unlock; IndexedDB record shows same unicode bytes; no XSS; no console errors."},
      {"action": "Settings → remove wss://relay.damus.io; observe WS close frame 1000 in DevTools Network panel; verify dashboard relay health row disappears within 2s", "observed": "Close frame code=1000 emitted, row removed, surviving relays stay OPEN."}
    ]
  },
  "tests": {
    "added": [
      {"file": "src/screens/DashboardScreen/sidebar/__tests__/SettingsSidebar.nameEdit.test.tsx", "cases": [
        {"name": "empty name rejected with inline error", "verifies": "VAL-SETTINGS-002"},
        {"name": "unicode + emoji names save and render", "verifies": "VAL-SETTINGS-024"},
        {"name": "XSS payload in name is rendered as literal text", "verifies": "VAL-SETTINGS-024"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Paper reference for the target surface is ambiguous or missing — return and request clarification.
- A UI affordance requires a runtime method that doesn't exist yet (e.g., publishing a profile backup requires a relay publish path not yet built) — return and suggest the runtime feature come first.
- The WASM bridge is missing a codec helper (e.g., QR-specific string encoding). Do NOT modify bifrost-rs. Return.
