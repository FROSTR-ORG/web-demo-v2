# Igloo Web Demo V2

A FROST threshold signing web application for Nostr — prototype UI for multi-device key management, keyset creation, rotation, and recovery.

## Current State

All UI screens are implemented and wired for navigation, brought to full Paper-reference content parity (`igloo-paper`) across 9 flows. Click-through is complete; protocol logic (bifrost-rs) is stubbed or mocked. 136 behavioral assertions covering the entire UI surface are verified via the DemoGallery at `/demo`.

## Flows Implemented

All flows follow their Paper design reference exactly (copy, typography, layout).

### Welcome — `/`
- First-visit variant ("Split your Nostr key.") and returning-user variant ("Welcome back.")
- Password unlock for existing profiles, `Create New Keyset` / `Import Device Profile` CTAs

### Import Device Profile — `/import` → `/import/decrypt` → `/import/review` → `/import/error`
Load backup, decrypt, review & save, plus error variants (wrong password, corrupted package).

### Onboard Device — `/onboard` → `/onboard/handshake` → `/onboard/failed` → `/onboard/complete`
Package validation + CTA gating, handshake, rejected variant (red alert) vs timeout variant (amber alert), success.

### Create Keyset — `/create` → `/create/progress` → `/create/profile` → `/create/distribute` → `/create/complete`
3-phase progress (generate keyset, derive shares, publish metadata), shared-profile screen, share distribution, completion.

### Recover NSEC — `/recover/:profileId` → `/recover/:profileId/success`
Paste share packages, collect across peers, reveal NSEC with static-label toggle (masked ↔ revealed).

### Rotate Keyset — `/rotate-keyset` → `/rotate-keyset/review` → `/rotate-keyset/progress` → `/rotate-keyset/profile` → `/rotate-keyset/distribute` → `/rotate-keyset/complete`
Full adaptation flow + 3 error states (wrong password, group mismatch, generation failed).

### Replace Share — `/replace-share` → `/replace-share/applying` → `/replace-share/failed` → `/replace-share/replaced`
Enter onboarding package, applying replacement, failed state, share replaced success.

### Dashboard — `/dashboard/:profileId`
Five runtime states (running, stopped, connecting, relays-offline, signing-blocked) with paper-faithful peer rows (online count, ready capacity, per-peer permission badges SIGN/ECDH/PING/ONBOARD), policies view, pending approvals, event log, modals (clear credentials, export profile, export complete, policy prompt, signing failed), and Settings sidebar with Device Profile / Group Profile / Rotate Share + Rotate Keyset / Export & Backup / Profile Security sections. Source is organized under `src/screens/DashboardScreen/` (index, states/, panels/, modals/, sidebar/, mocks.ts, types.ts).

## Demo Gallery

The `/demo` route hosts a first-class gallery of every canonical screen + variant, keyed by scenario id. Each scenario seeds `MockAppStateProvider` with the exact fixtures needed to render that screen, so every assertion in `.factory/missions/.../validation-contract.md` is reachable via a stable `/demo/{scenario-id}` URL. The gallery toolbar exposes `All screens / Prev / Next / Raw / Reference`; append `?chrome=0` to any scenario URL to strip the chrome for clean capture.

## Setup & Run

```bash
npm install
npm run dev          # Start dev server (Vite) on 127.0.0.1:5173
npm run test         # Run unit tests (Vitest) — 378+ tests
npm run build        # Production build (includes WASM)
npm run test:e2e     # Playwright desktop + mobile end-to-end tests
```

Typecheck without running tests:

```bash
npx tsc -b
```

## Tech Stack

- React 19, TypeScript, Vite 6
- react-router-dom v7 (client-side routing)
- Tailwind CSS v4 + custom CSS (`src/styles/global.css`)
- lucide-react (icons), qrcode, zod (validation)
- idb-keyval (IndexedDB storage)
- Vitest + Testing Library (unit tests), Playwright (e2e)

## App State & Demo Bridge

Two providers implement the same `useAppState()` API:

- **AppStateProvider** (`src/app/AppState.tsx`) — real runtime: reads from IndexedDB, polls `RuntimeClient` every 2500ms (paused while the demo bridge is hydrated).
- **MockAppStateProvider** — stateful demo provider used by `/demo/:scenarioId` routes. Initialized from `scenario.appState`; `clearCredentials` truly empties `profiles` and `lockProfile` truly clears `runtimeStatus` so demo flows behave end-to-end. `DemoScenarioPage` passes `key={scenario.id}` so the provider remounts on scenario change.
- **App-state bridge** (`src/app/appStateBridge.ts`) — one-shot `sessionStorage` handoff so the real `AppStateProvider` can rehydrate from the demo state when a `/demo/...` click deep-links into a real-app route like `/dashboard/:profileId`.

## Design Reference

The sibling `igloo-paper` repo is the source of truth for every screen. Each scenario in `src/demo/scenarios.ts` links to its Paper source.

## Next Steps

- Integrate bifrost-rs WASM protocol logic for real FROST signing
- Connect to Nostr relays for live device communication
- Replace the mock/demo providers with persistent application state
