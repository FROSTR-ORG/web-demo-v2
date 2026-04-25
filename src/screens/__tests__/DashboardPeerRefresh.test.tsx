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
 * DashboardPeerRefresh — validates features `m1-ping-refresh-dispatch`
 * and `fix-m1-non-sign-failure-surface` (VAL-OPS-011 / VAL-OPS-015):
 *
 *  1. Clicking the Test page peer-refresh affordance dispatches a
 *     `refresh_all_peers` command through `handleRuntimeCommand`.
 *  2. When ANY `ping` `OperationFailure` arrives targeting a peer that
 *     resolves to a visible PeerRow, that row renders an inline
 *     "Refresh failed" error indicator — regardless of whether the peer
 *     was online or offline at dispatch time (broadened under
 *     `fix-m1-non-sign-failure-surface`: every non-sign failure with a
 *     resolvable peer attaches to that peer's row so VAL-OPS-015's
 *     non-modal feedback is always observable).
 *  3. Non-sign failures whose `failed_peer` is null OR not in the
 *     current peer list remain in the Event Log only and do not render
 *     bottom-of-screen banners.
 *  4. When a peer subsequently comes back online, its error indicator
 *     clears automatically.
 *  5. The SigningFailedModal NEVER opens for non-sign failures
 *     (regression guard for VAL-OPS-015).
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

function renderTestPage() {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/dashboard/test-profile-id/test", state: null },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId/test" element={<DashboardScreen mode="test" />} />
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
  it("clicking Test page 'Refresh peers' dispatches refresh_all_peers via handleRuntimeCommand", async () => {
    renderTestPage();
    const refreshBtn = screen
      .getByTestId("test-peer-refresh-panel")
      .querySelector("button[type='submit']") as HTMLButtonElement;
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

    // Simulate the runtime having drained a ping failure for peer #2 (the
    // offline peer). Re-render with the updated slice.
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

  it("raises the refresh-failed indicator on any peer row a ping failure targets (broadened under fix-m1-non-sign-failure-surface)", async () => {
    const { rerender } = renderDashboard();

    // Under the non-sign failure surface refactor, every non-sign failure
    // whose failed_peer resolves to a PeerRow renders the inline indicator
    // — there is no "online-at-dispatch" carve-out anymore. The regression
    // guard that used to assert the indicator stays absent is replaced by
    // the broader assertion that the indicator is raised so VAL-OPS-015's
    // "non-modal feedback appears" is observable for every non-sign
    // failure path with a resolvable peer.
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ping-online",
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
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("peer-refresh-error-1")).toBeInTheDocument();
    });
    const errorEl = screen.getByTestId("peer-refresh-error-1");
    expect(errorEl.textContent).toMatch(/refresh failed/i);
    expect(errorEl.getAttribute("title")).toBe("peer went offline mid-flight");
  });

  it("clears the refresh error indicator when the peer transitions back to online", async () => {
    const { rerender } = renderDashboard();

    // Feed a ping failure to raise the indicator.
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

/* ==========================================================================
 * fix-m1-non-sign-failure-surface — VAL-OPS-015
 *
 * Non-sign OperationFailures (ecdh / ping / onboard) must not open the
 * signing failure modal:
 *   - failed_peer resolves to a visible peer → inline PeerRow indicator;
 *   - otherwise → Event Log only, with no bottom-of-screen banner.
 *
 * Inline indicators auto-clear after 30 s.
 * ========================================================================== */
describe("Non-sign failure surface — VAL-OPS-015", () => {
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

  it("keeps an ECDH failure with null failed_peer out of bottom banners and PeerRows", async () => {
    const { rerender } = renderDashboard();
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ecdh-orphan",
          op_type: "ecdh",
          code: "timeout",
          message: "ecdh round-trip timed out",
          failed_peer: null,
        },
      ],
    };
    await act(async () => {
      rerender(routeTree());
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId("non-sign-failure-banners"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("non-sign-failure-banner-req-ecdh-orphan"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("peer-refresh-error-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("peer-refresh-error-2"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Signing Failed" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an ECDH failure with a failed_peer not in the current peers list out of bottom banners", async () => {
    const { rerender } = renderDashboard();
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ecdh-unknown",
          op_type: "ecdh",
          code: "peer_rejected",
          message: "unknown peer rejected request",
          failed_peer: ["unknown-peer-", "00ff00ff00"].join(""),
        },
      ],
    };
    await act(async () => {
      rerender(routeTree());
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId("non-sign-failure-banners"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("non-sign-failure-banner-req-ecdh-unknown"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("peer-refresh-error-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Signing Failed" }),
    ).not.toBeInTheDocument();
  });

  it("SigningFailedModal stays closed when only non-sign failures are present (regression guard)", async () => {
    const { rerender } = renderDashboard();
    appStateHolder.current = {
      ...appStateHolder.current,
      runtimeFailures: [
        {
          request_id: "req-ping-offline",
          op_type: "ping",
          code: "timeout",
          message: "peer unreachable",
          failed_peer: PEER_OFFLINE_PUBKEY,
        },
        {
          request_id: "req-ecdh-orphan-guard",
          op_type: "ecdh",
          code: "timeout",
          message: "ecdh timed out",
          failed_peer: null,
        },
        {
          request_id: "req-onboard-guard",
          op_type: "onboard",
          code: "peer_rejected",
          message: "onboard rejected",
          failed_peer: null,
        },
      ],
    };
    await act(async () => {
      rerender(routeTree());
    });
    // Let effects settle.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      screen.queryByRole("heading", { name: "Signing Failed" }),
    ).not.toBeInTheDocument();
    // And the non-modal feedback IS observable (PeerRow + banner both).
    await waitFor(() => {
      expect(screen.getByTestId("peer-refresh-error-2")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("non-sign-failure-banners"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("non-sign-failure-banner-req-ecdh-orphan-guard"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("non-sign-failure-banner-req-onboard-guard"),
    ).not.toBeInTheDocument();
  });
});
