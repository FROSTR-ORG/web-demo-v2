# Outside-Runtime Setup Flow Invariants

These flows run before (or outside) the live signer/runtime: Welcome, Create,
Import, Onboard (requester AND source-side sponsor), Rotate Keyset, Replace
Share, Recover, and distribution handoff.
They are currently all implemented end-to-end against `bifrost-bridge-wasm`;
this document captures the invariants the browser-side code must preserve so
that private-key material never leaves the WASM bridge or React memory.

## Memory & storage boundaries

- Decoded setup payloads stay in `AppStateProvider` React memory only
  (`src/app/AppStateProvider.tsx`). That includes raw share secrets,
  decrypted profile payloads, validated source shares, package passwords,
  and recovered `nsec` values. Ref slots are cleared on every cancel /
  finish / lock / credential-clear / invalid-direct-navigation path (see
  `createSession` reset in `AppStateProvider.tsx` — the explicit
  packageSecrets ref clear mirrors the session null-out so plaintext share
  secrets cannot leak across setup attempts).
- The demo-to-product bridge snapshot (`src/app/appStateBridge.ts`) is a
  **visual handoff only**. It serializes saved profile summaries, active
  profile summary, runtime display status, and pause state. All setup
  sessions are written as `null`.
- IndexedDB (`idb-keyval`, `src/lib/storage/profileStore.ts` +
  `profileMigration.ts`) stores profile summaries plus encrypted `bfprofile`
  package strings. Raw shares and recovered keys must not be stored outside
  those encrypted package strings. The web demo intentionally does not surface
  relay backup publish/restore; profile transfer uses explicit `bfprofile`
  import/export.
- Router state may carry safe retry context (package text, profile ids). It
  must NOT carry passwords, decoded payloads, raw share secrets, or
  recovered keys.

## Flow-by-flow secret inventory

| Flow | Sensitive material | Allowed browser boundary | Must clear on |
| --- | --- | --- | --- |
| Create keyset | Generated `nsec`, local share secret, remote share packages, package passwords | WASM bridge and `createSession` React memory; encrypted `bfprofile` only after save/export | Cancel, direct-navigation guard, profile save finish, credential clear, lock |
| Create distribution | `bfonboard` payloads and per-share passwords | `createSession.onboardingPackages` and UI input state; display-safe package status may bridge | Package distribution finish, cancel, credential clear, lock |
| Import profile | Encrypted `bfprofile`, decrypt password, decoded profile payload | Encrypted package may be persisted; decoded payload/password stay in memory | Review save, import error retry/cancel, credential clear, lock |
| Onboard requester | `bfonboard`, package password, decoded source response, new profile password | `onboardSession` memory and relay transport driven by WASM-verified events | Success save, failure, cancel, timeout, credential clear |
| Onboard sponsor | Source share selection, minted onboarding package, package password, source ceremony state | `onboardSponsorSessions` memory and runtime relay pump; package text is visible only for user handoff while the session is active | Handoff success/failure, cancel, timeout, credential clear, lock |
| Rotate keyset | Source profile password, rotated keyset, new local share, remote packages/passwords | `rotateKeysetSession` memory and WASM helpers | Completion, cancel, wrong-password/group-mismatch/generation failure retry, credential clear, lock |
| Replace share | Replacement package/password and decoded replacement payload | Replace-share session memory, runtime operation state | Success, failure, cancel, credential clear, lock |
| Recover NSEC | Collected share packages, recovered `nsec` | Recover session/UI memory only; reveal/copy affordances must not persist it | Leaving success, cancel, credential clear, lock |
| Profile export | Profile export password and encrypted `bfprofile` | Encrypted package string may be saved locally; password stays in memory | Modal close, export finish, credential clear |

## Private-key locus — always behind the bridge

Nostr private-key operations for these flows stay in Rust/WASM. Browser code
may request generated `nsec` values or exact-key splitting, but NIP-19
encoding, secp256k1 validation, and FROST key material handling remain behind
`src/lib/bifrost/packageService.ts` → vendored `bifrost-bridge-wasm`. The
browser-side flow helpers (`src/app/profileRuntime.ts`,
`src/app/sourceShareCollection.ts`, `src/app/distributionPackages.ts`,
`src/app/runtimeExports.ts`, `src/lib/bifrost/packageService.ts`) are thin
orchestrators around WASM calls — they marshal byte-level payloads, enforce
phase ordering, and handle relay transport, but never touch secp256k1 math
or share arithmetic directly.

## Phase gating

- Product success paths use real package/session/storage methods. Paper /
  demo click-through success paths are allowed only when isolated behind
  demo state (`MockAppStateProvider`).
- Product setup routes are guarded by their in-memory session phase. Direct
  navigation without the expected phase returns to the safe intake route
  instead of fabricating package, profile, or distribution state.
- Back, retry, cancel, timeout, and finish paths clear abandoned setup
  state. Onboarding (requester and sponsor) additionally aborts any active
  relay request before clearing the decoded package session.
- Rotate Keyset is phase-gated: source validation, keyset rotation, local
  profile replacement, and remote package handoff must happen in order.
  Completion requires every remote package to have package handoff plus
  password accounting.

## Review checklist for new setup-flow work

- The intake route validates format before advancing to a route that assumes a
  decoded package or live session.
- Every non-intake route redirects to the safe intake route when its expected
  session phase is missing.
- Retry and cancel clear in-memory decoded payloads before navigating.
- Password fields are local component state unless an app-state action needs
  them synchronously; they are never copied to the demo bridge, IndexedDB, or
  router state.
- Event logs, relay-history debug buffers, console output, and screenshots show
  request ids, peer ids, statuses, and redacted previews only.
- A component or app-state test covers the direct-navigation guard and at least
  one cleanup path for any new session phase.

## Live onboarding — both directions are now live

- **Requester side.** The browser decodes a real `bfonboard`, creates a
  Rust-signed onboarding request, publishes raw NIP-01 relay WebSocket
  frames, and accepts only Rust-verified source responses. Browser code
  never implements event crypto or response verification — it only drives
  transport and exposes the decoded result to React.
- **Source-side sponsorship.** `src/app/AppStateProvider.tsx >
  createOnboardSponsorPackage` (and its companion session/handoff state)
  runs the full source ceremony: mints an onboarding package via WASM,
  publishes the source response across the runtime relay pump, and tears
  down the session on success / failure / cancel. UI surface:
  `src/screens/OnboardSponsorScreens.tsx` (intake, handoff, success,
  failed). The spec
  `src/e2e/multi-device/onboard-sponsorship.spec.ts` drives a two-context
  round-trip against the local `bifrost-devtools` relay.

## QR-scan intake

- Camera-based QR scanning for onboarding + replace-share packages is
  implemented in `src/components/QrScanner.tsx` using `jsqr`, gated by a
  `getUserMedia` permission probe, and strictly scoped to package intake
  (no raw bytes are logged or persisted). The scanner is exercised by
  `src/components/__tests__/QrScanner.test.tsx` and the flow specs that
  consume it.

## Profile transfer

- The web demo exposes two profile-transfer paths: import a local `bfprofile`
  package at `/import`, or export a local encrypted profile package from
  Dashboard Settings. Relay backup publish/restore is intentionally not part
  of the surfaced web-demo product flow.
- New devices join through `bfonboard` packages (`/onboard` requester flow or
  `/onboard-sponsor` from an unlocked profile). Existing local profiles are
  opened through Welcome unlock, and keysets can be rotated from an unlocked
  profile.

## Inside-runtime interactions

- Replace Share is implemented inside the runtime too — it reuses the same
  decoded-package session, dispatches through
  `src/app/AppStateProvider.tsx` to the runtime, and flows through
  `src/screens/ReplaceShareScreens.tsx` (applying / failed / replaced).

No outside-runtime work is currently deferred — the previous "still-deferred
work" roadmap entries (web-dashboard source sponsorship, existing `nsec`
splitting, camera QR scanning, inside-runtime Replace Share) have all
shipped. If a future scope adds a new outside-runtime flow, extend this
document with the same invariants (React-memory-only payloads, router state
safety, phase gating, WASM locus) before wiring UI.
