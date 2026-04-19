import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paperRoot = resolve(repoRoot, process.env.IGLOO_PAPER_PATH ?? "../igloo-paper");

const copies = [
  ["design-system/tokens/tokens.css", "src/styles/paper-tokens.css"],
  ["assets/paper/1WEXSFAT73DS0G9ZZTFNR8PXP9.png", "src/assets/igloo-logo.png"],
  ["screens/welcome/1-welcome/screenshot.png", "src/assets/paper-reference/welcome.png"],
  ["screens/create/1-create-keyset/screenshot.png", "src/assets/paper-reference/create-keyset.png"],
  ["screens/shared/2-create-profile/screenshot.png", "src/assets/paper-reference/create-profile.png"],
  ["screens/shared/3-distribute-shares/screenshot.png", "src/assets/paper-reference/distribute-shares.png"],
  ["screens/shared/3b-distribution-completion/screenshot.png", "src/assets/paper-reference/distribution-completion.png"],
  ["screens/dashboard/1-signer-dashboard/screenshot.png", "src/assets/paper-reference/dashboard.png"]
];

for (const [from, to] of copies) {
  const dest = resolve(repoRoot, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(paperRoot, from), dest);
}

const scenariosSource = readFileSync(resolve(repoRoot, "src/demo/scenarios.ts"), "utf8");
const scenarioPattern = /scenario\(\s*"([^"]+)"[\s\S]*?"(screens\/[^"]+)"/g;
const scenarioCopies = [...scenariosSource.matchAll(scenarioPattern)].map((match) => ({
  id: match[1],
  paperPath: match[2]
}));

for (const { id, paperPath } of scenarioCopies) {
  const dest = resolve(repoRoot, "public/paper-reference", `${id}.png`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(paperRoot, paperPath, "screenshot.png"), dest);
}

console.log(`Synced ${copies.length} core Paper assets and ${scenarioCopies.length} screen references.`);
