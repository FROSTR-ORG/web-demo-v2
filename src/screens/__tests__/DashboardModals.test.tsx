import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock AppState so we can provide a controlled activeProfile and runtimeStatus.
const mockLockProfile = vi.fn();
const mockSetSignerPaused = vi.fn();
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
    setSignerPaused: mockSetSignerPaused,
    refreshRuntime: mockRefreshRuntime,
  }),
}));

// Must import DashboardScreen after mock is set up
import { DashboardScreen } from "../DashboardScreen";

afterEach(cleanup);

function renderDashboard() {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/dashboard/test-profile-id",
          state: { demoUi: { dashboard: { showMockControls: true } } },
        },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DashboardScreen — Signer Policy Prompt Modal", () => {
  it("opens Policy Prompt modal when trigger button is clicked", () => {
    renderDashboard();
    const triggerBtn = screen.getByLabelText("Open Policy Prompt");
    fireEvent.click(triggerBtn);
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders all key elements: title, request badge, peer info, details table, expiration, 6 action buttons", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    const dialog = screen.getByRole("dialog");
    // Title
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    // Subtitle
    expect(screen.getByText("A peer is requesting permission to sign on your behalf")).toBeInTheDocument();
    // Request badge - use getAllByText since SIGN also appears in peer badges
    const signElements = screen.getAllByText("SIGN");
    expect(signElements.length).toBeGreaterThanOrEqual(1);
    // Peer info
    expect(screen.getByText("from Peer #2")).toBeInTheDocument();
    // Details table
    expect(screen.getByText("EVENT KIND")).toBeInTheDocument();
    expect(screen.getByText("CONTENT")).toBeInTheDocument();
    expect(screen.getByText("PUBKEY")).toBeInTheDocument();
    expect(screen.getByText("DOMAIN")).toBeInTheDocument();
    // Detail values
    expect(screen.getByText("kind:1 (Short Text Note)")).toBeInTheDocument();
    // Expiration timer
    expect(screen.getByText("Expires in 42s")).toBeInTheDocument();
    // 6 action buttons
    expect(screen.getByText("Deny")).toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Always allow")).toBeInTheDocument();
    expect(screen.getByText("Always for kind:1")).toBeInTheDocument();
    expect(screen.getByText("Always deny for kind:1")).toBeInTheDocument();
    expect(screen.getByText("Always deny for primal.net")).toBeInTheDocument();
    // Confirm dialog is present
    expect(dialog).toBeInTheDocument();
  });

  it("dismisses modal when Close (X) button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const closeBtn = screen.getByLabelText("Close modal");
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when Deny button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    fireEvent.click(screen.getByText("Deny"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when Allow once button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    fireEvent.click(screen.getByText("Allow once"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when Always allow button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    fireEvent.click(screen.getByText("Always allow"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when Always deny for kind:1 is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    fireEvent.click(screen.getByText("Always deny for kind:1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when backdrop is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("DashboardScreen — Signing Failed Modal", () => {
  it("opens Signing Failed modal when trigger button is clicked", () => {
    renderDashboard();
    const triggerBtn = screen.getByLabelText("Open Signing Failed");
    fireEvent.click(triggerBtn);
    // Both the trigger button and the modal title say "Signing Failed"
    const signingFailedElements = screen.getAllByText("Signing Failed");
    expect(signingFailedElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders all key elements: error icon area, title, description, code box, Dismiss, Retry", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Signing Failed"));
    // Title — modal title h2 should exist
    const titleEl = screen.getByRole("heading", { name: "Signing Failed" });
    expect(titleEl).toBeInTheDocument();
    // Description
    expect(screen.getByText("Unable to complete signature for event kind:1. All 3 retry attempts exhausted.")).toBeInTheDocument();
    // Code box
    expect(screen.getByText("Round: r-0x4f2a · Peers responded: 1/2 · Error: insufficient partial signatures")).toBeInTheDocument();
    // Buttons
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("dismisses modal when Close (X) button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Signing Failed"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const closeBtn = screen.getByLabelText("Close modal");
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when Dismiss button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Signing Failed"));
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when Retry button is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Signing Failed"));
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses modal when backdrop is clicked", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Open Signing Failed"));
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("DashboardScreen — Modal triggers visible and working", () => {
  it("renders Policy Prompt and Signing Failed trigger buttons", () => {
    renderDashboard();
    expect(screen.getByLabelText("Open Policy Prompt")).toBeInTheDocument();
    expect(screen.getByLabelText("Open Signing Failed")).toBeInTheDocument();
  });

  it("opening and closing both modals in sequence produces no errors", () => {
    renderDashboard();
    // Open and close Policy Prompt
    fireEvent.click(screen.getByLabelText("Open Policy Prompt"));
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Deny"));
    expect(screen.queryByRole("heading", { name: "Signer Policy" })).not.toBeInTheDocument();
    // Open and close Signing Failed
    fireEvent.click(screen.getByLabelText("Open Signing Failed"));
    // Modal title heading appears
    expect(screen.getByRole("heading", { name: "Signing Failed" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("heading", { name: "Signing Failed" })).not.toBeInTheDocument();
  });
});
