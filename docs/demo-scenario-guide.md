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
- `src/demo/DemoScenarioPage.tsx` renders `/demo/:scenarioId`. It wraps
  `CoreRoutes` in `MockAppStateProvider`, remounts that provider when the
  scenario id changes, and supports `?chrome=0` for clean screenshots.
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
- `/demo/{scenario-id}?chrome=0` hides the toolbar for screenshot capture.
- The toolbar's Reference link opens the synced Paper PNG from
  `public/paper-reference/`.

Use `?chrome=0` for visual comparisons and for screenshots that should not
include demo navigation chrome.
