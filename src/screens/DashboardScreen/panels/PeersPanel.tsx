import { ChevronDown, HelpCircle, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, StatusPill } from "../../../components/ui";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../../lib/bifrost/types";
import type { PeerLatencySample } from "../../../app/AppStateTypes";
import { paperLatencyMs } from "../mocks";
import {
  freshPeerLatencyMs,
  PeerRow,
  type PeerRefreshErrorInfo,
} from "./PeerRow";

export function PeersPanel({
  peers,
  onlineCount,
  signReadyLabel,
  paperPanels,
  sidebarOpen,
  onRefresh,
  peerRefreshErrors,
  peerPermissionStates,
  peerLatencyByPubkey,
  nowMs,
}: {
  peers: PeerStatus[];
  onlineCount: number;
  signReadyLabel: string;
  paperPanels: boolean;
  sidebarOpen?: boolean;
  onRefresh?: () => void | Promise<void>;
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
  peerLatencyByPubkey?: Record<string, PeerLatencySample>;
  nowMs?: number;
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

  // Inline collapsible state. PeersPanel owns its expand/collapse rather
  // than delegating to `<Collapsible>` because callers can optionally host
  // sibling header actions beside the toggle. Wrapping the whole header in a
  // single `<button>` (as `<Collapsible>` does) would nest those actions
  // inside another `<button>`, which React flags as invalid DOM and breaks
  // keyboard/screen-reader focus semantics. Tracked by
  // `misc-peers-panel-nested-button`.
  const [open, setOpen] = useState(true);
  const toggle = () => setOpen((prev) => !prev);
  const resolvedNowMs = useMemo(
    () => nowMs ?? Date.now(),
    [nowMs, peerLatencyByPubkey, peers],
  );
  const averageLatencyLabel = useMemo(() => {
    const onlinePeers = peers.filter((peer) => peer.online);
    if (paperPanels) {
      if (onlinePeers.length === 0) return "Avg: --";
      const total = onlinePeers.reduce(
        (sum, peer) => sum + paperLatencyMs(peer.idx),
        0,
      );
      return `Avg: ${Math.round(total / onlinePeers.length)}ms`;
    }
    const freshLatencies = onlinePeers
      .map((peer) =>
        freshPeerLatencyMs(
          peerLatencyByPubkey?.[peer.pubkey],
          resolvedNowMs,
        ),
      )
      .filter((latency): latency is number => latency !== null);
    if (freshLatencies.length === 0) return "Peer avg: --";
    return `Peer avg: ${Math.round(
      freshLatencies.reduce((sum, latency) => sum + latency, 0) /
        freshLatencies.length,
    )}ms`;
  }, [resolvedNowMs, paperPanels, peerLatencyByPubkey, peers]);

  const helpTitle =
    "Peer RTT is measured from Ping dispatch to completion. Relay RTT is browser-to-relay REQ/EOSE.";

  return (
    <div className="collapsible peers-panel-collapsible">
      <div className="peers-header">
        <button
          type="button"
          className="peers-header-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? "Collapse peers panel" : "Expand peers panel"}
        >
          <ChevronDown
            size={14}
            className={`collapsible-chevron${open ? " collapsible-chevron-open" : ""}`}
            aria-hidden="true"
          />
          <span className="peers-title-group">
            <span className="peers-title">Peers</span>
            <span title={helpTitle} aria-label={helpTitle}>
              <HelpCircle size={15} color="#93c5fd" aria-hidden="true" />
            </span>
            <span
              className={`health-dot ${onlineCount > 0 ? "online" : "offline"}`}
            />
            <StatusPill tone={onlineCount > 0 ? "success" : "warning"}>
              {onlineCount} online
            </StatusPill>
            <StatusPill>{peers.length} total</StatusPill>
          </span>
        </button>
        <div className="peers-badges">
          <StatusPill tone="info">
            {paperPanels ? "~186 ready" : signReadyLabel}
          </StatusPill>
          <StatusPill>{averageLatencyLabel}</StatusPill>
          {onRefresh ? (
            <Button
              type="button"
              variant="header"
              size="icon"
              onClick={() => {
                void onRefresh();
              }}
              aria-label="Refresh peers"
            >
              <RotateCw size={16} />
            </Button>
          ) : null}
        </div>
      </div>
      {open && (
        <div className="collapsible-body">
          <div className="peer-list">
            {peers.map((peer) => (
              <PeerRow
                key={peer.pubkey}
                peer={peer}
                paper={paperPanels}
                sidebarOpen={sidebarOpen}
                refreshError={peerRefreshErrors?.[peer.pubkey] ?? null}
                latencySample={
                  paperPanels
                    ? null
                    : peerLatencyByPubkey?.[peer.pubkey] ?? null
                }
                nowMs={resolvedNowMs}
                permissionState={
                  permissionStateByPubkey?.get(peer.pubkey) ?? null
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
