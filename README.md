# Igloo Web Demo V2

A FROST threshold signing web application for Nostr — prototype UI for multi-device key management, keyset creation, rotation, and recovery.

## Current State

All UI screens are implemented and wired for navigation. The app is minimally functional for smoke testing and visual review; protocol logic (bifrost-rs) is stubbed or mocked.

## Flows Implemented

### Welcome
- First-time and returning-user variants
- Unlock (password entry)
- Rotate button for existing keysets

### Import Device Profile (4 screens)
`/import` → `/import/decrypt` → `/import/review` → `/import/error`

### Onboard Device (4 screens)
`/onboard` → `/onboard/handshake` → `/onboard/failed` → `/onboard/complete`

### Create Keyset (5 screens)
`/create` → `/create/progress` → `/create/profile` → `/create/distribute` → `/create/complete`
- Form, generation progress, shared profile, distribute shares, distribution complete

### Dashboard
`/dashboard/:profileId`
- 5 runtime states, policies view, policy prompt modal, signing failed modal
- Mock state toggle for development

### Settings Sidebar
- Device profile, relays, group profile, lock, clear credentials

### Export Profile
- Modal + complete (accessible from settings)

### Recover NSEC (2 screens)
`/recover/:profileId` → `/recover/:profileId/success`
- Collect shares + success confirmation

### Rotate Keyset (9 screens)
`/rotate-keyset` → `/rotate-keyset/review` → `/rotate-keyset/progress` → `/rotate-keyset/profile` → `/rotate-keyset/distribute` → `/rotate-keyset/complete`
- 3 error states: wrong password, group mismatch, generation failed

### Rotate Share (4 screens)
`/rotate-share` → `/rotate-share/applying` → `/rotate-share/failed` → `/rotate-share/updated`

## Setup & Run

```bash
npm install
npm run dev          # Start dev server (Vite)
npm run test         # Run unit tests (Vitest)
npm run build        # Production build (includes WASM)
npm run test:e2e     # Playwright end-to-end tests
```

## Tech Stack

- React 19, TypeScript, Vite
- react-router-dom v7 (client-side routing)
- Tailwind CSS v4 + custom CSS
- lucide-react (icons), qrcode, zod (validation)
- idb-keyval (IndexedDB storage)
- Vitest + Testing Library (unit tests), Playwright (e2e)

## Design Reference

The `igloo-paper` repo (sibling directory) is the source of truth for all screen designs and visual specifications.

## Next Steps

- Integrate bifrost-rs WASM protocol logic for real FROST signing
- Connect to Nostr relays for live device communication
- Replace mock/stub state with persistent application state
