import { mkdirSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bifrostRoot = resolve(repoRoot, process.env.BIFROST_RS_PATH ?? "../bifrost-rs");
const crateDir = resolve(bifrostRoot, "crates/bifrost-bridge-wasm");
const outDir = resolve(repoRoot, "src/vendor/bifrost-bridge-wasm");
const homebrewClang = "/opt/homebrew/opt/llvm/bin/clang";
const homebrewAr = "/opt/homebrew/opt/llvm/bin/llvm-ar";

const env = { ...process.env };
if (!env.CC_wasm32_unknown_unknown && existsSync(homebrewClang)) {
  env.CC_wasm32_unknown_unknown = homebrewClang;
}
if (!env.AR_wasm32_unknown_unknown && existsSync(homebrewAr)) {
  env.AR_wasm32_unknown_unknown = homebrewAr;
}

mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  "wasm-pack",
  ["build", crateDir, "--target", "web", "--out-dir", outDir],
  { stdio: "inherit", env }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

rmSync(resolve(outDir, ".gitignore"), { force: true });
