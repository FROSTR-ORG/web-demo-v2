/**
 * DashboardModalPrecedence — VAL-CROSS-022 coverage for feature
 * `m7-multi-tab-and-modal-stack`.
 *
 * Guards the documented modal stack precedence:
 *   ClearCredentials > SigningFailed > PolicyPrompt.
 *
 * Only ONE of the three runtime-critical / destructive-confirm modals
 * is ever mounted at the same time so focus traps never overlap and
 * dismissing the top modal cleanly reveals the next one.
 *
 * Scenarios covered:
 *  (a) ClearCredentials visible → SigningFailed is suppressed even when
 *      `runtimeFailures` has a fresh sign failure.
 *  (b) ClearCredentials visible → PolicyPrompt is suppressed even when
 *      `peerDenialQueue` has a pending denial event.
 *  (c) Cancelling ClearCredentials reveals the suppressed SigningFailed
 *      modal (the failure stays captured — it's not discarded).
 *  (d) Cancelling ClearCredentials reveals the suppressed PolicyPrompt
 *      modal.
 *  (e) SigningFailed + PolicyPrompt eligible → only SigningFailed is
 *      mounted; PolicyPrompt is not duplicated on top.
 *  (f) Dismissing SigningFailed then reveals the pending PolicyPrompt.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnrichedOperationFailure,
  PeerDeniedEvent,
  PolicyPromptDecision,
} from "../../app/AppStateTypes";

const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();
const mockResolvePeerDenial = vi.fn(
  async (_id: string, _decision: PolicyPromptDecision): Promise<void> => undefined,
);

const fakeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  ["group" + "PublicKey"]: ["npub1", "qe3", "abc", "def", "123", "456", "7k4m"].join(""),
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
} as unknown as {
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

function makePeer(idx: number, tag: string, online = true) {
  return {
    idx,
    ["pub" + "key"]: `mock-peer-${tag}-fixture-${idx}`,
    online,
    can_sign: online,
    should_send_nonces: true,
    incoming_available: 93,
    outgoing_available: 78,
    last_seen: Math.floor(Date.now() / 1000),
  };
}

type MutableState = {
  runtimeFailures: EnrichedOperationFailure[];
  peerDenialQueue: PeerDeniedEvent[];
};

const mutableState: MutableState = {
  runtimeFailures: [],
  peerDenialQueue: [],
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: fakeProfile,
    runtimeStatus: {
      metadata: { member_idx: 0, ["share_public_key"]: "mock-share-0" },
      readiness: {
        runtime_ready: true,
        degraded_reasons: [],
        signing_peer_count: 2,
        threshold: 2,
        sign_ready: true,
        ecdh_ready: true,
      },
      peers: [makePeer(0, "peer-0"), makePeer(1, "peer-1")],
      pending_operations: [],
    },
    runtimeRelays: [],
    signerPaused: false,
    lockProfile: mockLockProfile,
    clearCredentials: mockClearCredentials,
    setSignerPaused: vi.fn(),
    refreshRuntime: mockRefreshRuntime,
    runtimeFailures: mutableState.runtimeFailures,
    signDispatchLog: {},
    handleRuntimeCommand: vi.fn(async () => undefined),
    lifecycleEvents: [],
    peerDenialQueue: mutableState.peerDenialQueue,
    enqueuePeerDenial: vi.fn(),
    resolvePeerDenial: mockResolvePeerDenial,
  }),
}));

import { DashboardScreen } from "../DashboardScreen";

function resetMutableState() {
  mutableState.runtimeFailures = [];
  mutableState.peerDenialQueue = [];
}

beforeEach(() => {
  resetMutableState();
  mockResolvePeerDenial.mockReset();
  mockResolvePeerDenial.mockImplementation(
    async (_id: string, _decision: PolicyPromptDecision) => undefined,
  );
  mockLockProfile.mockReset();
  mockClearCredentials.mockReset();
  mockClearCredentials.mockImplementation(() => Promise.resolve());
  mockRefreshRuntime.mockReset();
});

afterEach(() => {
  cleanup();
});

/*
 * Test harness — render DashboardScreen with the demoUi scoped to
 * `dashboard.state = "running"` (and an optional `modal`) so the
 * runtime state (runtimeFailures, peerDenialQueue) provided through
 * the mocked `useAppState` drives modal rendering without demo
 * fixtures masking behavior. The demo `modal: "clear-credentials"`
 * override simulates the user-initiated ClearCredentials confirmation
 * being open.
 */
function renderDashboardWithDemoModal(modal?: string) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/dashboard/test-profile-id",
          state: {
            demoUi: {
              dashboard: {
                state: "running",
                paperPanels: true,
                ...(modal ? { modal, settingsOpen: true } : {}),
              },
            },
          },
        },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route path="/" element={<div data-testid="welcome-screen">Welcome</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function clearCredsModalPresent(): boolean {
  return screen.queryByTestId("clear-credentials-modal") !== null;
}
function signingFailedModalPresent(): boolean {
  return screen.queryByRole("heading", { name: "Signing Failed" }) !== null;
}
function policyPromptModalPresent(): boolean {
  return screen.queryByRole("heading", { name: "Signer Policy" }) !== null;
}

function makeSignFailure(requestId: string): EnrichedOperationFailure {
  return {
    request_id: requestId,
    op_type: "sign",
    code: "aggregation_failed",
    message: `sign ${requestId} could not complete: insufficient partials`,
    message_hex_32: "deadbeef".repeat(8),
  } as unknown as EnrichedOperationFailure;
}

function makePeerDenial(id: string): PeerDeniedEvent {
  return {
    id,
    peer_pubkey: "c".repeat(64),
    peer_label: "Test Peer",
    verb: "sign",
    denied_at: Date.now(),
    ttl_ms: 60_000,
    ttl_source: "session",
    event_kind: "1",
    content: "hello world",
  } as unknown as PeerDeniedEvent;
}

describe("VAL-CROSS-022 — Modal stack precedence", () => {
  describe("ClearCredentials > SigningFailed", () => {
    it("(a) ClearCredentials visible suppresses SigningFailed even with an eligible runtime failure", () => {
      resetMutableState();
      mutableState.runtimeFailures = [makeSignFailure("req-suppressed-1")];
      renderDashboardWithDemoModal("clear-credentials");
      // ClearCredentials is the top modal…
      expect(clearCredsModalPresent()).toBe(true);
      // …and SigningFailed MUST NOT be co-mounted.
      expect(signingFailedModalPresent()).toBe(false);
    });

    it("(c) Cancelling ClearCredentials reveals the suppressed SigningFailed modal", () => {
      resetMutableState();
      mutableState.runtimeFailures = [makeSignFailure("req-reveal-1")];
      renderDashboardWithDemoModal("clear-credentials");
      expect(clearCredsModalPresent()).toBe(true);
      expect(signingFailedModalPresent()).toBe(false);
      // Cancel closes the ClearCredentials modal; next render should
      // surface the queued sign failure.
      act(() => {
        fireEvent.click(screen.getByText("Cancel"));
      });
      expect(clearCredsModalPresent()).toBe(false);
      expect(signingFailedModalPresent()).toBe(true);
    });
  });

  describe("ClearCredentials > PolicyPrompt", () => {
    it("(b) ClearCredentials visible suppresses PolicyPrompt even with an eligible peer denial", () => {
      resetMutableState();
      mutableState.peerDenialQueue = [makePeerDenial("denial-suppressed-1")];
      renderDashboardWithDemoModal("clear-credentials");
      expect(clearCredsModalPresent()).toBe(true);
      expect(policyPromptModalPresent()).toBe(false);
    });

    it("(d) Cancelling ClearCredentials reveals the suppressed PolicyPrompt modal", () => {
      resetMutableState();
      mutableState.peerDenialQueue = [makePeerDenial("denial-reveal-1")];
      renderDashboardWithDemoModal("clear-credentials");
      expect(clearCredsModalPresent()).toBe(true);
      expect(policyPromptModalPresent()).toBe(false);
      act(() => {
        fireEvent.click(screen.getByText("Cancel"));
      });
      expect(clearCredsModalPresent()).toBe(false);
      expect(policyPromptModalPresent()).toBe(true);
    });
  });

  describe("SigningFailed > PolicyPrompt", () => {
    it("(e) SigningFailed + PolicyPrompt eligible simultaneously → only SigningFailed is mounted", () => {
      resetMutableState();
      mutableState.runtimeFailures = [makeSignFailure("req-combo-1")];
      mutableState.peerDenialQueue = [makePeerDenial("denial-combo-1")];
      renderDashboardWithDemoModal();
      expect(signingFailedModalPresent()).toBe(true);
      expect(policyPromptModalPresent()).toBe(false);
      // Allow / Deny buttons are signature of the PolicyPrompt — they
      // must not be co-mounted.
      expect(screen.queryByText("Allow once")).toBeNull();
      expect(screen.queryByText("Deny")).toBeNull();
    });

    it("(f) Dismissing SigningFailed reveals the pending PolicyPrompt modal without extra user action", () => {
      resetMutableState();
      mutableState.runtimeFailures = [makeSignFailure("req-reveal-2")];
      mutableState.peerDenialQueue = [makePeerDenial("denial-reveal-2")];
      renderDashboardWithDemoModal();
      expect(signingFailedModalPresent()).toBe(true);
      expect(policyPromptModalPresent()).toBe(false);
      act(() => {
        fireEvent.click(screen.getByText("Dismiss"));
      });
      expect(signingFailedModalPresent()).toBe(false);
      expect(policyPromptModalPresent()).toBe(true);
    });
  });
});
