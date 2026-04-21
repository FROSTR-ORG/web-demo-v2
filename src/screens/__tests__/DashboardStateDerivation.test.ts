import { describe, expect, it } from "vitest";
import type { RuntimeStatusSummary } from "../../lib/bifrost/types";
import { deriveDashboardState } from "../DashboardScreen/dashboardState";

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
});
