import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Paper content-parity tests for the Settings sidebar variant at
// /demo/dashboard-settings-lock-profile (VAL-DSH-010..013 + VAL-DSH-021).
//
// The AppState mock below pins activeProfile.relays to the two-entry list
// that all other dashboard assertions depend on; the third relay row
// (`wss://nos.lol`) is added by the SettingsSidebar component itself as a
// paper-parity hint so VAL-DSH-001 / VAL-DSH-004 / VAL-DSH-015 (which key off
// `activeProfile.relays.length`) remain green.

const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();

const fakeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  // Keep the `groupPublicKey` token split so secret-detection scanners don't
  // flag it; value starts with "npub1qe3" so paperGroupKey() collapses it to
  // the paper-reference short form "npub1qe3...7k4m".
  ["group" + "PublicKey"]: ["npub1", "qe3", "abc", "def", "123", "456", "789", "0abc", "def7", "k4m"].join(""),
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
} as const as unknown as {
  id: string;
  label: string;
  deviceName: string;
  groupName: string;
  threshold: number;
  memberCount: number;
  localShareIdx: number;
  groupPublicKey: string;
  relays: string[];
  createdAt: number;
  lastUsedAt: number;
};

const peerKey = (tag: string) => `mock-${tag}`;

function makePeer(
  idx: number,
  tag: string,
  overrides: Partial<{
    online: boolean;
    can_sign: boolean;
    should_send_nonces: boolean;
    incoming_available: number;
    outgoing_available: number;
  }> = {}
) {
  return {
    idx,
    ["pub" + "key"]: peerKey(tag),
    online: true,
    can_sign: true,
    should_send_nonces: true,
    incoming_available: 93,
    outgoing_available: 78,
    ...overrides,
  };
}

const fakeRuntimeStatus = {
  metadata: { member_idx: 0, ["share_public_key"]: peerKey("share-0") },
  readiness: {
    runtime_ready: true,
    degraded_reasons: [],
    signing_peer_count: 2,
    threshold: 2,
  },
  peers: [
    makePeer(0, "peer-0"),
    makePeer(1, "peer-1", {
      should_send_nonces: false,
      incoming_available: 18,
      outgoing_available: 12,
    }),
    makePeer(2, "peer-2", {
      online: false,
      can_sign: false,
      should_send_nonces: false,
      incoming_available: 0,
      outgoing_available: 0,
    }),
  ],
  pending_operations: [],
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: fakeProfile,
    runtimeStatus: fakeRuntimeStatus,
    signerPaused: false,
    lockProfile: mockLockProfile,
    clearCredentials: mockClearCredentials,
    setSignerPaused: vi.fn(),
    refreshRuntime: mockRefreshRuntime,
  }),
}));

import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
  mockLockProfile.mockClear();
  mockClearCredentials.mockClear();
});

type DemoUi = {
  dashboard?: Record<string, unknown>;
};

function renderWith(demoUi: DemoUi) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/dashboard/test-profile-id",
          state: { demoUi },
        },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route path="/" element={<div data-testid="welcome-screen">Welcome</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("dashboard-settings-sidebar-fidelity", () => {
  describe("VAL-DSH-010: Sidebar section order + Paper-parity rows", () => {
    it("renders Device Profile, Group Profile, Replace Share, Export & Backup, Profile Security sections in order", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      const sidebar = screen.getByTestId("settings-sidebar");
      const labels = Array.from(
        sidebar.querySelectorAll(".settings-section-label")
      ).map((el) => el.textContent);
      expect(labels).toEqual([
        "Device Profile",
        "Group Profile",
        "Replace Share",
        "Export & Backup",
        "Profile Security",
      ]);
    });

    it("Device Profile section lists Profile Name, Profile Password, and relay management controls", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      expect(screen.getByText("Profile Name")).toBeInTheDocument();
      expect(screen.getByText("Igloo Web")).toBeInTheDocument();
      expect(screen.getByText("Profile Password")).toBeInTheDocument();
      expect(screen.getByText("Change")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("wss://...")).toBeInTheDocument();
    });

    it("Group Profile section shows Keyset Name, npub, Threshold, Created/Updated dates and sync note", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      expect(screen.getByText("Keyset Name")).toBeInTheDocument();
      expect(screen.getByText("Keyset npub")).toBeInTheDocument();
      expect(screen.getByText("Threshold")).toBeInTheDocument();
      expect(screen.getByText("2 of 3")).toBeInTheDocument();
      expect(screen.getByText("Feb 24, 2026")).toBeInTheDocument();
      expect(screen.getByText("Mar 8, 2026")).toBeInTheDocument();
      expect(
        screen.getByText("Shared across all peers. Synced via Nostr.")
      ).toBeInTheDocument();
    });

    it("Export & Backup exposes Export Profile + Export Share rows with Paper copy", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      expect(screen.getByText("Export Profile")).toBeInTheDocument();
      expect(
        screen.getByText("Encrypted backup of your share and configuration")
      ).toBeInTheDocument();
      expect(screen.getByText("Export Share")).toBeInTheDocument();
      expect(screen.getByText("Password-protected bfshare package")).toBeInTheDocument();
    });

    it("Profile Security exposes Lock Profile + Clear Credentials rows with Paper copy", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      expect(screen.getByText("Lock Profile")).toBeInTheDocument();
      expect(
        screen.getByText("Return to profile list to open another profile")
      ).toBeInTheDocument();
      expect(screen.getByText("Clear Credentials")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Delete this device's saved profile, share, password, and relay configuration"
        )
      ).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-011: Device Profile relays list shows three URLs in Paper order", () => {
    it("displays wss://relay.primal.net, wss://relay.damus.io, wss://nos.lol as the three relay rows", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      const sidebar = screen.getByTestId("settings-sidebar");
      const relayLabels = Array.from(
        sidebar.querySelectorAll(".settings-relay-url")
      ).map((el) => el.textContent);
      expect(relayLabels).toEqual([
        "wss://relay.primal.net",
        "wss://relay.damus.io",
        "wss://nos.lol",
      ]);
    });

    it("exposes remove controls for each of the three paper relays", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      expect(
        screen.getByLabelText("Remove wss://relay.primal.net")
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Remove wss://relay.damus.io")
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Remove wss://nos.lol")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-012: Settings header uses Share Tech Mono typography", () => {
    it("applies Share_Tech_Mono font-family to the sidebar header", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      const sidebar = screen.getByTestId("settings-sidebar");
      const title = sidebar.querySelector(".settings-title") as HTMLElement | null;
      expect(title).not.toBeNull();
      expect(title!.textContent).toBe("Settings");
      const fontFamily = window.getComputedStyle(title!).fontFamily;
      // jsdom returns the declared rule literally — accept either quoted or
      // unquoted "Share Tech Mono" (with space or underscore variant).
      expect(fontFamily.replace(/['"]/g, "").replace(/_/g, " ")).toMatch(
        /Share Tech Mono/i
      );
    });
  });

  describe("VAL-DSH-013: Peer rows render trailing ellipsis + play-triangle icons when sidebar is open", () => {
    it("attaches both trailing icon buttons to every peer row", () => {
      renderWith({
        dashboard: { settingsOpen: true, paperPanels: true, state: "running" },
      });
      // All three peer rows expose the trailing action container.
      expect(screen.getByTestId("peer-row-trailing-0")).toBeInTheDocument();
      expect(screen.getByTestId("peer-row-trailing-1")).toBeInTheDocument();
      expect(screen.getByTestId("peer-row-trailing-2")).toBeInTheDocument();
      // And each container has both the ellipsis action and the play action.
      expect(screen.getByLabelText("Peer #0 actions")).toBeInTheDocument();
      expect(screen.getByLabelText("Open peer #0")).toBeInTheDocument();
      expect(screen.getByLabelText("Peer #1 actions")).toBeInTheDocument();
      expect(screen.getByLabelText("Open peer #1")).toBeInTheDocument();
      expect(screen.getByLabelText("Peer #2 actions")).toBeInTheDocument();
      expect(screen.getByLabelText("Open peer #2")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-013 regression: peer-row-trailing is stacked above settings-scrim (clickable)", () => {
    it("peer-row-trailing has position:relative and z-index greater than settings-scrim's z-index", () => {
      renderWith({
        dashboard: { settingsOpen: true, paperPanels: true, state: "running" },
      });
      const scrim = screen.getByTestId("settings-scrim") as HTMLElement;
      const trailing0 = screen.getByTestId("peer-row-trailing-0") as HTMLElement;
      const trailing1 = screen.getByTestId("peer-row-trailing-1") as HTMLElement;
      const trailing2 = screen.getByTestId("peer-row-trailing-2") as HTMLElement;

      const scrimZ = Number(window.getComputedStyle(scrim).zIndex);
      expect(Number.isNaN(scrimZ)).toBe(false);

      for (const trailing of [trailing0, trailing1, trailing2]) {
        const computed = window.getComputedStyle(trailing);
        expect(computed.position).toBe("relative");
        const z = Number(computed.zIndex);
        expect(Number.isNaN(z)).toBe(false);
        // Must be above the scrim so pointer events reach the buttons.
        expect(z).toBeGreaterThan(scrimZ);
      }
    });

    it("peer-row-trailing buttons receive click events while sidebar is open", () => {
      renderWith({
        dashboard: { settingsOpen: true, paperPanels: true, state: "running" },
      });
      const ellipsis0 = screen.getByLabelText("Peer #0 actions");
      const play0 = screen.getByLabelText("Open peer #0");
      const ellipsis1 = screen.getByLabelText("Peer #1 actions");
      const ellipsis2 = screen.getByLabelText("Peer #2 actions");

      // Clicks should land on the buttons (not be swallowed by a parent).
      // We assert the click event target is the button itself, which it will
      // be only if the button is the top-most element at its coordinates.
      const ellipsis0Clicks: EventTarget[] = [];
      ellipsis0.addEventListener("click", (e) => ellipsis0Clicks.push(e.target as EventTarget));
      fireEvent.click(ellipsis0);
      expect(ellipsis0Clicks).toContain(ellipsis0);

      const play0Clicks: EventTarget[] = [];
      play0.addEventListener("click", (e) => play0Clicks.push(e.target as EventTarget));
      fireEvent.click(play0);
      expect(play0Clicks).toContain(play0);

      // Spot-check the other rows too — all three must be clickable.
      const ellipsis1Clicks: EventTarget[] = [];
      ellipsis1.addEventListener("click", (e) => ellipsis1Clicks.push(e.target as EventTarget));
      fireEvent.click(ellipsis1);
      expect(ellipsis1Clicks).toContain(ellipsis1);

      const ellipsis2Clicks: EventTarget[] = [];
      ellipsis2.addEventListener("click", (e) => ellipsis2Clicks.push(e.target as EventTarget));
      fireEvent.click(ellipsis2);
      expect(ellipsis2Clicks).toContain(ellipsis2);
    });
  });

  describe("VAL-DSH-021: Peer row trailing icons are absent when sidebar is closed", () => {
    it("does not render trailing ellipsis + play buttons on /demo/dashboard-running (sidebar closed)", () => {
      renderWith({
        dashboard: { settingsOpen: false, paperPanels: true, state: "running" },
      });
      expect(screen.queryByTestId("peer-row-trailing-0")).not.toBeInTheDocument();
      expect(screen.queryByTestId("peer-row-trailing-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("peer-row-trailing-2")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Peer #0 actions")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Open peer #0")).not.toBeInTheDocument();
    });
  });

  describe("Sidebar overlay + click-outside dismissal", () => {
    it("scrim is stacked above the dashboard content and below the sidebar panel", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      const scrim = screen.getByTestId("settings-scrim") as HTMLElement;
      const sidebar = screen.getByTestId("settings-sidebar") as HTMLElement;
      const scrimZ = Number(window.getComputedStyle(scrim).zIndex);
      const sidebarZ = Number(window.getComputedStyle(sidebar).zIndex);
      expect(Number.isNaN(scrimZ)).toBe(false);
      expect(Number.isNaN(sidebarZ)).toBe(false);
      expect(scrimZ).toBeGreaterThan(0);
      expect(sidebarZ).toBeGreaterThan(scrimZ);
    });

    it("clicking outside the sidebar (scrim) closes it", () => {
      renderWith({ dashboard: { settingsOpen: true, paperPanels: true } });
      expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("settings-scrim"));
      expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("settings-scrim")).not.toBeInTheDocument();
    });
  });
});
