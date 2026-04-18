# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Runtime

- Node v25.9.0, TypeScript 5.9.3, Vite 6.4.2
- React 19, react-router-dom 7
- macOS ARM64

## WASM Build

- bifrost-rs WASM is pre-built in `src/vendor/bifrost-bridge-wasm/`
- Rebuilding requires: Rust toolchain, wasm-pack, Homebrew LLVM (for macOS ARM cross-compilation)
- The WASM build step is part of `npm run build` and `npm run test` — but the vendor output is already checked in
- Build script: `scripts/build-wasm.mjs` — looks for `../bifrost-rs/crates/bifrost-bridge-wasm`

## Fonts

- Share Tech Mono (headings, monospace values) — loaded via Google Fonts or local
- Inter (body text) — loaded via Google Fonts or local
- Font loading is via CSS `@import` or `<link>` in index.html — check that fonts render correctly

## No External Services

- No backend API, no database, no authentication service
- All data stored in IndexedDB via `idb-keyval`
- Relay connections are simulated via `LocalRuntimeSimulator` (no real WebSocket connections)
