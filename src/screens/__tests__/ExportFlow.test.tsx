import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  }),
}));

import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
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

describe("Export Profile Modal", () => {
  it("opens when header Export button is clicked", () => {
    renderDashboard();
    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
    // Find the Export button in the header
    const exportButtons = screen.getAllByText("Export");
    fireEvent.click(exportButtons[0]);
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();
  });

  it("renders title, description, summary, password inputs, strength bar, Cancel and Export buttons", () => {
    renderDashboard();
    fireEvent.click(screen.getAllByText("Export")[0]);

    expect(screen.getByText("Export Profile")).toBeInTheDocument();
    expect(screen.getByText(/encrypted backup/i)).toBeInTheDocument();
    // Summary line appears both in dashboard bar and modal
    const modal = screen.getByTestId("export-profile-modal");
    expect(modal.querySelector(".export-modal-summary")?.textContent).toContain("Share #0");
    expect(screen.getByLabelText("Export Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByTestId("password-strength-bar")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    // The Export submit button
    const exportBtns = screen.getAllByText("Export");
    expect(exportBtns.length).toBeGreaterThanOrEqual(2); // header + modal
  });

  it("Cancel button dismisses the modal", () => {
    renderDashboard();
    fireEvent.click(screen.getAllByText("Export")[0]);
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
  });

  it("close X button dismisses the modal", () => {
    renderDashboard();
    fireEvent.click(screen.getAllByText("Export")[0]);
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close modal"));
    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
  });

  it("Export button is disabled until passwords match", () => {
    renderDashboard();
    fireEvent.click(screen.getAllByText("Export")[0]);

    // Find the submit Export button inside the modal
    const modalExportBtns = screen.getByTestId("export-profile-modal").querySelectorAll("button");
    const submitBtn = Array.from(modalExportBtns).find((btn) => btn.textContent === "Export");
    expect(submitBtn).toBeTruthy();
    expect(submitBtn!.hasAttribute("disabled")).toBe(true);

    // Type matching passwords
    fireEvent.change(screen.getByLabelText("Export Password"), { target: { value: "testpass123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "testpass123" } });

    expect(submitBtn!.hasAttribute("disabled")).toBe(false);
  });

  it("shows match indicator when passwords match", () => {
    renderDashboard();
    fireEvent.click(screen.getAllByText("Export")[0]);

    fireEvent.change(screen.getByLabelText("Export Password"), { target: { value: "test123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "test123" } });

    // The matched class should be applied and check icon visible
    const confirmShell = screen.getByLabelText("Confirm Password").parentElement;
    expect(confirmShell?.classList.contains("matched")).toBe(true);
  });

  it("Export button transitions to Export Complete modal", () => {
    renderDashboard();
    fireEvent.click(screen.getAllByText("Export")[0]);

    fireEvent.change(screen.getByLabelText("Export Password"), { target: { value: "StrongPass1" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "StrongPass1" } });

    // Click submit Export
    const modalExportBtns = screen.getByTestId("export-profile-modal").querySelectorAll("button");
    const submitBtn = Array.from(modalExportBtns).find((btn) => btn.textContent === "Export");
    fireEvent.click(submitBtn!);

    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();
  });
});

describe("Export Complete Modal", () => {
  function openExportComplete() {
    renderDashboard();
    // Open export profile
    fireEvent.click(screen.getAllByText("Export")[0]);
    // Fill passwords
    fireEvent.change(screen.getByLabelText("Export Password"), { target: { value: "StrongPass1" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "StrongPass1" } });
    // Submit
    const modalExportBtns = screen.getByTestId("export-profile-modal").querySelectorAll("button");
    const submitBtn = Array.from(modalExportBtns).find((btn) => btn.textContent === "Export");
    fireEvent.click(submitBtn!);
  }

  it("renders green checkmark, Backup Ready title, masked backup, Copy, Download, warning, Done", () => {
    openExportComplete();

    expect(screen.getByText("Backup Ready")).toBeInTheDocument();
    expect(screen.getByTestId("backup-string")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText(/Store this backup/)).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("backup string starts masked with bullets", () => {
    openExportComplete();
    const backupText = screen.getByTestId("backup-string").textContent!;
    expect(backupText).toContain("•");
    expect(backupText.startsWith("bfprofile1")).toBe(true);
  });

  it("reveal toggle shows/hides full backup text", () => {
    openExportComplete();

    // Initially masked
    const backupEl = screen.getByTestId("backup-string");
    expect(backupEl.textContent).toContain("•");

    // Click reveal
    fireEvent.click(screen.getByLabelText("Reveal backup string"));
    expect(backupEl.textContent).not.toContain("•");

    // Click hide
    fireEvent.click(screen.getByLabelText("Hide backup string"));
    expect(backupEl.textContent).toContain("•");
  });

  it("Done button dismisses modal and returns to dashboard", () => {
    openExportComplete();
    expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("export-complete-modal")).not.toBeInTheDocument();
  });

  it("Copy button shows 'Copied!' feedback", () => {
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });

    openExportComplete();

    fireEvent.click(screen.getByText("Copy"));
    expect(screen.getByText("Copied!")).toBeInTheDocument();
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
    const sidebarExportBtn = sidebar.querySelector(".settings-btn-blue");
    expect(sidebarExportBtn).toBeTruthy();
    // The first .settings-btn-blue might be Rotate Share; find the Export one
    const sidebarButtons = sidebar.querySelectorAll(".settings-btn-blue");
    const exportBtn = Array.from(sidebarButtons).find((btn) => btn.textContent === "Export");
    expect(exportBtn).toBeTruthy();
    fireEvent.click(exportBtn!);

    // VAL-DSH-031: Settings sidebar stays open while the Export Profile
    // and Export Complete modals are shown; the modal layer (z-index 200)
    // renders above the sidebar (z-index 101). Clicking Done on the
    // Backup Ready modal returns the user to the same sidebar rows.
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();
  });
});
