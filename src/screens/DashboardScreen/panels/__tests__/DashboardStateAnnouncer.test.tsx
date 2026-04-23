import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardStateAnnouncer } from "../DashboardStateAnnouncer";
import type { DashboardState } from "../../types";

/**
 * Unit tests for the aria-live dashboard state announcer introduced by
 * feature m7-a11y-offline-banner (VAL-CROSS-025).
 */

afterEach(() => {
  cleanup();
});

describe("DashboardStateAnnouncer", () => {
  it("renders a polite aria-live status region", () => {
    render(<DashboardStateAnnouncer dashboardState="running" />);
    const region = screen.getByTestId("dashboard-state-announcer");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
  });

  it("renders the initial state label on mount", () => {
    render(<DashboardStateAnnouncer dashboardState="running" />);
    const region = screen.getByTestId("dashboard-state-announcer");
    expect(region.textContent).toBe("Signer running");
  });

  it("maps each dashboard state to a distinct concise label", () => {
    const states: DashboardState[] = [
      "running",
      "connecting",
      "stopped",
      "relays-offline",
      "signing-blocked",
    ];
    const labels = new Set<string>();
    for (const state of states) {
      const { unmount } = render(
        <DashboardStateAnnouncer dashboardState={state} />,
      );
      const region = screen.getByTestId("dashboard-state-announcer");
      expect(region.textContent && region.textContent.length > 0).toBe(
        true,
      );
      labels.add(region.textContent ?? "");
      unmount();
    }
    // Each state must map to a unique announcement string.
    expect(labels.size).toBe(states.length);
  });

  it("updates the live region text when the dashboard state changes", () => {
    const { rerender } = render(
      <DashboardStateAnnouncer dashboardState="running" />,
    );
    expect(screen.getByTestId("dashboard-state-announcer").textContent).toBe(
      "Signer running",
    );
    rerender(<DashboardStateAnnouncer dashboardState="relays-offline" />);
    expect(screen.getByTestId("dashboard-state-announcer").textContent).toBe(
      "Relays offline",
    );
    rerender(<DashboardStateAnnouncer dashboardState="signing-blocked" />);
    expect(screen.getByTestId("dashboard-state-announcer").textContent).toBe(
      "Signing blocked",
    );
  });

  it("keeps the same text when the dashboard state prop does not change across re-renders", () => {
    const { rerender } = render(
      <DashboardStateAnnouncer dashboardState="connecting" />,
    );
    const initial = screen.getByTestId(
      "dashboard-state-announcer",
    ).textContent;
    // Re-render with the same prop — the live region should stay the
    // same (no stutter of the same announcement).
    rerender(<DashboardStateAnnouncer dashboardState="connecting" />);
    const after = screen.getByTestId("dashboard-state-announcer").textContent;
    expect(after).toBe(initial);
    expect(after).toBe("Signer connecting to relays");
  });

  it("exposes the current state via data-dashboard-state for selector convenience", () => {
    render(<DashboardStateAnnouncer dashboardState="relays-offline" />);
    const region = screen.getByTestId("dashboard-state-announcer");
    expect(region.getAttribute("data-dashboard-state")).toBe(
      "relays-offline",
    );
  });

  it("is visually hidden (sr-only) so sighted users are unaffected", () => {
    render(<DashboardStateAnnouncer dashboardState="running" />);
    const region = screen.getByTestId("dashboard-state-announcer");
    // JSDOM returns inline styles via style.* — verify the sr-only
    // clip pattern that keeps the node in the a11y tree but off-screen.
    expect(region.style.position).toBe("absolute");
    expect(region.style.width).toBe("1px");
    expect(region.style.height).toBe("1px");
    expect(region.style.overflow).toBe("hidden");
  });
});
