# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Env Vars

The app does not require any secret env vars. Relay URLs and group/share material are configured inside encrypted bfprofile packages at runtime.

Vite supports `import.meta.env.DEV` for dev-build gating; workers MAY gate debug affordances on this.

## External Dependencies

- **Public Nostr relays** — `wss://relay.primal.net`, `wss://relay.damus.io`, `wss://nos.lol`. No API keys required. Rate-limit behavior varies; tests must be resilient to intermittent relay connectivity.
- **`bifrost-devtools` relay binary** — spawned for multi-device e2e tests. Lives at sibling path `/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs/target/` after a bifrost-rs cargo build. Workers may invoke `cargo build -p bifrost-devtools --release` in the sibling if the binary is missing.
- **WASM bridge** — `src/vendor/bifrost-bridge-wasm/bifrost_bridge_wasm{.js,.d.ts,_bg.wasm}` are vendored; rebuild via `npm run wasm:build` only when the sibling `bifrost-rs` WASM changes.
- **Chromium (via Playwright / agent-browser)** — Playwright manages its own browser binaries. Agent-browser uses a managed Chromium installation.

## Platform Notes

- **Dev-server host:** `127.0.0.1:5173`. HMR is enabled (Vite default).
- **Node version:** per package.json engines and node_modules build. No explicit engines field; workers should use the installed system node (v22+ worked in dry run).
- **macOS quirks:** camera permission (for QR scanning) requires Chrome permission grant; Playwright can grant via context options.

## Dependency Quirks

- `idb-keyval` returns undefined for missing keys (not errors); consumers must null-check.
- `lucide-react` v0.468 — keep imports tree-shakeable (`import {Foo} from 'lucide-react'`).
- `qrcode` + `jsqr` already in deps; `jsqr` for decoding (camera), `qrcode` for encoding (package hand-off display).
- WASM lazy-loaded: first runtime call takes ~200 ms longer while module compiles; avoid racing early.

## External Reference Repos (read-only)

Workers MAY read these for reference; workers MUST NOT modify them:

- `/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs/` — protocol library + WASM source (READ-ONLY)
- `/Users/plebdev/Desktop/igloo-web-v2-prototype/igloo-paper/` — design reference (READ-ONLY)
- `/Users/plebdev/Desktop/code/frostr-infra/` — monorepo with reference implementations of the Igloo stack (READ-ONLY)
