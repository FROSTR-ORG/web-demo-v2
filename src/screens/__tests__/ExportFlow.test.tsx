import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();
const mockExportRuntimePackages = vi.fn(async () => ({
  profilePackage: "bfprofile1realprofile",
  sharePackage: "bfshare1realshare",
  metadata: {
    profileId: "test-profile-id",
    groupName: "My Signing Key",
    deviceName: "Igloo Web",
    shareIdx: 0,
    relayCount: 2,
    peerCount: 3,
  },
}));

const fakeProfile = {
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
    exportRuntimePackages: mockExportRuntimePackages,
  }),
}));

import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
  mockExportRuntimePackages.mockClear();
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

function clickSettingsActionRowExport(label: string) {
  fireEvent.click(screen.getByLabelText("Settings"));
  const settings = screen.getByTestId("settings-sidebar");
  const actionLabel = within(settings).getByText(label);
  const actionRow = actionLabel.closest(".settings-action-row");
  expect(actionRow).not.toBeNull();
  const exportButton = within(actionRow as HTMLElement).getByRole("button", {
    name: "Export",
  });
  fireEvent.click(exportButton);
}

function openSettingsExportProfile() {
  clickSettingsActionRowExport("Export Profile");
  return screen.getByTestId("export-profile-modal");
}

describe("Export Profile Modal", () => {
  it("does not expose Export in the dashboard header", () => {
    renderDashboard();
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
  });

  it("renders title, description, summary, password inputs, strength bar, Cancel and Export buttons", () => {
    renderDashboard();
    const modal = openSettingsExportProfile();
    expect(within(modal).getByText("Export Profile")).toBeInTheDocument();
    expect(within(modal).getByText(/encrypted backup/i)).toBeInTheDocument();
    // Summary line appears both in dashboard bar and modal
    expect(modal.querySelector(".export-modal-summary")?.textContent).toContain("Share #0");
    expect(within(modal).getByLabelText("Export Password")).toBeInTheDocument();
    expect(within(modal).getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(within(modal).getByTestId("password-strength-bar")).toBeInTheDocument();
    expect(within(modal).getByText("Cancel")).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("Cancel button dismisses the modal", () => {
    renderDashboard();
    const modal = openSettingsExportProfile();
    expect(modal).toBeInTheDocument();

    fireEvent.click(within(modal).getByText("Cancel"));
    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
  });

  it("close X button dismisses the modal", () => {
    renderDashboard();
    const modal = openSettingsExportProfile();
    expect(modal).toBeInTheDocument();

    fireEvent.click(within(modal).getByLabelText("Close modal"));
    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
  });

  it("Export button is disabled until passwords match", () => {
    renderDashboard();
    const modal = openSettingsExportProfile();

    const submitBtn = within(modal).getByRole("button", { name: "Export" });
    expect(submitBtn).toBeDisabled();

    // Type matching passwords
    fireEvent.change(within(modal).getByLabelText("Export Password"), { target: { value: "testpass123" } });
    fireEvent.change(within(modal).getByLabelText("Confirm Password"), { target: { value: "testpass123" } });

    expect(submitBtn).not.toBeDisabled();
  });

  it("shows match indicator when passwords match", () => {
    renderDashboard();
    const modal = openSettingsExportProfile();

    fireEvent.change(within(modal).getByLabelText("Export Password"), { target: { value: "test123" } });
    fireEvent.change(within(modal).getByLabelText("Confirm Password"), { target: { value: "test123" } });

    // The matched class should be applied and check icon visible
    const confirmShell = within(modal).getByLabelText("Confirm Password").parentElement;
    expect(confirmShell?.classList.contains("matched")).toBe(true);
  });

  it("Export button transitions to Export Complete modal", async () => {
    renderDashboard();
    const modal = openSettingsExportProfile();

    fireEvent.change(within(modal).getByLabelText("Export Password"), { target: { value: "StrongPass1" } });
    fireEvent.change(within(modal).getByLabelText("Confirm Password"), { target: { value: "StrongPass1" } });

    fireEvent.click(within(modal).getByRole("button", { name: "Export" }));

    await waitFor(() => {
      expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
      expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();
    });
    expect(mockExportRuntimePackages).toHaveBeenCalledWith("StrongPass1");
  });
});

describe("Export Complete Modal", () => {
  async function openExportComplete() {
    renderDashboard();
    // Open export profile
    const modal = openSettingsExportProfile();
    // Fill passwords
    fireEvent.change(within(modal).getByLabelText("Export Password"), { target: { value: "StrongPass1" } });
    fireEvent.change(within(modal).getByLabelText("Confirm Password"), { target: { value: "StrongPass1" } });
    // Submit
    fireEvent.click(within(modal).getByRole("button", { name: "Export" }));
    await screen.findByTestId("export-complete-modal");
  }

  it("renders green checkmark, Backup Ready title, masked backup, Copy, Download, warning, Done", async () => {
    await openExportComplete();

    expect(screen.getByText("Profile Backup Ready")).toBeInTheDocument();
    expect(screen.getByTestId("backup-string")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText(/Store this backup/)).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("backup string starts masked with bullets", async () => {
    await openExportComplete();
    const backupText = screen.getByTestId("backup-string").textContent!;
    expect(backupText).toContain("•");
    expect(backupText.startsWith("bfprofile1")).toBe(true);
  });

  it("reveal toggle shows/hides full backup text", async () => {
    await openExportComplete();

    // Initially masked
    const backupEl = screen.getByTestId("backup-string");
    expect(backupEl.textContent).toContain("•");

    // Click reveal
    fireEvent.click(screen.getByLabelText("Reveal backup string"));
    expect(backupEl.textContent).not.toContain("•");
    expect(backupEl.textContent).toBe("bfprofile1realprofile");

    // Click hide
    fireEvent.click(screen.getByLabelText("Hide backup string"));
    expect(backupEl.textContent).toContain("•");
  });

  it("Done button dismisses modal and returns to dashboard", async () => {
    await openExportComplete();
    expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("export-complete-modal")).not.toBeInTheDocument();
  });

  it("Copy button shows 'Copied!' feedback", async () => {
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });

    await openExportComplete();

    fireEvent.click(screen.getByText("Copy"));
    expect(screen.getByText("Copied!")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("bfprofile1realprofile");
  });
});

describe("Export from Settings Sidebar", () => {
  it("Settings sidebar Export button opens Export Profile modal", () => {
    renderDashboard();

    // Open settings sidebar
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();

    // Click the Export button inside the sidebar
    const sidebar = screen.getByTestId("settings-sidebar");
    const [exportBtn] = within(sidebar).getAllByRole("button", {
      name: "Export",
    });
    fireEvent.click(exportBtn);

    // VAL-DSH-031: Settings sidebar stays open while the Export Profile
    // and Export Complete modals are shown; the modal layer (z-index 200)
    // renders above the sidebar (z-index 101). Clicking Done on the
    // Backup Ready modal returns the user to the same sidebar rows.
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();
  });

  it("Settings sidebar Export Share opens share export mode and produces bfshare", async () => {
    renderDashboard();
    clickSettingsActionRowExport("Export Share");

    const modal = screen.getByTestId("export-profile-modal");
    expect(modal).toBeInTheDocument();
    expect(screen.getAllByText("Export Share").length).toBeGreaterThanOrEqual(2);
    expect(within(modal).getByLabelText("Share Export Password")).toBeInTheDocument();

    fireEvent.change(within(modal).getByLabelText("Share Export Password"), { target: { value: "StrongPass1" } });
    fireEvent.change(within(modal).getByLabelText("Confirm Password"), { target: { value: "StrongPass1" } });
    fireEvent.click(within(modal).getByRole("button", { name: "Export" }));

    await screen.findByTestId("export-complete-modal");
    expect(screen.getByText("Share Package Ready")).toBeInTheDocument();
    const backupEl = screen.getByTestId("backup-string");
    expect(backupEl.textContent).toBe(`bfshare1${"•".repeat(28)}`);
    fireEvent.click(screen.getByLabelText("Reveal backup string"));
    expect(backupEl.textContent).toBe("bfshare1realshare");
  });
});
