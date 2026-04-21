---
name: protocol-flow-worker
description: Implements multi-step runtime-side protocol flows that span browser JS, relay publish/subscribe, and WASM runtime state — specifically source-side onboarding sponsorship. Handles M7 features where a logged-in device drives a ceremony over a real relay.
---

# Protocol Flow Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that:
- Drive multi-party protocol ceremonies from the dashboard (source-side onboarding sponsorship in M7).
- Require coordination between local WASM runtime, relay publish, and peer-side response consumption.
- Compose several bifrost bridge primitives (handle_command + drain_outbound_events + drain_completions + package codecs) into a user-facing flow.

Do NOT use for purely reactive UI wiring (`runtime-worker` / `ui-screen-worker`).

## Required Skills

- **agent-browser** — mandatory for multi-device validation of any protocol ceremony.

## Work Procedure

1. **Map the ceremony.** Document the protocol steps end-to-end:
   - What command does the source initiate? (`onboard` with `peer_pubkey32_hex`)
   - What envelope does bifrost emit? (`drain_outbound_events()` after the tick — an Onboard request).
   - What package does the source generate for hand-off? (`encode_bfonboard_package` with chosen password)
   - How does the requester consume it? (paste + decode + restore_runtime, already wired)
   - How does the source observe completion? (`drain_completions()` yields `CompletedOperationJson::Onboard { request_id, group_member_count, group, nonces }`)
   - What state changes on success? (peer list grows; runtime_metadata refreshes; event log gets ONBOARD entries on both sides.)

2. **Check Paper reference.** There's no dedicated Paper screen for source-side sponsorship; use design system primitives (`.settings-section`, `.settings-card`) to build a screen that matches the stack visually. Reuse copy patterns from the requester-side onboarding flow (`igloo-paper/screens/onboard/`).

3. **Consult frostr-infra for related patterns.** Igloo-chrome/igloo-pwa/igloo-home onboarding is primarily requester-side; source-side sponsorship is NEW. But look at patterns for:
   - Multi-tab sponsor-driven flows in frostr-infra test specs
   - `encode_bfonboard_package` usage in web-demo-v2's existing create-flow (share distribution)

4. **Write failing tests first (RED):**
   - Vitest: the AppStateValue.beginOnboardSponsorship mutator shape, state transitions, cancellation cleanup.
   - Vitest: encoded bfonboard package round-trips through decode_bfonboard_package with the chosen password.
   - Playwright multi-device spec: source creates onboard package → requester pastes → both complete; peer list updates on source side; ONBOARD badges on both event logs.
   - Playwright spec: cancel mid-sponsorship cleans up outbound queue (no stale Onboard request lingering).

5. **Implement (GREEN):**
   - Add a "Onboard a Device" entry to the dashboard Settings sidebar (or as a separate top-level action per Paper).
   - Build the sponsor screen (`src/screens/OnboardSponsorship/` or colocate under DashboardScreen): configure new device label, password, relay overrides → generate bfonboard → display with Copy + QR render (`qrcode` dep).
   - Dispatch `handleRuntimeCommand({type: 'onboard', peer_pubkey32_hex})` with the target peer identity derived from the new onboard bundle.
   - Listen for `CompletedOperationJson::Onboard` and update dashboard peer list; refresh `runtime_metadata`.
   - Cancel path: remove the queued Onboard op (dispatch appropriate cancel if exposed; otherwise set policy override to block any follow-up).
   - Preserve security invariants: no raw nsec/share secrets in React state beyond what the hand-off package already contains; cleanup session on any exit.

6. **Verify:**
   - Standard TS + vitest + playwright gates.
   - Multi-device e2e against the local bifrost-devtools relay: run at least one full 2-party ceremony (source + requester) end-to-end.
   - If time permits, run against a real public relay to catch latency / frame-ordering issues.

7. **Manual verification via agent-browser:**
   - Open source session; drive through configure → generate → copy package.
   - Open requester session; paste package; unlock with chosen password; observe handshake complete.
   - Back on source: peer list shows the new peer; event log shows ONBOARD entries; runtime_metadata reflects new member count.
   - Repeat with intentional failure paths: wrong password, cancel mid-flight, duplicate package.

8. **Document deviations** in `docs/runtime-deviations-from-paper.md` for any design choices that differ from requester-side Paper screens.

9. **Clean up.** Stop all sessions, relays, servers.

## Example Handoff

```json
{
  "successState": "success",
  "salientSummary": "Built dashboard source-side onboarding sponsorship flow: new 'Onboard a Device' entry in Settings, configure + generate bfonboard package, display with Copy + QR, dispatch Onboard command, observe requester-side adoption and peer list update. Verified 2-browser round-trip against local relay; peer list updates within 4s of requester adoption; ONBOARD badges land on both event logs.",
  "whatWasImplemented": "1) src/screens/OnboardSponsorship/ folder with ConfigureScreen (name + password + relay overrides), HandoffScreen (package text + QR canvas + Copy), and AwaitingAdoption (pending_operations pill + Cancel). 2) AppStateValue.beginOnboardSponsorship(config) orchestrates encode_bfonboard_package + handleRuntimeCommand({type:'onboard'}) + tracks state in onboardSponsorshipSession slice. 3) Completion handler watches drainCompletions for CompletedOperationJson::Onboard and calls finishOnboardSponsorship(request_id) which refreshes runtime_metadata and adds peer to dashboard. 4) Cancel path drops the outbound queue entry and clears session. 5) Tests: 11 new vitest + 2 new playwright multi-device specs. 6) Added deviation doc entry explaining new screen is design-system-native (no Paper source).",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "npx tsc --noEmit -p tsconfig.json --pretty false", "exitCode": 0, "observation": "clean"},
      {"command": "npx vitest run", "exitCode": 0, "observation": "414 passing (11 new)"},
      {"command": "npx playwright test src/e2e/multi-device/onboard-sponsorship.spec.ts --project=desktop --workers 1", "exitCode": 0, "observation": "2 passing (happy path + cancel)"}
    ],
    "interactiveChecks": [
      {"action": "Source session: Settings → Onboard a Device → enter 'Bob Mobile' + password 'pw-test-pkg' → Generate → Copy package → verify non-empty bfonboard1... string in clipboard", "observed": "Package string 328 chars, bfonboard1 prefix, copies cleanly."},
      {"action": "Requester session: Welcome → Onboard → paste package → enter 'pw-test-pkg' → Unlock → observe /onboard/complete within 6s", "observed": "Handshake completed; profile added; runtime unlocks."},
      {"action": "Back on source: observe peer list grow by 1 (Bob Mobile pubkey first 8 chars visible); event log shows ONBOARD success entry", "observed": "Peer list refreshed, runtime_metadata.member_idx unchanged but member_count = 3; event log row badge ONBOARD."}
    ]
  },
  "tests": {
    "added": [
      {"file": "src/screens/OnboardSponsorship/__tests__/sponsorship.test.tsx", "cases": [
        {"name": "Generate button is disabled without name and password", "verifies": "VAL-ONBOARD-003"},
        {"name": "bfonboard round-trips with chosen password", "verifies": "VAL-ONBOARD-004"}
      ]},
      {"file": "src/e2e/multi-device/onboard-sponsorship.spec.ts", "cases": [
        {"name": "2-browser source sponsored onboarding completes", "verifies": "VAL-ONBOARD-008, VAL-ONBOARD-009, VAL-CROSS-001"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- WASM bridge lacks a method needed for the ceremony (e.g., cancel-in-flight onboard). Return with the missing surface; do not modify bifrost-rs.
- Ceremony semantics are ambiguous vs what the protocol docs say. Return with a concrete question.
- Local relay binary is missing and public relays are unreliable for the test — return to orchestrator for a decision.
