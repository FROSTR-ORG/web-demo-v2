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

  it("renders all effective_policy-granted badges for offline peers in runtime mode (cross-surface parity with PoliciesState)", () => {
    // Regression coverage for `fix-m3-peerrow-badges-render-for-offline-peers`.
    // Scrutiny flagged that PeerRow's legacy offline-hiding behaviour broke
    // VAL-POLICIES-001 cross-surface parity with PoliciesState, which
    // renders chips from `effective_policy` unconditionally. When a live
    // permission state is provided (runtime mode), PeerRow must render
    // the same four badges derived from `effective_policy.request.*` so
    // the two surfaces never disagree for the same (peer, verb). The
    // offline visual treatment is conveyed by the `.peer-row.offline`
    // container (greyed opacity + red online dot), not by hiding badges.
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

    const { container } = render(
      <PeerRow peer={peer} permissionState={permissionState} />,
    );

    // Badges remain visible regardless of `peer.online` when a
    // permission state is wired in — each verb granted by
    // `effective_policy.request.*` surfaces as an inline badge.
    expect(screen.getByText("SIGN")).toBeInTheDocument();
    expect(screen.getByText("ECDH")).toBeInTheDocument();
    expect(screen.getByText("PING")).toBeInTheDocument();
    expect(screen.getByText("ONBOARD")).toBeInTheDocument();

    // The subtle offline indication is carried by the enclosing row's
    // `.offline` modifier (opacity + red dot), not by badge hiding.
    const row = container.querySelector(".peer-row");
    expect(row).not.toBeNull();
    expect(row!.classList.contains("offline")).toBe(true);

    // The trailing slot still renders the "Offline" affordance so the
    // user has a dedicated label, complementing the greyed container.
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("still suppresses offline-peer badges in Paper fixture mode (no runtime permissionState) — preserves demo-gallery pixel parity", () => {
    // The Paper fixture path (`paper=true`, no runtime permissionState)
    // must keep the legacy offline-hiding behaviour so
    // `demo-gallery.spec.ts` and the `dashboard-running` pixel-parity
    // regression specs do not drift from the Paper reference.
    const peer = makePeer({
      online: false,
      can_sign: true,
      should_send_nonces: true,
      incoming_available: 0,
      outgoing_available: 0,
    });

    render(<PeerRow peer={peer} paper />);

    expect(screen.queryByText("SIGN")).not.toBeInTheDocument();
    expect(screen.queryByText("ECDH")).not.toBeInTheDocument();
    expect(screen.queryByText("PING")).not.toBeInTheDocument();
    expect(screen.queryByText("ONBOARD")).not.toBeInTheDocument();
  });
});
