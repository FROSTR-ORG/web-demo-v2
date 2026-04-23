/**
 * Paper visual parity regression test for the three live-runtime
 * onboarding surfaces (feature `fix-followup-paper-parity-final-review`;
 * refactored to drive LIVE /create/* routes under
 * `fix-scrutiny-r1-paper-parity-live-routes-and-baseline-source-doc`,
 * scrutiny r1 blocker #4).
 *
 * Scope:
 *   - /create/profile vs Paper 60R-0 ("Web — Shared — 2. Create Profile")
 *   - /create/distribute vs Paper 8GU-0 ("Web — Shared — 3. Distribute Shares")
 *   - /create/complete vs Paper LN7-0 ("Web — Shared — 3b. Distribution Completion")
 *
 * Routing contract (BLOCKER #4 fix):
 *   Unlike the pre-r1 spec which navigated to the demo-gallery simulator
 *   path (chrome-suppressed scenario URL under the demo namespace) and
 *   therefore compared `MockAppStateProvider` fixture presets against
 *   the Paper artboards, this spec now walks the REAL `/create` flow
 *   end-to-end:
 *     - Case 1: `/` → Create New Keyset → Generate nsec → Create
 *       Keyset → /create/progress auto-advances to /create/profile.
 *     - Case 2: + fill profile form → Continue to Distribute Shares →
 *       /create/distribute in the PRE-encode state (Paper 8GU-0
 *       authoritatively shows the "Package not created" card).
 *     - Case 3: + call `encodeDistributionPackage(idx, password)` +
 *       `markPackageDistributed(idx)` for each remote share via the
 *       DEV-only `window.__appState` bridge (same surface the
 *       multi-device specs already drive), then click "Continue to
 *       Completion" to land on /create/complete in the all-done
 *       state Paper LN7-0 depicts.
 *
 * The DOM screenshot + pixelmatch comparison logic is UNCHANGED from
 * the pre-r1 spec (maxDiffPixelRatio = 0.20, top-aligned common-region
 * crop, `.app-shell` target).
 *
 * Baseline source (BLOCKER #5 fix): the three PNGs under
 * `src/e2e/visual/baselines/followup-paper/` are refreshed from
 * `scripts/sync-paper.mjs` (canonical igloo-paper PNGs). Paper MCP's
 * `export` tool returns empty `filePaths` in this environment; see
 * `baselines.json` + `docs/runtime-deviations-from-paper.md` for the
 * deviation record.
 *
 * Notes:
 *   - This spec is NOT expected to run in CI (it is deliberately not
 *     added to any package.json script). Run it locally with:
 *       npx playwright test src/e2e/visual/followup-paper-parity.spec.ts \
 *         --project=desktop --workers 1
 *   - The tolerance mirrors `dashboard-states.spec.ts`'s
 *     `maxDiffPixelRatio = 0.20` documented in
 *     `docs/runtime-deviations-from-paper.md`. The Paper artboards are
 *     a static HTML export whose font rendering differs from the live
 *     React/Vite runtime; the common-region crop + loose threshold
 *     catches real structural drift without failing on subpixel
 *     antialiasing differences. Known intentional deviations
 *     (Distribution Completion callout body copy, peer permission
 *     ToggleSwitch vs Paper pill badges, and the missing
 *     New/Existing-device secondary sub-label on LN7-0) are documented in
 *     `docs/followup-paper-parity-report.md` and
 *     `docs/runtime-deviations-from-paper.md`.
 *
 * Covers (for cross-referencing):
 *   - VAL-FOLLOWUP-007 (Create Profile DOM has no "Remote Package Password")
 *   - VAL-FOLLOWUP-008 (Distribute Shares DOM per-share password + Create
 *     package + post-state action row)
 *   - VAL-FOLLOWUP-011 (Distribute Shares "How this step works" panel)
 *   - VAL-FOLLOWUP-012 (Distribution Completion subhead/chips/callout/CTA)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { expect, test, type Page } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASELINES_DIR = path.join(__dirname, "baselines", "followup-paper");

const DB_NAME = "keyval-store";
const STORE_NAME = "keyval";

interface FollowupPaperCase {
  id: string;
  screen: "/create/profile" | "/create/distribute" | "/create/complete";
  expectedHeading: RegExp;
  paperNodeId: "60R-0" | "8GU-0" | "LN7-0";
  baselineFile: string;
}

const CASES: readonly FollowupPaperCase[] = [
  {
    id: "create-profile",
    screen: "/create/profile",
    expectedHeading: /Create Profile/i,
    paperNodeId: "60R-0",
    baselineFile: "create-profile-60R-0.png",
  },
  {
    id: "distribute-shares",
    screen: "/create/distribute",
    expectedHeading: /Distribute Shares/i,
    paperNodeId: "8GU-0",
    baselineFile: "distribute-shares-8GU-0.png",
  },
  {
    id: "distribution-completion",
    screen: "/create/complete",
    expectedHeading: /Distribution Completion/i,
    paperNodeId: "LN7-0",
    baselineFile: "distribution-completion-LN7-0.png",
  },
];

/** Mirrors `dashboard-states.spec.ts` parity threshold. */
const PAPER_MAX_DIFF_PIXEL_RATIO = 0.2;

const KEYSET_NAME = "Paper Parity Key";
const PROFILE_NAME = "Paper Parity Device";
const PROFILE_PASSWORD = "paper-parity-password-1234";
const PACKAGE_PASSWORD = "paper-parity-package-password-1234";

/**
 * Crop a PNG to the top-aligned rectangle (`{width, height}`). Remaining
 * pixels stay transparent black. Callers must ensure `width <= src.width`
 * and `height <= src.height` for a strict crop.
 */
function cropTopAligned(src: PNG, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= src.width || y >= src.height) continue;
      const srcIdx = (src.width * y + x) * 4;
      const dstIdx = (width * y + x) * 4;
      out.data[dstIdx] = src.data[srcIdx];
      out.data[dstIdx + 1] = src.data[srcIdx + 1];
      out.data[dstIdx + 2] = src.data[srcIdx + 2];
      out.data[dstIdx + 3] = src.data[srcIdx + 3];
    }
  }
  return out;
}

function compareToPaperFixture(
  appBuffer: Buffer,
  paperPath: string,
): { diffRatio: number; width: number; height: number } {
  const appPng = PNG.sync.read(appBuffer);
  const paperPng = PNG.sync.read(fs.readFileSync(paperPath));
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
  return { diffRatio: diffPixels / (width * height), width, height };
}

/**
 * Wipe IndexedDB + session/local storage so each test case starts from
 * a clean Welcome screen. Mirrors `outside-runtime-flows.spec.ts`'s
 * `clearIdb` helper.
 */
async function clearBrowserState(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    async ({ dbName, storeName }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(storeName);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).clear();
          tx.oncomplete = () => {
            db.close();
            sessionStorage.clear();
            localStorage.clear();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { dbName: DB_NAME, storeName: STORE_NAME },
  );
}

/**
 * Walk the real Create flow UI from "/" to `/create/profile`. Returns
 * with the Create Profile heading visible. Sets the DEV-only
 * `__iglooTestAllowInsecureRelayForRestore` opt-in so the subsequent
 * createProfile call is allowed to validate non-wss relays in the seed
 * path (future-proofing — the default relay preset is still wss-only).
 */
async function navigateToCreateProfile(page: Page): Promise<void> {
  await page.goto("/");
  // Opt-in for the DEV-only relay-validation bypass. Placed before
  // `createProfile` is ever called so the bypass is observed when the
  // submit handler reads it. See AGENTS.md > Mission Boundaries >
  // Ports > Local-Relay Caveats for the gate's full semantics.
  await page.evaluate(() => {
    (window as typeof window & {
      __iglooTestAllowInsecureRelayForRestore?: boolean;
    }).__iglooTestAllowInsecureRelayForRestore = true;
  });

  await page.getByRole("button", { name: "Create New Keyset" }).click();
  await page.getByLabel("Keyset Name").fill(KEYSET_NAME);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  // Wait for the nsec input to render a freshly generated value before
  // clicking Create Keyset so the submission does not race the WASM
  // generator.
  await expect(
    page.getByPlaceholder("Paste your existing nsec or generate a new one"),
  ).toHaveValue(/nsec1/);
  await page.getByRole("button", { name: "Create Keyset" }).click();

  // /create/progress auto-advances to /create/profile via
  // GenerationProgressScreen once the WASM keyset generation resolves.
  await expect(
    page.getByRole("heading", { name: "Create Profile" }),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * From `/create/profile`, fill the profile form with a deterministic
 * draft and submit. Lands on `/create/distribute` with every remote
 * share in the PRE-encode state (Paper 8GU-0 authoritatively renders
 * this as the "Package not created" card).
 */
async function continueToDistribute(page: Page): Promise<void> {
  await page.getByLabel("Profile Name").fill(PROFILE_NAME);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(PROFILE_PASSWORD);
  await page
    .getByRole("textbox", { name: "Confirm Password", exact: true })
    .fill(PROFILE_PASSWORD);
  await page
    .getByRole("button", { name: "Continue to Distribute Shares" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Distribute Shares" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("How this step works")).toBeVisible();
}

/**
 * From `/create/distribute`, call `encodeDistributionPackage(idx,
 * password)` + `markPackageDistributed(idx)` for every remote share via
 * the DEV-only `window.__appState` bridge, then click "Continue to
 * Completion" to land on `/create/complete`.
 *
 * The `__appState` bridge exposes the exact same mutators the
 * production UI binds into the RemoteShareCard; driving them via
 * `page.evaluate` avoids the keystroke-per-field churn that the real
 * UI requires and is equivalent to the DEV-only hook pair
 * (`__iglooTestEncodeDistributionPackage` / `__iglooTestMarkPackageDistributed`)
 * the feature task allowed as small DEV-gated additions. No new hook
 * was needed — `__appState` already exists and already gates on
 * `import.meta.env.DEV` via the installer effect in
 * `AppStateProvider.tsx`.
 */
async function continueToComplete(page: Page): Promise<void> {
  const remoteIndices: number[] = await page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        createSession?: {
          onboardingPackages?: Array<{ idx: number }>;
        };
      };
    };
    const packages = w.__appState?.createSession?.onboardingPackages ?? [];
    return packages.map((pkg) => pkg.idx);
  });
  expect(remoteIndices.length).toBeGreaterThan(0);

  const completionLabels = ["Igloo Mobile", "Igloo Desktop"];

  for (const [position, idx] of remoteIndices.entries()) {
    await page.evaluate(
      async ({ idx, password, deviceLabel }) => {
        const w = window as unknown as {
          __appState: {
            setPackageDeviceLabel: (idx: number, deviceLabel: string) => void;
            encodeDistributionPackage: (
              idx: number,
              password: string,
            ) => Promise<void>;
            markPackageDistributed: (idx: number) => void;
          };
        };
        w.__appState.setPackageDeviceLabel(idx, deviceLabel);
        await w.__appState.encodeDistributionPackage(idx, password);
        w.__appState.markPackageDistributed(idx);
      },
      {
        idx,
        password: PACKAGE_PASSWORD,
        deviceLabel:
          completionLabels[position] ?? `Igloo Device ${position + 1}`,
      },
    );
  }

  // Confirm every remote share advanced to the "Distributed" chip
  // before navigating — the Continue button is disabled until every
  // package has been encoded.
  await expect(
    page.locator(".status-pill.success", { hasText: "Distributed" }),
  ).toHaveCount(remoteIndices.length, { timeout: 15_000 });

  await page.getByRole("button", { name: "Continue to Completion" }).click();
  await expect(
    page.getByRole("heading", { name: "Distribution Completion" }),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Drive the live /create flow up to the target screen for the given
 * case. Every navigation step is exercised against the real
 * `AppStateProvider` / real `/create/*` routes — no demo scenarios,
 * no `MockAppStateProvider`.
 */
async function driveToTargetScreen(
  page: Page,
  entry: FollowupPaperCase,
): Promise<void> {
  await clearBrowserState(page);
  await navigateToCreateProfile(page);
  if (entry.screen === "/create/profile") return;
  await continueToDistribute(page);
  if (entry.screen === "/create/distribute") return;
  await continueToComplete(page);
}

for (const entry of CASES) {
  test(`followup paper parity — ${entry.id} (${entry.paperNodeId})`, async (
    { page },
    testInfo,
  ) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Visual parity suite runs on desktop only (1440x1080 viewport).",
    );

    await driveToTargetScreen(page, entry);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(
      page.locator(".app-shell").getByText(entry.expectedHeading).first(),
    ).toBeVisible();

    // Disable transitions / animations so the capture is stable.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          transition-duration: 0s !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
        }
      `,
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const appShell = page.locator(".app-shell");
    const appBuffer = await appShell.screenshot({
      animations: "disabled",
      caret: "hide",
    });

    const paperPath = path.join(BASELINES_DIR, entry.baselineFile);
    expect(
      fs.existsSync(paperPath),
      `Paper baseline missing at ${paperPath}. Re-run ` +
        `\`node scripts/sync-paper.mjs\` and re-copy the three PNGs ` +
        `from public/paper-reference/ into ` +
        `src/e2e/visual/baselines/followup-paper/.`,
    ).toBe(true);

    const { diffRatio } = compareToPaperFixture(appBuffer, paperPath);
    expect(
      diffRatio,
      `App render drifted from Paper baseline for "${entry.id}" ` +
        `(diffRatio=${diffRatio.toFixed(4)} > PAPER_MAX_DIFF_PIXEL_RATIO=${PAPER_MAX_DIFF_PIXEL_RATIO}). ` +
        `Review docs/followup-paper-parity-report.md for known deviations; if this represents a new drift, ` +
        `either fix in code or extend the deviation report.`,
    ).toBeLessThanOrEqual(PAPER_MAX_DIFF_PIXEL_RATIO);
  });
}
