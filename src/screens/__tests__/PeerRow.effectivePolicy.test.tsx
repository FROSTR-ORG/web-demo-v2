import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PeerRow } from "../DashboardScreen/panels/PeerRow";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../lib/bifrost/types";

/**
 * m3-peer-policies-view — PeerRow inline badges must derive from
 * `peer_permission_states[*].effective_policy.request.*` when a
 * permission state is provided, not from the legacy
 * `can_sign` / `should_send_nonces` heuristics (VAL-POLICIES-006,
 * VAL-POLICIES-005, VAL-POLICIES-020).
 *
 * With a permission state wired in, the badge set rendered for a peer
 * must match 1:1 the allowed-verb set shown in the Peer Policies
 * panel — no heuristic leakage.
 */

const PEER_PUBKEY = ["peer-effective-policy-", "0123456789abcdef"].join("");

function makePeer(overrides: Partial<PeerStatus> = {}): PeerStatus {
  return {
    idx: 1,
    pubkey: PEER_PUBKEY,
    known: true,
    last_seen: 1000,
    online: true,
    incoming_available: 50,
    outgoing_available: 50,
    outgoing_spent: 0,
    can_sign: true,
    should_send_nonces: true,
    ...overrides,
  };
}

function makePermissionState(
  effective: Record<string, unknown>,
  overrides: Partial<PeerPermissionState> = {},
): PeerPermissionState {
  return {
    pubkey: PEER_PUBKEY,
    manual_override: null,
    remote_observation: null,
    effective_policy: effective,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-21T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PeerRow — effective_policy-driven badges (VAL-POLICIES-006)", () => {
  it("renders only the allowed verbs from effective_policy.request when provided", () => {
    const peer = makePeer({ can_sign: true, should_send_nonces: true });
    const permissionState = makePermissionState({
      request: {
        sign: "allow",
        ecdh: "allow",
        ping: "allow",
        onboard: "deny",
      },
      respond: {},
    });

    render(<PeerRow peer={peer} permissionState={permissionState} />);

    expect(screen.getByText("SIGN")).toBeInTheDocument();
    expect(screen.getByText("ECDH")).toBeInTheDocument();
    expect(screen.getByText("PING")).toBeInTheDocument();
    expect(screen.queryByText("ONBOARD")).not.toBeInTheDocument();
  });

  it("omits SIGN badge when effective_policy.request.sign=deny even though peer.can_sign=true (no heuristic leakage)", () => {
    const peer = makePeer({
      can_sign: true,
      should_send_nonces: true,
    });
    const permissionState = makePermissionState({
      request: {
        sign: "deny",
        ecdh: "deny",
        ping: "deny",
        onboard: "deny",
      },
      respond: {},
    });

    render(<PeerRow peer={peer} permissionState={permissionState} />);

    expect(screen.queryByText("SIGN")).not.toBeInTheDocument();
    expect(screen.queryByText("ECDH")).not.toBeInTheDocument();
    expect(screen.queryByText("PING")).not.toBeInTheDocument();
    expect(screen.queryByText("ONBOARD")).not.toBeInTheDocument();
  });

  it("accepts the flat effective_policy shape used by demo fixtures", () => {
    const peer = makePeer();
    const permissionState = makePermissionState({
      sign: "allow",
      ecdh: "deny",
      ping: "allow",
      onboard: "allow",
    });

    render(<PeerRow peer={peer} permissionState={permissionState} />);

    expect(screen.getByText("SIGN")).toBeInTheDocument();
    expect(screen.queryByText("ECDH")).not.toBeInTheDocument();
    expect(screen.getByText("PING")).toBeInTheDocument();
    expect(screen.getByText("ONBOARD")).toBeInTheDocument();
  });

  it("treats 'ask' / 'unset' as ungranted (muted/omitted)", () => {
    const peer = makePeer();
    const permissionState = makePermissionState({
      request: {
        sign: "ask",
        ecdh: "unset",
        ping: "allow",
        onboard: "ask",
      },
      respond: {},
    });

    render(<PeerRow peer={peer} permissionState={permissionState} />);

    expect(screen.queryByText("SIGN")).not.toBeInTheDocument();
    expect(screen.queryByText("ECDH")).not.toBeInTheDocument();
    expect(screen.getByText("PING")).toBeInTheDocument();
    expect(screen.queryByText("ONBOARD")).not.toBeInTheDocument();
  });

  it("falls back to heuristics when permissionState is absent (backwards compat)", () => {
    const peer = makePeer({
      can_sign: true,
      should_send_nonces: true,
    });

    // No permissionState prop — should use legacy can_sign / should_send_nonces.
    render(<PeerRow peer={peer} />);

    expect(screen.getByText("SIGN")).toBeInTheDocument();
    expect(screen.getByText("ECDH")).toBeInTheDocument();
  });

  it("does not render any badges for offline peers even if effective_policy grants verbs", () => {
    const peer = makePeer({
      online: false,
      can_sign: false,
      should_send_nonces: false,
      incoming_available: 0,
      outgoing_available: 0,
    });
    const permissionState = makePermissionState({
      request: {
        sign: "allow",
        ecdh: "allow",
        ping: "allow",
        onboard: "allow",
      },
      respond: {},
    });

    render(<PeerRow peer={peer} permissionState={permissionState} />);

    expect(screen.queryByText("SIGN")).not.toBeInTheDocument();
    expect(screen.queryByText("ECDH")).not.toBeInTheDocument();
    expect(screen.queryByText("PING")).not.toBeInTheDocument();
    expect(screen.queryByText("ONBOARD")).not.toBeInTheDocument();
  });
});
