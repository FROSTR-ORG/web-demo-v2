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

  if (pendingRuntimeWorkIsBlocked(input.runtimeStatus)) {
    return "signing-blocked";
  }

  return "running";
}
