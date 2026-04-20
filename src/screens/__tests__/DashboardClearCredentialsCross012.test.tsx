/**
 * VAL-CROSS-012 regression — Dashboard → Clear Credentials → Welcome
 *   (no-profiles variant)
 *
 * Before this milestone the DashboardScreen's `handleClearCredentials`
 * wrote an explicit empty snapshot into the sessionStorage bridge just
 * before `navigate("/")` as a workaround for the fact that the demo
 * fixture's `clearCredentials` was a no-op. The workaround has been
 * removed now that `MockAppStateProvider` is stateful and its
 * `clearCredentials` genuinely empties `profiles`, clears the active
 * profile, and clears the runtime.
 *
 * This regression test renders the real `DashboardScreen` inside a
 * `MockAppStateProvider` seeded with a profile, confirms the destructive
 * "Clear Credentials" action, and then asserts that the landing `/`
 * route (rendered by the SAME provider instance) sees zero profiles and
 * no active profile — i.e. the Welcome no-profiles variant would render
 * if the real `WelcomeScreen` were mounted there.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MockAppStateProvider, useAppState } from "../../app/AppState";
import { BRIDGE_STORAGE_KEY } from "../../app/appStateBridge";
import { createDemoAppState, demoProfile, demoRuntimeStatus } from "../../demo/fixtures";
import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function LandingProbe() {
  const { profiles, activeProfile, runtimeStatus } = useAppState();
  return (
    <>
      <div data-testid="landing-profile-count">{profiles.length}</div>
      <div data-testid="landing-active-profile">{activeProfile?.id ?? ""}</div>
      <div data-testid="landing-runtime">{runtimeStatus ? "yes" : "no"}</div>
      <div data-testid="welcome-no-profiles">Welcome No Profiles Variant</div>
    </>
  );
}

describe("VAL-CROSS-012 — stateful MockAppStateProvider clears credentials → Welcome no-profiles", () => {
  it("Clear Credentials confirm empties profiles and lands on the no-profiles variant", async () => {
    const seedValue = createDemoAppState({
      profiles: [demoProfile],
      activeProfile: demoProfile,
      runtimeStatus: demoRuntimeStatus
    });

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/dashboard/${demoProfile.id}`,
            state: {
              demoUi: {
                dashboard: {
                  settingsOpen: true,
                  modal: "clear-credentials",
                  paperPanels: true
                }
              }
            }
          }
        ]}
      >
        <MockAppStateProvider value={seedValue}>
          <Routes>
            <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
            <Route path="/" element={<LandingProbe />} />
            <Route path="/rotate-keyset" element={<div />} />
            <Route path="/rotate-share" element={<div />} />
            <Route path="/recover/:profileId" element={<div />} />
          </Routes>
        </MockAppStateProvider>
      </MemoryRouter>
    );

    // Confirmation destructive button ("Clear Credentials" inside the
    // .clear-creds-confirm action row).
    const confirmBtn = Array.from(screen.getAllByText("Clear Credentials")).find((el) =>
      el.closest(".clear-creds-confirm")
    );
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);

    // Navigation + stateful clear → the Landing probe reads from the SAME
    // provider instance, and it must see the empty state so the real
    // Welcome screen's no-profiles variant would render there.
    await waitFor(() => {
      expect(screen.getByTestId("welcome-no-profiles")).toBeInTheDocument();
    });
    expect(screen.getByTestId("landing-profile-count").textContent).toBe("0");
    expect(screen.getByTestId("landing-active-profile").textContent).toBe("");
    expect(screen.getByTestId("landing-runtime").textContent).toBe("no");

    // The bridge snapshot is also rearmed with the empty state so a later
    // navigation that hits the real AppStateProvider surfaces the same
    // no-profiles variant. This is the behaviour the Dashboard-side
    // workaround previously had to force manually.
    await waitFor(() => {
      const raw = window.sessionStorage.getItem(BRIDGE_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.profiles).toEqual([]);
      expect(parsed.activeProfile).toBeNull();
      expect(parsed.runtimeStatus).toBeNull();
    });
  });
});
