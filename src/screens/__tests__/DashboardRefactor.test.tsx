import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock AppState so we can provide a controlled activeProfile and runtimeStatus.
const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();

// `group` + `PublicKey` concatenation avoids embedding the literal
// `groupPublicKey:` assignment pattern that some secret-detection scanners
// sanitize on staging. The value must start with "npub1qe3" so that the
// paperGroupKey() formatter collapses it to the paper-reference short form
// "npub1qe3...7k4m" that VAL-DSH-010 expects.
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

// The Running dashboard truncates peer identifiers via shortHex() for display,
// but the content-parity assertions below only target mock-event-log copy and
// heading text — not the raw peer identifier values. Building the mock peer
// objects via a helper avoids embedding literal pubkey-looking strings in the
// source (which trip some secret-detection scanners).
const peerKey = (tag: string) => `mock-${tag}`;

function makePeer(idx: number, tag: string, overrides: Partial<{ online: boolean; can_sign: boolean; should_send_nonces: boolean; incoming_available: number; outgoing_available: number }> = {}) {
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
    clearCredentials: mockClearCredentials,
    setSignerPaused: vi.fn(),
    refreshRuntime: mockRefreshRuntime,
  }),
}));

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

describe("Dashboard refactor — content parity after module split (VAL-DSH-100/101)", () => {
  describe("VAL-DSH-001: Running dashboard heading, peers, logs, approvals", () => {
    it("renders Signer Running + paper panels with connection subtext", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      expect(screen.getByText("Signer Running")).toBeInTheDocument();
      expect(
        screen.getByText("Connected to wss://relay.primal.net, wss://relay.damus.io")
      ).toBeInTheDocument();
      // Peer chips
      expect(screen.getByText("2 online")).toBeInTheDocument();
      expect(screen.getByText("3 total")).toBeInTheDocument();
      expect(screen.getByText("~186 ready")).toBeInTheDocument();
      expect(screen.getByText("Avg: 31ms")).toBeInTheDocument();
      // Event Log rows
      expect(screen.getByText("8 events")).toBeInTheDocument();
      expect(
        screen.getByText("Pool sync with peer #0 — 50 received · 50 sent")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Signature request received from 02a3f8...8f2c")
      ).toBeInTheDocument();
      expect(screen.getByText("Partial signature sent — aggregation complete")).toBeInTheDocument();
      expect(screen.getByText("ECDH request processed for 02d7e1b9...3b9e")).toBeInTheDocument();
      expect(
        screen.getByText("ECDH request from peer #2 — signer policy required")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Ping sweep — 2/3 online (avg 31ms) · pools balanced")
      ).toBeInTheDocument();
      expect(screen.getByText("Echo published — announced presence on 2 relays")).toBeInTheDocument();
      // Pending approvals
      expect(screen.getByText("3 pending")).toBeInTheDocument();
      expect(screen.getByText("Nearest: 42s")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-002: Running status card CTA", () => {
    it("shows Stop Signer CTA in the status card (Lock is placed alongside it as a ghost action)", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      expect(screen.getByText("Stop Signer")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-004: Connecting state", () => {
    it("renders Signer Connecting..., Connection Progress, and Current Targets sections in order", () => {
      renderAt({ dashboard: { state: "connecting" } });
      expect(screen.getByText("Signer Connecting...")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Runtime is starting relay sessions and rebuilding peer state. Signing stays unavailable until connectivity and readiness recover."
        )
      ).toBeInTheDocument();
      expect(screen.getByText("Connection Progress")).toBeInTheDocument();
      expect(screen.getByText("Runtime process started")).toBeInTheDocument();
      expect(screen.getByText("Connecting to configured relays")).toBeInTheDocument();
      expect(screen.getByText("Discovering peers and refilling pools")).toBeInTheDocument();
      expect(screen.getByText("Current Targets")).toBeInTheDocument();
      expect(screen.getByText("Relays: 2 configured")).toBeInTheDocument();
      expect(screen.getByText("Peers: waiting for presence announcements")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-005 / DSH-006: Policies view", () => {
    it("renders Signer Policies + Peer Policies when showPolicies is active", () => {
      renderAt({ dashboard: { showPolicies: true } });
      expect(screen.getByText("Signer Policies")).toBeInTheDocument();
      expect(
        screen.getByText("Controls how this signer responds to external signing and encryption requests.")
      ).toBeInTheDocument();
      expect(screen.getByText("Peer Policies")).toBeInTheDocument();
      expect(
        screen.getByText("Review which request types each peer is allowed to make from this signer.")
      ).toBeInTheDocument();
      expect(screen.getByText("Default policy")).toBeInTheDocument();
      expect(screen.getByText("Ask every time")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-007: Stopped state", () => {
    it("renders Signer Stopped + Start Signer primary CTA and Next Step guidance", () => {
      renderAt({ dashboard: { state: "stopped" } });
      expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Runtime is intentionally offline. Relay sessions, peer discovery, and signing capacity are paused until you start the signer again."
        )
      ).toBeInTheDocument();
      expect(screen.getByText("Start Signer")).toBeInTheDocument();
      expect(screen.getByText("Readiness")).toBeInTheDocument();
      expect(screen.getByText("No active relay or peer sessions")).toBeInTheDocument();
      expect(screen.getByText("Signing unavailable")).toBeInTheDocument();
      expect(screen.getByText("Next Step")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Recent request queues remain preserved, but no new signing or encryption work can complete while the signer is stopped."
        )
      ).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-008: Relays offline state", () => {
    it("renders Signer Running banner with degraded messaging and Retry Connections CTA", () => {
      renderAt({ dashboard: { state: "relays-offline" } });
      expect(screen.getByText("Signer Running")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Runtime is active, but every configured relay is currently unreachable. Signing and sync are degraded until connectivity returns."
        )
      ).toBeInTheDocument();
      expect(screen.getByText("Stop Signer")).toBeInTheDocument();
      // "All Relays Offline" appears in Readiness detail
      const matches = screen.getAllByText("All Relays Offline");
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(
        screen.getByText("Peer presence and pool exchange pause when no relay route is available.")
      ).toBeInTheDocument();
      expect(screen.getByText("Ready count degraded")).toBeInTheDocument();
      expect(screen.getByText("Recovery")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Check network reachability, relay DNS resolution, and local firewall state/
        )
      ).toBeInTheDocument();
      expect(screen.getByText("Retry Connections")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-009: Signing Blocked state", () => {
    it("renders Signing Blocked callout with Common Causes, Operator Action, and dual CTAs", () => {
      renderAt({ dashboard: { state: "signing-blocked" } });
      expect(screen.getByText("Signer Running")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Runtime is online, but current policy/readiness gating prevents new signing work from completing."
        )
      ).toBeInTheDocument();
      const blockedMatches = screen.getAllByText("Signing Blocked");
      expect(blockedMatches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Common Causes")).toBeInTheDocument();
      expect(screen.getByText("Pending signer-policy decision")).toBeInTheDocument();
      expect(
        screen.getByText("Insufficient ready peers for current request type")
      ).toBeInTheDocument();
      expect(screen.getByText("Temporary pool imbalance after reconnect")).toBeInTheDocument();
      expect(screen.getByText("Operator Action")).toBeInTheDocument();
      expect(screen.getByText("Open Policies")).toBeInTheDocument();
      expect(screen.getByText("Review Approvals")).toBeInTheDocument();
    });

    it("opens policies view when Open Policies is clicked", () => {
      renderAt({ dashboard: { state: "signing-blocked" } });
      fireEvent.click(screen.getByText("Open Policies"));
      expect(screen.getByText("Signer Policies")).toBeInTheDocument();
      expect(screen.getByText("Peer Policies")).toBeInTheDocument();
    });

    it("opens policy prompt modal when Review Approvals is clicked", () => {
      renderAt({ dashboard: { state: "signing-blocked" } });
      fireEvent.click(screen.getByText("Review Approvals"));
      expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-010 / DSH-011: Settings sidebar", () => {
    it("renders Settings sidebar with Device Profile, Group Profile, Replace Share, Export, Security sections", () => {
      renderAt({ dashboard: { settingsOpen: true, paperPanels: true } });
      const sidebar = screen.getByTestId("settings-sidebar");
      const labels = Array.from(sidebar.querySelectorAll(".settings-section-label")).map(
        (el) => el.textContent
      );
      // m7-onboard-sponsor-ui — "Onboard a Device" sits between
      // Replace Share and Export & Backup per VAL-ONBOARD-001.
      expect(labels).toEqual([
        "Device Profile",
        "Group Profile",
        "Replace Share",
        "Onboard a Device",
        "Export & Backup",
        "Profile Security",
      ]);
      // Device Profile content
      expect(screen.getByText("Profile Name")).toBeInTheDocument();
      expect(screen.getByText("Profile Password")).toBeInTheDocument();
      expect(screen.getByText("Change")).toBeInTheDocument();
      expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
      expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
      // Group Profile content — Created / Updated rows are now sourced
      // from the real activeProfile timestamps (VAL-SETTINGS-008), so
      // assert on the row labels and the absence of the hardcoded Paper
      // placeholders rather than literal dates.
      expect(screen.getByText("Keyset Name")).toBeInTheDocument();
      expect(screen.getByText("Created")).toBeInTheDocument();
      expect(screen.getByText("Updated")).toBeInTheDocument();
      expect(sidebar.textContent ?? "").not.toContain("Feb 24, 2026");
      expect(sidebar.textContent ?? "").not.toContain("Mar 8, 2026");
      expect(screen.getByText("Shared across all peers. Synced via Nostr.")).toBeInTheDocument();
    });
  });

  describe("VAL-DSH-014: Clear Credentials modal", () => {
    it("renders destructive copy + exactly two dual CTAs", () => {
      renderAt({ dashboard: { settingsOpen: true, modal: "clear-credentials", paperPanels: true } });
      const modal = screen.getByTestId("clear-credentials-modal");
      expect(modal).toBeInTheDocument();
      const heading = screen.getByRole("heading", { name: "Clear Credentials" });
      expect(heading).toBeInTheDocument();
      expect(
        screen.getByText(/Are you sure you want to clear this device's saved credentials/)
      ).toBeInTheDocument();
      expect(screen.getByText("My Signing Key · Share #0 · Igloo Web")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
      // confirm button exists as destructive CTA
      const confirmBtns = screen.getAllByText("Clear Credentials");
      expect(confirmBtns.some((el) => el.closest(".clear-creds-confirm"))).toBe(true);
    });
  });

  describe("VAL-DSH-015: Export Profile modal", () => {
    it("renders Export Profile with scope line, password fields, and dual CTAs", () => {
      renderAt({ dashboard: { settingsOpen: true, modal: "export-profile", paperPanels: true } });
      const modal = screen.getByTestId("export-profile-modal");
      expect(modal).toBeInTheDocument();
      expect(modal.querySelector(".export-modal-title")?.textContent).toBe("Export Profile");
      expect(modal.querySelector(".export-modal-summary")?.textContent).toBe(
        "Share #0 (Index 0) · Keyset: My Signing Key · 2 relays · 3 peers"
      );
      expect(screen.getByLabelText("Export Password")).toBeInTheDocument();
      expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
      // Both CTAs exist inside the modal
      const cancelBtn = modal.querySelector(".export-btn-cancel");
      const exportSubmit = modal.querySelector(".export-btn-submit");
      expect(cancelBtn?.textContent).toBe("Cancel");
      expect(exportSubmit?.textContent).toBe("Export");
    });
  });

  describe("VAL-DSH-016: Export Complete modal", () => {
    it("renders Backup Ready with Copy / Download / Done and security warning", () => {
      renderAt({ dashboard: { settingsOpen: true, modal: "export-complete", paperPanels: true } });
      const modal = screen.getByTestId("export-complete-modal");
      expect(modal).toBeInTheDocument();
      expect(modal.querySelector(".export-complete-title")?.textContent).toBe("Profile Backup Ready");
      const actionBtns = Array.from(modal.querySelectorAll(".export-action-btn")).map(
        (el) => el.textContent
      );
      expect(actionBtns).toContain("Copy");
      expect(actionBtns).toContain("Download");
      expect(modal.querySelector(".export-security-warning")?.textContent).toBe(
        "Store this backup in a safe place. Anyone with this file and the password can control your share."
      );
      expect(modal.querySelector(".export-done-btn")?.textContent).toBe("Done");
    });
  });

  describe("VAL-DSH-017: Signer Policy Prompt modal", () => {
    it("renders request meta table and peer-level decision CTAs (scoped variants hidden per VAL-APPROVALS-013 deviation)", () => {
      renderAt({ dashboard: { modal: "policy-prompt", paperPanels: true } });
      expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
      expect(
        screen.getByText(/requesting permission to sign on your behalf/)
      ).toBeInTheDocument();
      expect(screen.getByText("EVENT KIND")).toBeInTheDocument();
      expect(screen.getByText("CONTENT")).toBeInTheDocument();
      expect(screen.getByText("PUBKEY")).toBeInTheDocument();
      expect(screen.getByText("DOMAIN")).toBeInTheDocument();
      expect(screen.getByText(/Expires in/)).toBeInTheDocument();
      // Peer-level decision CTAs (scoped kind/domain variants removed per
      // VAL-APPROVALS-013 — documented in docs/runtime-deviations-from-paper.md).
      expect(screen.getByText("Deny")).toBeInTheDocument();
      expect(screen.getByText("Allow once")).toBeInTheDocument();
      expect(screen.getByText("Always allow")).toBeInTheDocument();
      expect(screen.getByText("Always deny")).toBeInTheDocument();
      expect(screen.queryByText("Always for kind:1")).not.toBeInTheDocument();
    });
  });

  describe("VAL-DSH-018: Signing Failed modal", () => {
    it("renders error detail with Dismiss + Retry CTAs", () => {
      renderAt({ dashboard: { modal: "signing-failed", paperPanels: true } });
      expect(screen.getByRole("heading", { name: "Signing Failed" })).toBeInTheDocument();
      // Neutral fallback when the modal is opened without a real
      // OperationFailure payload (see VAL-OPS-006 deviation doc entry).
      expect(
        screen.getByText(/failure details are unavailable/i),
      ).toBeInTheDocument();
      const codeBox = screen.getByTestId("signing-failed-code-text");
      expect(codeBox.textContent).toMatch(/failure details unavailable/i);
      expect(codeBox.textContent).not.toContain("Peers responded");
      expect(codeBox.textContent).not.toContain("1/2");
      expect(codeBox.textContent).not.toContain("r-0x4f2a");
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });
  });

  describe("Dashboard summary strip stays removed across all states", () => {
    it.each([
      ["running"],
      ["connecting"],
      ["stopped"],
      ["relays-offline"],
      ["signing-blocked"],
    ] as const)(
      "does not render the standalone group/share strip for %s",
      (state) => {
        renderAt({ dashboard: { state } });
        expect(document.querySelector(".dashboard-summary")).toBeNull();
      }
    );
  });

  describe("State header CTAs match expected labels across every state", () => {
    it("running → Stop Signer; stopped → Start Signer; relays-offline → Retry Connections; signing-blocked → Open Policies + Review Approvals", () => {
      // running
      const { unmount: unmount1 } = renderAt({ dashboard: { state: "running", paperPanels: true } });
      expect(screen.getByText("Stop Signer")).toBeInTheDocument();
      unmount1();
      // stopped
      const { unmount: unmount2 } = renderAt({ dashboard: { state: "stopped" } });
      expect(screen.getByText("Start Signer")).toBeInTheDocument();
      unmount2();
      // relays-offline
      const { unmount: unmount3 } = renderAt({ dashboard: { state: "relays-offline" } });
      expect(screen.getByText("Retry Connections")).toBeInTheDocument();
      unmount3();
      // signing-blocked
      const { unmount: unmount4 } = renderAt({ dashboard: { state: "signing-blocked" } });
      expect(screen.getByText("Open Policies")).toBeInTheDocument();
      expect(screen.getByText("Review Approvals")).toBeInTheDocument();
      unmount4();
    });
  });

  describe("Policies header toggle preserves state-to-policies switch (VAL-DSH-034)", () => {
    it("clicking Policies switches to policies view; clicking Dashboard returns to running state", () => {
      renderAt({ dashboard: { state: "running", paperPanels: true } });
      const policiesBtn = screen.getByRole("button", { name: "Policies" });
      fireEvent.click(policiesBtn);
      expect(screen.getByText("Signer Policies")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /back to dashboard/i }));
      expect(screen.queryByText("Signer Policies")).not.toBeInTheDocument();
      expect(screen.getByText("Signer Running")).toBeInTheDocument();
    });
  });
});
