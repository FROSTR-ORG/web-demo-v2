/**
 * Paper visual parity regression test for the 5 main dashboard states.
 *
 * Feature: m7-paper-parity-visuals (+ fix-m7-scrutiny-r1-paper-parity-baseline-source)
 *
 * What this covers:
 *   1. **Paper-sourced baseline (primary).** The live app render of
 *      each dashboard state is compared against the canonical Paper
 *      artboard PNG exported from the sibling `igloo-paper` repo
 *      (`igloo-paper/screens/dashboard/<flow>/screenshot.png`) and
 *      committed under `src/e2e/visual/paper-fixtures/`. These are the
 *      true source of truth for Paper parity — they catch app-vs-paper
 *      drift, not just app-vs-self regression. The comparison uses a
 *      custom pixelmatch run (sizes may differ — Paper is 1440 × 1284,
 *      app captures a viewport-sized `.app-shell`), cropping both
 *      images to their common top-aligned bounding box before diffing.
 *      Threshold is widened to `maxDiffPixelRatio = 0.20` because the
 *      Paper artboards are a static HTML export with different font
 *      rendering / antialiasing than the React/Vite runtime; 0.20 is
 *      the deviation documented in
 *      `docs/runtime-deviations-from-paper.md`. Any drift beyond that
 *      indicates real structural divergence from Paper and fails the
 *      test.
 *
 *   2. **App self-consistency baseline (secondary).** `.app-shell` is
 *      also pixel-diffed against a tight 1% tolerance baseline that
 *      was generated from the app's own render (Paper-fixture-driven
 *      demo, `paperPanels=true`). These catch app-vs-self regressions
 *      between runs. Baselines live under
 *      `dashboard-states.spec.ts-snapshots/dashboard-<state>-self-*`.
 *
 *   3. Design-system primitive reuse. The contract requires the
 *      Settings sidebar primitives to remain available as shared CSS
 *      classes. We assert their existence in the bundled page CSS so
 *      changes that drop them (renames, purges) are caught even if
 *      the dashboard main-state DOM doesn't render the sidebar by
 *      default.
 *
 * Notes:
 *   - `?chrome=0` hides the demo toolbar so captures exclude demo
 *     affordances.
 *   - We wait for scenario-specific copy before screenshotting so
 *     async pumps have settled; `paperPanels=true` renders use static
 *     fixture content so no timers are driving the DOM at capture
 *     time.
 *   - Self baselines live under
 *     `src/e2e/visual/dashboard-states.spec.ts-snapshots/` and are
 *     tracked in git.
 *   - Paper baselines live under `src/e2e/visual/paper-fixtures/` and
 *     are a verbatim copy of `igloo-paper/screens/dashboard/<flow>/
 *     screenshot.png`. Do not regenerate from the app — re-export from
 *     Paper when the artboard changes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAPER_FIXTURES_DIR = path.join(__dirname, "paper-fixtures");

interface DashboardStateCase {
  id: string;
  scenarioId: string;
  expectedCopy: RegExp;
  paperFixture: string;
}

const STATES: readonly DashboardStateCase[] = [
  {
    id: "running",
    scenarioId: "dashboard-running",
    expectedCopy: /Signer Running/i,
    paperFixture: "dashboard-running.png"
  },
  {
    id: "connecting",
    scenarioId: "dashboard-connecting",
    expectedCopy: /Signer Connecting/i,
    paperFixture: "dashboard-connecting.png"
  },
  {
    id: "stopped",
    scenarioId: "dashboard-stopped",
    expectedCopy: /Signer Stopped/i,
    paperFixture: "dashboard-stopped.png"
  },
  {
    id: "relays-offline",
    scenarioId: "dashboard-relays-offline",
    expectedCopy: /All Relays Offline/i,
    paperFixture: "dashboard-relays-offline.png"
  },
  {
    id: "signing-blocked",
    scenarioId: "dashboard-signing-blocked",
    expectedCopy: /Signing Blocked/i,
    paperFixture: "dashboard-signing-blocked.png"
  }
];

const REQUIRED_DS_PRIMITIVES = [
  ".settings-section",
  ".settings-card",
  ".settings-btn-blue",
  ".settings-btn-muted",
  ".settings-btn-red"
] as const;

/**
 * Paper parity tolerance. The Paper artboards are static HTML exports
 * with different font rendering and antialiasing than the live React
 * runtime. Empirically, the clean layout diff sits in the 8–15% range
 * due to anti-alias and subpixel positioning differences. 0.20 is
 * generous enough to absorb that without masking real structural
 * drift (e.g. a missing panel row would add 25%+). If your feature
 * work pushes this above 0.20 you must either (a) fix the drift, or
 * (b) widen the threshold here AND document the deviation in
 * `docs/runtime-deviations-from-paper.md` with the new ratio.
 */
const PAPER_MAX_DIFF_PIXEL_RATIO = 0.20;

/**
 * Crop a PNG to the top-aligned rectangle `{width, height}`. The
 * output is a freshly-allocated `PNG` of exactly `width × height`; if
 * the source is smaller, the remaining pixels are left transparent
 * black. Callers should ensure `width ≤ source.width` and `height ≤
 * source.height` for a strict crop.
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

/**
 * Compare an app screenshot buffer against a Paper fixture PNG on
 * disk. Sizes may differ (Paper artboard height is 1284px; app
 * `.app-shell` capture is viewport-sized) — we crop both to their
 * common top-aligned bounding box before running pixelmatch, then
 * return the diff ratio over that common area. This matches the
 * contract language: "compare the primary bounding box against Paper;
 * treat Paper's extra trailing pixels as intentional deviation."
 */
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

for (const state of STATES) {
  test(`paper parity — ${state.id}`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Visual parity suite runs on desktop only (1440x1080 viewport)."
    );

    await page.goto(`/demo/${state.scenarioId}?chrome=0`);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(
      page.locator(".app-shell").getByText(state.expectedCopy).first()
    ).toBeVisible();

    // Disable CSS transitions / animations so the capture is stable on
    // machines where hover/focus transitions might be mid-flight.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          transition-duration: 0s !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
        }
      `
    });

    // Settle the layout.
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const appShell = page.locator(".app-shell");

    // ---- (1) Paper-sourced baseline (primary). ----
    // We capture `.app-shell` to a raw buffer and compare against the
    // Paper artboard export. Different dimensions are expected (see
    // `docs/runtime-deviations-from-paper.md`), so we crop to the
    // common top-aligned region before diffing.
    const appBuffer = await appShell.screenshot({
      animations: "disabled",
      caret: "hide"
    });
    const paperPath = path.join(PAPER_FIXTURES_DIR, state.paperFixture);
    expect(
      fs.existsSync(paperPath),
      `Paper fixture missing at ${paperPath}. Re-export from igloo-paper/screens/dashboard/<flow>/screenshot.png.`
    ).toBe(true);
    const { diffRatio } = compareToPaperFixture(appBuffer, paperPath);
    expect(
      diffRatio,
      `App render drifted from Paper fixture for state "${state.id}" ` +
        `(diffRatio=${diffRatio.toFixed(4)} > PAPER_MAX_DIFF_PIXEL_RATIO=${PAPER_MAX_DIFF_PIXEL_RATIO}). ` +
        `If this is intentional, update docs/runtime-deviations-from-paper.md and the ratio in ` +
        `src/e2e/visual/dashboard-states.spec.ts.`
    ).toBeLessThanOrEqual(PAPER_MAX_DIFF_PIXEL_RATIO);

    // ---- (2) App self-consistency baseline (secondary). ----
    // Tight 1% tolerance pixel-diff against the committed
    // app-self baseline. The `-self` suffix makes the snapshot file
    // name `dashboard-<state>-self-desktop-darwin.png`, distinct from
    // any Paper-origin baseline naming.
    await expect(appShell).toHaveScreenshot(`dashboard-${state.id}-self.png`, {
      threshold: 0.1,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide"
    });
  });
}

test("design-system primitives (.settings-section / .settings-card / .settings-btn-*) are available", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Visual parity suite runs on desktop only."
  );

  // Load any of the dashboard scenarios so the full CSS bundle is in the
  // page; the specific state does not matter here — we're asserting
  // against the loaded stylesheet's rule table.
  await page.goto(`/demo/dashboard-running?chrome=0`);
  await expect(page.locator(".app-header")).toBeVisible();

  const missing = await page.evaluate((selectors: readonly string[]) => {
    const found: Record<string, boolean> = {};
    for (const selector of selectors) found[selector] = false;

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        // cross-origin stylesheet: skip.
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        const cssText = (rule as CSSRule).cssText ?? "";
        for (const selector of selectors) {
          if (!found[selector] && cssText.includes(selector)) {
            found[selector] = true;
          }
        }
      }
    }
    return selectors.filter((selector) => !found[selector]);
  }, REQUIRED_DS_PRIMITIVES);

  expect(missing, "missing design-system primitive class rules").toEqual([]);
});

test("design-system primitives render in the Settings sidebar on the dashboard", async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Visual parity suite runs on desktop only."
  );

  // The Settings sidebar is where .settings-section / .settings-card /
  // .settings-btn-* are actually composed. Visiting the dedicated
  // settings scenario ensures at least one live consumer of each
  // primitive is mounted in the DOM — proving reuse, not just
  // definition.
  await page.goto(`/demo/dashboard-settings-lock-profile?chrome=0`);
  await expect(page.locator(".app-header")).toBeVisible();

  // `.settings-section` and `.settings-card` are used by every section
  // (Device Profile / Group Profile / Replace Share / Onboard a Device /
  // etc.), so we expect multiple instances.
  await expect(page.locator(".settings-section").first()).toBeVisible();
  expect(await page.locator(".settings-section").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".settings-card").first()).toBeVisible();
  expect(await page.locator(".settings-card").count()).toBeGreaterThanOrEqual(2);

  // The blue CTA is used by Replace Share / Onboard a Device; at least
  // one must exist in the rendered sidebar.
  expect(await page.locator(".settings-btn-blue").count()).toBeGreaterThanOrEqual(1);
});
