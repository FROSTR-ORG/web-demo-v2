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
