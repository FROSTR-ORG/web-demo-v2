import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBaseUrl = "http://127.0.0.1:5173";
const outputDir = resolve(repoRoot, "test-results", "paper-drift");

const options = parseArgs(process.argv.slice(2));
if (typeof options.threshold === "boolean") {
  throw new Error("Invalid --threshold value: expected a number between 0 and 1.");
}
if (typeof options.baseUrl === "boolean") {
  throw new Error("Invalid --base-url value: expected a URL.");
}
if (typeof options.mode === "boolean") {
  throw new Error('Invalid --mode value: expected "raw" or "live".');
}
const threshold = Number(options.threshold ?? "0.02");
const baseURL = String(options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "");
const keepPassingArtifacts = Boolean(options.keepPassingArtifacts);
const mode = String(options.mode ?? "raw");

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  throw new Error(`Invalid --threshold value: ${options.threshold}`);
}
if (!["raw", "live"].includes(mode)) {
  throw new Error(`Invalid --mode value: ${mode}. Expected "raw" or "live".`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Keep polling until Vite is ready.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return false;
}

function scenarioIdsFromSource() {
  const scenariosSource = readFileSync(resolve(repoRoot, "src/demo/scenarios.ts"), "utf8");
  const ids = [
    ...scenariosSource.matchAll(/scenario\(\s*"([^"]+)"[\s\S]*?"(screens\/[^"]+)"/g),
  ].map((match) => match[1]);
  for (const id of [
    "rotate-keyset-create-profile",
    "rotate-keyset-distribute",
    "rotate-keyset-complete",
  ]) {
    if (!ids.includes(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

function cropTopAligned(source, width, height) {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= source.width || y >= source.height) continue;
      const sourceIndex = (source.width * y + x) * 4;
      const outputIndex = (width * y + x) * 4;
      output.data[outputIndex] = source.data[sourceIndex];
      output.data[outputIndex + 1] = source.data[sourceIndex + 1];
      output.data[outputIndex + 2] = source.data[sourceIndex + 2];
      output.data[outputIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return output;
}

function compareToPaper(appBuffer, paperPath) {
  const appPng = PNG.sync.read(appBuffer);
  const paperPng = PNG.sync.read(readFileSync(paperPath));
  const width = Math.min(appPng.width, paperPng.width);
  const height = Math.min(appPng.height, paperPng.height);
  const appCropped = cropTopAligned(appPng, width, height);
  const paperCropped = cropTopAligned(paperPng, width, height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    appCropped.data,
    paperCropped.data,
    diff.data,
    width,
    height,
    { threshold: 0.1, includeAA: false },
  );
  return {
    ratio: diffPixels / (width * height),
    width,
    height,
    appSize: `${appPng.width}x${appPng.height}`,
    paperSize: `${paperPng.width}x${paperPng.height}`,
    appPng,
    paperPng,
    diff,
  };
}

function writeArtifacts(id, comparison, appBuffer, paperPath) {
  const scenarioDir = resolve(outputDir, id);
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(resolve(scenarioDir, "app.png"), appBuffer);
  writeFileSync(resolve(scenarioDir, "paper.png"), readFileSync(paperPath));
  writeFileSync(resolve(scenarioDir, "diff.png"), PNG.sync.write(comparison.diff));
}

function serverPortFromBaseURL(url) {
  const parsed = new URL(url);
  if (parsed.port) return parsed.port;
  return parsed.protocol === "https:" ? "443" : "80";
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

let server;
const healthURL = `${baseURL}/demo/welcome-first-time?chrome=0`;
if (!(await waitForServer(healthURL, 1_000))) {
  server = spawn("npm", ["run", "dev", "--", "--port", serverPortFromBaseURL(baseURL)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  server.stdout.on("data", (chunk) => process.stderr.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  if (!(await waitForServer(healthURL))) {
    await stopServer(server);
    throw new Error("Vite server did not become ready");
  }
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const results = [];
const failures = [];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
    permissions: ["clipboard-read", "clipboard-write"],
  });

  for (const id of scenarioIdsFromSource()) {
    const paperPath = resolve(repoRoot, "public/paper-reference", `${id}.png`);
    if (!existsSync(paperPath)) {
      failures.push({ id, message: `Missing Paper reference: ${paperPath}` });
      continue;
    }
    try {
      const url = mode === "raw" ? `${baseURL}/demo/${id}?chrome=0` : `${baseURL}/demo/${id}`;
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      const shell = page.locator(".app-shell").first();
      await shell.waitFor({ state: "visible", timeout: 10_000 });
      if (mode === "raw") {
        const image = shell.locator(".paper-reference-image").first();
        await image.waitFor({ state: "visible", timeout: 10_000 });
        await image.evaluate((element) => {
          const imageElement = element;
          if (!(imageElement instanceof HTMLImageElement)) {
            throw new Error("Paper reference target is not an image");
          }
          if (imageElement.complete && imageElement.naturalWidth > 0) return;
          if (imageElement.complete) {
            throw new Error("Paper reference image failed to load");
          }
          return new Promise((resolveImage, rejectImage) => {
            imageElement.addEventListener("load", resolveImage, { once: true });
            imageElement.addEventListener(
              "error",
              () => rejectImage(new Error("Paper reference image failed to load")),
              { once: true },
            );
          });
        });
      } else {
        await page.locator(".app-header").first().waitFor({ state: "visible", timeout: 10_000 });
      }
      await page.addStyleTag({
        content:
          ".demo-scenario-toolbar{display:none!important}*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important;animation-delay:0s!important}",
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const appBuffer = await shell.screenshot({ animations: "disabled", caret: "hide" });
      const comparison = compareToPaper(appBuffer, paperPath);
      const result = { id, ...comparison };
      results.push(result);
      if (comparison.ratio > threshold || keepPassingArtifacts) {
        writeArtifacts(id, comparison, appBuffer, paperPath);
      }
    } catch (error) {
      failures.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
} finally {
  await browser.close();
  await stopServer(server);
}

results.sort((a, b) => b.ratio - a.ratio);
for (const result of results) {
  console.log(
    `${result.id}\t${(result.ratio * 100).toFixed(2)}%\tcommon=${result.width}x${result.height}\tapp=${result.appSize}\tpaper=${result.paperSize}`,
  );
}

if (failures.length > 0) {
  console.log("\nFAILURES");
  for (const failure of failures) {
    console.log(`${failure.id}\t${failure.message}`);
  }
}

const driftFailures = results.filter((result) => result.ratio > threshold);
if (driftFailures.length > 0 || failures.length > 0) {
  console.error(
    `\nPaper drift audit (${mode}) failed: ${driftFailures.length} scenarios exceeded ${(threshold * 100).toFixed(2)}% and ${failures.length} captures failed.`,
  );
  process.exitCode = 1;
} else {
  console.log(`\nPASS: ${results.length} scenarios are at or below ${(threshold * 100).toFixed(2)}% drift in ${mode} mode.`);
}
