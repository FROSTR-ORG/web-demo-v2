# Web Demo Architecture Notes

This demo is a Vite + React app that keeps the product routes, demo gallery,
and setup flows in one client-side runtime. The primary rule for future work is
to keep protocol/state transitions in app/lib modules and keep screens focused
on rendering and route-level orchestration.

## App State

- `AppState.tsx` is a compatibility barrel. Import from it at app edges so
  routes, screens, fixtures, and tests keep one stable public surface.
- `AppStateProvider.tsx` is the real provider. It owns saved profile summaries,
  active runtime state, setup-flow sessions, IndexedDB persistence, WASM package
  calls, relay handshakes, and the assembled `AppStateValue`.
- `AppStateContext.tsx` owns the single app-state React context and `useAppState`.
- `MockAppStateProvider.tsx` is the demo-gallery provider. It starts from scenario
  fixtures, keeps bridge-safe state mutable for click-through demos, and writes
  bridge snapshots when demo routes hand off to product routes.
- `profileRuntime.ts`, `sourceShareCollection.ts`, and
  `distributionPackages.ts` hold the shared workflow helpers used by setup
  actions. Keep protocol-shaped helper code there instead of duplicating it in
  screen components.
- `appStateBridge.ts` is a one-shot `sessionStorage` handoff. It must only
  serialize bridge-safe summaries and runtime display state, never raw setup
  secrets or recovered keys.
- Public app-state types live in `AppStateTypes.ts`; draft defaults live in
  `profileDrafts.ts`.

## Setup Sessions

Setup flows keep decoded package material in React memory only. Create, import,
onboard, rotate-keyset, and recover sessions should be cleared on cancel,
finish, lock, credential clearing, or invalid direct navigation. Browser code
may coordinate WASM calls and relay requests, but Nostr private-key operations
and FROST key material handling stay behind the bifrost bridge.

## Screen Organization

Large flows should follow the dashboard and rotate-keyset folder pattern:
route-facing exports stay stable from the legacy file, while implementation
modules group form, progress, error, profile, distribution, mocks, and utilities
by behavior. Shared UI primitives belong in `components/`; flow-specific copy,
guards, and demo affordances stay near the screen modules that use them.

Recover follows the same pattern in `RecoverScreen/`: product collect/success
screens stay separate from demo collect/success screens, shared share/NSEC
display components are flow-local, and mocks are isolated from product session
logic. Sensitive setup-flow screens should keep their public `*Screens.tsx`
barrel stable while colocating masking, reveal, copy, clear, expiry, and
demo-only shortcuts beside the screen code that depends on those rules.

## Validation

Prefer commands that avoid rewriting tracked WASM artifacts during refactors:

```bash
npx tsc --noEmit -p tsconfig.json --pretty false
npx tsc --noEmit -p tsconfig.node.json --pretty false
npx vitest run --config vitest.config.ts
npx playwright test src/e2e/demo-gallery.spec.ts --project=desktop
```

Avoid `npm test` and `npm run build` for cleanup-only verification unless the
goal includes rebuilding the vendored WASM bridge.
