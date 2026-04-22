# Outside-Runtime Setup Flow Invariants

These flows run before the live signer/runtime is active: Welcome, Create,
Import, Onboard, Rotate Keyset, Recover, and distribution handoff.

- Decoded setup payloads stay in `AppStateProvider` React memory only. That
  includes raw share secrets, decrypted profile payloads, validated source
  shares, package passwords, and recovered `nsec` values.
- The demo-to-product bridge snapshot is a visual handoff only. It serializes
  saved profile summaries, active profile summary, runtime display status, and
  pause state. All setup sessions are written as `null`.
- IndexedDB stores profile summaries plus encrypted `bfprofile` package strings.
  Raw shares and recovered keys must not be stored outside encrypted package
  strings.
- Router state may carry safe retry context such as package text or profile ids.
  It must not carry passwords, decoded payloads, raw share secrets, or recovered
  keys.
- Product success paths use real package/session/storage methods. Paper/demo
  click-through success paths are allowed only when isolated behind demo state.
- Product setup routes are guarded by their in-memory session phase. Direct
  navigation without the expected phase returns to the safe intake route instead
  of fabricating package, profile, or distribution state.
- Back, retry, cancel, timeout, and finish paths clear abandoned setup state.
  Onboarding additionally aborts any active relay request before clearing the
  decoded package session.
- Nostr private-key operations for these flows stay in Rust/WASM. Browser code
  may request generated `nsec` values or exact-key splitting, but NIP-19
  encoding, secp256k1 validation, and FROST key material handling remain behind
  the bridge.
- Live onboarding is requester-only before login. The browser may decode a real
  `bfonboard`, create a Rust-signed onboarding request, publish raw NIP-01 relay
  websocket frames, and accept only Rust-verified source responses. Browser code
  does not implement source-side sponsorship, relay policy, event crypto, or
  response verification.
- Rotate Keyset is phase-gated: source validation, keyset rotation, local profile
  replacement, and remote package handoff must happen in order. Completion
  requires every remote package to have package handoff plus password accounting.
- Still-deferred work is explicit: web-dashboard source sponsorship over relays,
  existing pasted-`nsec` splitting into a new keyset, dashboard/runtime behavior,
  camera QR scanning, and inside-runtime Replace Share.
