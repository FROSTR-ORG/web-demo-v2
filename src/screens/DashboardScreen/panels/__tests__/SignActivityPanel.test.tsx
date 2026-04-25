import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppStateValue,
  SignLifecycleEntry,
} from "../../../../app/AppStateTypes";
import type { RuntimeStatusSummary } from "../../../../lib/bifrost/types";

/**
 * SignActivityPanel — Test page affordance that surfaces the
 * per-request_id runtime lifecycle (dispatched -> pending -> completed |
 * failed) as DOM rows + an aria-live "sign succeeded" toast. Fulfils the
 * `fix-m1-sign-completion-ui-feedback-and-pending-trace` feature and
 * closes the visibility gap in VAL-OPS-002 / VAL-OPS-004 / VAL-OPS-013.
 *
 * These tests use fake timers so the 30 s row-retention window and the
 * aria-live toast's 4 s visibility window can be exercised
 * deterministically.
 */

// Mutable shared AppState — individual tests mutate `currentState`
// between renders.
const currentState: { value: AppStateValue } = {
  value: {} as AppStateValue,
};

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => currentState.value,
}));

import { SignActivityPanel, pickVisibleEntries } from "../SignActivityPanel";

function makeEntry(
  overrides: Partial<SignLifecycleEntry> & Pick<SignLifecycleEntry, "request_id">,
): SignLifecycleEntry {
  return {
    request_id: overrides.request_id,
    op_type: overrides.op_type ?? "sign",
    message_preview: overrides.message_preview ?? "deadbeef01",
    status: overrides.status ?? "pending",
    dispatched_at: overrides.dispatched_at ?? Date.now(),
    pending_at: overrides.pending_at ?? overrides.dispatched_at ?? Date.now(),
    completed_at: overrides.completed_at ?? null,
    failed_at: overrides.failed_at ?? null,
    failure_reason: overrides.failure_reason ?? null,
  };
}

function makeStatus(pendingRequestIds: string[] = []): RuntimeStatusSummary {
  return {
    status: {
      device_id: "device",
      pending_ops: pendingRequestIds.length,
      last_active: 0,
      known_peers: 1,
      request_seq: 1,
    },
    metadata: {
      device_id: "device",
      member_idx: 0,
      share_public_key: "share",
      group_public_key: "group",
      peers: [],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 1,
      signing_peer_count: 1,
      ecdh_peer_count: 1,
      last_refresh_at: 0,
      degraded_reasons: [],
    },
    peers: [],
    peer_permission_states: [],
    pending_operations: pendingRequestIds.map((id, idx) => ({
      op_type: "Sign",
      request_id: id,
      started_at: 0,
      timeout_at: 0,
      target_peers: [],
      threshold: 1,
      collected_responses: [],
      context: null,
      // Entirely synthetic; the panel only reads `request_id`.
      _seq: idx,
    })) as unknown as RuntimeStatusSummary["pending_operations"],
  };
}

function setAppState(overrides: Partial<AppStateValue>) {
  currentState.value = {
    ...({} as AppStateValue),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-04-21T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("pickVisibleEntries — retention window", () => {
  it("keeps non-terminal entries regardless of age", () => {
    const entry = makeEntry({
      request_id: "req-1",
      status: "pending",
      dispatched_at: Date.now() - 60_000,
      pending_at: Date.now() - 60_000,
    });
    const visible = pickVisibleEntries([entry], Date.now());
    expect(visible).toHaveLength(1);
  });

  it("keeps completed entries for 30 s after completion and drops them after", () => {
    const completedAt = Date.now() - 10_000;
    const entry = makeEntry({
      request_id: "req-ok",
      status: "completed",
      dispatched_at: completedAt - 500,
      pending_at: completedAt - 500,
      completed_at: completedAt,
    });
    expect(pickVisibleEntries([entry], Date.now())).toHaveLength(1);
    // Advance the clock so terminal is 31 s old.
    const later = completedAt + 31_000;
    expect(pickVisibleEntries([entry], later)).toHaveLength(0);
  });

  it("keeps failed entries for 30 s after failure and drops them after", () => {
    const failedAt = Date.now() - 5_000;
    const entry = makeEntry({
      request_id: "req-fail",
      status: "failed",
      dispatched_at: failedAt - 100,
      pending_at: failedAt - 100,
      failed_at: failedAt,
      failure_reason: "timeout: peer offline",
    });
    expect(pickVisibleEntries([entry], Date.now())).toHaveLength(1);
    expect(pickVisibleEntries([entry], failedAt + 30_500)).toHaveLength(0);
  });

  it("orders visible entries newest-dispatched first", () => {
    const older = makeEntry({
      request_id: "req-older",
      status: "pending",
      dispatched_at: 1_000,
      pending_at: 1_000,
    });
    const newer = makeEntry({
      request_id: "req-newer",
      status: "pending",
      dispatched_at: 2_000,
      pending_at: 2_000,
    });
    const order = pickVisibleEntries([older, newer], 5_000).map(
      (entry) => entry.request_id,
    );
    expect(order).toEqual(["req-newer", "req-older"]);
  });
});

describe("SignActivityPanel — rendering and lifecycle transitions", () => {
  it("shows the empty state when signLifecycleLog is empty", () => {
    setAppState({
      signLifecycleLog: [],
      runtimeStatus: makeStatus(),
    });
    render(<SignActivityPanel />);
    expect(screen.getByTestId("sign-activity-empty")).toBeInTheDocument();
  });

  it("renders a row with 'pending' status while the op is in runtime_status.pending_operations", () => {
    const entry = makeEntry({
      request_id: "req-pending",
      status: "pending",
      message_preview: "abcdef0123",
    });
    setAppState({
      signLifecycleLog: [entry],
      runtimeStatus: makeStatus(["req-pending"]),
    });
    render(<SignActivityPanel />);
    const status = screen.getByTestId("sign-activity-status-req-pending");
    expect(status.textContent).toBe("pending");
    const row = screen.getByTestId("sign-activity-row-req-pending");
    expect(row.getAttribute("data-status")).toBe("pending");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toContain("pending");
    expect(row.getAttribute("aria-label")).toContain("SIGN");
  });

  it("flips a row from pending to completed when the lifecycle entry transitions", () => {
    const dispatchedAt = Date.now();
    const pendingEntry = makeEntry({
      request_id: "req-42",
      status: "pending",
      message_preview: "deadbeef01",
      dispatched_at: dispatchedAt,
      pending_at: dispatchedAt,
    });
    setAppState({
      signLifecycleLog: [pendingEntry],
      runtimeStatus: makeStatus(["req-42"]),
    });
    const { rerender } = render(<SignActivityPanel />);
    expect(screen.getByTestId("sign-activity-status-req-42").textContent).toBe(
      "pending",
    );

    // Advance: runtime drained the completion. Both the lifecycle entry
    // AND pending_operations reflect the transition.
    vi.advanceTimersByTime(2_000);
    const completedEntry: SignLifecycleEntry = {
      ...pendingEntry,
      status: "completed",
      completed_at: Date.now(),
    };
    setAppState({
      signLifecycleLog: [completedEntry],
      runtimeStatus: makeStatus([]),
    });
    rerender(<SignActivityPanel />);
    expect(screen.getByTestId("sign-activity-status-req-42").textContent).toBe(
      "completed",
    );
  });

  it("flips a row to failed when the lifecycle entry records a failure", () => {
    const dispatchedAt = Date.now();
    const entry = makeEntry({
      request_id: "req-bad",
      status: "failed",
      dispatched_at: dispatchedAt,
      pending_at: dispatchedAt,
      failed_at: dispatchedAt + 500,
      failure_reason: "timeout: peer offline",
    });
    setAppState({
      signLifecycleLog: [entry],
      runtimeStatus: makeStatus(),
    });
    render(<SignActivityPanel />);
    expect(
      screen.getByTestId("sign-activity-status-req-bad").textContent,
    ).toBe("failed");
  });

  it("keeps a completed row visible for at least 30 s, drops it after", () => {
    const completedAt = Date.now();
    const entry = makeEntry({
      request_id: "req-ok",
      status: "completed",
      dispatched_at: completedAt - 100,
      pending_at: completedAt - 100,
      completed_at: completedAt,
    });
    setAppState({
      signLifecycleLog: [entry],
      runtimeStatus: makeStatus(),
    });
    render(<SignActivityPanel />);
    expect(
      screen.getByTestId("sign-activity-status-req-ok").textContent,
    ).toBe("completed");

    // Advance past the 30 s retention window. The panel's internal 1 s
    // clock tick re-evaluates `pickVisibleEntries`.
    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(
      screen.queryByTestId("sign-activity-row-req-ok"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("sign-activity-empty")).toBeInTheDocument();
  });

  it("surfaces the aria-live toast when a sign completes, then hides it", () => {
    const dispatchedAt = Date.now();
    const pendingEntry = makeEntry({
      request_id: "req-toast",
      status: "pending",
      dispatched_at: dispatchedAt,
      pending_at: dispatchedAt,
      message_preview: "abcd012345",
    });
    setAppState({
      signLifecycleLog: [pendingEntry],
      runtimeStatus: makeStatus(["req-toast"]),
    });
    const { rerender } = render(<SignActivityPanel />);
    const toastNode = screen.getByTestId("sign-activity-toast");
    expect(toastNode.getAttribute("aria-live")).toBe("polite");
    expect(toastNode.textContent).toBe("");
    expect(toastNode.style.opacity).toBe("0");

    // Runtime completes the sign.
    vi.advanceTimersByTime(1_000);
    const completedAt = Date.now();
    const completedEntry: SignLifecycleEntry = {
      ...pendingEntry,
      status: "completed",
      completed_at: completedAt,
    };
    setAppState({
      signLifecycleLog: [completedEntry],
      runtimeStatus: makeStatus(),
    });
    rerender(<SignActivityPanel />);
    expect(toastNode.textContent).toContain("Sign succeeded");
    expect(toastNode.textContent).toContain("abcd012345");
    expect(toastNode.style.opacity).toBe("1");

    // Toast fades after its lifetime (~4s). Advance the internal clock
    // tick so `now` moves past the toast window.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // Re-render with unchanged state so the component picks up the new
    // `now` value. (Panel tick is 1s; we advanced 5s so interval
    // fired 5x — state already advanced via the internal setInterval.)
    rerender(<SignActivityPanel />);
    expect(toastNode.style.opacity).toBe("0");
  });

  it("includes non-sign completions (ECDH, Ping) in the activity surface", () => {
    const dispatchedAt = Date.now();
    const ecdhEntry = makeEntry({
      request_id: "req-ecdh",
      op_type: "ecdh",
      status: "completed",
      dispatched_at: dispatchedAt,
      pending_at: dispatchedAt,
      completed_at: dispatchedAt + 100,
      message_preview: "ecdefabc12",
    });
    const pingEntry = makeEntry({
      request_id: "req-ping",
      op_type: "ping",
      status: "completed",
      dispatched_at: dispatchedAt + 10,
      pending_at: dispatchedAt + 10,
      completed_at: dispatchedAt + 120,
      message_preview: "pingabcdef",
    });
    setAppState({
      signLifecycleLog: [ecdhEntry, pingEntry],
      runtimeStatus: makeStatus(),
    });
    render(<SignActivityPanel />);
    expect(
      screen.getByTestId("sign-activity-kind-req-ecdh").textContent,
    ).toBe("ecdh");
    expect(
      screen.getByTestId("sign-activity-kind-req-ping").textContent,
    ).toBe("ping");
  });

  it("row is keyboard focusable via tabIndex=0 and exposes status via accessible text", () => {
    const entry = makeEntry({
      request_id: "req-kbd",
      status: "pending",
      message_preview: "0123456789",
    });
    setAppState({
      signLifecycleLog: [entry],
      runtimeStatus: makeStatus(["req-kbd"]),
    });
    render(<SignActivityPanel />);
    const row = screen.getByTestId("sign-activity-row-req-kbd");
    expect(row.tagName).toBe("LI");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toContain("pending");
    // Status is also text-visible (not purely visual).
    expect(
      screen.getByTestId("sign-activity-status-req-kbd").textContent,
    ).toBe("pending");
  });
});
