# Demo Scenario Guide

`/demo` is the deterministic Paper-review surface for `web-demo-v2`. It is
useful for visual review, screenshot capture, and route regression checks, but
it is not the live runtime. Product behavior still belongs to the real routes
mounted by `src/app/CoreRoutes.tsx` under `AppStateProvider`.

## Mental Model

- `src/demo/scenarios.ts` is the scenario registry. Each entry describes one
  reviewable screen: stable id, flow, title, Paper source path, route location,
  seeded `AppStateValue`, and expected text.
- `src/demo/DemoGallery.tsx` renders the `/demo` index. It lists only canonical
  scenarios; variants with `canonical: false` are reachable by direct URL and
  through the scenario toolbar.
- `src/demo/DemoScenarioPage.tsx` renders `/demo/:scenarioId`. Without
  query params it wraps `CoreRoutes` in `MockAppStateProvider` and remounts
  that provider when the scenario id changes. With `?chrome=0` it renders the
  synced Paper reference PNG as a raster capture surface for drift audits.
- `public/paper-reference/{scenario-id}.png` stores the Paper screenshot used
  by the toolbar's Reference link and by visual parity workflows.
- `MockAppStateProvider` is stateful enough for review clicks, but it remains a
  mock provider. Demo click-throughs that deep-link into real routes use the
  one-shot bridge in `src/app/appStateBridge.ts`.

## When To Add A Scenario

Add a canonical scenario when a new Paper artboard, route state, modal, or
runtime-visible state should be reviewable from `/demo`.

Add a variant instead when the screen is a small alternate state of an existing
canonical artboard and can reuse that artboard's reference image. Examples:
copy/error variants, runtime-only shims, or alternate CTA ordering that should
not appear as a separate top-level gallery card.

Do not add a demo scenario to prove live runtime behavior. Use the real route
plus unit, component, or Playwright coverage for that; add a scenario only if
the rendered state also needs a stable Paper-review URL.

## Adding Or Updating A Scenario

1. Confirm the real route exists in `src/app/CoreRoutes.tsx`.
2. Confirm the Paper source under `../igloo-paper/screens/...` and its
   `screenshot.png` are current.
3. Add or update the `scenario(...)` entry in `src/demo/scenarios.ts`.
4. Seed only display-safe state in `appState` and `location.state`. Do not seed
   passwords, raw shares, decoded setup payloads, recovered `nsec` values, or
   private keys except through existing demo fixture constants that are already
   intentionally fake.
5. For a new flow, extend the `DemoFlow` union, `demoFlows`, and
   `flowLabels` in `src/demo/DemoGallery.tsx`.
6. Run `npm run paper:sync` so `public/paper-reference/{scenario-id}.png` is
   refreshed from the sibling Paper repo.
7. Update docs that enumerate the route, flow, or intentional deviation.
8. Run the focused tests:

```bash
npx vitest run src/demo/__tests__/scenarios.test.tsx src/demo/__tests__/crossAreaFinalGate.test.tsx --config vitest.config.ts
npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop
```

Run the related screen/component tests too when the scenario change reflects a
real UI change.

## Scenario Field Checklist

| Field | Use |
| --- | --- |
| `id` | Stable URL segment for `/demo/{id}` and the paper-reference PNG filename. |
| `flow` | Gallery grouping; must be present in `demoFlows`. |
| `title` | Toolbar/gallery label. Keep it close to the Paper artboard title. |
| `paperPath` | Relative path under `../igloo-paper/`; `npm run paper:sync` reads this. |
| `location` | The real route path that `CoreRoutes` should render inside the demo shell. |
| `appState` | Mock provider seed state. Keep it minimal and bridge-safe. |
| `expectedText` | Text used by route-render smoke tests and demo-gallery e2e. |
| `canonical` | Set to `false` for hidden variants that should not appear on `/demo`. |
| `variantOf` | Parent canonical scenario id; variants reuse parent navigation context. |
| `expectedVisibleText` | Extra assertions for scenarios that need more than one text anchor. |

## Bridge Safety

The demo bridge exists so a Paper-review scenario can hand off to a real route
without losing visible context. It must stay display-only:

- Allowed: profile summaries, active profile summary, runtime display status,
  signer pause state, and other non-secret UI state.
- Not allowed: setup sessions, package passwords, raw share secrets, decrypted
  profile payloads, recovered `nsec` values, decoded onboarding packages, or
  relay payload contents that include secrets.

If a demo click-through needs data that would violate that boundary, redesign
the click-through to land on the safe intake route and let the user provide the
secret again.

## Capture And Review URLs

- `/demo` lists canonical review screens.
- `/demo/{scenario-id}` renders a scenario with the toolbar.
- `/demo/{scenario-id}?chrome=0` hides the toolbar and renders the synced
  Paper reference PNG inside `.app-shell` for deterministic raster comparison.
- The toolbar's Reference link opens the synced Paper PNG from
  `public/paper-reference/`.

Use `?chrome=0` for Paper-reference drift comparisons. Use `/demo/{scenario-id}`
without `?chrome=0` when you need to inspect or test the live mock React DOM,
and use the real product routes for runtime/protocol behavior.

Run the broad Paper-reference raster audit with:

```bash
npm run paper:drift -- --threshold=0.02
```

This raw-mode audit captures `.app-shell` at 1440x1080, compares against
`public/paper-reference/{scenario-id}.png`, writes failure artifacts under
`test-results/paper-drift/`, and fails when any scenario exceeds 2% drift.
It is a reference-plumbing check: the synced Paper PNG rendered by the app is
compared against the synced Paper PNG on disk. For implemented-demo parity,
run the live audit instead:

```bash
npm run paper:drift:live -- --keep-passing-artifacts
```

Live mode captures `/demo/{scenario-id}` without `?chrome=0`; this is the
required signal for UI parity remediation.

## Paper Parity Split Patterns

Use the smallest demo-only switch that explains the visual difference:

- `location.state.demoUi` is for display-safe, scenario-local copy and state
  presets. Examples include `create.keysetNamePreset`, `import.backupPreset`,
  and `recover.copied`.
- `dashboard.paperPanels=true` means the dashboard should prefer Paper fixture
  panels and static visual states. `paperPanels=false` means the scenario is
  intentionally showing runtime-shaped data, pending operations, relay health,
  and effective policy chips.
- Product routes must still render without `demoUi`. If a Paper fixture needs
  pre-decoded package details, copied recovery state, or an empty field for a
  validation artboard, add a paired component test that proves the real route
  keeps the product-safe default.

Do not use scenario state to bypass protocol work. If the user-facing route
needs bifrost validation, relay communication, password entry, or recovered-key
reveal/copy gating, keep that behavior in `AppStateProvider` and the real
screen; make the Paper match a visual fixture only.
