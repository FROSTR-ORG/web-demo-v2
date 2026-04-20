import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DemoScenarioPage } from "../DemoScenarioPage";

/*
 * Regression test for the misc-tech-debt blocker logged against
 * `MockAppStateProvider`: its internal state (profiles / activeProfile /
 * runtimeStatus / signerPaused / createSession) is seeded from `value` via
 * `useState(value)` at mount and is never resynchronised when `value`
 * changes. `DemoScenarioPage` passes `value={scenario.appState}`, so prior
 * to the fix navigating from `/demo/:scenarioIdA` to `/demo/:scenarioIdB`
 * kept scenario A's seed state and the user saw stale UI.
 *
 * The fix uses `key={scenario.id}` on `MockAppStateProvider` in
 * `DemoScenarioPage`. A new `scenario.id` causes React to unmount the
 * previous provider and mount a fresh one, which re-runs `useState(value)`
 * with scenario B's seed data.
 *
 * This test drives the behaviour through the same `<DemoScenarioPage />`
 * route the demo gallery uses — it will fail if the `key` prop is removed
 * or if someone swaps MockAppStateProvider back to a non-stateful
 * implementation that silently ignores a changed `value`.
 */

let externalNavigate: ((to: string) => void) | null = null;
function NavigatorCapture() {
  const navigate = useNavigate();
  useEffect(() => {
    externalNavigate = navigate;
  }, [navigate]);
  return null;
}

afterEach(() => {
  externalNavigate = null;
  cleanup();
});

describe("DemoScenarioPage scenario switching resets MockAppStateProvider state", () => {
  it("navigating /demo/dashboard-running → /demo/welcome-first-time renders scenario B's empty-profile Welcome, not scenario A's Dashboard", async () => {
    render(
      <MemoryRouter initialEntries={["/demo/dashboard-running"]}>
        <NavigatorCapture />
        <Routes>
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Scenario A — Dashboard (signer running). Unique Dashboard-only copy
    // that is not present on the Welcome screen.
    await waitFor(() => {
      expect(screen.getAllByText(/Signer Running/i).length).toBeGreaterThan(0);
    });

    // Flip to scenario B (welcome-first-time). scenario.appState for this
    // scenario has `profiles: []` / `activeProfile: null` / `runtimeStatus:
    // null`, which is what the Welcome "first visit" variant renders from.
    await act(async () => {
      externalNavigate!("/demo/welcome-first-time");
    });

    // Scenario B — first-visit Welcome card copy. This ONLY appears when
    // profiles.length === 0; if scenario A's seed state leaked, we would
    // still see the Dashboard "Signer Running" indicator.
    await waitFor(() => {
      expect(screen.getAllByText(/Create New Keyset/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(/Signer Running/i)).toHaveLength(0);
  });

  it("navigating /demo/welcome-first-time → /demo/dashboard-running renders scenario B's Dashboard with the seeded activeProfile, not the stale empty state", async () => {
    render(
      <MemoryRouter initialEntries={["/demo/welcome-first-time"]}>
        <NavigatorCapture />
        <Routes>
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Scenario A — first-visit Welcome (empty profiles).
    await waitFor(() => {
      expect(screen.getAllByText(/Create New Keyset/i).length).toBeGreaterThan(0);
    });

    // Flip to scenario B — Dashboard (running signer). If MockAppStateProvider
    // did not reset, the Welcome-based empty state would block the Dashboard
    // screen from rendering (the Dashboard guard would redirect to "/").
    await act(async () => {
      externalNavigate!("/demo/dashboard-running");
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Signer Running/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText(/Create New Keyset/i)).toHaveLength(0);
  });
});
