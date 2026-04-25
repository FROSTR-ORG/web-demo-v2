import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PeerRow } from "../DashboardScreen/panels/PeerRow";
import type { PeerStatus } from "../../lib/bifrost/types";

/**
 * PeerRow latency slot — keeps the Peers panel trailing column compact.
 * Runtime mode renders only fresh measured peer RTT samples. Paper mode
 * keeps the static reference tokens for visual parity.
 */

const PEER_PUBKEY = ["peer-latency-", "abcdef0123"].join("");

function makePeer(overrides: Partial<PeerStatus> = {}): PeerStatus {
  return {
    idx: 1,
    pubkey: PEER_PUBKEY,
    known: true,
    last_seen: Date.now(),
    online: true,
    incoming_available: 50,
    outgoing_available: 50,
    outgoing_spent: 0,
    can_sign: true,
    should_send_nonces: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("PeerRow latency slot — runtime mode", () => {
  it("renders a compact placeholder until a fresh sample exists", () => {
    render(<PeerRow peer={makePeer({ idx: 0 })} nowMs={10_000} />);

    expect(screen.getByTestId("peer-latency-0").textContent).toBe("--");
    expect(screen.queryByText(/Last seen/i)).not.toBeInTheDocument();
  });

  it("renders fresh measured peer RTT samples", () => {
    render(
      <PeerRow
        peer={makePeer({ idx: 1 })}
        latencySample={{
          latencyMs: 47,
          measuredAt: 10_000,
          requestId: "req-ping-1",
          source: "user",
        }}
        nowMs={10_500}
      />,
    );

    expect(screen.getByTestId("peer-latency-1").textContent).toBe("47ms");
  });

  it("ignores stale measured samples", () => {
    render(
      <PeerRow
        peer={makePeer({ idx: 7 })}
        latencySample={{
          latencyMs: 47,
          measuredAt: 10_000,
          requestId: "req-ping-1",
          source: "refresh",
        }}
        nowMs={70_001}
      />,
    );

    expect(screen.getByTestId("peer-latency-7").textContent).toBe("--");
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});

describe("PeerRow latency slot — Paper / fallback states", () => {
  it("paper mode renders the same compact millisecond token", () => {
    render(<PeerRow peer={makePeer({ idx: 0 })} paper />);

    expect(screen.getByTestId("peer-latency-0").textContent).toBe("24ms");
  });

  it("offline peers render 'Offline' instead of a latency element", () => {
    const peer = makePeer({
      online: false,
      can_sign: false,
      should_send_nonces: false,
      incoming_available: 0,
      outgoing_available: 0,
    });

    render(<PeerRow peer={peer} />);

    expect(screen.queryByTestId("peer-latency-1")).not.toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("refreshError takes precedence over latency", () => {
    render(
      <PeerRow
        peer={makePeer({ idx: 0 })}
        refreshError={{ code: "timeout", message: "peer unreachable" }}
      />,
    );

    const errorEl = screen.getByTestId("peer-refresh-error-0");
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.getAttribute("title")).toBe("peer unreachable");
    expect(screen.queryByTestId("peer-latency-0")).not.toBeInTheDocument();
  });
});
