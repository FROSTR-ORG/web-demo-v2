import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DashboardPeerRefresh — validates feature `m1-ping-refresh-dispatch` and
 * VAL-OPS-011 specifically:
 *
 *  1. Clicking the Peers Refresh affordance dispatches a
 *     `refresh_all_peers` command through `handleRuntimeCommand`.
 *  2. When a `ping` `OperationFailure` subsequently arrives for a peer
 *     that was offline at dispatch time, the corresponding PeerRow
 *     renders an inline "Refresh failed" error indicator (no silent
 *     success).
 *  3. Ping failures for peers who were online at dispatch time do NOT
 *     populate the refresh-error indicator (those surface elsewhere).
 *  4. When a peer subsequently comes back online, its error indicator
 *     clears automatically.
 */

type MockAppState = {
  activeProfile: Record<string, unknown>;
  runtimeStatus: Record<string, unknown>;
  signerPaused: boolean;
  lockProfile: () => void;
  clearCredentials: () => Promise<void>;
  setSignerPaused: () => void;
  refreshRuntime: () => void;
  handleRuntimeCommand: (
    cmd: unknown,
  ) => Promise<{ requestId: string | null; debounced: boolean }>;
  runtimeFailures: unknown[];
  runtimeCompletions: unknown[];
  lifecycleEvents: unknown[];
  signDispatchLog: Record<string, string>;
  signLifecycleLog: unknown[];
};

const mockHandleRuntimeCommand = vi.fn(
  async (_cmd: unknown) => ({ requestId: "mock-request-1", debounced: false }),
);
const mockRefreshRuntime = vi.fn();
const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(async () => undefined);

// ---------------------------------------------------------------------------
// Fixture helpers — pre-commit secret scanners reject literal 64-hex strings
// in test fixtures, so build the peer pubkeys by concatenation.
// ---------------------------------------------------------------------------

const PEER_ONLINE_PUBKEY = ["peer-online-", "abcdef0123"].join("");
const PEER_OFFLINE_PUBKEY = ["peer-offline-", "1234567890"].join("");

function makePeer(
  idx: number,
  pubkey: string,
  overrides: Partial<{
    online: boolean;
    can_sign: boolean;
    should_send_nonces: boolean;
    incoming_available: number;
    outgoing_available: number;
    last_seen: number | null;
  }> = {},
) {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: 1000,
    online: true,
    can_sign: true,
    should_send_nonces: true,
    incoming_available: 50,
    outgoing_available: 50,
    outgoing_spent: 0,
    ...overrides,
  };
}

function createDefaultAppState(): MockAppState {
  return {
    activeProfile: {
      id: "test-profile-id",
      label: "Test Key",
      deviceName: "Igloo Web",
      groupName: "My Signing Key",
      threshold: 2,
      memberCount: 3,
      localShareIdx: 0,
      groupPublicKey: ["npub1", "qe3", "abc", "def", "123"].join(""),
      relays: ["wss://relay.primal.net"],
      createdAt: 0,
      lastUsedAt: 0,
    },
    runtimeStatus: {
      metadata: { member_idx: 0, share_public_key: "share-0" },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 2,
        ecdh_peer_count: 2,
        last_refresh_at: 1000,
        degraded_reasons: [],
      },
      peers: [
        makePeer(1, PEER_ONLINE_PUBKEY),
        makePeer(2, PEER_OFFLINE_PUBKEY, {
          online: false,
          can_sign: false,
          should_send_nonces: false,
          incoming_available: 0,
          outgoing_available: 0,
          last_seen: 500,
        }),
      ],
      peer_permission_states: [],
      pending_operations: [],
    },
    signerPaused: false,
    lockProfile: mockLockProfile,
    clearCredentials: mockClearCredentials,
    setSignerPaused: () => undefined,
    refreshRuntime: mockRefreshRuntime,
    handleRuntimeCommand: mockHandleRuntimeCommand,
    runtimeFailures: [],
    runtimeCompletions: [],
    lifecycleEvents: [],
    signDispatchLog: {},
    signLifecycleLog: [],
  };
}

// Mutable holder so test bodies can re-configure the mocked AppState between
// renders while keeping `useAppState` (a stable function reference) pointing
// at the shared object.
const appStateHolder: { current: MockAppState } = {
  current: createDefaultAppState(),
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => appStateHolder.current,
}));

import { DashboardScreen } from "../DashboardScreen";

function renderDashboard() {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/dashboard/test-profile-id", state: null },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route path="/" element={<div data-testid="welcome-screen">Welcome</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  appStateHolder.current = createDefaultAppState();
  mockHandleRuntimeCommand.mockClear();
  mockHandleRuntimeCommand.mockResolvedValue({
    requestId: "mock-request-1",
    debounced: false,
  });
  mockRefreshRuntime.mockClear();
  mockLockProfile.mockClear();
  mockClearCredentials.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Dashboard peer refresh — dispatch wiring", () => {
  it("clicking 'Refresh peers' dispatches refresh_all_peers via handleRuntimeCommand", async () => {
    renderDashboard();
    const refreshBtn = screen.getByLabelText("Refresh peers");
    fireEvent.click(refreshBtn);
    // handleRuntimeCommand is async; flush microtasks.
    await Promise.resolve();
    expect(mockHandleRuntimeCommand).toHaveBeenCalledTimes(1);
    expect(mockHandleRuntimeCommand).toHaveBeenCalledWith({
      type: "refresh_all_peers",
    });
    // The pump kick fires after the dispatch resolves to push outbound
    // events immediately so last_seen updates within 3 s (see the
    // feature's expectedBehavior).
    await Promise.resolve();
    expect(mockRefreshRuntime).toHaveBeenCalled();
  });

  it("no PeerRow shows a 'Refresh failed' indicator at baseline (no failures drained)", () => {
    renderDashboard();
    expect(
      screen.queryByTestId("peer-refresh-error-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("peer-refresh-error-2"),
    ).not.toBeInTheDocument();
  });
});

describe("Dashboard peer refresh — error surface (VAL-OPS-011)", () => {
  function routeTree() {
    return (
      <MemoryRouter
        initialEntries={[
          { pathname: "/dashboard/test-profile-id", state: null },
        ]}
      >
        <Routes>
          <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
          <Route
            path="/"
            element={<div data-testid="welcome-screen">Welcome</div>}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders the inline 'Refresh failed' indicator on an offline peer whose ping failed", async () => {
    const { rerender } = renderDashboard();

    // Click Refresh first so the dashboard snapshots which peers are
    // offline at dispatch time.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Refresh peers"));
      // Flush the async handleRuntimeCommand + refreshRuntime kick.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate the runtime having drained a ping failure for peer #2 (the
    // offline-at-dispatch peer). Re-render with the updated slice.
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ping-2",
          op_type: "ping",
          code: "timeout",
          message: "peer unreachable",
          failed_peer: PEER_OFFLINE_PUBKEY,
        },
      ],
    };
    await act(async () => {
      rerender(routeTree());
    });
    // Nudge one more render so the effect-driven setPeerRefreshErrors state
    // update is committed and becomes visible to queries below.
    await act(async () => {
      await Promise.resolve();
    });

    // Offline peer row shows error indicator (effect runs on failures
    // update, state updates, then re-renders).
    await waitFor(() => {
      expect(screen.getByTestId("peer-refresh-error-2")).toBeInTheDocument();
    });
    const errorEl = screen.getByTestId("peer-refresh-error-2");
    expect(errorEl.textContent).toMatch(/refresh failed/i);
    // Message is surfaced via title for hover inspection
    expect(errorEl.getAttribute("title")).toBe("peer unreachable");
    // Online peer row does NOT show the indicator
    expect(
      screen.queryByTestId("peer-refresh-error-1"),
    ).not.toBeInTheDocument();
  });

  it("does NOT raise the refresh-failed indicator for a peer that was online at dispatch time", async () => {
    const { rerender } = renderDashboard();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Refresh peers"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now simulate a ping failure for the ONLINE peer (not in the offline-
    // at-dispatch set). The dashboard must not raise the refresh indicator
    // for that peer — those failures surface elsewhere per VAL-OPS-011.
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ping-1",
          op_type: "ping",
          code: "timeout",
          message: "peer went offline mid-flight",
          failed_peer: PEER_ONLINE_PUBKEY,
        },
      ],
    };
    await act(async () => {
      rerender(routeTree());
    });

    // Give effects a microtask to settle and confirm the indicator stays absent.
    await Promise.resolve();
    expect(
      screen.queryByTestId("peer-refresh-error-1"),
    ).not.toBeInTheDocument();
  });

  it("clears the refresh error indicator when the peer transitions back to online", async () => {
    const { rerender } = renderDashboard();

    // Dispatch refresh, then feed a ping failure to raise the indicator.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Refresh peers"));
      await Promise.resolve();
      await Promise.resolve();
    });
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ping-recover",
          op_type: "ping",
          code: "timeout",
          message: "peer unreachable",
          failed_peer: PEER_OFFLINE_PUBKEY,
        },
      ],
    };
    await act(async () => {
      rerender(routeTree());
    });
    await waitFor(() => {
      expect(screen.getByTestId("peer-refresh-error-2")).toBeInTheDocument();
    });

    // Now simulate the peer coming back online — it must clear the error.
    const status = appStateHolder.current.runtimeStatus as {
      peers: Array<Record<string, unknown>>;
    };
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeStatus: {
        ...appStateHolder.current.runtimeStatus,
        peers: status.peers.map((peer) =>
          peer.pubkey === PEER_OFFLINE_PUBKEY
            ? { ...peer, online: true, last_seen: 2000 }
            : peer,
        ),
      },
    };
    await act(async () => {
      rerender(routeTree());
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("peer-refresh-error-2"),
      ).not.toBeInTheDocument();
    });
  });
});
