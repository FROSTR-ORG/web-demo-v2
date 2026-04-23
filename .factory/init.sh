#!/usr/bin/env bash
# Idempotent worker environment setup for web-demo-v2 mission.
# Runs at the start of each worker session. Must be safe to re-run.

set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure dependencies are installed
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
  echo "[init] Installing npm dependencies..."
  npm install
else
  echo "[init] node_modules present; skipping npm install."
fi

# Ensure WASM bridge is built and vendored
if [ ! -f "src/vendor/bifrost-bridge-wasm/bifrost_bridge_wasm_bg.wasm" ]; then
  echo "[init] WASM bridge missing; running wasm:build..."
  npm run wasm:build
else
  echo "[init] WASM bridge vendored; skipping wasm:build."
fi

# Ensure Playwright browsers are available (quiet no-op if already installed)
npx playwright install chromium >/dev/null 2>&1 || true

# Ensure the sibling `bifrost-devtools` release binary is built. This is
# required by `services.local_relay` and by the multi-device e2e specs
# under `src/e2e/multi-device/`. Idempotent: skip if the binary already
# exists. Graceful fallback: if `cargo` is unavailable (e.g. CI images
# without Rust toolchain) emit a clear message and continue — specs that
# need the binary still auto-skip via `existsSync` checks.
BIFROST_RS_DIR="/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs"
DEVTOOLS_BIN="${BIFROST_RS_DIR}/target/release/bifrost-devtools"
if [ -x "${DEVTOOLS_BIN}" ]; then
  echo "[init] bifrost-devtools binary present; skipping build_devtools."
elif ! command -v cargo >/dev/null 2>&1; then
  echo "[init] cargo not available; skipping build_devtools. Multi-device e2e specs will auto-skip."
elif [ ! -f "${BIFROST_RS_DIR}/Cargo.toml" ]; then
  echo "[init] sibling bifrost-rs not found at ${BIFROST_RS_DIR}; skipping build_devtools."
else
  echo "[init] Building bifrost-devtools (cargo build --release -p bifrost-devtools) ..."
  if ! cargo build --release -p bifrost-devtools --manifest-path "${BIFROST_RS_DIR}/Cargo.toml"; then
    echo "[init] WARNING: cargo build of bifrost-devtools failed; multi-device e2e specs will auto-skip."
  fi
fi

# Ensure docs directory exists (for runtime-deviations-from-paper.md)
mkdir -p docs

# Ensure deviations file exists (workers append to it as deviations are introduced)
if [ ! -f "docs/runtime-deviations-from-paper.md" ]; then
  cat > docs/runtime-deviations-from-paper.md <<'EOF'
# Runtime Deviations from Paper Design

This file enumerates intentional deviations from `igloo-paper` design caused by protocol
or architectural constraints. Each entry cites the Paper source, the web-demo-v2 implementation,
and the validation assertion IDs that cover it.

## Deviations

(Entries are appended by worker sessions as deviations are introduced.)
EOF
  echo "[init] Created docs/runtime-deviations-from-paper.md"
fi

echo "[init] Environment ready."
