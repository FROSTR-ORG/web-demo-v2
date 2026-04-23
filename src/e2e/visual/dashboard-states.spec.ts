/**
 * Paper visual parity regression test for the 5 main dashboard states.
 *
 * Feature: m7-paper-parity-visuals
 *
 * What this covers:
 *   1. Pixel diff on the primary bounding box (`.app-shell`) for:
 *        - dashboard-running
 *        - dashboard-connecting
 *        - dashboard-stopped
 *        - dashboard-relays-offline
 *        - dashboard-signing-blocked
 *      Each state is compared against a committed snapshot produced from
 *      the Paper-fixture-driven demo (paperPanels=true when the scenario
 *      supplies `demoUi.dashboard`), which is the source of truth for
 *      Paper parity. Tolerance matches the feature contract:
 *        - per-pixel threshold: 0.1 (pixelmatch-compatible)
 *        - max diff pixel ratio: 0.01 (≤ 1% of primary bounding box)
 *      The baseline snapshots were seeded with `--update-snapshots` from
 *      the Paper-fixture render of each scenario so the active baseline
 *      is a deterministic Paper-parity render (EventLog fixture rows,
 *      static peer latency / last_seen, fixed copy, fixed pending rows,
 *      fixed relay list). Any drift > 1% on the primary bounding box
 *      fails the test.
 *
 *   2. Design-system primitive reuse. The contract requires the Settings
 *      sidebar primitives to remain available as shared CSS classes. We
 *      assert their existence in the bundled page CSS so changes that
 *      drop them (renames, purges) are caught even if the dashboard
 *      main-state DOM doesn't render the sidebar by default.
 *
 * Notes:
 *   - `?chrome=0` hides the demo toolbar so snapshots capture the pure
 *     app-shell render.
 *   - We wait for scenario-specific copy before screenshotting so async
 *     pumps have settled; paperPanels=true renders use static fixture
 *     content so no timers are driving the DOM at capture time.
 *   - Snapshots live under `src/e2e/visual/dashboard-states.spec.ts-
 *     snapshots/` and are tracked in git.
 */

import { expect, test } from "@playwright/test";

interface DashboardStateCase {
  id: string;
  scenarioId: string;
  expectedCopy: RegExp;
}

const STATES: readonly DashboardStateCase[] = [
  { id: "running", scenarioId: "dashboard-running", expectedCopy: /Signer Running/i },
  { id: "connecting", scenarioId: "dashboard-connecting", expectedCopy: /Signer Connecting/i },
  { id: "stopped", scenarioId: "dashboard-stopped", expectedCopy: /Signer Stopped/i },
  { id: "relays-offline", scenarioId: "dashboard-relays-offline", expectedCopy: /All Relays Offline/i },
  { id: "signing-blocked", scenarioId: "dashboard-signing-blocked", expectedCopy: /Signing Blocked/i }
];

const REQUIRED_DS_PRIMITIVES = [
  ".settings-section",
  ".settings-card",
  ".settings-btn-blue",
  ".settings-btn-muted",
  ".settings-btn-red"
] as const;

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

    // Disable CSS transitions / animations so the snapshot is stable on
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

    // Pixel-diff the primary bounding box. threshold=0.1 is pixelmatch's
    // per-pixel tolerance; maxDiffPixelRatio=0.01 enforces ≤1% total
    // divergence over the bounding box — matching the feature contract.
    await expect(page.locator(".app-shell")).toHaveScreenshot(
      `dashboard-${state.id}.png`,
      {
        threshold: 0.1,
        maxDiffPixelRatio: 0.01,
        animations: "disabled",
        caret: "hide"
      }
    );
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
