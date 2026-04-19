# User Testing

Testing surface, tools, and resource cost classification.

---

## Validation Surface

- **Browser UI** at `http://127.0.0.1:5173` (Vite dev server)
- **Tool:** agent-browser (Playwright-based headless Chromium)
- **Viewport:** 1440×1080 (desktop)

## Validation Setup

1. Start the Vite dev server: see `.factory/services.yaml` → `services.web.start`
2. Wait for healthcheck: `curl -sf http://127.0.0.1:5173`
3. Launch agent-browser and navigate to `http://127.0.0.1:5173`

## Validation Concurrency

- **Machine:** 128 GB RAM, 18 CPU cores
- **Per-instance footprint:** ~642 MB (Vite dev server ~257 MB + Chrome instance ~385 MB)
- **Usable headroom (70%):** ~75 GB
- **Max concurrent validators:** 5 (5 × 642 MB = ~3.2 GB, well within budget)
- **Note:** All validators share one Vite dev server; only the Chrome instances multiply

## Testing Approach

- Navigate through flows using agent-browser accessibility snapshots
- Take screenshots at key screens for visual verification
- Check console for errors after each flow
- Verify navigation by checking URL changes
- Verify interactive elements via accessibility tree (buttons, inputs, modals)

## Known Constraints

- WASM loading may add 2-3 seconds to initial page load
- IndexedDB state persists between test runs — validators may need to clear storage for clean state
- Some screens require pre-existing profile data (Dashboard, Settings, Export, Recover) — validators need to set up state first via the Create flow or mock data

## Flow Validator Guidance: agent-browser

- Use a unique browser session per validator and never use the default session.
- Treat each validator as isolated: start by clearing storage/cookies in its own browser context before running assertions.
- Stay within assigned assertions only; do not modify app code or shared service configuration.
- Use only `http://127.0.0.1:5173` as the app URL and do not use other ports.
- Save screenshots and any other artifacts only under the assigned evidence directory for that validator group.
- If an assertion depends on prior state (e.g., returning-user profile), create that state within the same validator session rather than relying on another validator.

## Welcome-Entry Validation Notes

- Onboard failure-path assertions are most reliably reached using the Handshake screen's **Simulate Failure** control.
- `agent-browser` network request capture may occasionally return no entries for pure client-side route transitions; treat screenshot + URL + console evidence as primary in those runs.

## Dashboard-States Validation Notes

- For clean-session setup, the fastest path to Dashboard is: create profile in Create flow, return to Welcome, then unlock the newly saved profile.
- In headless runs, Create > Distribution Completion may keep **Finish Distribution** disabled until each remote share's QR modal is opened and dismissed with **Done**.

## Settings-Export-Recover Validation Notes

- In headless `agent-browser`, the Export flow's **Copy** action may log a clipboard-permission console warning (`writeText` denied) even when UI feedback correctly changes to **Copied!**.
- For Settings/Export/Recover SPA-only transitions, `agent-browser` network capture often returns no requests; prefer URL checks, screenshots, and console error checks as primary evidence.
