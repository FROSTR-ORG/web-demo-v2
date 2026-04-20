import { ChevronDown, HelpCircle, RotateCw } from "lucide-react";
import { Button, StatusPill } from "../../../components/ui";
import type { PeerStatus } from "../../../lib/bifrost/types";
import { PeerRow } from "./PeerRow";

export function PeersPanel({
  peers,
  onlineCount,
  signReadyLabel,
  paperPanels,
  sidebarOpen,
  onRefresh,
}: {
  peers: PeerStatus[];
  onlineCount: number;
  signReadyLabel: string;
  paperPanels: boolean;
  sidebarOpen?: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="peers-panel">
      <div className="peers-header">
        <div className="peers-title-group">
          <ChevronDown size={12} color="#93c5fd" />
          <div className="peers-title">Peers</div>
          <HelpCircle size={15} color="#93c5fd" />
          <span className={`health-dot ${onlineCount > 0 ? "online" : "offline"}`} />
          <StatusPill tone={onlineCount > 0 ? "success" : "warning"}>{onlineCount} online</StatusPill>
          <StatusPill>{peers.length} total</StatusPill>
        </div>
        <div className="peers-badges">
          <StatusPill tone="info">{paperPanels ? "~186 ready" : signReadyLabel}</StatusPill>
          <StatusPill>{paperPanels ? "Avg: 31ms" : "Avg: --"}</StatusPill>
          <Button type="button" variant="header" size="icon" onClick={onRefresh} aria-label="Refresh peers">
            <RotateCw size={16} />
          </Button>
        </div>
      </div>
      <div className="peer-list">
        {peers.map((peer) => (
          <PeerRow key={peer.pubkey} peer={peer} paper={paperPanels} sidebarOpen={sidebarOpen} />
        ))}
      </div>
    </div>
  );
}
