import type { RuntimeStatusSummary } from "../../lib/bifrost/types";
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
 * Heuristic for detecting a depleted FROST nonce pool.
 *
 * The WASM runtime does NOT emit a dedicated `nonce_pool_exhausted` entry
 * in `readiness.degraded_reasons` — it only emits
 * `insufficient_signing_peers` when `signing_peer_count < threshold`. That
 * bucket covers two distinct conditions: (a) not enough peers are online,
 * and (b) peers are online but the nonce pool with them is empty so
 * `can_sign` is false. Only (b) is fixable by the user clicking
 * "Trigger Sync"; for (a) the user must wait for peers to come back.
 *
 * We distinguish the two by comparing the number of online peers to the
 * signing threshold. If enough peers are online but signing is still
 * blocked, the bottleneck is the nonce pool — not peer availability.
 */
export function isNoncePoolDepleted(status: RuntimeStatusSummary): boolean {
  const { readiness, peers } = status;
  if (readiness.sign_ready) return false;
  const onlinePeerCount = peers.filter((peer) => peer.online).length;
  return onlinePeerCount >= readiness.threshold;
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
