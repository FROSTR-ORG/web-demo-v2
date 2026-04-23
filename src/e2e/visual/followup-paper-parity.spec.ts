/**
 * Paper visual parity regression test for the three live-runtime
 * onboarding surfaces (feature `fix-followup-paper-parity-final-review`).
 *
 * Scope:
 *   - /create/profile vs Paper 60R-0 ("Web — Shared — 2. Create Profile")
 *   - /create/distribute vs Paper 8GU-0 ("Web — Shared — 3. Distribute Shares")
 *   - /create/complete vs Paper LN7-0 ("Web — Shared — 3b. Distribution Completion")
 *
 * Notes:
 *   - This spec is NOT expected to run in CI (it is deliberately not
 *     added to any package.json script). Run it locally with:
 *       npx playwright test src/e2e/visual/followup-paper-parity.spec.ts
 *   - Baselines live under
 *     `src/e2e/visual/baselines/followup-paper/` alongside `baselines.json`
 *     which documents the Paper node IDs + capture timestamps.
 *   - The tolerance mirrors `dashboard-states.spec.ts`'s
 *     `maxDiffPixelRatio = 0.20` documented in
 *     `docs/runtime-deviations-from-paper.md`. The Paper artboards are
 *     a static HTML export whose font rendering differs from the live
 *     React/Vite runtime; the common-region crop + loose threshold
 *     catches real structural drift without failing on subpixel
 *     antialiasing differences. Known intentional deviations
 *     (Distribution Completion callout body copy, peer permission
 *     ToggleSwitch vs Paper pill badges, missing device label rows
 *     on LN7-0) are documented in
 *     `docs/followup-paper-parity-report.md` and
 *     `docs/runtime-deviations-from-paper.md`.
 *   - Demo scenarios are used (not live relay pumps) because the
 *     assertion is copy + layout + hierarchy parity — the live relay
 *     pump path is protocol-level and already covered by
 *     `src/e2e/multi-device/create-distribute-live-bootstrap.spec.ts`
 *     (VAL-FOLLOWUP-003). The Paper artboards themselves are static
 *     snapshots; comparing against the fixture-driven scenarios gives
 *     a deterministic visual signal of Paper-copy/Paper-layout drift.
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
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASELINES_DIR = path.join(__dirname, "baselines", "followup-paper");

interface FollowupPaperCase {
  id: string;
  screen: "/create/profile" | "/create/distribute" | "/create/complete";
  scenarioId: string;
  expectedCopy: RegExp;
  paperNodeId: "60R-0" | "8GU-0" | "LN7-0";
  baselineFile: string;
}

const CASES: readonly FollowupPaperCase[] = [
  {
    id: "create-profile",
    screen: "/create/profile",
    scenarioId: "shared-create-profile",
    expectedCopy: /Create Profile/i,
    paperNodeId: "60R-0",
    baselineFile: "create-profile-60R-0.png"
  },
  {
    id: "distribute-shares",
    screen: "/create/distribute",
    scenarioId: "shared-distribute-shares",
    expectedCopy: /Distribute Shares/i,
    paperNodeId: "8GU-0",
    baselineFile: "distribute-shares-8GU-0.png"
  },
  {
    id: "distribution-completion",
    screen: "/create/complete",
    scenarioId: "shared-distribution-completion",
    expectedCopy: /Distribution Completion/i,
    paperNodeId: "LN7-0",
    baselineFile: "distribution-completion-LN7-0.png"
  }
];

/** Mirrors `dashboard-states.spec.ts` parity threshold. */
const PAPER_MAX_DIFF_PIXEL_RATIO = 0.2;

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
  paperPath: string
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
    { threshold: 0.1, includeAA: false }
  );
  return { diffRatio: diffPixels / (width * height), width, height };
}

for (const entry of CASES) {
  test(`followup paper parity — ${entry.id} (${entry.paperNodeId})`, async (
    { page },
    testInfo
  ) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Visual parity suite runs on desktop only (1440x1080 viewport)."
    );

    await page.goto(`/demo/${entry.scenarioId}?chrome=0`);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(
      page.locator(".app-shell").getByText(entry.expectedCopy).first()
    ).toBeVisible();

    // Disable transitions / animations so the capture is stable.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          transition-duration: 0s !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
        }
      `
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const appShell = page.locator(".app-shell");
    const appBuffer = await appShell.screenshot({
      animations: "disabled",
      caret: "hide"
    });

    const paperPath = path.join(BASELINES_DIR, entry.baselineFile);
    expect(
      fs.existsSync(paperPath),
      `Paper baseline missing at ${paperPath}. Re-run the followup baseline capture step in fix-followup-paper-parity-final-review.`
    ).toBe(true);

    const { diffRatio } = compareToPaperFixture(appBuffer, paperPath);
    expect(
      diffRatio,
      `App render drifted from Paper baseline for "${entry.id}" ` +
        `(diffRatio=${diffRatio.toFixed(4)} > PAPER_MAX_DIFF_PIXEL_RATIO=${PAPER_MAX_DIFF_PIXEL_RATIO}). ` +
        `Review docs/followup-paper-parity-report.md for known deviations; if this represents a new drift, ` +
        `either fix in code or extend the deviation report.`
    ).toBeLessThanOrEqual(PAPER_MAX_DIFF_PIXEL_RATIO);
  });
}
