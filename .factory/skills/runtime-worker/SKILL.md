---
name: runtime-worker
description: Wires bifrost-rs WASM runtime behavior into the web-demo-v2 app — operations dispatch, policy writes, event log subscription, runtime telemetry. Handles features under the M1 / M2 / M3 / M4 milestones and any other feature whose core work is "JS talking to WASM runtime."
---

# Runtime Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that:
- Wire UI actions to `RuntimeClient.handleCommand()` / `setPolicyOverride()` / `wipeState()` / `updateConfig()`.
- Consume `drainCompletions()`, `drainFailures()`, `drainRuntimeEvents()` and expose them via `AppStateProvider` to React.
- Build / modify `RuntimeRelayPump` or `BrowserRelayClient` logic.
- Subscribe new state slices (event log buffer, pending ops, peer permission states) into `AppStateProvider`.

Do NOT use for pure screen styling work, pure settings persistence (use `ui-screen-worker`), or protocol package codec extensions (use `library-worker`).

## Required Skills

- **agent-browser** — for manual verification of wired behavior end-to-end (multi-device sign/ECDH round-trips). Invoke when verifying an operation actually completes through the UI.

## Work Procedure

1. **Understand the existing wiring.** Read `src/app/AppStateProvider.tsx` (current refresh loop + command forwarding), `src/lib/bifrost/runtimeClient.ts` (WASM wrapper surface), `src/lib/relay/runtimeRelayPump.ts` (current pump behavior), and the target screen/panel (`src/screens/DashboardScreen/...`). Note where the current mock/stub lives.

2. **Check Paper reference** for the target UI surface in `/Users/plebdev/Desktop/igloo-web-v2-prototype/igloo-paper/screens/<area>/`. Match copy, layout, and visual style. If you introduce any deviation due to protocol constraints, append an entry to `docs/runtime-deviations-from-paper.md` with assertion IDs.

3. **Write failing tests first (RED).** At minimum:
   - Vitest unit/integration: covers the state transitions you'll add (e.g., AppStateProvider exposes `pending_operations` from real runtime, `drainCompletions` results flow to an event log buffer). Use a fake `RuntimeClient` with controllable drain outputs.
   - Vitest component test: the affected panel/modal renders real data instead of mocks.
   - If the feature has a multi-device e2e assertion, add a new Playwright spec under `src/e2e/multi-device/` following the `frostr-infra/test/igloo-chrome/specs/chrome-pwa-pairing.spec.ts` pattern (two pages, shared local relay, seeded artifacts).
   - Verify tests FAIL before implementation: `npx vitest run path/to/new-test.test.ts` must show failures.

4. **Implement (GREEN).**
   - Prefer wiring real runtime data through AppStateProvider; remove mock fallbacks once the real path is live.
   - Preserve the Paper-parity `demoUi` override path for `/demo/*` scenarios — demo scenarios MUST continue to render identically to today.
   - For new runtime state slices, add them to `AppStateTypes.ts` and extend both `AppStateProvider` and `MockAppStateProvider` with matching shapes (mocks may return fixture values; real provider pulls from WASM).
   - Do NOT change the `WasmBridgeRuntime` typings or hand-edit vendored WASM. If you need new bridge methods, call `npm run wasm:build` only if the sibling bifrost-rs source has changed — otherwise call a different existing method or compose from existing ones.

5. **Verify (every time):**
   - `npx tsc --noEmit -p tsconfig.json --pretty false` — must be 0 errors.
   - `npx tsc --noEmit -p tsconfig.node.json --pretty false` — must be 0 errors.
   - `npx vitest run --config vitest.config.ts` — all tests pass, no `.skip` additions.
   - `npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop --workers 1` — gallery still passes.
   - If your feature's `fulfills` contains any VAL-OPS-/VAL-EVENTLOG-/VAL-APPROVALS-/VAL-POLICIES-/VAL-SETTINGS-*-<nnn> assertion requiring a multi-device round-trip, run the multi-device spec too.

6. **Manual verification via agent-browser.** For every assertion your feature fulfills, drive through it in agent-browser and record an `interactiveChecks` entry with the sequence and observed outcome. For multi-device assertions, use 2–3 concurrent sessions.

7. **Clean up.** Stop any dev server, local relay, or agent-browser session you started.

## Example Handoff

```json
{
  "successState": "success",
  "salientSummary": "Wired sign/ECDH/ping dispatch via AppStateProvider.handleRuntimeCommand → RuntimeClient → WASM; drainCompletions and drainFailures now feed new completions/failures slices; SigningFailedModal consumes real failure data with working Retry. Verified 2-device sign round-trip (primal relay) completes within 6s.",
  "whatWasImplemented": "1) Added AppStateValue.handleRuntimeCommand(cmd) forwarding to RuntimeClient.handleCommand with request-id capture via pending_operations polling. 2) Extended refreshRuntime loop to drainCompletions/drainFailures each tick and push into new runtimeCompletions / runtimeFailures slices. 3) Rewired SigningFailedModal to read from runtimeFailures keyed by request_id (replacing static copy); Retry dispatches a fresh sign with same message_hex_32 via handleRuntimeCommand. 4) Dev-only TestSignPanel on Dashboard (gated on import.meta.env.DEV) exposes a message input and Dispatch button. 5) AppStateTypes updated; MockAppStateProvider now supports injecting completions/failures for demo scenarios. Tests: 9 new vitest cases (appState.operations.test.ts, SigningFailedModal.test.tsx), 1 new playwright spec (src/e2e/multi-device/sign-round-trip.spec.ts).",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "npx tsc --noEmit -p tsconfig.json --pretty false", "exitCode": 0, "observation": "clean"},
      {"command": "npx vitest run --config vitest.config.ts", "exitCode": 0, "observation": "385 passing (9 new)"},
      {"command": "npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop --workers 1", "exitCode": 0, "observation": "42 passing"},
      {"command": "npx playwright test src/e2e/multi-device/sign-round-trip.spec.ts --project=desktop --workers 1", "exitCode": 0, "observation": "1 passing (2-device sign completes via local relay in 4.8s)"}
    ],
    "interactiveChecks": [
      {"action": "Open Dashboard as Device A (agent-browser session #1); Open Dashboard as Device B (session #2) with peer share of same 2-of-3 keyset; in session #1 click TestSign and enter 64-hex message; observe pending_operations row appears, then clears within ~5s", "observed": "Sign dispatched, completion received, no SigningFailedModal, peer B's event log shows SIGN_REQUEST_RECEIVED + PARTIAL_SIG_SENT; session #1 console.error count = 0."},
      {"action": "In session #1 with no online peers (set Device A alone), click TestSign", "observed": "runtime_status.signing_state === 'SIGNING_BLOCKED' within 1 tick; TestSign button disabled; after 30s, SigningFailedModal opens with real failure payload (code=TIMEOUT); Retry re-dispatches identical request_id."}
    ]
  },
  "tests": {
    "added": [
      {"file": "src/app/__tests__/operations.test.ts", "cases": [
        {"name": "handleRuntimeCommand forwards sign to WASM with 32-byte message", "verifies": "command shape passes through runtimeClient unchanged"},
        {"name": "drainCompletions populates runtimeCompletions slice in ascending request_id order", "verifies": "VAL-OPS-013"},
        {"name": "drainFailures populates runtimeFailures and opens SigningFailedModal for sign failures only", "verifies": "VAL-OPS-015"}
      ]},
      {"file": "src/screens/DashboardScreen/modals/__tests__/SigningFailedModal.test.tsx", "cases": [
        {"name": "renders real failure payload fields (code, message, round_id, peer_count)", "verifies": "VAL-OPS-007"},
        {"name": "Retry dispatches handleRuntimeCommand with same message", "verifies": "VAL-OPS-008"}
      ]},
      {"file": "src/e2e/multi-device/sign-round-trip.spec.ts", "cases": [
        {"name": "2-of-3 keyset round-trip via local relay", "verifies": "VAL-OPS-004, VAL-OPS-009, VAL-CROSS-001"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A feature's prerequisites (e.g., AppStateValue API extension needed) aren't in place yet. Return and suggest the missing feature be created first.
- A Paper requirement conflicts with an actual protocol constraint not yet documented. Return so the deviation doc + assertion wording can be reconciled.
- The WASM bridge surface is missing a method you need. Do NOT modify bifrost-rs. Return.
- A multi-device test cannot run because `bifrost-devtools relay` binary is missing from `bifrost-rs/target/`. Return so the orchestrator can decide whether to rebuild or switch to public relays.
