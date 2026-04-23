import { describe, expect, it } from "vitest";
import type {
  PeerPermissionState,
  PeerStatus,
  RuntimeStatusSummary,
} from "../../lib/bifrost/types";
import { isNoncePoolDepleted } from "../DashboardScreen/dashboardState";

/**
 * Focused tests for the narrowed nonce-pool-depletion heuristic.
 *
 * Feature `fix-m1-nonce-depletion-detection-policy-gated` requires that
 * `isNoncePoolDepleted` no longer false-positives when `sign_ready === false`
 * is caused purely by policy gating (peers lacking
 * `effective_policy.request.sign`). Covers the behavior required by
 * VAL-OPS-012 / VAL-OPS-017 / VAL-OPS-018 without regressing VAL-OPS-024's
 * "Trigger Sync" overlay in genuine nonce-depletion cases.
 */

function peer(
  idx: number,
  pubkey: string,
  overrides: Partial<PeerStatus> = {},
): PeerStatus {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: 1,
    online: true,
    incoming_available: 0,
    outgoing_available: 0,
    outgoing_spent: 0,
    can_sign: false,
    should_send_nonces: true,
    ...overrides,
  };
}

function permission(
  pubkey: string,
  signValue: "unset" | "allow" | "deny",
): PeerPermissionState {
  return {
    pubkey,
    manual_override: null,
    remote_observation: null,
    effective_policy: {
      request: {
        sign: signValue,
        ecdh: "allow",
        ping: "allow",
        onboard: "unset",
        echo: "allow",
      },
      respond: {
        sign: "allow",
        ecdh: "allow",
        ping: "allow",
        onboard: "unset",
        echo: "allow",
      },
    },
  };
}

function status(overrides: Partial<RuntimeStatusSummary> = {}): RuntimeStatusSummary {
  return {
    status: {
      device_id: "local",
      pending_ops: 0,
      last_active: 1,
      known_peers: 2,
      request_seq: 0,
    },
    metadata: {
      device_id: "local",
      member_idx: 0,
      share_public_key: "local-pk",
      group_public_key: "group-pk",
      peers: ["peer-a", "peer-b"],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: false,
      ecdh_ready: false,
      threshold: 2,
      signing_peer_count: 0,
      ecdh_peer_count: 0,
      last_refresh_at: 1,
      degraded_reasons: ["insufficient_signing_peers"],
    },
    peers: [peer(1, "peer-a"), peer(2, "peer-b")],
    peer_permission_states: [],
    pending_operations: [],
    ...overrides,
  };
}

describe("isNoncePoolDepleted — narrowed policy-aware heuristic", () => {
  it("pure nonce depletion (policy allows, can_sign=false) → true", () => {
    // Peers are online, policy permits sign requests to each, but their
    // nonce pool is empty (`can_sign=false`). This is the case where the
    // user should see the "Syncing nonces" banner + Trigger Sync button.
    expect(
      isNoncePoolDepleted(
        status({
          peer_permission_states: [
            permission("peer-a", "allow"),
            permission("peer-b", "allow"),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("pure policy denial (peers can_sign=true but request.sign=deny for all) → false", () => {
    // Peers are online and each has nonces ready (`can_sign=true`), but
    // policy forbids outbound sign requests to every peer. The dashboard
    // must NOT render the nonce-sync affordance — SIGNING_BLOCKED should
    // surface policy CTAs ("Open Policies" / "Review Approvals") only.
    expect(
      isNoncePoolDepleted(
        status({
          peers: [
            peer(1, "peer-a", { can_sign: true, incoming_available: 8 }),
            peer(2, "peer-b", { can_sign: true, incoming_available: 8 }),
          ],
          peer_permission_states: [
            permission("peer-a", "deny"),
            permission("peer-b", "deny"),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("pure policy denial via unset-without-allow default (resolved deny) → false", () => {
    // When effective_policy.request.sign is not "allow" for any peer
    // (e.g. runtime defaults to Deny and peers are unset), policy still
    // blocks sign — even with abundant nonces. No Trigger Sync.
    expect(
      isNoncePoolDepleted(
        status({
          peers: [
            peer(1, "peer-a", { can_sign: true }),
            peer(2, "peer-b", { can_sign: true }),
          ],
          peer_permission_states: [
            permission("peer-a", "deny"),
            permission("peer-b", "deny"),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("mixed: enough policy-allowed peers are nonce-starved → true (nonce is the blocker)", () => {
    // 3 peers online, threshold 2. One is policy-denied, the other two
    // are policy-allowed but nonce-drained. Since 2 policy-allowed peers
    // could meet threshold if nonces recovered, the actual bottleneck is
    // nonces — render the Trigger Sync affordance.
    expect(
      isNoncePoolDepleted(
        status({
          metadata: {
            device_id: "local",
            member_idx: 0,
            share_public_key: "local-pk",
            group_public_key: "group-pk",
            peers: ["peer-a", "peer-b", "peer-c"],
          },
          peers: [
            peer(1, "peer-a", { can_sign: false }),
            peer(2, "peer-b", { can_sign: false }),
            peer(3, "peer-c", { can_sign: true }),
          ],
          peer_permission_states: [
            permission("peer-a", "allow"),
            permission("peer-b", "allow"),
            permission("peer-c", "deny"),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("mixed: policy-denied peers prevent meeting threshold even if nonces recovered → false", () => {
    // 3 peers online, threshold 2. Two are policy-denied; one is
    // policy-allowed with can_sign=false. Even if nonces recovered on
    // the lone policy-allowed peer, we could not meet threshold without
    // policy changes. Policy is the real blocker.
    expect(
      isNoncePoolDepleted(
        status({
          metadata: {
            device_id: "local",
            member_idx: 0,
            share_public_key: "local-pk",
            group_public_key: "group-pk",
            peers: ["peer-a", "peer-b", "peer-c"],
          },
          peers: [
            peer(1, "peer-a", { can_sign: false }),
            peer(2, "peer-b", { can_sign: true }),
            peer(3, "peer-c", { can_sign: true }),
          ],
          peer_permission_states: [
            permission("peer-a", "allow"),
            permission("peer-b", "deny"),
            permission("peer-c", "deny"),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("explicit runtime nonce degraded reason overrides policy analysis → true", () => {
    // If the runtime itself ever surfaces a nonce-pool signal in
    // `degraded_reasons` (forward-compatibility with bifrost-rs),
    // we trust the runtime even when policy would otherwise look like
    // the blocker.
    expect(
      isNoncePoolDepleted(
        status({
          readiness: {
            runtime_ready: true,
            restore_complete: true,
            sign_ready: false,
            ecdh_ready: false,
            threshold: 2,
            signing_peer_count: 0,
            ecdh_peer_count: 0,
            last_refresh_at: 1,
            // Cast: bifrost-rs may emit additional nonce-related reasons
            // that the current typed enum does not yet enumerate.
            degraded_reasons: [
              "nonce_pool_exhausted",
            ] as unknown as RuntimeStatusSummary["readiness"]["degraded_reasons"],
          },
          peers: [
            peer(1, "peer-a", { can_sign: true }),
            peer(2, "peer-b", { can_sign: true }),
          ],
          peer_permission_states: [
            permission("peer-a", "deny"),
            permission("peer-b", "deny"),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("explicit readiness.nonce_pool_depleted flag → true (forward-compat)", () => {
    // Forward-compatibility: if bifrost-rs adds an explicit field on
    // readiness, the heuristic trusts it.
    const s = status({
      peer_permission_states: [
        permission("peer-a", "deny"),
        permission("peer-b", "deny"),
      ],
    });
    (s.readiness as unknown as Record<string, unknown>).nonce_pool_depleted = true;
    expect(isNoncePoolDepleted(s)).toBe(true);
  });

  it("sign_ready=true short-circuits to false regardless of other state", () => {
    expect(
      isNoncePoolDepleted(
        status({
          readiness: {
            runtime_ready: true,
            restore_complete: true,
            sign_ready: true,
            ecdh_ready: true,
            threshold: 2,
            signing_peer_count: 2,
            ecdh_peer_count: 2,
            last_refresh_at: 1,
            degraded_reasons: [],
          },
          peers: [
            peer(1, "peer-a", { can_sign: true }),
            peer(2, "peer-b", { can_sign: true }),
          ],
          peer_permission_states: [
            permission("peer-a", "allow"),
            permission("peer-b", "allow"),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("below-threshold online peers → false (connectivity is the blocker, not nonces)", () => {
    expect(
      isNoncePoolDepleted(
        status({
          peers: [
            peer(1, "peer-a", { online: true }),
            peer(2, "peer-b", { online: false }),
          ],
          peer_permission_states: [
            permission("peer-a", "allow"),
            permission("peer-b", "allow"),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("legacy state (no peer_permission_states) preserves existing heuristic → true", () => {
    // Guards against regressions in callers that have not yet surfaced
    // peer_permission_states (e.g. early-boot frames, demo fixtures).
    expect(isNoncePoolDepleted(status())).toBe(true);
  });
});
