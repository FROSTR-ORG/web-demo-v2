import { describe, expect, it } from "vitest";
import type { RuntimeStatusSummary } from "../../lib/bifrost/types";
import {
  deriveDashboardState,
  isNoncePoolDepleted,
} from "../DashboardScreen/dashboardState";

function runtimeStatus(
  overrides: Partial<RuntimeStatusSummary> = {},
): RuntimeStatusSummary {
  return {
    status: {
      device_id: "device",
      pending_ops: 0,
      last_active: 1,
      known_peers: 2,
      request_seq: 1,
    },
    metadata: {
      device_id: "device",
      member_idx: 0,
      share_public_key: "local",
      group_public_key: "group",
      peers: ["peer-a", "peer-b"],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 1,
      signing_peer_count: 1,
      ecdh_peer_count: 1,
      last_refresh_at: 10,
      degraded_reasons: [],
    },
    peers: [
      {
        idx: 1,
        pubkey: "peer-a",
        known: true,
        last_seen: 10,
        online: true,
        incoming_available: 4,
        outgoing_available: 4,
        outgoing_spent: 0,
        can_sign: true,
        should_send_nonces: true,
      },
    ],
    peer_permission_states: [],
    pending_operations: [],
    ...overrides,
  };
}

describe("deriveDashboardState", () => {
  it("shows stopped when the signer is paused", () => {
    expect(
      deriveDashboardState({
        signerPaused: true,
        runtimeStatus: runtimeStatus(),
        runtimeRelays: [{ url: "wss://relay.test", state: "online" }],
      }),
    ).toBe("stopped");
  });

  it("shows connecting while any relay is still connecting", () => {
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: runtimeStatus(),
        runtimeRelays: [{ url: "wss://relay.test", state: "connecting" }],
      }),
    ).toBe("connecting");
  });

  it("shows all-relays-offline when every configured relay failed", () => {
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: runtimeStatus(),
        runtimeRelays: [
          { url: "wss://one.test", state: "offline" },
          { url: "wss://two.test", state: "offline" },
        ],
      }),
    ).toBe("relays-offline");
  });

  it("shows connecting after relay connection but before peer refresh", () => {
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: runtimeStatus({
          readiness: {
            ...runtimeStatus().readiness,
            last_refresh_at: null,
          },
          peers: runtimeStatus().peers.map((peer) => ({
            ...peer,
            last_seen: null,
          })),
        }),
        runtimeRelays: [{ url: "wss://relay.test", state: "online" }],
      }),
    ).toBe("connecting");
  });

  it("shows signing-blocked for blocked pending sign work", () => {
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: runtimeStatus({
          readiness: {
            ...runtimeStatus().readiness,
            sign_ready: false,
          },
          pending_operations: [
            {
              op_type: "Sign",
              request_id: "request-1",
              started_at: 1,
              timeout_at: 31,
              target_peers: ["peer-a"],
              threshold: 1,
              collected_responses: [],
              context: {},
            },
          ],
        }),
        runtimeRelays: [{ url: "wss://relay.test", state: "online" }],
      }),
    ).toBe("signing-blocked");
  });

  it("shows running for a refreshed ready runtime", () => {
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: runtimeStatus(),
        runtimeRelays: [{ url: "wss://relay.test", state: "online" }],
      }),
    ).toBe("running");
  });

  // m1-signing-blocked-and-nonce-overlay: the dashboard must transition into
  // `signing-blocked` the moment readiness surfaces `!sign_ready` — even if
  // no sign is currently queued. Without this, the UI would only react after
  // the user already dispatched a request that can't complete, and the Paper
  // "Signing Blocked" state would never appear with 0 online peers.
  it("shows signing-blocked when readiness is not sign_ready with no pending ops", () => {
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: runtimeStatus({
          readiness: {
            ...runtimeStatus().readiness,
            sign_ready: false,
            signing_peer_count: 0,
            degraded_reasons: ["insufficient_signing_peers"],
          },
          peers: [],
        }),
        runtimeRelays: [{ url: "wss://relay.test", state: "online" }],
      }),
    ).toBe("signing-blocked");
  });
});

// ---------------------------------------------------------------------------
// Nonce-pool-depletion heuristic exported for the SigningBlockedState overlay
// ---------------------------------------------------------------------------

describe("isNoncePoolDepleted", () => {
  function baseStatus(
    overrides: Partial<RuntimeStatusSummary> = {},
  ): RuntimeStatusSummary {
    return {
      status: {
        device_id: "d",
        pending_ops: 0,
        last_active: 1,
        known_peers: 2,
        request_seq: 0,
      },
      metadata: {
        device_id: "d",
        member_idx: 0,
        share_public_key: "local",
        group_public_key: "group",
        peers: ["peer-a", "peer-b"],
      },
      readiness: {
        runtime_ready: false,
        restore_complete: true,
        sign_ready: false,
        ecdh_ready: false,
        threshold: 2,
        signing_peer_count: 0,
        ecdh_peer_count: 0,
        last_refresh_at: 1,
        degraded_reasons: ["insufficient_signing_peers"],
      },
      peers: [
        {
          idx: 1,
          pubkey: "peer-a",
          known: true,
          last_seen: 1,
          online: true,
          incoming_available: 0,
          outgoing_available: 0,
          outgoing_spent: 0,
          can_sign: false,
          should_send_nonces: true,
        },
        {
          idx: 2,
          pubkey: "peer-b",
          known: true,
          last_seen: 1,
          online: true,
          incoming_available: 0,
          outgoing_available: 0,
          outgoing_spent: 0,
          can_sign: false,
          should_send_nonces: true,
        },
      ],
      peer_permission_states: [],
      pending_operations: [],
      ...overrides,
    };
  }

  it("is true when enough peers are online but sign_ready is false", () => {
    // Nonce pool has drained even though peers are reachable — the runtime's
    // FROST signing gate (can_sign) requires fresh nonces from each peer.
    expect(isNoncePoolDepleted(baseStatus())).toBe(true);
  });

  it("is false when sign_ready is true (ready to sign, pool is healthy)", () => {
    expect(
      isNoncePoolDepleted(
        baseStatus({
          readiness: {
            ...baseStatus().readiness,
            sign_ready: true,
            signing_peer_count: 2,
            degraded_reasons: [],
          },
          peers: baseStatus().peers.map((peer) => ({
            ...peer,
            can_sign: true,
            incoming_available: 8,
            outgoing_available: 8,
          })),
        }),
      ),
    ).toBe(false);
  });

  it("is false when insufficient peers are online (bottleneck is peers, not nonces)", () => {
    expect(
      isNoncePoolDepleted(
        baseStatus({
          peers: baseStatus().peers.map((peer, idx) => ({
            ...peer,
            online: idx === 0, // only one online, threshold is 2
          })),
        }),
      ),
    ).toBe(false);
  });
});

describe("deriveDashboardState — nonce pool depletion", () => {
  it("transitions to signing-blocked when nonce pool is depleted", () => {
    // Peers are online and reachable, but nonces are exhausted with all of
    // them — sign_ready is false. The dashboard must surface this condition
    // in the SIGNING_BLOCKED overlay, not silently stay in "running".
    expect(
      deriveDashboardState({
        signerPaused: false,
        runtimeStatus: {
          status: {
            device_id: "d",
            pending_ops: 0,
            last_active: 1,
            known_peers: 2,
            request_seq: 0,
          },
          metadata: {
            device_id: "d",
            member_idx: 0,
            share_public_key: "local",
            group_public_key: "group",
            peers: ["peer-a", "peer-b"],
          },
          readiness: {
            runtime_ready: false,
            restore_complete: true,
            sign_ready: false,
            ecdh_ready: false,
            threshold: 2,
            signing_peer_count: 0,
            ecdh_peer_count: 0,
            last_refresh_at: 1,
            degraded_reasons: ["insufficient_signing_peers"],
          },
          peers: [
            {
              idx: 1,
              pubkey: "peer-a",
              known: true,
              last_seen: 1,
              online: true,
              incoming_available: 0,
              outgoing_available: 0,
              outgoing_spent: 0,
              can_sign: false,
              should_send_nonces: true,
            },
            {
              idx: 2,
              pubkey: "peer-b",
              known: true,
              last_seen: 1,
              online: true,
              incoming_available: 0,
              outgoing_available: 0,
              outgoing_spent: 0,
              can_sign: false,
              should_send_nonces: true,
            },
          ],
          peer_permission_states: [],
          pending_operations: [],
        },
        runtimeRelays: [{ url: "wss://relay.test", state: "online" }],
      }),
    ).toBe("signing-blocked");
  });
});
