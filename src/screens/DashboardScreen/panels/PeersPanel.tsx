import { HelpCircle, RotateCw } from "lucide-react";
import { useMemo } from "react";
import { Button, StatusPill } from "../../../components/ui";
import { Collapsible } from "../../../components/Collapsible";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../../lib/bifrost/types";
import { PeerRow, type PeerRefreshErrorInfo } from "./PeerRow";

export function PeersPanel({
  peers,
  onlineCount,
  signReadyLabel,
  paperPanels,
  sidebarOpen,
  onRefresh,
  peerRefreshErrors,
  peerPermissionStates,
}: {
  peers: PeerStatus[];
  onlineCount: number;
  signReadyLabel: string;
  paperPanels: boolean;
  sidebarOpen?: boolean;
  onRefresh: () => void | Promise<void>;
  /**
   * Map of `peer.pubkey` → latest refresh failure for peers that were
   * offline at the last `refresh_all_peers` dispatch and whose
   * corresponding ping op failed. PeerRow renders an inline error
   * indicator per VAL-OPS-011 when this is present. Peers not in the map
   * (or that have since responded) render the default online/offline
   * latency slot.
   */
  peerRefreshErrors?: Record<string, PeerRefreshErrorInfo>;
  /**
   * Live `runtime_status.peer_permission_states` snapshot. When present
   * (runtime mode) PeerRow derives its inline verb badges from each
   * peer's `effective_policy.request.*` grant matrix so the PeerRow
   * and Peer Policies card never disagree for the same (peer, verb)
   * pair within a single snapshot (VAL-POLICIES-005 / VAL-POLICIES-006
   * / VAL-POLICIES-020).
   */
  peerPermissionStates?: PeerPermissionState[];
}) {
  // Index permission states by pubkey once per render so each PeerRow
  // lookup is O(1) rather than O(n) across the peer list.
  const permissionStateByPubkey = useMemo(() => {
    if (!peerPermissionStates || peerPermissionStates.length === 0) {
      return null;
    }
    const map = new Map<string, PeerPermissionState>();
    for (const state of peerPermissionStates) {
      map.set(state.pubkey, state);
    }
    return map;
  }, [peerPermissionStates]);
  const header = (
    <div className="peers-header">
      <div className="peers-title-group">
        <div className="peers-title">Peers</div>
        <HelpCircle size={15} color="#93c5fd" />
        <span className={`health-dot ${onlineCount > 0 ? "online" : "offline"}`} />
        <StatusPill tone={onlineCount > 0 ? "success" : "warning"}>{onlineCount} online</StatusPill>
        <StatusPill>{peers.length} total</StatusPill>
      </div>
      <div className="peers-badges">
        <StatusPill tone="info">{paperPanels ? "~186 ready" : signReadyLabel}</StatusPill>
        <StatusPill>{paperPanels ? "Avg: 31ms" : "Avg: --"}</StatusPill>
        <Button
          type="button"
          variant="header"
          size="icon"
          onClick={(event) => {
            // The PeersPanel header is itself a `<button>` (Collapsible
            // toggle) and React synthetic click events bubble. Without
            // stopping propagation here, clicking the refresh icon would
            // also collapse/expand the Peers panel. stopPropagation keeps
            // the click scoped to the refresh dispatch intent.
            event.stopPropagation();
            void onRefresh();
          }}
          aria-label="Refresh peers"
        >
          <RotateCw size={16} />
        </Button>
      </div>
    </div>
  );

  return (
    <Collapsible title={header} defaultOpen className="peers-panel-collapsible">
      <div className="peer-list">
        {peers.map((peer) => (
          <PeerRow
            key={peer.pubkey}
            peer={peer}
            paper={paperPanels}
            sidebarOpen={sidebarOpen}
            refreshError={peerRefreshErrors?.[peer.pubkey] ?? null}
            permissionState={
              permissionStateByPubkey?.get(peer.pubkey) ?? null
            }
          />
        ))}
      </div>
    </Collapsible>
  );
}
