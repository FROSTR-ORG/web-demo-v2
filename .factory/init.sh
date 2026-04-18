#!/usr/bin/env bash
set -euo pipefail

cd /Users/plebdev/Desktop/igloo-web-v2-prototype/web-demo-v2

# Install dependencies if node_modules is stale
if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ]; then
  npm install
fi

# Ensure WASM build exists (do not rebuild — it takes too long and requires Rust toolchain)
if [ ! -f src/vendor/bifrost-bridge-wasm/bifrost_bridge_wasm.js ]; then
  echo "WARNING: WASM build not found at src/vendor/bifrost-bridge-wasm/"
  echo "Run 'npm run wasm:build' manually if needed (requires Rust + wasm-pack)"
fi

echo "Init complete."
