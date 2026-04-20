import { Button } from "../../../components/ui";
import type { PeerStatus } from "../../../lib/bifrost/types";
import type { PolicyPromptRequest } from "../mocks";
import { EventLogPanel } from "../panels/EventLogPanel";
import { PeersPanel } from "../panels/PeersPanel";
import { PendingApprovalsPanel } from "../panels/PendingApprovalsPanel";

export function RunningState({
  relays,
  onlineCount,
  signReadyLabel,
  peers,
  pendingOperations,
  paperPanels,
  sidebarOpen,
  onStop,
  onRefresh,
  onOpenPolicyPrompt,
}: {
  relays: string[];
  onlineCount: number;
  signReadyLabel: string;
  peers: PeerStatus[];
  pendingOperations: unknown[];
  paperPanels: boolean;
  sidebarOpen?: boolean;
  onStop: () => void;
  onRefresh: () => void;
  onOpenPolicyPrompt?: (request: PolicyPromptRequest) => void;
}) {
  return (
    <>
      <div className="dash-status-card">
        <div className="dash-status-row">
          <div className="dash-status-info">
            <span className="status-light" />
            <div className="dash-status-text">
              <div className="dash-status-title">Signer Running</div>
              <div className="help">Connected to {relays.join(", ")}</div>
            </div>
          </div>
          <div className="inline-actions">
            <Button type="button" variant="danger" onClick={onStop}>
              Stop Signer
            </Button>
          </div>
        </div>
      </div>

      <PeersPanel
        peers={peers}
        onlineCount={onlineCount}
        signReadyLabel={signReadyLabel}
        paperPanels={paperPanels}
        sidebarOpen={sidebarOpen}
        onRefresh={onRefresh}
      />

      {paperPanels ? (
        <>
          <EventLogPanel />
          <PendingApprovalsPanel onOpenPolicyPrompt={onOpenPolicyPrompt} />
        </>
      ) : pendingOperations.length > 0 ? (
        <div className="panel panel-pad">
          <div className="value">Pending Operations</div>
          <div className="help">{pendingOperations.length} operation(s) currently pending.</div>
        </div>
      ) : null}
    </>
  );
}
