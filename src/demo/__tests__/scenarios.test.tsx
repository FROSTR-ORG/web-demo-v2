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
    expect(canonical).toHaveLength(51);
    expect(variants.map((scenario) => scenario.id).sort()).toEqual([
      "dashboard-peer-policy-chips",
      "import-error-corrupted",
      "onboard-failed-rejected",
      "welcome-replace-share-first",
      "welcome-rotate-keyset-first"
    ]);
    expect(new Set(demoScenarios.map((scenario) => scenario.id)).size).toBe(demoScenarios.length);
    expect(demoFlows).toEqual(["welcome", "import", "onboard", "create", "shared", "dashboard", "rotate-keyset", "replace-share", "recover"]);
  });

  it("has synced reference screenshots for every scenario", () => {
    for (const scenario of demoScenarios) {
      const referencePath = join(process.cwd(), "public", scenario.paperReference);
      expect(existsSync(referencePath), `${scenario.id} is missing ${scenario.paperReference}`).toBe(true);
    }
  });

  it("lists only canonical scenarios in the gallery (VAL-CROSS-001)", () => {
    render(
      <MemoryRouter>
        <DemoGallery />
      </MemoryRouter>
    );

    for (const scenario of demoScenarios) {
      if (scenario.canonical === false) {
        // Variants must NOT be listed as top-level gallery links
        expect(screen.queryByText(scenario.title)).toBeNull();
      } else {
        expect(screen.getByText(scenario.title)).toBeInTheDocument();
      }
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

  it("rotate-keyset adaptation scenarios render with rotate-keyset stepper variant (VAL-RTK-010)", () => {
    const adaptationIds = ["rotate-keyset-create-profile", "rotate-keyset-distribute", "rotate-keyset-complete"];
    const expectedPathnames: Record<string, string> = {
      "rotate-keyset-create-profile": "/rotate-keyset/profile",
      "rotate-keyset-distribute": "/rotate-keyset/distribute",
      "rotate-keyset-complete": "/rotate-keyset/complete"
    };

    for (const id of adaptationIds) {
      const scenario = demoScenarios.find((entry) => entry.id === id);
      expect(scenario, `${id} missing from demoScenarios`).toBeTruthy();
      expect(scenario!.flow).toBe("rotate-keyset");
      expect(scenario!.canonical).not.toBe(false);
      expect(scenario!.location.pathname).toBe(expectedPathnames[id]);

      const { unmount } = render(
        <MemoryRouter>
          <MockAppStateProvider value={scenario!.appState}>
            <CoreRoutes location={scenario!.location} />
          </MockAppStateProvider>
        </MemoryRouter>
      );

      // Rotate-keyset Stepper variant uses the "Rotate Keyset" step-1 label
      // and the full label triad "Rotate Keyset / Setup Profile / Onboard Devices".
      expect(screen.getAllByText("Rotate Keyset").length, `${id} missing Rotate Keyset step label`).toBeGreaterThan(0);
      expect(screen.getAllByText("Setup Profile").length, `${id} missing Setup Profile step label`).toBeGreaterThan(0);
      expect(screen.getAllByText("Onboard Devices").length, `${id} missing Onboard Devices step label`).toBeGreaterThan(0);

      unmount();
    }
  });

  it("covers the second-pass Paper parity gap text", () => {
    const checks = [
      { id: "dashboard-running", text: ["Event Log", "Pending Approvals", "~186 ready", "Avg: 31ms"] },
      { id: "dashboard-recover", text: ["Incompatible Shares", "03b7e1f9d2c8...4j8w"] },
      { id: "dashboard-recover-success", text: ["Security Warning", "Recovered NSEC:"] },
      { id: "recover-collect-shares", text: ["Incompatible Shares", "03b7e1f9d2c8...4j8w"] },
      { id: "import-error-corrupted", text: ["Backup Corrupted"] },
      { id: "onboard-failed-rejected", text: ["Onboarding Rejected"] },
      // fix-followup-distribute-2b-screen-rewrites — the Distribute
      // Shares screen was rewritten per Paper 8GU-0. The old
      // `lockedPackageIndexes` → "Enter password to unlock" affordance
      // no longer exists; the demo scenario now exercises the POST-
      // state (every remote share has `packageCreated === true`, so
      // each card renders the "Ready to distribute" chip + the new
      // "How this step works" info panel).
      { id: "shared-distribute-shares", text: ["How this step works", "Ready to distribute"] },
      { id: "replace-share-applying", text: ["Onboarding package: bfonboard1••••"] },
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
