import { expect, test } from "@playwright/test";

test("creates a keyset and reaches the runtime-backed dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Igloo Web" })).toBeVisible();
  await expect(page.getByText(/Phase 1/i)).toHaveCount(0);

  await page.getByRole("button", { name: "New Keyset" }).click();
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
  await expect(page.getByText(/bfonboard1/).first()).toBeVisible();

  const qrButtons = page.getByRole("button", { name: "QR" });
  const qrCount = await qrButtons.count();
  for (let index = 0; index < qrCount; index += 1) {
    await qrButtons.nth(index).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
  }

  await page.getByRole("button", { name: "Continue to Completion" }).click();

  await expect(page.getByRole("heading", { name: "Distribution Completion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish Distribution" })).toBeEnabled();
  await page.getByRole("button", { name: "Finish Distribution" }).click();

  await expect(page.locator(".app-header")).toHaveCount(1);
  await expect(page.getByText("Peers")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("main").getByText("E2E Signing Key").first()).toBeVisible();
  await expect(page.getByText(/sign ready/i)).toBeVisible();
});
