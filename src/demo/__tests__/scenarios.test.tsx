import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MockAppStateProvider } from "../../app/AppState";
import { CoreRoutes } from "../../app/CoreRoutes";
import { DemoGallery } from "../DemoGallery";
import { demoFlows, demoScenarios } from "../scenarios";

afterEach(cleanup);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("demo scenarios", () => {
  it("covers every Paper screen state", () => {
    const canonical = demoScenarios.filter((scenario) => scenario.canonical !== false);
    const variants = demoScenarios.filter((scenario) => scenario.canonical === false);
    expect(canonical).toHaveLength(44);
    expect(variants.map((scenario) => scenario.id).sort()).toEqual([
      "import-error-corrupted",
      "onboard-failed-rejected",
      "welcome-rotate-keyset-first",
      "welcome-rotate-share-first"
    ]);
    expect(new Set(demoScenarios.map((scenario) => scenario.id)).size).toBe(demoScenarios.length);
    expect(demoFlows).toEqual(["welcome", "import", "onboard", "create", "shared", "dashboard", "rotate-keyset", "rotate-share", "recover"]);
  });

  it("has synced reference screenshots for every scenario", () => {
    for (const scenario of demoScenarios) {
      const referencePath = join(process.cwd(), "public", scenario.paperReference);
      expect(existsSync(referencePath), `${scenario.id} is missing ${scenario.paperReference}`).toBe(true);
    }
  });

  it("lists all scenarios in the gallery", () => {
    render(
      <MemoryRouter>
        <DemoGallery />
      </MemoryRouter>
    );

    for (const scenario of demoScenarios) {
      expect(screen.getByText(scenario.title)).toBeInTheDocument();
    }
  });

  it("renders each scenario through the real route table", () => {
    for (const scenario of demoScenarios) {
      const { unmount } = render(
        <MemoryRouter>
          <MockAppStateProvider value={scenario.appState}>
            <CoreRoutes location={scenario.location} />
          </MockAppStateProvider>
        </MemoryRouter>
      );

      expect(screen.getAllByText(new RegExp(escapeRegExp(scenario.expectedText), "i")).length, scenario.id).toBeGreaterThan(0);
      unmount();
    }
  });

  it("covers the second-pass Paper parity gap text", () => {
    const checks = [
      { id: "dashboard-running", text: ["Event Log", "Pending Approvals", "~186 ready", "Avg: 31ms"] },
      { id: "recover-collect-shares", text: ["Incompatible Shares", "03b7e1f9d2c8...4j8w"] },
      { id: "import-error-corrupted", text: ["Backup Corrupted"] },
      { id: "onboard-failed-rejected", text: ["Onboarding Rejected"] },
      { id: "shared-distribute-shares", text: ["Enter password to unlock"] },
      { id: "rotate-share-applying", text: ["Rotate package: bfonboard1••••"] },
      { id: "create-generation-progress", text: ["1 of 3 phases"] },
      { id: "rotate-keyset-generation-progress", text: ["2 of 4 phases"] },
      { id: "welcome-returning-single", text: ["Rotate"] }
    ];

    for (const check of checks) {
      const scenario = demoScenarios.find((entry) => entry.id === check.id);
      expect(scenario, check.id).toBeTruthy();
      const { unmount } = render(
        <MemoryRouter>
          <MockAppStateProvider value={scenario!.appState}>
            <CoreRoutes location={scenario!.location} />
          </MockAppStateProvider>
        </MemoryRouter>
      );

      for (const text of check.text) {
        expect(screen.getAllByText(text).length, `${check.id} missing ${text}`).toBeGreaterThan(0);
      }
      unmount();
    }
  });
});
