import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOperation, PeerStatus } from "../../../../lib/bifrost/types";
import {
  PendingApprovalsPanel,
  deriveApprovalRowsFromRuntime,
  formatApprovalTtl,
  __resetPendingApprovalsCollapseForTest,
} from "../PendingApprovalsPanel";
import type { DashboardApprovalRow } from "../../mocks";

/**
 * Unit tests for the runtime-driven PendingApprovalsPanel wiring
 * (m2-pending-approvals-panel). Covers VAL-APPROVALS-001 through
 * VAL-APPROVALS-006: live rendering from runtime_status.pending_operations,
 * verb-prefixed descriptions, TTL countdowns, Nearest SLA label,
 * collapsibility with persistence across tab switches (but reset on
 * reload), and empty-state rendering.
 */

afterEach(() => {
  cleanup();
  __resetPendingApprovalsCollapseForTest();
});

function makePeer(idx: number, pubkey: string, overrides: Partial<PeerStatus> = {}): PeerStatus {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: 0,
    online: true,
    incoming_available: 50,
    outgoing_available: 50,
    outgoing_spent: 0,
    can_sign: true,
    should_send_nonces: true,
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingOperation> & Pick<PendingOperation, "op_type" | "request_id">): PendingOperation {
  return {
    op_type: overrides.op_type,
    request_id: overrides.request_id,
    started_at: overrides.started_at ?? 1_700_000_000,
    timeout_at: overrides.timeout_at ?? 1_700_000_042,
    target_peers: overrides.target_peers ?? [],
    threshold: overrides.threshold ?? 2,
    collected_responses: overrides.collected_responses ?? [],
    context: overrides.context ?? null,
  };
}

describe("formatApprovalTtl", () => {
  it("formats seconds below a minute as 'Ns'", () => {
    expect(formatApprovalTtl(42_000)).toBe("42s");
    expect(formatApprovalTtl(5_000)).toBe("5s");
    expect(formatApprovalTtl(999)).toBe("0s");
    expect(formatApprovalTtl(0)).toBe("0s");
    expect(formatApprovalTtl(-5_000)).toBe("0s");
  });

  it("formats minutes with zero-padded seconds as 'Nm SSs'", () => {
    expect(formatApprovalTtl(72_000)).toBe("1m 12s");
    expect(formatApprovalTtl(185_000)).toBe("3m 05s");
    expect(formatApprovalTtl(60_000)).toBe("1m 00s");
  });
});

describe("deriveApprovalRowsFromRuntime", () => {
  const nowSecs = 1_700_000_000;
  const nowMs = nowSecs * 1000;
  const peerAPubkey = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
  const peerBPubkey = "0102030405060708091011121314151617181920212223242526272829303132";

  it("maps op_type to the matching pill kind and resolves peer identity via runtimeStatus.peers", () => {
    const peers: PeerStatus[] = [makePeer(0, peerAPubkey), makePeer(2, peerBPubkey)];
    const pending: PendingOperation[] = [
      makePending({
        op_type: "Sign",
        request_id: "req-sign-0",
        target_peers: [peerAPubkey],
        timeout_at: nowSecs + 42,
        context: { message_hex_32: "deadbeef0102030405060708" },
      }),
      makePending({
        op_type: "Ecdh",
        request_id: "req-ecdh-0",
        target_peers: [peerBPubkey],
        timeout_at: nowSecs + 72,
      }),
      makePending({
        op_type: "Ping",
        request_id: "req-ping-0",
        target_peers: [peerAPubkey],
        timeout_at: nowSecs + 15,
      }),
      makePending({
        op_type: "Onboard",
        request_id: "req-onb-0",
        target_peers: [peerBPubkey],
        timeout_at: nowSecs + 180,
      }),
    ];

    const rows = deriveApprovalRowsFromRuntime(pending, peers, nowMs);

    expect(rows).toHaveLength(4);
    expect(rows[0].kind).toBe("SIGN");
    expect(rows[0].peer).toBe("Peer #0");
    expect(rows[0].key).toBe("aabbcc...8899");
    expect(rows[0].detail.startsWith("Sign: ")).toBe(true);
    expect(rows[0].detail).toContain("aabbcc...8899");
    expect(rows[0].detail).toContain("deadbeef01"); // first 10 hex of message
    expect(rows[0].ttl).toBe("42s");

    expect(rows[1].kind).toBe("ECDH");
    expect(rows[1].peer).toBe("Peer #2");
    expect(rows[1].detail.startsWith("ECDH: ")).toBe(true);
    expect(rows[1].ttl).toBe("1m 12s");

    expect(rows[2].kind).toBe("PING");
    expect(rows[2].detail.startsWith("Ping: ")).toBe(true);
    expect(rows[2].ttl).toBe("15s");

    expect(rows[3].kind).toBe("ONBOARD");
    expect(rows[3].detail.startsWith("Onboard: ")).toBe(true);
    expect(rows[3].ttl).toBe("3m 00s");
  });

  it("falls back to the short key when the peer pubkey is not in the peers list", () => {
    const pending: PendingOperation[] = [
      makePending({
        op_type: "Sign",
        request_id: "req-sign-x",
        target_peers: [peerAPubkey],
        timeout_at: nowSecs + 10,
      }),
    ];
    const rows = deriveApprovalRowsFromRuntime(pending, [], nowMs);
    expect(rows[0].peer).toBe("aabbcc...8899");
  });

  it("clamps negative TTLs to 0s", () => {
    const pending: PendingOperation[] = [
      makePending({
        op_type: "Ping",
        request_id: "req-ping-expired",
        target_peers: [peerAPubkey],
        timeout_at: nowSecs - 5,
      }),
    ];
    const rows = deriveApprovalRowsFromRuntime(pending, [], nowMs);
    expect(rows[0].ttl).toBe("0s");
  });
});

describe("PendingApprovalsPanel — rendering", () => {
  it("renders the empty state when rows is empty", () => {
    render(<PendingApprovalsPanel rows={[]} />);
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
    expect(screen.getByText("0 pending")).toBeInTheDocument();
    expect(screen.getByTestId("pending-approvals-empty")).toBeInTheDocument();
    expect(screen.getByTestId("pending-approvals-empty").textContent).toMatch(
      /no pending operations/i,
    );
    // No .pending-row elements in the DOM.
    expect(document.querySelectorAll(".pending-row").length).toBe(0);
    // Nearest SLA label is hidden/absent when empty.
    expect(screen.queryByText(/Nearest:/i)).not.toBeInTheDocument();
  });

  it("renders one row per entry in rows with verb-prefixed descriptions", () => {
    const rows: DashboardApprovalRow[] = [
      {
        id: "row-sign",
        kind: "SIGN",
        peer: "Peer #0",
        key: "aabbcc...8899",
        detail: "Sign: aabbcc...8899 deadbeef01",
        ttl: "42s",
      },
      {
        id: "row-ecdh",
        kind: "ECDH",
        peer: "Peer #1",
        key: "010203...3132",
        detail: "ECDH: 010203...3132",
        ttl: "1m 12s",
      },
      {
        id: "row-ping",
        kind: "PING",
        peer: "Peer #0",
        key: "aabbcc...8899",
        detail: "Ping: aabbcc...8899",
        ttl: "15s",
      },
      {
        id: "row-onboard",
        kind: "ONBOARD",
        peer: "Peer #1",
        key: "010203...3132",
        detail: "Onboard: 010203...3132",
        ttl: "3m 00s",
      },
    ];
    render(<PendingApprovalsPanel rows={rows} />);
    expect(screen.getByText("4 pending")).toBeInTheDocument();
    const domRows = Array.from(document.querySelectorAll(".pending-row"));
    expect(domRows).toHaveLength(4);
    const details = domRows.map((r) =>
      r.querySelector(".pending-detail")?.textContent,
    );
    expect(details[0]?.startsWith("Sign: ")).toBe(true);
    expect(details[1]?.startsWith("ECDH: ")).toBe(true);
    expect(details[2]?.startsWith("Ping: ")).toBe(true);
    expect(details[3]?.startsWith("Onboard: ")).toBe(true);
    const pills = domRows.map((r) => r.querySelector(".pending-kind")?.textContent);
    expect(pills).toEqual(["SIGN", "ECDH", "PING", "ONBOARD"]);
  });

  it("Nearest SLA label reflects the soonest TTL per the explicit nearest prop", () => {
    const rows: DashboardApprovalRow[] = [
      { id: "a", kind: "SIGN", peer: "Peer #0", key: "k", detail: "Sign: k", ttl: "1m 00s" },
      { id: "b", kind: "PING", peer: "Peer #1", key: "k", detail: "Ping: k", ttl: "10s" },
      { id: "c", kind: "ECDH", peer: "Peer #2", key: "k", detail: "ECDH: k", ttl: "1m 30s" },
    ];
    render(<PendingApprovalsPanel rows={rows} nearest="10s" />);
    expect(screen.getByText("Nearest: 10s")).toBeInTheDocument();
  });

  it("does not render an Open button when onOpenPolicyPrompt is not provided (runtime mode)", () => {
    const rows: DashboardApprovalRow[] = [
      {
        id: "row-sign",
        kind: "SIGN",
        peer: "Peer #0",
        key: "k",
        detail: "Sign: k",
        ttl: "42s",
      },
    ];
    render(<PendingApprovalsPanel rows={rows} />);
    expect(screen.queryByLabelText(/Open approval/i)).not.toBeInTheDocument();
  });

  it("renders an Open button for rows with a request payload when onOpenPolicyPrompt is provided (paper mode)", () => {
    const onOpen = vi.fn();
    const rows: DashboardApprovalRow[] = [
      {
        id: "row-sign",
        kind: "SIGN",
        peer: "Peer #0",
        key: "k",
        detail: "Sign: k",
        ttl: "42s",
        request: {
          kind: "SIGN",
          peer: "Peer #0",
          key: "k",
          domain: "primal.net",
          eventKind: "kind:1 (Short Text Note)",
          content: "gm",
          pubkey: "k",
          ttl: "42s",
        },
      },
    ];
    render(
      <PendingApprovalsPanel rows={rows} onOpenPolicyPrompt={onOpen} />,
    );
    const openBtn = screen.getByLabelText("Open approval 1");
    fireEvent.click(openBtn);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("PendingApprovalsPanel — collapsibility + persistence", () => {
  beforeEach(() => {
    __resetPendingApprovalsCollapseForTest();
  });

  it("defaults to expanded on first mount after reload", () => {
    const rows: DashboardApprovalRow[] = [
      { id: "a", kind: "SIGN", peer: "Peer #0", key: "k", detail: "Sign: k", ttl: "1s" },
    ];
    render(<PendingApprovalsPanel rows={rows} />);
    const header = screen.getByTestId("pending-approvals-header");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".pending-row").length).toBe(1);
  });

  it("toggling collapses and hides rows while keeping header + count pill visible", () => {
    const rows: DashboardApprovalRow[] = [
      { id: "a", kind: "SIGN", peer: "Peer #0", key: "k", detail: "Sign: k", ttl: "42s" },
      { id: "b", kind: "ECDH", peer: "Peer #1", key: "k", detail: "ECDH: k", ttl: "1m 12s" },
    ];
    render(<PendingApprovalsPanel rows={rows} />);
    const header = screen.getByTestId("pending-approvals-header");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll(".pending-row").length).toBe(0);
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".pending-row").length).toBe(2);
  });

  it("collapsed state persists across unmount+remount within the session (tab switch simulation)", () => {
    const rows: DashboardApprovalRow[] = [
      { id: "a", kind: "SIGN", peer: "Peer #0", key: "k", detail: "Sign: k", ttl: "42s" },
    ];
    const { unmount } = render(<PendingApprovalsPanel rows={rows} />);
    fireEvent.click(screen.getByTestId("pending-approvals-header"));
    expect(
      screen.getByTestId("pending-approvals-header").getAttribute("aria-expanded"),
    ).toBe("false");
    unmount();
    render(<PendingApprovalsPanel rows={rows} />);
    expect(
      screen.getByTestId("pending-approvals-header").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("resets to expanded when the module-level memo is cleared (page reload)", () => {
    const rows: DashboardApprovalRow[] = [
      { id: "a", kind: "SIGN", peer: "Peer #0", key: "k", detail: "Sign: k", ttl: "42s" },
    ];
    const { unmount } = render(<PendingApprovalsPanel rows={rows} />);
    fireEvent.click(screen.getByTestId("pending-approvals-header"));
    unmount();
    // Simulate page reload by clearing the memo.
    __resetPendingApprovalsCollapseForTest();
    render(<PendingApprovalsPanel rows={rows} />);
    expect(
      screen.getByTestId("pending-approvals-header").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("keyboard activation (Enter / Space) toggles the collapse state", () => {
    const rows: DashboardApprovalRow[] = [
      { id: "a", kind: "SIGN", peer: "Peer #0", key: "k", detail: "Sign: k", ttl: "42s" },
    ];
    render(<PendingApprovalsPanel rows={rows} />);
    const header = screen.getByTestId("pending-approvals-header");
    act(() => header.focus());
    fireEvent.keyDown(header, { key: "Enter" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(header, { key: " " });
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });
});
