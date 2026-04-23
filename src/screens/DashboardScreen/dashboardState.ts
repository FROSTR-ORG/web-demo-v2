import type {
  PeerPermissionState,
  PeerStatus,
  RuntimeStatusSummary,
} from "../../lib/bifrost/types";
import type { RuntimeRelayStatus } from "../../lib/relay/runtimeRelayPump";
import type { DashboardState } from "./types";

function pendingRuntimeWorkIsBlocked(status: RuntimeStatusSummary): boolean {
  return status.pending_operations.some((operation) => {
    if (operation.op_type === "Sign") {
      return !status.readiness.sign_ready;
    }
    if (operation.op_type === "Ecdh") {
      return !status.readiness.ecdh_ready;
    }
    return false;
  });
}

function hasCompletedPeerRefresh(status: RuntimeStatusSummary): boolean {
  return (
    status.readiness.last_refresh_at !== null ||
    status.peers.some((peer) => peer.last_seen !== null)
  );
}

/**
 * Returns true iff `effective_policy.request.sign` for `peer` resolves to
 * `allow` (either the literal string `"allow"` or boolean `true`). Any
 * other value — `"deny"`, `"unset"`, missing, unknown — is treated as
 * *not* permitting outbound sign requests. This mirrors the PoliciesState
 * "granted" rule so the Peer Policies card and the nonce-depletion
 * heuristic stay consistent (VAL-POLICIES-005).
 *
 * Note: the runtime may resolve `unset` to allow or deny depending on the
 * default policy, but by the time we inspect `effective_policy` the
 * runtime has already collapsed the default into the concrete value —
 * so treating only literal `allow`/`true` as permitting is safe here.
 */
function peerPolicyAllowsRequestSign(
  peer: PeerStatus,
  permissionStates: PeerPermissionState[],
): boolean {
  const state = permissionStates.find(
    (entry) => entry.pubkey === peer.pubkey,
  );
  if (!state) {
    // No peer_permission_state surfaced yet (early boot / demo fixtures):
    // fall back to treating the peer as policy-permitting so the legacy
    // heuristic remains intact. Downstream callers that *do* surface
    // permission states will get the narrowed behavior.
    return true;
  }
  const effective = state.effective_policy as
    | ({ request?: Record<string, unknown> } & Record<string, unknown>)
    | null
    | undefined;
  const value = effective?.request?.sign ?? effective?.sign;
  return value === true || value === "allow";
}

/**
 * Heuristic for detecting a depleted FROST nonce pool.
 *
 * The WASM runtime does NOT emit a dedicated `nonce_pool_exhausted` entry
 * in `readiness.degraded_reasons` — it only emits
 * `insufficient_signing_peers` when `signing_peer_count < threshold`. That
 * bucket covers three distinct conditions once policy is considered:
 *  (a) not enough peers are online,
 *  (b) peers are online and policy permits sign, but their nonce pool is
 *      empty so `can_sign` is false,
 *  (c) peers are online and have nonces, but our policy denies outbound
 *      sign requests (`effective_policy.request.sign !== "allow"`).
 *
 * Only (b) is fixable by clicking "Trigger Sync". For (a) the user must
 * wait for peers to reconnect; for (c) they must update policies or
 * review approvals. Showing the nonce-sync affordance in (c) is
 * actively misleading, so we narrow this check accordingly.
 *
 * Decision order:
 *  1. If readiness reports nonce exhaustion directly (future-compat
 *     string in `degraded_reasons`, explicit `nonce_pool_depleted` /
 *     `low_nonce` field), trust the runtime signal → `true`.
 *  2. If online peer count is below threshold, connectivity is the
 *     blocker, not nonces → `false`.
 *  3. If `peer_permission_states` are surfaced and fewer than
 *     `threshold` online peers have `effective_policy.request.sign`
 *     resolving to `allow`, policy is the blocker → `false`.
 *  4. Otherwise, we have ≥ threshold online + policy-allowed peers but
 *     `sign_ready === false`, so nonces must be the bottleneck → `true`.
 *
 * Covers VAL-OPS-012 / VAL-OPS-017 / VAL-OPS-018 (policy/paused gating
 * must not trigger nonce-sync copy) while preserving VAL-OPS-024 for
 * genuine nonce-depletion scenarios.
 */
export function isNoncePoolDepleted(status: RuntimeStatusSummary): boolean {
  const { readiness, peers } = status;
  // `peer_permission_states` is typed non-optional but some fixtures and
  // early-boot frames omit it. Default to an empty array so the
  // policy-aware branch simply falls through to the legacy heuristic
  // rather than crashing on `.length` / `.find`.
  const peer_permission_states = status.peer_permission_states ?? [];
  if (readiness.sign_ready) return false;

  // (1) Trust an explicit runtime signal when it shows up. This keeps
  // the heuristic forward-compatible with bifrost-rs adding a
  // dedicated nonce reason to `degraded_reasons` without requiring a
  // follow-up web-demo-v2 change.
  const hasNonceDegradedReason = readiness.degraded_reasons.some(
    (reason) =>
      typeof reason === "string" && reason.toLowerCase().includes("nonce"),
  );
  if (hasNonceDegradedReason) return true;

  const readinessUnknown = readiness as unknown as Record<string, unknown>;
  if (readinessUnknown.nonce_pool_depleted === true) return true;
  if (readinessUnknown.low_nonce === true) return true;

  // (2) Connectivity floor: if fewer than `threshold` peers are online,
  // peer availability — not nonces — is the bottleneck.
  const onlinePeers = peers.filter((peer) => peer.online);
  if (onlinePeers.length < readiness.threshold) return false;

  // (3) Policy floor: if callers surface per-peer permission states and
  // policy forbids sign requests to enough peers that we could never
  // meet threshold (even with a full nonce pool), policy is the blocker.
  if (peer_permission_states.length > 0) {
    const policyAllowedOnlinePeers = onlinePeers.filter((peer) =>
      peerPolicyAllowsRequestSign(peer, peer_permission_states),
    );
    if (policyAllowedOnlinePeers.length < readiness.threshold) return false;
  }

  // (4) Enough peers online + policy permits sign for ≥ threshold of
  // them, yet `sign_ready === false`. The only remaining knob is the
  // nonce pool with those peers — show Trigger Sync.
  return true;
}

/**
 * True when readiness indicates we cannot sign right now: either
 * `sign_ready === false` (insufficient signing_peer_count or depleted
 * nonce pool) or there is a pending sign/ECDH op that cannot complete
 * under the current readiness.
 *
 * Exported so the dashboard can derive the same signal outside the
 * dashboardState transition (e.g. to surface the Trigger Sync overlay
 * even while another non-signing state might otherwise win).
 */
export function isSigningBlocked(status: RuntimeStatusSummary): boolean {
  if (!status.readiness.sign_ready) return true;
  return pendingRuntimeWorkIsBlocked(status);
}

export function deriveDashboardState(input: {
  signerPaused: boolean;
  runtimeStatus: RuntimeStatusSummary;
  runtimeRelays: RuntimeRelayStatus[];
}): DashboardState {
  if (input.signerPaused) {
    return "stopped";
  }

  if (input.runtimeRelays.some((relay) => relay.state === "connecting")) {
    return "connecting";
  }

  if (
    input.runtimeRelays.length > 0 &&
    input.runtimeRelays.every((relay) => relay.state === "offline")
  ) {
    return "relays-offline";
  }

  if (
    input.runtimeRelays.some((relay) => relay.state === "online") &&
    !hasCompletedPeerRefresh(input.runtimeStatus)
  ) {
    return "connecting";
  }

  if (isSigningBlocked(input.runtimeStatus)) {
    return "signing-blocked";
  }

  return "running";
}
