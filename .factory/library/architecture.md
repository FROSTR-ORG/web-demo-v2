# Architecture

## System Overview

Igloo Web v2 is a single-page React application for managing FROST (Flexible Round-Optimized Schnorr Threshold) signing keysets. Users create threshold-signature keysets, split them into shares, create an encrypted local profile, and distribute onboarding packages to other participants. An unlocked profile runs a signing runtime that coordinates nonce exchange and co-signing with peers.

The app is a Vite + React + TypeScript project using React Router for navigation and React Context for global state. All cryptographic operations are delegated to a Rust library compiled to WASM (`bifrost-rs`). Profiles are persisted to IndexedDB via `idb-keyval`.

## Component Architecture

### Entry point

`main.tsx` → mounts `<BrowserRouter>` → `<AppStateProvider>` → `<App>`.

### Routing layer

`App.tsx` delegates screen routing to `CoreRoutes` and only injects demo routes:

- `/demo` → `DemoGallery`
- `/demo/:scenarioId/*` → `DemoScenarioPage`

`CoreRoutes.tsx` defines the full app route table. Major groups:

| Path group | Examples | Purpose |
|---|---|---|
| Welcome | `/` | Landing / profile picker |
| Create | `/create`, `/create/progress`, `/create/profile`, `/create/distribute`, `/create/complete` | Keyset creation + initial distribution |
| Import / Onboard | `/import/*`, `/onboard/*` | Bring existing profiles/shares onto device |
| Rotate keyset | `/rotate-keyset`, `/rotate-keyset/review`, `/rotate-keyset/progress`, `/rotate-keyset/profile`, `/rotate-keyset/distribute`, `/rotate-keyset/complete`, error routes | Keyset rotation and adaptation screens |
| Rotate share | `/rotate-share`, `/rotate-share/applying`, `/rotate-share/failed`, `/rotate-share/updated` | Local share replacement flow |
| Recover | `/recover/:profileId`, `/recover/:profileId/success` | Recover NSEC from shares |
| Dashboard | `/dashboard/:profileId` | Runtime status, signing, settings |
| Catch-all | `*` | Redirect → `/` |

### State management

`AppStateProvider` (React Context) holds all application state and exposes action callbacks:

- **Profiles list** — loaded from IndexedDB on mount via `listProfiles()`.
- **Active profile** — set after unlock/create; cleared on lock.
- **Runtime status** — polled every 2.5 s from a `RuntimeClient` instance.
- **Create session** — transient wizard state (draft → keyset → profile → onboarding packages).

Screens call context actions (`createKeyset`, `createProfile`, `unlockProfile`, etc.) which orchestrate bifrost service calls and update state.

### Screen components

Each screen lives in `src/screens/<Name>Screen.tsx`. Screens consume `useAppState()` for data and actions, wrap content in `<AppShell>`, and use shared UI primitives. Screens that depend on wizard state (e.g. `DistributeSharesScreen` needs `createSession`) should guard with a redirect to the appropriate earlier step.

### Shared UI components

**`shell.tsx`** — Layout chrome:
- `AppShell` — full-page layout with header, main area (variants: `center`, `flow`, `dashboard`), and footer. Accepts optional `headerMeta`, `headerActions`, `headerSettingsAction` slots.
- `PageHeading` — screen title + subtitle.

**`ui.tsx`** — Reusable controls:
- `Button` — variants: `primary`, `secondary`, `ghost`, `danger`, `chip`, `header`; sizes: `sm`, `md`, `full`, `icon`.
- `BackLink` — chevron + label for in-flow back navigation.
- `SectionHeader` — title with horizontal rule and optional copy text.
- `TextField`, `PasswordField` — labeled input fields with help/error slots.
- `NumberStepper` — increment/decrement control.
- `Stepper` — 3-step progress indicator for the create wizard.
- `StatusPill` — colored badge with optional dot/check marker; tones: `default`, `success`, `warning`, `error`, `info`.
- `PermissionBadge` — role/permission indicator.
- `SecretDisplay`, `CopyBlock`, `QrButton` — for displaying and sharing secret values.

### Services layer

| Directory | Role |
|---|---|
| `lib/bifrost/` | FROST key generation, profile encryption/decryption, package encoding, runtime client. Types validated with Zod schemas. |
| `lib/relay/` | Nostr relay interaction; includes `LocalRuntimeSimulator` for demo-mode peer simulation. |
| `lib/storage/` | `profileStore.ts` — CRUD for profiles in IndexedDB via `idb-keyval`. Keys prefixed `igloo.web-demo-v2.profile.*`. |
| `lib/wasm/` | WASM module loader for the `bifrost-rs` Rust crate. |

## Styling System

### Approach

The project uses **custom CSS classes** defined in `src/styles/global.css`. Components primarily reference semantic class names like `.button-primary`, `.status-pill`, `.app-shell`, etc.

Exception: when validation assertions explicitly require literal tokenized utility-style classes from Paper captures (for example `bg-[#2563EB40]`), those class tokens are intentionally included in JSX for contract parity evidence.

### Design tokens

`src/styles/paper-tokens.css` defines CSS custom properties extracted from the Paper design canvas:

- **Colors** — background (`--color-gray-950`, `--color-gray-900`), blue scale (`--color-blue-100` → `--color-blue-900`), semantic status colors, text tones (`--color-slate-200/400/500`), border/overlay alphas.
- **Fonts** — `--font-share-tech-mono`, `--font-inter`, `--font-ibm-plex-mono`, `--font-roboto-mono`.
- **Type scale** — composite tokens per level: `--text-h1-heading-*`, `--text-h2-section-header-*`, `--text-h3-card-title-*`, `--text-body-text-*`, `--text-small-*`, `--text-value-data-*`.

`global.css` defines its own runtime variables (`--ig-*`) that mirror or extend the token set for component use.

### Visual treatment

- **Background**: dark gradient — `linear-gradient(160deg, #030712 0%, #111827 50%, #172554 100%)`.
- **Panels**: semi-transparent slate (`#0f172a99`) with `backdrop-filter: blur(18px)` and blue-tinted borders.
- **Typography**: Share Tech Mono for headings, data values, and the brand name; Inter for body text and form labels.

## Routing

- `App.tsx` composes `CoreRoutes` and contributes demo-only routes (`/demo`, `/demo/:scenarioId/*`).
- `CoreRoutes.tsx` is the source of truth for screen routes; catch-all `*` redirects to `/`.
- State-dependent screens guard against missing prerequisites (e.g. no `createSession`) by redirecting to a prior step with `<Navigate>`.
- In-flow back navigation uses `<BackLink>` with an `onClick` handler (typically `navigate(-1)` or explicit path).

## Data Flow

```
User interaction
  → Screen calls AppState action (e.g. createKeyset)
    → Action calls bifrost service functions
    → Action updates React state (useState setters)
      → Screens re-render via useAppState() context

Profile persistence:
  AppState actions → profileStore (idb-keyval) → IndexedDB

Runtime loop:
  setInterval(2.5s) → refreshRuntime()
    → RuntimeClient.tick() / LocalRuntimeSimulator.pump()
    → setRuntimeStatus() → screens re-render
```

## Design Reference

The `igloo-paper` repository is the **design source of truth**. It contains:

| Path | Contents |
|---|---|
| `screens/` | Per-screen folders with `screen.html` (reference HTML), screenshots, and README files describing layout and behavior. |
| `design-system/components/` | Component specs — buttons, inputs, pills, cards, etc. |
| `design-system/foundations/` | Color palette, type scale, spacing definitions. |
| `design-system/tokens/` | Extracted design token values. |
| `design-system/patterns/` | Reusable layout patterns (e.g. form groups, card grids). |

**Workers building new screens should reference the corresponding `igloo-paper/screens/<flow>/<screen>/screen.html`** for layout structure, content, and component usage guidance.

> Path nuance: many Paper screen folders are numerically prefixed (for example `igloo-paper/screens/shared/2-create-profile/screen.html`).  
> If a guessed path does not exist, list the flow directory first and use the numbered folder name.

## Key Conventions

- **CSS class naming** — semantic BEM-ish names (`.button-primary`, `.status-pill`, `.app-header`), not Tailwind utilities. New components should follow existing patterns in `global.css`.
- **Button variants** — use the `variant` prop (`primary | secondary | ghost | danger | chip | header`) and `size` prop (`sm | md | full | icon`). Don't invent ad-hoc button styles.
- **StatusPill tones** — `default | success | warning | error | info` with optional `dot` or `check` marker.
- **AppShell layout modes** — `center` (vertically centered, for landing/wizard screens), `flow` (top-aligned scrollable, for forms), `dashboard` (top-aligned, for the dashboard).
- **Screen file naming** — `src/screens/<PascalName>Screen.tsx`, one component per file, default-ish export via named export.
- **State access** — always use `useAppState()` hook; never import context directly.
- **Form validation** — performed inside AppState actions (throw on invalid input); screens display errors via try/catch.
- **Icons** — sourced from `lucide-react`, not inline SVGs or emoji.
