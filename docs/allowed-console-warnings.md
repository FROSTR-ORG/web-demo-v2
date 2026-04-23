# Allowed Console Warnings

This document enumerates the set of `console.warn` messages that are expected to
appear at runtime in `web-demo-v2` and are therefore allowlisted by the
demo-gallery and multi-device e2e specs (see
`src/e2e/demo-gallery.spec.ts` — `collectConsoleNoise` /
`allowedConsoleWarnPatterns`).

## Policy

- **`console.error`** — zero tolerance. Any error entry during demo-gallery
  traversal or multi-device e2e fails the mission gate (VAL-CROSS-010,
  VAL-CROSS-031).
- **`console.warn`** — zero tolerance except for the patterns listed below.
  Each allowlisted pattern has a rationale and a lifecycle: it is either
  expected indefinitely (third-party / platform-driven) or tracked against a
  follow-up issue.

Any new `console.warn` introduced by the app layer must either be (a) removed
before committing, or (b) added to this file with a rationale AND (if
necessary) to the regex list in the e2e specs.

## Current allowlist

_None._ The demo-gallery + multi-device e2e gate currently runs with a strict
zero-warning policy (the pre-existing `PeersPanel` nested-button React DOM
warning was fixed in commit `b478499` under `misc-peers-panel-nested-button`).

If a future warning is added here, its pattern (anchored regex) must also be
added to the e2e spec's allowlist and this file must explain:

1. What the warning text is.
2. Where it originates (file / component / library version).
3. Why it is allowed (platform limitation, third-party behavior, mission
   deviation, etc.).
4. Tracking issue or removal target.

## Lint & format gate

`npm run lint` and `npm run format:check` are intentionally lightweight
placeholders that echo `lint via tsc+vitest`. The full lint/format contract is
enforced by:

- `npx tsc --noEmit -p tsconfig.json` — strict TypeScript (no implicit any,
  strict null checks, unused locals/parameters).
- `npx tsc --noEmit -p tsconfig.node.json` — the Vite/Vitest config project.
- `npx vitest run --config vitest.config.ts` — unit/integration suite, which
  fails on any unexpected `console.warn`/`console.error` via JSDOM hooks.
- `npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop` — the
  runtime zero-console-error / zero-unexpected-warn gate.

See VAL-CROSS-012, VAL-CROSS-013, VAL-CROSS-031, VAL-CROSS-032 in
`validation-contract.md`.
