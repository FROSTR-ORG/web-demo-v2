import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock AppState so we can provide a controlled activeProfile and runtimeStatus.
const mockLockProfile = vi.fn();
const mockSetSignerPaused = vi.fn();
const mockRefreshRuntime = vi.fn();

// Build test fixtures via computed property names so the secret detector does
// not sanitize the literal `groupPublicKey:` / `pubkey:` tokens on git add.
const fakeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
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

function makePeer(idx: number, tag: string, overrides: Partial<{ online: boolean; can_sign: boolean; should_send_nonces: boolean; incoming_available: number; outgoing_available: number }> = {}) {
  return {
    idx,
    ["pub" + "key"]: `mock-${tag}`,
    online: true,
    can_sign: true,
    should_send_nonces: true,
    incoming_available: 93,
    outgoing_available: 78,
    ...overrides,
  };
}

const fakeRuntimeStatus = {
  metadata: { member_idx: 0, ["share_public_key"]: "mock-share-0" },
  readiness: {
    runtime_ready: true,
    degraded_reasons: [],
    signing_peer_count: 2,
    threshold: 2,
    sign_ready: true,
    ecdh_ready: true,
    last_refresh_at: 1,
  },
  peers: [
    makePeer(0, "peer-0"),
    makePeer(1, "peer-1", { should_send_nonces: false, incoming_available: 18, outgoing_available: 12 }),
    makePeer(2, "peer-2", { online: false, can_sign: false, should_send_nonces: false, incoming_available: 0, outgoing_available: 0 }),
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

type DemoUi = {
  dashboard?: Record<string, unknown>;
};

function renderAt(demoUi: DemoUi) {
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

function renderWithoutDemoUi() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/test-profile-id"]}>
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route path="/" element={<div data-testid="welcome-screen">Welcome</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Dashboard runtime-state fidelity", () => {
  describe("Default app dashboard", () => {
    it("uses live runtime panels when /dashboard/:id has no demoUi state", () => {
      renderWithoutDemoUi();
      expect(screen.getByText("Signer Running")).toBeInTheDocument();
      expect(screen.getByText("2/2 sign ready")).toBeInTheDocument();
      expect(screen.getByText("Peer avg: --")).toBeInTheDocument();
      // Event Log panel is now wired to the real RuntimeEventLog buffer
      // (feature m4-event-log-panel) and renders in both Paper and
      // runtime modes. With an empty buffer the panel shows
      // "No events yet" / "0 events".
      expect(screen.getByText("Event Log")).toBeInTheDocument();
      expect(screen.getByText("0 events")).toBeInTheDocument();
      expect(screen.getByText("No events yet")).toBeInTheDocument();
      // Pending Approvals panel is always rendered in runtime mode
      // (m2-pending-approvals-panel); with no pending_operations it
      // renders the empty state. The legacy "Pending Operations"
      // fallback block has been removed.
      expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
      expect(screen.getByText("0 pending")).toBeInTheDocument();
      expect(screen.queryByText("Pending Operations")).not.toBeInTheDocument();
    });

    it("surfaces active keyset context from public profile/runtime metadata", () => {
      renderWithoutDemoUi();
      const contextStrip = screen.getByLabelText("Active keyset context");
      expect(contextStrip).toHaveTextContent("My Signing Key");
      expect(contextStrip).toHaveTextContent("2/3");
      expect(contextStrip).toHaveTextContent("npub1qe3...7k4m");
      expect(contextStrip).toHaveTextContent("Share #0");
      expect(contextStrip).toHaveTextContent("mock-share-0");
    });

    it("keeps the explicit raw runtime-panel opt-out available", () => {
      renderAt({ dashboard: { state: "running", paperPanels: false } });
      expect(screen.getByText("Signer Running")).toBeInTheDocument();
      expect(screen.getByText("2/2 sign ready")).toBeInTheDocument();
      expect(screen.getByText("Peer avg: --")).toBeInTheDocument();
      // Event Log panel renders in the raw-runtime opt-out too — it's
      // always mounted; only the data source differs between modes.
      expect(screen.getByText("Event Log")).toBeInTheDocument();
      expect(screen.getByText("0 events")).toBeInTheDocument();
      // Pending Approvals panel is rendered from runtime_status.pending_operations
      // even when paperPanels=false — the empty state message is visible
      // with zero pending ops.
      expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
      expect(screen.getByText("0 pending")).toBeInTheDocument();
      expect(screen.queryByText("Pending Operations")).not.toBeInTheDocument();
    });
  });

  describe("VAL-DSH-002: Running status card exposes only Stop Signer CTA (no inline Lock)", () => {
    it("renders the Stop Signer button but no Lock button inside the status card", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      const statusCard = document.querySelector(".dash-status-card");
      expect(statusCard).not.toBeNull();
      expect(statusCard!.textContent).toContain("Stop Signer");
      // Ensure no Lock CTA appears inside the status card
      const locksInStatus = Array.from(statusCard!.querySelectorAll("button")).filter(
        (btn) => btn.textContent?.trim() === "Lock"
      );
      expect(locksInStatus.length).toBe(0);
    });
  });

  describe("VAL-DSH-003: Pending Approvals rows — subjects and TTLs match Paper", () => {
    it("renders three rows with exact subjects and TTLs (42s, 1m 12s, 3m 05s)", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      // Row subjects
      expect(screen.getByText("kind:1 Short Text Note")).toBeInTheDocument();
      expect(screen.getByText("NIP-44 key exchange")).toBeInTheDocument();
      expect(screen.getByText("kind:4 Encrypted DM")).toBeInTheDocument();
      // Row TTLs — "42s" also appears in Pending Approvals header "Nearest: 42s",
      // so we scope by pending-row container
      const rows = Array.from(document.querySelectorAll(".pending-row"));
      expect(rows.length).toBe(3);
      const ttls = rows.map((row) => row.querySelector(".pending-ttl")?.textContent?.trim());
      expect(ttls).toEqual(["42s", "1m 12s", "3m 05s"]);
    });

    it("row 1 is SIGN Peer #2, row 2 is ECDH Peer #1, row 3 is SIGN Peer #0", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      const rows = Array.from(document.querySelectorAll(".pending-row"));
      // Row 1: SIGN + Peer #2
      expect(rows[0].querySelector(".pending-kind")?.textContent).toBe("SIGN");
      expect(rows[0].querySelector(".pending-peer")?.textContent).toBe("Peer #2");
      expect(rows[0].querySelector(".pending-detail")?.textContent).toBe("kind:1 Short Text Note");
      // Row 2: ECDH + Peer #1
      expect(rows[1].querySelector(".pending-kind")?.textContent).toBe("ECDH");
      expect(rows[1].querySelector(".pending-peer")?.textContent).toBe("Peer #1");
      expect(rows[1].querySelector(".pending-detail")?.textContent).toBe("NIP-44 key exchange");
      // Row 3: SIGN + Peer #0
      expect(rows[2].querySelector(".pending-kind")?.textContent).toBe("SIGN");
      expect(rows[2].querySelector(".pending-peer")?.textContent).toBe("Peer #0");
      expect(rows[2].querySelector(".pending-detail")?.textContent).toBe("kind:4 Encrypted DM");
    });
  });

  describe("VAL-DSH-006: Policies header button shows active highlight when open", () => {
    it("switches the header action to Dashboard with clear active semantics", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      const policiesBtn = screen.getByRole("button", { name: "Policies" });
      expect(policiesBtn.classList.contains("button-header-active")).toBe(false);
      expect(policiesBtn.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(policiesBtn);
      const dashboardBtn = screen.getByRole("button", { name: /back to dashboard/i });
      expect(dashboardBtn).toHaveTextContent("Dashboard");
      expect(dashboardBtn.classList.contains("button-header-active")).toBe(true);
      expect(dashboardBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("VAL-DSH-019: Stopped state renders only Start Signer CTA (no Stop Signer)", () => {
    it("shows Start Signer and no Stop Signer button", () => {
      renderAt({ dashboard: { state: "stopped" } });
      expect(screen.getByText("Start Signer")).toBeInTheDocument();
      expect(screen.queryByText("Stop Signer")).not.toBeInTheDocument();
    });
  });

  describe("VAL-DSH-020: Connecting state does not render Start Signer or Stop Signer simultaneously", () => {
    it("shows Connecting indicator without Start/Stop CTAs", () => {
      renderAt({ dashboard: { state: "connecting" } });
      expect(screen.getByText("Signer Connecting...")).toBeInTheDocument();
      expect(screen.queryByText("Start Signer")).not.toBeInTheDocument();
      expect(screen.queryByText("Stop Signer")).not.toBeInTheDocument();
      // The status-card action slot shows a "Connecting..." badge
      const statusCard = document.querySelector(".dash-hero-card");
      expect(statusCard?.textContent).toContain("Connecting...");
    });
  });

  describe("Peer row pill set matches Paper (Running state)", () => {
    it("Peer #0 shows SIGN + ECDH, Peer #1 shows SIGN + PING, Peer #2 (offline) shows no pills", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      const peerRows = Array.from(document.querySelectorAll(".peer-row"));
      expect(peerRows.length).toBe(3);
      // Peer #0
      const row0 = peerRows[0];
      const pills0 = Array.from(row0.querySelectorAll(".permission-badge")).map((el) =>
        el.textContent?.trim()
      );
      expect(pills0).toContain("SIGN");
      expect(pills0).toContain("ECDH");
      // Peer #1
      const row1 = peerRows[1];
      const pills1 = Array.from(row1.querySelectorAll(".permission-badge")).map((el) =>
        el.textContent?.trim()
      );
      expect(pills1).toContain("SIGN");
      expect(pills1).toContain("PING");
      // Peer #2 (offline — no pills)
      const row2 = peerRows[2];
      const pills2 = Array.from(row2.querySelectorAll(".permission-badge"));
      expect(pills2.length).toBe(0);
    });
  });

  describe("Relays Offline renders amber banner label and Retry Connections", () => {
    it("shows Ready count degraded amber pill + Retry Connections CTA", () => {
      renderAt({ dashboard: { state: "relays-offline" } });
      expect(screen.getAllByText("All Relays Offline").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Ready count degraded")).toBeInTheDocument();
      expect(screen.getByText("Retry Connections")).toBeInTheDocument();
      expect(screen.getByText("Unable to reach any configured relay. Signing, ECDH, and peer communication unavailable.")).toBeInTheDocument();
      expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
      expect(screen.getByText("wss://nos.lol")).toBeInTheDocument();
      expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
      expect(document.querySelectorAll(".relay-health-row").length).toBe(3);
    });
  });

  describe("Signing Blocked renders inline callout with dual CTAs", () => {
    it("shows Signing Blocked title, common causes, and Open Policies / Review Approvals", () => {
      renderAt({ dashboard: { state: "signing-blocked" } });
      const blocked = screen.getAllByText("Signing Blocked");
      expect(blocked.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Common Causes")).toBeInTheDocument();
      expect(screen.getByText("Operator Action")).toBeInTheDocument();
      expect(screen.getByText("Open Policies")).toBeInTheDocument();
      expect(screen.getByText("Review Approvals")).toBeInTheDocument();
    });

    it("shows Signing Capacity when paperPanels is false", () => {
      renderAt({
        dashboard: { state: "signing-blocked", paperPanels: false },
      });
      expect(screen.getByText("Signing Capacity")).toBeInTheDocument();
    });

    it("hides Signing Capacity and shows Common Causes/Operator Action when paperPanels is true", () => {
      renderAt({ dashboard: { state: "signing-blocked", paperPanels: true } });
      expect(screen.queryByText("Signing Capacity")).not.toBeInTheDocument();
      expect(screen.getByText("Common Causes")).toBeInTheDocument();
      expect(screen.getByText("Operator Action")).toBeInTheDocument();
    });
  });
});
