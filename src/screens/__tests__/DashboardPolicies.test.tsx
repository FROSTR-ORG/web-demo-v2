import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PolicyOverrideEntry } from "../../app/AppStateTypes";

// Mock AppState so we can provide a controlled activeProfile and runtimeStatus.
const mockLockProfile = vi.fn();
const mockSetSignerPaused = vi.fn();
const mockRefreshRuntime = vi.fn();
const mockRemovePolicyOverride = vi.fn(async () => undefined);
const mockSetPeerPolicyOverride = vi.fn(async () => undefined);

// Seeded active peer-policy overrides that drive the Signer Policies
// rule list under the new m3-signer-policies-crud wiring — rows are
// derived from `policyOverrides` (direction=respond for the reactive
// prompt flow), not from the legacy MOCK_SIGNER_RULES fixture.
const peerZeroPubkey =
  "a3f8c2d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f78f2c";
const peerOnePubkey =
  "d7e1b9f3a4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c93b9e";
const peerTwoPubkey =
  "9c4a8e2f3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c1f5e";

const seededPolicyOverrides: PolicyOverrideEntry[] = [
  {
    peer: peerZeroPubkey,
    direction: "respond",
    method: "sign",
    value: "allow",
    source: "persistent",
    createdAt: 3000,
  },
  {
    peer: peerOnePubkey,
    direction: "respond",
    method: "ecdh",
    value: "allow",
    source: "session",
    createdAt: 2000,
  },
  {
    peer: peerTwoPubkey,
    direction: "respond",
    method: "sign",
    value: "deny",
    source: "persistent",
    createdAt: 1000,
  },
];

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
    policyOverrides: seededPolicyOverrides,
    removePolicyOverride: mockRemovePolicyOverride,
    setPeerPolicyOverride: mockSetPeerPolicyOverride,
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

  it("Signer Policies panel shows default policy dropdown and a rule row per active override (VAL-POLICIES-014 read leg)", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    expect(screen.getByText("Default policy")).toBeInTheDocument();
    expect(screen.getByText("Ask every time")).toBeInTheDocument();
    // One rule row per policyOverrides entry — no more
    // MOCK_SIGNER_RULES rows (sign_event:1 / nip44_encrypt / get_public_key).
    const rows = screen.getAllByTestId("policy-override-row");
    expect(rows).toHaveLength(seededPolicyOverrides.length);
    expect(screen.queryByText("sign_event:1")).not.toBeInTheDocument();
    expect(screen.queryByText("nip44_encrypt")).not.toBeInTheDocument();
    expect(screen.queryByText("get_public_key")).not.toBeInTheDocument();
  });

  it("Signer Policies panel shows method labels, peer shortHex, and decision pills per override", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    // Persistent allow → "Always", session allow → "Allow once",
    // persistent deny → "Deny" (VAL-POLICIES-014 pill mapping).
    expect(screen.getByText("Always")).toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
    // Methods rendered uppercase: two SIGN rows + one ECDH row.
    const methodCells = screen
      .getAllByTestId("policy-override-row")
      .map((row) => row.querySelector(".policies-method")?.textContent);
    expect(methodCells).toEqual(
      expect.arrayContaining(["SIGN", "ECDH", "SIGN"]),
    );
  });

  it("Signer Policies panel shows a remove button for each override row", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    const removeButtons = screen.getAllByLabelText(/Remove .* override for /i);
    expect(removeButtons.length).toBe(seededPolicyOverrides.length);
  });

  it("clicking a rule's remove button dispatches removePolicyOverride with (peer, direction, method) (VAL-POLICIES-014 remove leg)", () => {
    renderDashboard();
    mockRemovePolicyOverride.mockClear();
    fireEvent.click(screen.getByText("Policies"));
    // The newest override is rendered first (createdAt=3000) → SIGN on peer zero.
    const rows = screen.getAllByTestId("policy-override-row");
    const firstRemove = rows[0].querySelector(
      "button.policies-remove-btn",
    ) as HTMLButtonElement;
    fireEvent.click(firstRemove);
    expect(mockRemovePolicyOverride).toHaveBeenCalledTimes(1);
    expect(mockRemovePolicyOverride).toHaveBeenCalledWith({
      peer: peerZeroPubkey,
      direction: "respond",
      method: "sign",
    });
  });

  it("changing the default policy dropdown updates the trigger label (VAL-POLICIES-019)", () => {
    renderDashboard();
    fireEvent.click(screen.getByText("Policies"));
    fireEvent.click(screen.getByRole("combobox", { name: /default policy/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Deny by default" }));
    expect(
      screen.getByRole("combobox", { name: /default policy/i }),
    ).toHaveTextContent("Deny by default");
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
    // Each peer row has 4 badges: SIGN, ECDH, PING, ONBOARD. Scope the
    // query to `.policies-peer-row` so the Signer Policies rule rows
    // (which also render "SIGN" / "ECDH" in `.policies-method`) are
    // excluded from the count.
    const peerRows = document.querySelectorAll(".policies-peer-row");
    expect(peerRows.length).toBe(3);
    peerRows.forEach((row) => {
      const badgeText = Array.from(
        row.querySelectorAll(".policies-peer-badges .permission-badge"),
      ).map((el) => el.textContent);
      expect(badgeText).toEqual(
        expect.arrayContaining(["SIGN", "ECDH", "PING", "ONBOARD"]),
      );
    });
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
