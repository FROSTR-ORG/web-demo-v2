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
    <MemoryRouter initialEntries={["/dashboard/test-profile-id"]}>
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DashboardScreen — Policies view", () => {
  it("clicking Policies header button shows the Policies view", () => {
    renderDashboard();
    const policiesBtn = screen.getByText("Policies");
    fireEvent.click(policiesBtn);
    expect(screen.getByText("Signer Policies")).toBeInTheDocument();
    expect(screen.getByText("Peer Policies")).toBeInTheDocument();
  });

  it("Signer Policies panel shows default policy dropdown and per-method rules", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    expect(screen.getByText("Default policy")).toBeInTheDocument();
    expect(screen.getByText("Ask every time")).toBeInTheDocument();
    expect(screen.getByText("sign_event:1")).toBeInTheDocument();
    expect(screen.getByText("nip44_encrypt")).toBeInTheDocument();
    expect(screen.getByText("get_public_key")).toBeInTheDocument();
  });

  it("Signer Policies panel shows domain labels and permission badges", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    // Domain labels
    const domainLabels = screen.getAllByText("primal.net");
    expect(domainLabels.length).toBeGreaterThanOrEqual(3);
    // Permission badges
    const alwaysBadges = screen.getAllByText("Always");
    expect(alwaysBadges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Allow once")).toBeInTheDocument();
  });

  it("Signer Policies panel shows remove buttons for each rule", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    const removeButtons = screen.getAllByLabelText("Remove rule");
    expect(removeButtons.length).toBe(3);
  });

  it("default policy dropdown changes value and remove buttons delete rules", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));

    fireEvent.click(screen.getByRole("combobox", { name: /default policy/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Deny by default" }));
    expect(screen.getByRole("combobox", { name: /default policy/i })).toHaveTextContent("Deny by default");

    let removeButtons = screen.getAllByLabelText("Remove rule");
    fireEvent.click(removeButtons[0]);
    expect(screen.queryByText("sign_event:1")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Remove rule").length).toBe(2);

    removeButtons = screen.getAllByLabelText("Remove rule");
    fireEvent.click(removeButtons[0]);
    fireEvent.click(screen.getAllByLabelText("Remove rule")[0]);
    expect(screen.queryAllByLabelText("Remove rule").length).toBe(0);
    expect(
      screen.getByText("No explicit signer policies. Default policy applies to new requests.")
    ).toBeInTheDocument();
  });

  it("Peer Policies panel shows per-peer rows with permission badges", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    expect(screen.getByText("Peer #0")).toBeInTheDocument();
    expect(screen.getByText("Peer #1")).toBeInTheDocument();
    expect(screen.getByText("Peer #2")).toBeInTheDocument();
  });

  it("Peer Policies panel shows SIGN/ECDH/PING/ONBOARD badges for each peer", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    // Each peer row has 4 badges: SIGN, ECDH, PING, ONBOARD
    const signBadges = screen.getAllByText("SIGN");
    expect(signBadges.length).toBe(3);
    const ecdhBadges = screen.getAllByText("ECDH");
    expect(ecdhBadges.length).toBe(3);
    const pingBadges = screen.getAllByText("PING");
    expect(pingBadges.length).toBe(3);
    const onboardBadges = screen.getAllByText("ONBOARD");
    expect(onboardBadges.length).toBe(3);
  });

  it("summary bar persists in Policies view", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
  });

  it("clicking Policies button again returns to main dashboard view", () => {
    renderDashboard();
    // Open policies
    fireEvent.click(screen.getByText("Policies"));
    expect(screen.getByText("Signer Policies")).toBeInTheDocument();
    // Click again to close
    fireEvent.click(screen.getByText("Policies"));
    // Now should be back to running state
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    expect(screen.queryByText("Signer Policies")).not.toBeInTheDocument();
  });
});
