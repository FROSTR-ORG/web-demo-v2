# Follow-up Paper Parity Report (fix-followup-paper-parity-final-review)

Final design-parity audit of the three live-runtime onboarding surfaces against the latest
igloo-paper artboards. Baselines live under
`src/e2e/visual/baselines/followup-paper/` (see `baselines.json` for the Paper node IDs,
artboard names, and capture timestamp).

Reconciled Paper artboard IDs (the feature task description transposed the first two):

| Screen                  | Paper artboard ID | Paper artboard name                           | Paper dimensions |
| ----------------------- | ----------------- | --------------------------------------------- | ---------------- |
| `/create/profile`       | **60R-0**         | Web — Shared — 2. Create Profile              | 1440 × 1787      |
| `/create/distribute`    | **8GU-0**         | Web — Shared — 3. Distribute Shares           | 1440 × 1284      |
| `/create/complete`      | **LN7-0**         | Web — Shared — 3b. Distribution Completion    | 1440 × 1284      |

Finding severity legend:
- **fix-in-code** — drift was small enough to fix in the same feature commit; see the cited
  source change.
- **documented deviation** — drift is intentional; see
  `docs/runtime-deviations-from-paper.md` for the full entry.
- **no drift** — live render already matches Paper for that aspect.

## /create/profile

Paper source: `60R-0`. Implementation: `src/screens/CreateProfileScreen.tsx`. Demo scenario:
`/demo/shared-create-profile`.

- Copy drift: **no drift detected.** Page heading, subcopy, Profile Name help text, Assigned
  Local Share block, Profile Password help text, Relays section header, Peer Permissions help
  text, and the "Continue to Distribute Shares" CTA all match Paper 60R-0 verbatim. Confirmed
  via exact-text assertions in `src/screens/__tests__/CreateProfileScreen.test.tsx`.
- Layout drift: **no drift detected** at the section level. Order matches Paper
  (Stepper → BackLink → Page Intro → Profile Name → Assigned Local Share → Profile Password
  → Relays → Peer Permissions → Primary CTA).
- Missing element: **no missing elements.** Paper 60R-0 renders three peer permission rows
  (Peer #0, Peer #1, Peer #2) because the Paper fixture is a 2-of-3 keyset; the live render
  iterates `createSession.keyset.group.members`, which the same demo fixture seeds with three
  members, so the rendered row count matches.
- Extra element: **no extras.** VAL-FOLLOWUP-007 is satisfied — the Create Profile DOM has
  no "Remote Package Password" or "Confirm Remote Package Password" copy (they moved to
  Distribute Shares as per-share fields in feature fix-followup-distribute-2a).
- Color / typography drift: **documented deviation.** The peer permission row renders a
  `ToggleSwitch` control (slider-style on/off switch with a colored label) rather than
  Paper's colored pill badges (saturated when the method is allowed, muted when denied).
  The switch is the design-system primitive already used by the dashboard `PoliciesState`
  panel and the Settings sidebar; converting to a separate chip-toggle primitive would
  fragment the design system without improving user clarity. See
  `docs/runtime-deviations-from-paper.md` > "Peer Permissions row uses ToggleSwitch instead
  of Paper pill badges (VAL-FOLLOWUP-007 / 60R-0)".

## /create/distribute

Paper source: `8GU-0`. Implementation: `src/screens/DistributeSharesScreen.tsx`. Demo
scenario: `/demo/shared-distribute-shares`.

- Copy drift: **no drift detected.** Page heading, subcopy, "How this step works" kicker,
  the three numbered-step titles + bodies, LOCAL share "Saved to Igloo Web" / "Saved
  securely in this browser", per-share chip states ("Package not created" / "Ready to
  distribute" / "Distributed"), "Waiting for package password" helper, "Package Password"
  / "bfonboard Package" field labels, and the "Continue to Completion" CTA all match Paper
  8GU-0 verbatim. Confirmed via exact-text assertions in
  `src/screens/__tests__/DistributeSharesScreen.test.tsx`.
- Layout drift: **no drift detected.** Section order matches Paper
  (Stepper → Page Intro → How-this-step-works → Share 1 Local → Share 2 remote (pre-state)
  → Share 3 remote (post-state) → Primary CTA). The per-share row layout matches:
  header row (title + index + status chip) → bfonboard preview / waiting helper →
  Package Password input or masked display + Create package button when pre-state →
  action row (Copy package / Copy password / QR code / Mark distributed).
- Missing element: **fix-in-code applied.** Paper 8GU-0 renders no BackLink on the
  Distribute Shares screen — once a profile has been created and per-share onboard
  dispatches are in flight, the flow is one-way and the Stepper is the only navigation
  affordance. The previous implementation rendered a BackLink back to `/create/profile`;
  removed in
  `src/screens/DistributeSharesScreen.tsx` (removed `BackLink` import and usage) with an
  inline comment citing this feature. Browser-back remains functional for users who want
  to inspect the prior step.
- Extra element: **no extras.** The DEV-only insecure-relay toggle
  (`__iglooTestAllowInsecureRelayForRestore`) does NOT appear on `/create/distribute`;
  it lives in the Settings restore flow and is gated behind `import.meta.env.DEV`.
- Color / typography drift: **no drift detected.** Status chips use the established
  `.status-pill` primitive and its `warning | info | success` tones, which match Paper's
  amber / cyan / green tokens.

## /create/complete

Paper source: `LN7-0`. Implementation: `src/screens/DistributionCompleteScreen.tsx`. Demo
scenario: `/demo/shared-distribution-completion`.

- Copy drift: **fix-in-code applied (partial) + documented deviation.**
  - Page header ("Distribution Completion") and subhead copy match Paper LN7-0 verbatim
    — confirmed by `DistributionCompleteScreen.test.tsx`.
  - Distribution Status kicker is rendered via the `.kicker` class which uppercases "Distribution Status" to match Paper's "DISTRIBUTION STATUS" token (letter-spacing:0.05em; CSS-driven uppercase).
  - Success callout now renders a **title line "All remote packages complete"** above the
    callout body — fix-in-code added in this feature (via a `<strong>` within the existing
    `.success-callout`; the existing `.success-callout strong` CSS rule styles it green).
  - Success callout body: **documented deviation.** Paper LN7-0's body copy reads "2 of 2
    remote bfonboard packages completed by echo or manual mark." The live render uses
    VAL-FOLLOWUP-012's exact-text contract ("All packages distributed — N of N remote
    bfonboard packages have been marked distributed. Continue when device adoption handoff
    can proceed."). Preserving the validation-contract text is the correct resolution —
    changing the copy would break
    `src/screens/__tests__/DistributionCompleteScreen.test.tsx`'s exact-match assertion
    that is pinned to VAL-FOLLOWUP-012. See
    `docs/runtime-deviations-from-paper.md` > "Distribution Completion callout body copy
    pinned by VAL-FOLLOWUP-012".
- Layout drift: **fix-in-code applied.** Paper LN7-0 distinguishes per-row status between
  `Echo received` (peer genuinely came online — `peerOnline === true`) and
  `Marked distributed` (user clicked Mark distributed — `manuallyMarkedDistributed === true`,
  echo never arrived). The previous implementation rendered every distributed row as
  "Marked distributed" regardless of which state flipped the row to distributed. Fixed in
  `src/screens/DistributionCompleteScreen.tsx` — the `StatusPill` now reads
  `pkg.peerOnline ? "Echo received" : "Marked distributed"`. Both render with the
  success/green tone. Existing `DistributionCompleteScreen.test.tsx` fixtures set
  `manuallyMarkedDistributed: true` only, so the test's `getAllByText("Marked distributed")`
  assertion continues to pass.
- Missing element: **documented deviation.** Paper LN7-0 shows per-member rows with a
  **device label** ("Igloo Mobile", "Igloo Desktop") and a **"New Device" / "Existing
  Device"** sub-label underneath. The live render uses the member's short pubkey suffix
  (`Member #N — <shortHex(pubkey)>`) because the `OnboardingPackageView` type does not
  track `deviceLabel` or a new-vs-existing flag at create time — the create flow does not
  prompt the user for per-share device labels (those are Paper fixture values). Adding
  per-share device labels requires extending the AppState mutator surface and the
  `OnboardingPackageView` type, which is out of scope for this paper-parity review
  (`ui-screen-worker` skill explicitly limits this feature to "copy/layout/hierarchy
  fidelity of these three screens"). See
  `docs/runtime-deviations-from-paper.md` > "Distribution Completion per-member rows use
  pubkey suffix in lieu of device labels".
- Extra element: **no extras.** Pending rows (for members whose handoff is incomplete)
  expose an inline **Mark distributed** button — this is required by VAL-FOLLOWUP-005
  ("a 'Mark distributed' affordance on any remote-share row whose state is still
  'Ready to distribute' (fallback for QR/offline handoff)") and is therefore Paper-faithful
  in intent even though Paper LN7-0 only shows fully-distributed rows.
- Color / typography drift: **no drift detected.** `.completion-check` / `.status-pill`
  `.success-callout` all use the shared design-system tokens; Paper's green check +
  success chip tokens match 1:1.

## Summary

- **fix-in-code** items applied (all in the same feature commit):
  1. Remove BackLink from `/create/distribute` (Paper 8GU-0 has no back link).
  2. Distinguish per-row status chip between "Echo received" (peerOnline) and "Marked
     distributed" (manual) on `/create/complete` per Paper LN7-0.
  3. Add "All remote packages complete" title line above the `/create/complete` success
     callout body per Paper LN7-0.
- **documented deviations** (added to `docs/runtime-deviations-from-paper.md` in the same
  commit):
  1. Peer permission rows on `/create/profile` use `ToggleSwitch` rather than Paper's
     pill badges — design-system alignment.
  2. `/create/complete` callout body copy pinned by VAL-FOLLOWUP-012 exact-text contract.
  3. `/create/complete` per-member rows use `shortHex(memberPubkey)` instead of Paper's
     device label + New/Existing sub-label — deviceLabel is not tracked on
     `OnboardingPackageView`.
- **no drift** for every other aspect audited.
