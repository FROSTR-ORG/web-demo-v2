import { expect, test } from "@playwright/test";

/**
 * Regression gate for feature `m7-recover-regression`.
 *
 * Mission contract: after every milestone landed on master
 * (M1 runtime ops, M2 approvals, M3 policies, M4 event log,
 * M5 settings persistence, M6 backups/camera/QR, M7
 * onboard sponsorship + rotate-keyset live-sign), the
 * Recover NSEC flow must still function end-to-end with
 * no new UI glitches introduced by any earlier milestone:
 *
 *   - Paste threshold share packages (collect shares screen
 *     renders the required `Source Share #N — bfshare` slots
 *     for the active profile's threshold, plus the "This
 *     Browser" local share slot).
 *   - Reveal NSEC with masked↔revealed toggle (success
 *     screen masks the nsec by default, reveals on user
 *     action, re-masks on toggle back).
 *   - No console errors on either screen.
 *   - Paper copy intact ("Recover NSEC" heading, threshold
 *     copy, "Security Warning", "Recovered NSEC:" +
 *     "Recovered NSEC (revealed):" block labels).
 *
 * The demo gallery already exercises render-parity for
 * every scenario, but its desktop console-error guard is
 * currently masked by the pre-existing PeersPanel nested
 * `<button>` failure on `dashboard-running`
 * (tracked by `misc-peers-panel-nested-button` in
 * AGENTS.md > Known Pre-Existing Issues). This focused
 * spec therefore reasserts the console-error guarantee on
 * just the recover scenarios plus drives the
 * masked↔revealed toggle interactively — a behavior that
 * only the live DOM can verify.
 *
 * Runs on the desktop project only; mobile viewport is
 * covered by the demo-gallery mobile pass, which already
 * includes `recover-success` in its representative set.
 */

const RECOVERED_NSEC = "nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0";
const MASKED_NSEC_PREFIX = "nsec1abc";

test.describe("Recover NSEC regression gate", () => {
  test("collect shares screen renders with zero console errors and Paper copy", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Recover regression gate runs on desktop only.");

    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/demo/recover-collect-shares");

    // Paper copy: heading, threshold line, share slot labels.
    await expect(page.getByRole("heading", { name: "Recover NSEC" })).toBeVisible();
    await expect(
      page.getByText(/Recovering your nsec requires \d+ of your \d+ shares/i).first()
    ).toBeVisible();
    await expect(page.getByText(/Share #0 — This Browser/).first()).toBeVisible();
    await expect(page.getByText(/Share #1 — Pasted/).first()).toBeVisible();

    expect(errors, "recover-collect-shares render").toEqual([]);
  });

  test("success screen toggles masked↔revealed with zero console errors", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Recover regression gate runs on desktop only.");

    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/demo/recover-success");

    // Paper copy on success screen.
    await expect(page.getByRole("heading", { name: "Recover NSEC" })).toBeVisible();
    await expect(page.getByText("Security Warning").first()).toBeVisible();
    await expect(page.getByText("Recovered NSEC:").first()).toBeVisible();
    await expect(page.getByText("Recovered NSEC (revealed):").first()).toBeVisible();

    // Default masked state: the full recovered nsec must NOT be visible.
    // Both blocks show the masked prefix until the user reveals.
    await expect(page.getByText(RECOVERED_NSEC)).toHaveCount(0);

    // Copy to Clipboard starts disabled while the nsec is masked.
    const copyButton = page.getByRole("button", { name: /Copy to Clipboard/ });
    await expect(copyButton).toBeDisabled();

    // Reveal → revealed block shows the full nsec, button label flips to "Hide".
    const toggle = page.getByRole("button", { name: /Reveal|Hide/ });
    await expect(toggle).toHaveText(/Reveal/);
    await toggle.click();

    await expect(page.getByText(RECOVERED_NSEC)).toBeVisible();
    await expect(toggle).toHaveText(/Hide/);
    await expect(copyButton).toBeEnabled();

    // The masked block (first "Recovered NSEC:" display) must remain masked —
    // revealing only un-masks the second "Recovered NSEC (revealed):" block.
    // The revealed nsec appears exactly once at this point.
    await expect(page.getByText(RECOVERED_NSEC)).toHaveCount(1);

    // Masked prefix remains visible in the first block.
    await expect(page.locator(".recover-nsec-masked")).toContainText(MASKED_NSEC_PREFIX);

    // Toggle back: Hide → re-masks the revealed block, button flips back to "Reveal".
    await toggle.click();
    await expect(page.getByText(RECOVERED_NSEC)).toHaveCount(0);
    await expect(toggle).toHaveText(/Reveal/);
    await expect(copyButton).toBeDisabled();

    expect(errors, "recover-success render + toggle").toEqual([]);
  });
});
