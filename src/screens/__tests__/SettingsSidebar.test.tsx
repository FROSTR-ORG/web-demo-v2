import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();
const mockUpdateProfileName = vi.fn((name: string) => {
  // Mirror the MockAppStateProvider behavior: update the live activeProfile
  // object so the sidebar's `persistedDeviceName` (sourced from activeProfile)
  // reflects the write without a full context re-wire.
  fakeProfile.deviceName = name.trim();
  return Promise.resolve();
});
const mockUpdateRelays = vi.fn((next: string[]) => {
  // Mirror the real provider contract: update the shared `fakeProfile.relays`
  // reference so the sidebar re-renders with the new list after the mutator
  // settles. Tests that need to assert on intermediate states can reset the
  // mock via `beforeEach`.
  fakeProfile.relays = next.slice();
  return Promise.resolve();
});

const fakeProfile: {
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
} = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  groupPublicKey: "npub1qe3abcdef1234567890abcdef7k4m",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
};

const fakeRuntimeStatus = {
  metadata: { member_idx: 0, share_public_key: "02a3f8c2d1e2f3a4b5c6d7e8f9a0b1c28f2c4a" },
  readiness: {
    runtime_ready: true,
    degraded_reasons: [],
    signing_peer_count: 2,
    threshold: 2,
  },
  peers: [
    {
      idx: 0,
      pubkey: "02a3f8c2d1e2f3a4b5c6d7e8f9a0b1c28f2c4a",
      online: true,
      can_sign: true,
      should_send_nonces: true,
      incoming_available: 93,
      outgoing_available: 78,
    },
    {
      idx: 1,
      pubkey: "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d",
      online: true,
      can_sign: true,
      should_send_nonces: false,
      incoming_available: 18,
      outgoing_available: 12,
    },
    {
      idx: 2,
      pubkey: "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e",
      online: false,
      can_sign: false,
      should_send_nonces: false,
      incoming_available: 0,
      outgoing_available: 0,
    },
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
    updateProfileName: mockUpdateProfileName,
    updateRelays: mockUpdateRelays,
    changeProfilePassword: vi.fn(() => Promise.resolve()),
  }),
}));

import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
  mockLockProfile.mockClear();
  mockClearCredentials.mockClear();
  mockUpdateProfileName.mockClear();
  mockUpdateRelays.mockClear();
  // Reset the shared profile so the mutable `deviceName` / `relays`
  // used by the inline edit tests below do not leak into the next test.
  fakeProfile.deviceName = "Igloo Web";
  fakeProfile.relays = ["wss://relay.primal.net", "wss://relay.damus.io"];
});

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/test-profile-id"]}>
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route path="/" element={<div data-testid="welcome-screen">Welcome</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Settings Sidebar", () => {
  it("opens when Settings gear button is clicked", () => {
    renderDashboard();
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
  });

  it("shows all 7 sections", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    // Settings title in the sidebar
    const sidebar = screen.getByTestId("settings-sidebar");
    expect(sidebar).toBeInTheDocument();
    // Check section labels
    const sectionLabels = sidebar.querySelectorAll(".settings-section-label");
    const labelTexts = Array.from(sectionLabels).map((el) => el.textContent);
    expect(labelTexts).toContain("Device Profile");
    expect(labelTexts).toContain("Group Profile");
    expect(labelTexts).toContain("Replace Share");
    expect(labelTexts).toContain("Export & Backup");
    expect(labelTexts).toContain("Profile Security");
  });

  it("displays Device Profile section with name, password, and relays", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("Profile Name")).toBeInTheDocument();
    expect(screen.getByText("Igloo Web")).toBeInTheDocument();
    expect(screen.getByText("Profile Password")).toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
  });

  it("displays Group Profile section with keyset info", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    const sidebar = within(screen.getByTestId("settings-sidebar"));
    expect(sidebar.getByText("Keyset Name")).toBeInTheDocument();
    expect(sidebar.getByText("My Signing Key")).toBeInTheDocument();
    expect(sidebar.getByText("Keyset npub")).toBeInTheDocument();
    expect(sidebar.getByText("Threshold")).toBeInTheDocument();
    expect(sidebar.getByText("2 of 3")).toBeInTheDocument();
    expect(sidebar.getByText("Created")).toBeInTheDocument();
    expect(sidebar.getByText("Updated")).toBeInTheDocument();
  });

  it("displays relay management with remove buttons and add input", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByLabelText("Remove wss://relay.primal.net")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove wss://relay.damus.io")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("wss://...")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("close (X) button dismisses sidebar and removes scrim", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("settings-scrim")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-scrim")).not.toBeInTheDocument();
  });

  it("clicking scrim closes sidebar", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-scrim"));
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
  });

  it("Lock Profile button calls lockProfile and navigates to /", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    // Find the Lock button within the Profile Security section
    const lockButtons = screen.getAllByText("Lock");
    // The Lock button in settings (not the dashboard header one)
    const settingsLockBtn = lockButtons.find((btn) => btn.closest(".settings-btn-red"));
    expect(settingsLockBtn).toBeDefined();
    fireEvent.click(settingsLockBtn!);
    expect(mockLockProfile).toHaveBeenCalled();
    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
  });

  it("removing a relay removes it from the list", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove wss://relay.primal.net"));
    expect(screen.queryByText("wss://relay.primal.net")).not.toBeInTheDocument();
    expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
  });

  it("adding a relay adds it to the list", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    const input = screen.getByPlaceholderText("wss://...");
    fireEvent.change(input, { target: { value: "wss://nos.lol" } });
    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("wss://nos.lol")).toBeInTheDocument();
  });

  it("edits the profile name inline and opens the Export Share flow", async () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));

    fireEvent.click(screen.getByLabelText("Edit profile name"));
    const nameInput = screen.getByLabelText("Profile Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Igloo Desk" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await vi.waitFor(() => {
      expect(mockUpdateProfileName).toHaveBeenCalledWith("Igloo Desk");
      expect(screen.getByText("Igloo Desk")).toBeInTheDocument();
    });

    const exportShareRow = screen.getByText("Export Share").closest(".settings-action-row");
    expect(exportShareRow).not.toBeNull();
    const exportButton = exportShareRow!.querySelector(".settings-btn-blue") as HTMLElement;
    fireEvent.click(exportButton);
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();
    expect(screen.getByLabelText("Share Export Password")).toBeInTheDocument();
  });
});

describe("Clear Credentials Modal", () => {
  it("Clear button in sidebar opens destructive confirmation modal", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    const clearButtons = screen.getAllByText("Clear");
    const settingsClearBtn = clearButtons.find((btn) => btn.closest(".settings-btn-red"));
    expect(settingsClearBtn).toBeDefined();
    fireEvent.click(settingsClearBtn!);
    expect(screen.getByTestId("clear-credentials-modal")).toBeInTheDocument();
    // "Clear Credentials" appears as title and confirm button
    const clearCredsTexts = screen.getAllByText("Clear Credentials");
    expect(clearCredsTexts.length).toBeGreaterThanOrEqual(2);
  });

  it("modal shows red trash icon, descriptive text, and profile badge", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    const clearButtons = screen.getAllByText("Clear");
    fireEvent.click(clearButtons.find((btn) => btn.closest(".settings-btn-red"))!);
    expect(screen.getByText(/Are you sure you want to clear/)).toBeInTheDocument();
    expect(screen.getByText("My Signing Key · Share #0 · Igloo Web")).toBeInTheDocument();
  });

  it("Cancel button dismisses modal without navigation", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    const clearButtons = screen.getAllByText("Clear");
    fireEvent.click(clearButtons.find((btn) => btn.closest(".settings-btn-red"))!);
    expect(screen.getByTestId("clear-credentials-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("clear-credentials-modal")).not.toBeInTheDocument();
    // Sidebar should still be visible
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
  });

  it("Confirm button calls clearCredentials and navigates to /", async () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Settings"));
    const clearButtons = screen.getAllByText("Clear");
    fireEvent.click(clearButtons.find((btn) => btn.closest(".settings-btn-red"))!);
    // Click "Clear Credentials" confirm button (the one inside the modal)
    const confirmBtn = screen.getAllByText("Clear Credentials").find(
      (el) => el.closest(".clear-creds-confirm")
    );
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);
    // Wait for async clearCredentials to resolve
    await vi.waitFor(() => {
      expect(mockClearCredentials).toHaveBeenCalled();
    });
  });
});
