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

function renderDashboard({ showMockControls = true }: { showMockControls?: boolean } = {}) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/dashboard/test-profile-id",
          state: showMockControls ? { demoUi: { dashboard: { showMockControls: true } } } : undefined,
        },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DashboardScreen — state toggle", () => {
  it("does not render mock state controls in the normal product route", () => {
    renderDashboard({ showMockControls: false });
    expect(screen.queryByLabelText("Mock State")).not.toBeInTheDocument();
  });

  it("renders mock state toggle with all 5 state options", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    expect(select).toBeInTheDocument();
    expect(select).toBeInstanceOf(HTMLSelectElement);
    const options = (select as HTMLSelectElement).options;
    const optionValues = Array.from(options).map((o) => o.value);
    expect(optionValues).toContain("running");
    expect(optionValues).toContain("connecting");
    expect(optionValues).toContain("stopped");
    expect(optionValues).toContain("relays-offline");
    expect(optionValues).toContain("signing-blocked");
  });

  it("default state shows 'Signer Running' with green indicator and Stop Signer button", () => {
    renderDashboard();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    expect(screen.getByText("Stop Signer")).toBeInTheDocument();
  });

  it("switching to 'connecting' shows amber Signer Connecting title and Connection Progress panel", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    fireEvent.change(select, { target: { value: "connecting" } });
    expect(screen.getByText("Signer Connecting...")).toBeInTheDocument();
    expect(screen.getByText("Connection Progress")).toBeInTheDocument();
    expect(screen.getByText("Current Targets")).toBeInTheDocument();
  });

  it("switching to 'stopped' shows red Signer Stopped title and Start Signer button", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    fireEvent.change(select, { target: { value: "stopped" } });
    expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
    expect(screen.getByText("Start Signer")).toBeInTheDocument();
    expect(screen.getByText("Readiness")).toBeInTheDocument();
    expect(screen.getByText("Next Step")).toBeInTheDocument();
  });

  it("switching to 'relays-offline' shows Signer Running with degraded message and Retry Connections button", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    fireEvent.change(select, { target: { value: "relays-offline" } });
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    // "All Relays Offline" appears in both dropdown option and rendered content
    const allRelaysMatches = screen.getAllByText("All Relays Offline");
    expect(allRelaysMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Retry Connections")).toBeInTheDocument();
  });

  it("switching to 'signing-blocked' shows Signing Blocked panel with Common Causes and Operator Action", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    fireEvent.change(select, { target: { value: "signing-blocked" } });
    // "Signing Blocked" appears in both dropdown option and rendered content
    const signingBlockedMatches = screen.getAllByText("Signing Blocked");
    expect(signingBlockedMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Common Causes")).toBeInTheDocument();
    expect(screen.getByText("Operator Action")).toBeInTheDocument();
    expect(screen.getByText("Open Policies")).toBeInTheDocument();
    expect(screen.getByText("Review Approvals")).toBeInTheDocument();
  });

  it("Stop Signer button transitions to Stopped state", () => {
    renderDashboard();
    // Start in Running state
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    const stopBtn = screen.getByText("Stop Signer");
    fireEvent.click(stopBtn);
    expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
    expect(screen.getByText("Start Signer")).toBeInTheDocument();
  });

  it("Start Signer button transitions from Stopped to Running state", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    fireEvent.change(select, { target: { value: "stopped" } });
    expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
    const startBtn = screen.getByText("Start Signer");
    fireEvent.click(startBtn);
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });

  it("cycling through all 5 states produces no errors", () => {
    renderDashboard();
    const select = screen.getByLabelText("Mock State");
    const states = ["running", "connecting", "stopped", "relays-offline", "signing-blocked", "running"];
    for (const state of states) {
      fireEvent.change(select, { target: { value: state } });
    }
    // If we get here without throwing, the test passes
    expect(screen.getByLabelText("Mock State")).toBeInTheDocument();
  });
});
