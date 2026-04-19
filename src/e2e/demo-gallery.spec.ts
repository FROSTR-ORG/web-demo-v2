import { expect, test } from "@playwright/test";
import { demoScenarios } from "../demo/scenarios";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("renders every demo scenario on desktop without page errors", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Full gallery pass runs on desktop only.");

  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const scenario of demoScenarios) {
    errors.length = 0;
    await page.goto(`/demo/${scenario.id}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".app-shell").getByText(new RegExp(escapeRegExp(scenario.expectedText), "i")).first()).toBeVisible();
    expect(errors, scenario.id).toEqual([]);
  }
});

test("renders every demo scenario in raw mode without demo chrome", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Raw gallery pass runs on desktop only.");

  for (const scenario of demoScenarios) {
    await page.goto(`/demo/${scenario.id}?chrome=0`);
    await expect(page.locator(".demo-scenario-toolbar")).toHaveCount(0);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".app-shell").getByText(new RegExp(escapeRegExp(scenario.expectedText), "i")).first()).toBeVisible();
  }
});

test("enabled interactive controls use pointer cursors in every raw demo scenario", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Cursor affordance pass runs on desktop only.");

  for (const scenario of demoScenarios) {
    await page.goto(`/demo/${scenario.id}?chrome=0`);
    await expect(page.locator(".app-header")).toBeVisible();

    const cursorMismatches = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, [role='button'], a[href]"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => {
          const cursor = window.getComputedStyle(element).cursor;
          const disabled = element.matches(":disabled, [aria-disabled='true']");
          return {
            tag: element.tagName.toLowerCase(),
            text: (element.textContent || element.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
            className: element.getAttribute("class") ?? "",
            cursor,
            disabled
          };
        })
        .filter((element) => (element.disabled ? element.cursor !== "not-allowed" : element.cursor !== "pointer"))
    );

    expect(cursorMismatches, scenario.id).toEqual([]);
  }
});

test("renders representative dense demo scenarios on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile pass runs on the mobile project only.");

  const representativeIds = [
    "welcome-returning-many",
    "dashboard-settings-lock-profile",
    "shared-create-profile",
    "rotate-keyset-intake",
    "recover-success"
  ];

  for (const scenarioId of representativeIds) {
    const scenario = demoScenarios.find((entry) => entry.id === scenarioId);
    expect(scenario, scenarioId).toBeTruthy();
    await page.goto(`/demo/${scenario!.id}`);
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".app-shell").getByText(new RegExp(escapeRegExp(scenario!.expectedText), "i")).first()).toBeVisible();
  }
});
