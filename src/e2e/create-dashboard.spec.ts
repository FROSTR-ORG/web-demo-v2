import { expect, test } from "@playwright/test";

/**
 * fix-followup-distribute-2c — Part C of the 2A/2B/2C split.
 *
 * The CreateProfile form no longer collects a single shared
 * "Remote Package Password" (that field was removed in 2A); instead
 * the Distribute Shares screen renders a per-share Password input +
 * "Create package" CTA (Paper 8GU-0 rewrite in 2B). This spec now
 * drives the new per-share flow and clicks "Mark distributed" as
 * the offline fallback so the test does not depend on a live relay
 * adopting the package (VAL-FOLLOWUP-005).
 */
test("creates a keyset and reaches the Paper-skinned runtime dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Igloo Web" })).toBeVisible();
  await expect(page.getByText(/Phase 1/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Create New Keyset" }).click();
  await expect(page.getByRole("heading", { name: "Create New Keyset" })).toBeVisible();
  await page.getByLabel("Keyset Name").fill("E2E Signing Key");
  await expect(page.getByText(/Phase 1/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Create Keyset" }).click();

  await expect(page.getByRole("heading", { name: "Create Profile" })).toBeVisible();
  await page.getByLabel("Profile Name").fill("Igloo Web E2E");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("test-password");
  await page.getByRole("textbox", { name: "Confirm Password", exact: true }).fill("test-password");
  await expect(page.getByText(/Phase 1/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to Distribute Shares" }).click();

  await expect(page.getByRole("heading", { name: "Distribute Shares" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Mark Copied")).toHaveCount(0);
  await expect(page.getByText(/bfonboard1/).first()).toHaveCount(0);

  // Per-share Password input + "Create package" CTA rendered for every
  // remote share (2 for a 2-of-3 with local share idx 0). Each card
  // transitions PRE → POST when its CTA is clicked; the CTA count
  // strictly decreases. Once every card is POST the remote-package
  // stack reveals the live `bfonboard1…` preview.
  const packagePasswordInputs = page.getByLabel(/^Package password for share \d+$/);
  const remoteCount = await packagePasswordInputs.count();
  expect(remoteCount).toBeGreaterThan(0);
  const createPackageButtons = page.getByRole("button", { name: "Create package" });
  for (let index = 0; index < remoteCount; index += 1) {
    await packagePasswordInputs.first().fill(`remote-package-password-${index + 1}`);
    await createPackageButtons.first().click();
    await expect(createPackageButtons).toHaveCount(remoteCount - index - 1, {
      timeout: 10_000,
    });
  }
  await expect(page.getByText(/bfonboard1/).first()).toBeVisible();

  // Offline fallback: mark every remote share distributed manually
  // (no live relay in this desktop spec). The Continue-to-Completion
  // CTA requires every remote row to be packageCreated (already
  // satisfied above) to progress.
  const markDistributedButtons = page.getByRole("button", { name: /^Mark distributed$/ });
  await expect(markDistributedButtons).toHaveCount(remoteCount);
  for (let index = 0; index < remoteCount; index += 1) {
    await markDistributedButtons.nth(index).click();
  }

  await page.getByRole("button", { name: "Continue to Completion" }).click();

  await expect(page.getByRole("heading", { name: "Distribution Completion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish Distribution" })).toBeEnabled();
  await page.getByRole("button", { name: "Finish Distribution" }).click();

  await expect(page.locator(".app-header")).toHaveCount(1);
  await expect(page.getByText(/Peers:/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main").getByText("E2E Signing Key").first()).toBeVisible();
});
