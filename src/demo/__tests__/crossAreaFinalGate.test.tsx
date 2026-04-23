import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MockAppStateProvider } from "../../app/AppState";
import { CoreRoutes } from "../../app/CoreRoutes";
import { DemoGallery } from "../DemoGallery";
import { DemoScenarioPage } from "../DemoScenarioPage";
import { createDemoAppState } from "../fixtures";
import { demoFlows, demoScenarios } from "../scenarios";

/**
 * Comprehensive cross-area regression gate enumerating every canonical
 * demo scenario and asserting expectedText renders through the real demo
 * route + provider plumbing. This feature (cross-area-final-gate) exists to
 * guard that a single regression elsewhere in the codebase — a renamed
 * screen heading, a broken provider, a dropped Paper fixture — fails this
 * file loudly before it slips into the shipped prototype.
 *
 * Validation contract IDs covered here:
 *  - VAL-CROSS-001  DemoGallery lists every canonical scenario grouped by flow
 *  - VAL-CROSS-002  Gallery links navigate to /demo/{id} and the scenario's expectedText renders
 *  - VAL-CROSS-003  Scenario chrome toolbar renders All screens / Prev / Next / Raw / Reference
 *  - VAL-CROSS-004  Raw mode (?chrome=0) hides the scenario chrome toolbar
 *  - VAL-CROSS-014  Unknown routes fall back to "/" (welcome)
 *  - VAL-CROSS-022  paper-reference assets resolve for at least one representative scenario per flow
 */

afterEach(cleanup);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("Cross-area final gate — every canonical scenario", () => {
  const canonical = demoScenarios.filter((entry) => entry.canonical !== false);
  const variants = demoScenarios.filter((entry) => entry.canonical === false);

  it("DemoGallery renders 'Paper Screen Gallery' heading and flow sections in canonical order (VAL-CROSS-001)", () => {
    render(
      <MemoryRouter>
        <DemoGallery />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 1, name: "Paper Screen Gallery" })).toBeInTheDocument();

    const expectedFlowHeadings = [
      "Welcome",
      "Import",
      "Onboard",
      "Create",
      "Shared",
      "Dashboard",
      "Rotate Keyset",
      "Replace Share",
      "Recover"
    ];
    const renderedFlowHeadings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "");
    expect(renderedFlowHeadings).toEqual(expectedFlowHeadings);
    // Sanity-check alignment with demoFlows.
    expect(demoFlows.length).toBe(expectedFlowHeadings.length);
  });

  it("DemoGallery lists canonical scenarios and omits variants (VAL-CROSS-001)", () => {
    render(
      <MemoryRouter>
        <DemoGallery />
      </MemoryRouter>
    );

    for (const scenario of canonical) {
      const link = screen.getByRole("link", { name: new RegExp(escapeRegExp(scenario.title)) });
      expect(link).toBeInTheDocument();
      expect(link.getAttribute("href")).toBe(`/demo/${scenario.id}`);
    }

    for (const variant of variants) {
      // Variant titles must not appear as gallery links; their href target
      // should be absent from the gallery DOM entirely.
      expect(screen.queryByRole("link", { name: new RegExp(escapeRegExp(variant.title)) })).toBeNull();
    }
  });

  it("every canonical scenario renders its expectedText through the DemoScenarioPage (VAL-CROSS-002)", () => {
    for (const scenario of canonical) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[`/demo/${scenario.id}`]}>
          <Routes>
            <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
          </Routes>
        </MemoryRouter>
      );

      const matches = screen.getAllByText(new RegExp(escapeRegExp(scenario.expectedText), "i"));
      expect(matches.length, `${scenario.id} missing expectedText "${scenario.expectedText}"`).toBeGreaterThan(0);
      unmount();
    }
  });

  it("every variant scenario also renders its expectedText (guards against silent breakage)", () => {
    for (const scenario of variants) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[`/demo/${scenario.id}`]}>
          <Routes>
            <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
          </Routes>
        </MemoryRouter>
      );

      const matches = screen.getAllByText(new RegExp(escapeRegExp(scenario.expectedText), "i"));
      expect(matches.length, `${scenario.id} missing expectedText "${scenario.expectedText}"`).toBeGreaterThan(0);
      unmount();
    }
  });

  it("chrome toolbar exposes All screens, Prev, Next, Raw, and Reference links in canonical order (VAL-CROSS-003)", () => {
    const multi = demoScenarios.find((entry) => entry.id === "welcome-returning-multi");
    expect(multi, "welcome-returning-multi must exist").toBeTruthy();

    render(
      <MemoryRouter initialEntries={[`/demo/${multi!.id}`]}>
        <Routes>
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </Routes>
      </MemoryRouter>
    );

    const toolbar = document.querySelector(".demo-scenario-toolbar") as HTMLElement | null;
    expect(toolbar).not.toBeNull();

    const allScreens = screen.getByRole("link", { name: "All screens" });
    expect(allScreens.getAttribute("href")).toBe("/demo");

    // Canonical Prev = welcome-returning-single, Next = welcome-returning-many.
    const previous = screen.getByRole("link", { name: "Previous" });
    expect(previous.getAttribute("href")).toBe("/demo/welcome-returning-single");

    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("href")).toBe("/demo/welcome-returning-many");

    const raw = screen.getByRole("link", { name: "Raw" });
    expect(raw.getAttribute("href")).toBe(`/demo/${multi!.id}?chrome=0`);

    const reference = screen.getByRole("link", { name: "Reference" });
    expect(reference.getAttribute("href")).toBe(`/paper-reference/${multi!.id}.png`);
  });

  it("Prev/Next skips variants so the user stays on the canonical cycle (VAL-CROSS-003)", () => {
    // `welcome-unlock-error-modal` is the LAST canonical Welcome scenario.
    // Its next canonical scenario is the first Import scenario,
    // `import-load-backup` — NOT the next entry in the raw array, which is
    // the welcome-rotate-keyset-first variant.
    const unlockError = demoScenarios.find((entry) => entry.id === "welcome-unlock-error-modal");
    expect(unlockError, "welcome-unlock-error-modal must exist").toBeTruthy();

    render(
      <MemoryRouter initialEntries={[`/demo/${unlockError!.id}`]}>
        <Routes>
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </Routes>
      </MemoryRouter>
    );

    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("href")).toBe("/demo/import-load-backup");
  });

  it("Raw mode (?chrome=0) hides the demo chrome toolbar (VAL-CROSS-004)", () => {
    render(
      <MemoryRouter initialEntries={["/demo/welcome-first-time?chrome=0"]}>
        <Routes>
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </Routes>
      </MemoryRouter>
    );

    const toolbar = document.querySelector(".demo-scenario-toolbar");
    expect(toolbar).toBeNull();

    // The scenario content itself still renders.
    const welcome = demoScenarios.find((entry) => entry.id === "welcome-first-time")!;
    expect(
      screen.getAllByText(new RegExp(escapeRegExp(welcome.expectedText), "i")).length
    ).toBeGreaterThan(0);
  });

  it("removing ?chrome=0 restores the toolbar (VAL-CROSS-004)", () => {
    render(
      <MemoryRouter initialEntries={["/demo/welcome-first-time"]}>
        <Routes>
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </Routes>
      </MemoryRouter>
    );

    const toolbar = document.querySelector(".demo-scenario-toolbar");
    expect(toolbar).not.toBeNull();
  });

  it.each([
    ["/no-such-route"],
    ["/dashboard"],
    ["/create/bogus"],
    ["/rotate-keyset/not-a-step"],
    ["/replace-share/bogus"],
    ["/recover"]
  ])("unknown route %s redirects to / and renders Welcome (VAL-CROSS-014)", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <MockAppStateProvider value={createDemoAppState({ profiles: [] })}>
          <CoreRoutes />
        </MockAppStateProvider>
      </MemoryRouter>
    );

    // The welcome-first-time variant shows "Igloo Web" (expectedText for
    // welcome-first-time). Any redirect to "/" lands on WelcomeScreen, which
    // renders the Igloo branding regardless of profiles state.
    expect(screen.getAllByText(/Igloo Web/i).length).toBeGreaterThan(0);
  });

  it("paper-reference assets exist on disk for every representative scenario (VAL-CROSS-022)", () => {
    // Contract spot-checks one representative scenario per flow; we verify
    // that the asset referenced by paperReference (post-redirect for
    // variants) exists under public/ so the dev server can serve it HTTP 200.
    const representatives = [
      "welcome-first-time",
      "import-load-backup",
      "onboard-enter-package",
      "create-keyset",
      "shared-create-profile",
      "dashboard-running",
      "rotate-keyset-intake",
      "replace-share-enter-package",
      "recover-collect-shares"
    ];

    for (const id of representatives) {
      const scenario = demoScenarios.find((entry) => entry.id === id);
      expect(scenario, `representative scenario ${id} missing`).toBeTruthy();
      const referencePath = join(process.cwd(), "public", scenario!.paperReference);
      expect(existsSync(referencePath), `${id} paper-reference missing at ${referencePath}`).toBe(true);
    }
  });

  it("every scenario paper-reference asset resolves to a file (VAL-CROSS-022 defensive)", () => {
    for (const scenario of demoScenarios) {
      const referencePath = join(process.cwd(), "public", scenario.paperReference);
      expect(existsSync(referencePath), `${scenario.id} missing ${scenario.paperReference}`).toBe(true);
    }
  });

  it("demoFlows covers every flow used by demoScenarios with no orphan entries", () => {
    const flowsInScenarios = new Set(demoScenarios.map((scenario) => scenario.flow));
    for (const flow of flowsInScenarios) {
      expect(demoFlows).toContain(flow);
    }
    for (const flow of demoFlows) {
      expect(demoScenarios.some((scenario) => scenario.flow === flow)).toBe(true);
    }
  });

  it("baseline scenario count and variant identity are locked in (VAL-CROSS-021 guard)", () => {
    // Helps catch accidental deletions of canonical scenarios or silent
    // promotions of variants to canonical.
    expect(canonical.length).toBeGreaterThanOrEqual(47);
    expect(variants.map((entry) => entry.id).sort()).toEqual([
      "dashboard-peer-policy-chips",
      "import-error-corrupted",
      "onboard-failed-rejected",
      "welcome-replace-share-first",
      "welcome-rotate-keyset-first"
    ]);
  });
});
