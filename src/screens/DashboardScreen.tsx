import { ChevronDown, Download, FileText, HelpCircle, RotateCw, Settings, SlidersHorizontal } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button, PermissionBadge, StatusPill } from "../components/ui";
import { shortHex } from "../lib/bifrost/format";
import type { PeerStatus } from "../lib/bifrost/types";

export function DashboardScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile, runtimeStatus, signerPaused, lockProfile, setSignerPaused, refreshRuntime } = useAppState();

  if (!profileId) {
    return <Navigate to="/" replace />;
  }
  if (!activeProfile || activeProfile.id !== profileId || !runtimeStatus) {
    return <Navigate to="/" replace />;
  }

  const ready = runtimeStatus.readiness.runtime_ready;
  const degraded = runtimeStatus.readiness.degraded_reasons.length > 0;
  const onlineCount = runtimeStatus.peers.filter((peer) => peer.online).length;
  const signReadyLabel = `${runtimeStatus.readiness.signing_peer_count}/${runtimeStatus.readiness.threshold} sign ready`;
  const statusTone = signerPaused ? "error" : ready ? "success" : degraded ? "warning" : "default";
  const statusLabel = signerPaused ? "Signer stopped" : ready ? "Signer Running" : degraded ? "Signing Blocked" : "Connecting";
  const statusCopy = signerPaused
    ? "Local ticking is paused."
    : ready
      ? `Connected to ${activeProfile.relays.join(", ")}`
      : runtimeStatus.readiness.degraded_reasons.join(", ") || "Waiting for peer readiness.";

  return (
    <AppShell
      mainVariant="dashboard"
      headerActions={
        <>
          <Button type="button" variant="header">
            <FileText size={14} />
            Recover
          </Button>
          <Button type="button" variant="header">
            <Download size={14} />
            Export
          </Button>
          <Button type="button" variant="header">
            <SlidersHorizontal size={14} />
            Policies
          </Button>
        </>
      }
      headerSettingsAction={
        <Button type="button" variant="header" size="icon" aria-label="Settings">
          <Settings size={14} />
        </Button>
      }
    >
      <section className="dashboard-column">
        <div className="dashboard-summary">
          <div className="dashboard-summary-group">
            <span className="value">{activeProfile.groupName}</span>
            <span className="help">·</span>
            <span className="help">
              {activeProfile.threshold}/{activeProfile.memberCount}
            </span>
            <span className="help">·</span>
            <span className="dashboard-key">{shortHex(activeProfile.groupPublicKey, 12, 8)}</span>
          </div>
          <div className="dashboard-summary-separator" />
          <div className="dashboard-summary-share">
            <span className="help">Share #{runtimeStatus.metadata.member_idx}</span>
            <span className="help">·</span>
            <span className="dashboard-key">{shortHex(runtimeStatus.metadata.share_public_key, 10, 8)}</span>
          </div>
        </div>

        <div className="dashboard-status">
          <div className="dashboard-status-row">
            <div className="status-main">
              <span className={`status-light ${statusTone === "warning" ? "warning" : statusTone === "error" ? "error" : ""}`} />
              <div>
                <div className="status-title">{statusLabel}</div>
                <div className="help">{statusCopy}</div>
              </div>
            </div>
            <div className="inline-actions">
              <Button type="button" variant={signerPaused ? "secondary" : "danger"} onClick={() => setSignerPaused(!signerPaused)}>
                {signerPaused ? "Start Signer" : "Stop Signer"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  lockProfile();
                  navigate("/");
                }}
              >
                Lock
              </Button>
            </div>
          </div>
        </div>

        <div className="peers-panel">
          <div className="peers-header">
            <div className="peers-title-group">
              <ChevronDown size={12} color="#93c5fd" />
              <div className="peers-title">Peers</div>
              <HelpCircle size={15} color="#93c5fd" />
              <span className={`health-dot ${onlineCount > 0 ? "online" : "offline"}`} />
              <StatusPill tone={onlineCount > 0 ? "success" : "warning"}>{onlineCount} online</StatusPill>
              <StatusPill>{runtimeStatus.peers.length} total</StatusPill>
            </div>
            <div className="peers-badges">
              <StatusPill tone="info">{signReadyLabel}</StatusPill>
              <StatusPill>Avg: --</StatusPill>
              <Button type="button" variant="header" size="icon" onClick={refreshRuntime} aria-label="Refresh peers">
                <RotateCw size={16} />
              </Button>
            </div>
          </div>
          <div className="peer-list">
            {runtimeStatus.peers.map((peer) => (
              <PeerRow key={peer.pubkey} peer={peer} />
            ))}
          </div>
        </div>

        {runtimeStatus.pending_operations.length > 0 ? (
          <div className="panel panel-pad">
            <div className="value">Pending Operations</div>
            <div className="help">{runtimeStatus.pending_operations.length} operation(s) currently pending.</div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function PeerRow({ peer }: { peer: PeerStatus }) {
  const incomingPct = Math.min(100, peer.incoming_available);
  const outgoingPct = Math.min(100, peer.outgoing_available);
  const lowPool = peer.online && Math.min(peer.incoming_available, peer.outgoing_available) < 25;
  const rowState = peer.online ? (lowPool ? "warning" : "") : "offline";

  return (
    <div className={`peer-row ${rowState}`}>
      <div className="peer-orbit">
        <div className="peer-orbit-inner">
          <span className="peer-online-dot" />
        </div>
      </div>
      <div className="peer-main">
        <span className="peer-index">#{peer.idx}</span>
        <span className="help">·</span>
        <span className="peer-key">{shortHex(peer.pubkey, 12, 8)}</span>
        {peer.online ? (
          <span className="inline-actions">
            {peer.can_sign ? <PermissionBadge>SIGN</PermissionBadge> : null}
            {peer.should_send_nonces ? <PermissionBadge tone="info">ECDH</PermissionBadge> : <PermissionBadge tone="ping">PING</PermissionBadge>}
          </span>
        ) : null}
      </div>
      <div className="peer-metrics">
        {peer.online ? (
          <>
            <div className="mini-bars" aria-label="Nonce availability">
              <div className="mini-bar">
                <span style={{ width: `${incomingPct}%` }} />
              </div>
              <div className="mini-bar">
                <span style={{ width: `${outgoingPct}%`, opacity: 0.65 }} />
              </div>
            </div>
            <div className="metric-numbers">
              <span>{peer.incoming_available}</span>
              <span>{peer.outgoing_available}</span>
            </div>
          </>
        ) : (
          <span className="help">--</span>
        )}
      </div>
      <div className="latency-slot">{peer.online ? "Ready" : "Offline"}</div>
    </div>
  );
}
