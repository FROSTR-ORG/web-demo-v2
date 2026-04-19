import { ChevronDown, Download, FileText, HelpCircle, RotateCw, Settings, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button, PermissionBadge, StatusPill } from "../components/ui";
import { shortHex } from "../lib/bifrost/format";
import type { PeerStatus } from "../lib/bifrost/types";

type DashboardState = "running" | "connecting" | "stopped" | "relays-offline" | "signing-blocked";

export function DashboardScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile, runtimeStatus, lockProfile, refreshRuntime } = useAppState();
  const [mockState, setMockState] = useState<DashboardState>("running");
  const [showPolicies, setShowPolicies] = useState(false);

  if (!profileId) {
    return <Navigate to="/" replace />;
  }
  if (!activeProfile || activeProfile.id !== profileId || !runtimeStatus) {
    return <Navigate to="/" replace />;
  }

  const onlineCount = runtimeStatus.peers.filter((peer) => peer.online).length;
  const signReadyLabel = `${runtimeStatus.readiness.signing_peer_count}/${runtimeStatus.readiness.threshold} sign ready`;

  function handleStopSigner() {
    setMockState("stopped");
  }

  function handleStartSigner() {
    setMockState("running");
  }

  function handleRetryConnections() {
    setMockState("connecting");
  }

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
          <Button type="button" variant="header" onClick={() => setShowPolicies((v) => !v)}>
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
        {/* Mock State Toggle */}
        <div className="dash-state-toggle">
          <label className="dash-state-toggle-label" htmlFor="mock-state-select">
            Mock State
          </label>
          <select
            id="mock-state-select"
            className="dash-state-toggle-select"
            value={mockState}
            onChange={(e) => setMockState(e.target.value as DashboardState)}
            aria-label="Mock State"
          >
            <option value="running">Running</option>
            <option value="connecting">Connecting</option>
            <option value="stopped">Stopped</option>
            <option value="relays-offline">All Relays Offline</option>
            <option value="signing-blocked">Signing Blocked</option>
          </select>
        </div>

        {/* Summary bar — shared across all states */}
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

        {/* Conditional rendering: Policies view OR dashboard state */}
        {showPolicies ? (
          <PoliciesView peers={runtimeStatus.peers} />
        ) : (
          <>
            {mockState === "running" && (
              <RunningState
                relays={activeProfile.relays}
                onlineCount={onlineCount}
                signReadyLabel={signReadyLabel}
                peers={runtimeStatus.peers}
                pendingOperations={runtimeStatus.pending_operations}
                onStop={handleStopSigner}
                onLock={() => {
                  lockProfile();
                  navigate("/");
                }}
                onRefresh={refreshRuntime}
              />
            )}

            {mockState === "connecting" && (
              <ConnectingState relays={activeProfile.relays} />
            )}

            {mockState === "stopped" && (
              <StoppedState onStart={handleStartSigner} />
            )}

            {mockState === "relays-offline" && (
              <RelaysOfflineState
                onStop={handleStopSigner}
                onRetry={handleRetryConnections}
              />
            )}

            {mockState === "signing-blocked" && (
              <SigningBlockedState onStop={handleStopSigner} />
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}

/* ========================================
   State 1: Running
   ======================================== */
function RunningState({
  relays,
  onlineCount,
  signReadyLabel,
  peers,
  pendingOperations,
  onStop,
  onLock,
  onRefresh,
}: {
  relays: string[];
  onlineCount: number;
  signReadyLabel: string;
  peers: PeerStatus[];
  pendingOperations: unknown[];
  onStop: () => void;
  onLock: () => void;
  onRefresh: () => void;
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
            <Button type="button" variant="ghost" onClick={onLock}>
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
            <StatusPill>{peers.length} total</StatusPill>
          </div>
          <div className="peers-badges">
            <StatusPill tone="info">{signReadyLabel}</StatusPill>
            <StatusPill>Avg: --</StatusPill>
            <Button type="button" variant="header" size="icon" onClick={onRefresh} aria-label="Refresh peers">
              <RotateCw size={16} />
            </Button>
          </div>
        </div>
        <div className="peer-list">
          {peers.map((peer) => (
            <PeerRow key={peer.pubkey} peer={peer} />
          ))}
        </div>
      </div>

      {pendingOperations.length > 0 ? (
        <div className="panel panel-pad">
          <div className="value">Pending Operations</div>
          <div className="help">{pendingOperations.length} operation(s) currently pending.</div>
        </div>
      ) : null}
    </>
  );
}

/* ========================================
   State 2: Connecting
   ======================================== */
function ConnectingState({ relays }: { relays: string[] }) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light warning" />
            <span className="dash-hero-title amber">Signer Connecting...</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is starting relay sessions and rebuilding peer state. Signing stays unavailable until connectivity and readiness recover.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="ghost" className="dash-connecting-badge">
            Connecting...
          </Button>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Connection Progress</div>

          <div className="dash-progress-step">
            <span className="dash-step-dot done" />
            <div className="dash-step-content">
              <div className="dash-step-label">Runtime process started</div>
              <div className="dash-step-detail">Signer booted and local credentials loaded.</div>
            </div>
          </div>

          <div className="dash-progress-step">
            <span className="dash-step-dot active" />
            <div className="dash-step-content">
              <div className="dash-step-label">Connecting to configured relays</div>
              <div className="dash-step-detail">
                Opening sessions for {relays.join(" and ")}.
              </div>
            </div>
          </div>

          <div className="dash-progress-step">
            <span className="dash-step-dot pending" />
            <div className="dash-step-content">
              <div className="dash-step-label">Discovering peers and refilling pools</div>
              <div className="dash-step-detail">
                Ready state returns once peers are online and pool counts recover.
              </div>
            </div>
          </div>
        </div>

        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Current Targets</div>
          <p className="dash-info-line">Relays: {relays.length} configured</p>
          <p className="dash-info-line">Peers: waiting for presence announcements</p>
          <div className="dash-info-note">
            Event logs stay compact here. The primary concern is relay and peer readiness, not log volume.
          </div>
        </div>
      </div>
    </>
  );
}

/* ========================================
   State 3: Stopped
   ======================================== */
function StoppedState({ onStart }: { onStart: () => void }) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light error" />
            <span className="dash-hero-title red">Signer Stopped</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is intentionally offline. Relay sessions, peer discovery, and signing capacity are paused until you start the signer again.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="primary" onClick={onStart}>
            Start Signer
          </Button>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Readiness</div>

          <div className="dash-readiness-row">
            <div className="dash-readiness-orbit">
              <div className="dash-readiness-orbit-inner">
                <span className="dash-readiness-dot offline" />
              </div>
            </div>
            <div className="dash-readiness-labels">
              <span className="dash-readiness-status">Offline</span>
              <span className="help">—</span>
            </div>
            <div className="dash-readiness-detail">
              <div className="dash-readiness-title">No active relay or peer sessions</div>
              <p className="dash-readiness-desc">
                Starting the signer reconnects configured relays, re-announces presence, and begins refilling pool state.
              </p>
            </div>
          </div>

          <div className="dash-badge-row">
            <span className="dash-badge red">0 relays connected</span>
            <span className="dash-badge red">0 peers online</span>
            <span className="dash-badge neutral">Signing unavailable</span>
          </div>
        </div>

        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Next Step</div>
          <div className="dash-next-steps">
            <p className="dash-info-line">1. Start the signer to resume relay connectivity.</p>
            <p className="dash-info-line">2. Wait for peers to return online and refill signing pools.</p>
            <p className="dash-info-line">3. Policy prompts and approvals will resume once runtime is available again.</p>
          </div>
          <div className="dash-info-note">
            Recent request queues remain preserved, but no new signing or encryption work can complete while the signer is stopped.
          </div>
        </div>
      </div>
    </>
  );
}

/* ========================================
   State 4: All Relays Offline
   ======================================== */
function RelaysOfflineState({
  onStop,
  onRetry,
}: {
  onStop: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light" />
            <span className="dash-hero-title green">Signer Running</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is active, but every configured relay is currently unreachable. Signing and sync are degraded until connectivity returns.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="danger" onClick={onStop}>
            Stop Signer
          </Button>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Readiness</div>

          <div className="dash-readiness-row">
            <div className="dash-readiness-orbit">
              <div className="dash-readiness-orbit-inner">
                <span className="dash-readiness-dot offline" />
              </div>
            </div>
            <div className="dash-readiness-labels">
              <span className="dash-readiness-status">Offline</span>
              <span className="help">—</span>
            </div>
            <div className="dash-readiness-detail">
              <div className="dash-readiness-title">All Relays Offline</div>
              <p className="dash-readiness-desc">
                Peer presence and pool exchange pause when no relay route is available.
              </p>
            </div>
          </div>

          <div className="dash-badge-row">
            <span className="dash-badge red">0 / 2 relays reachable</span>
            <span className="dash-badge amber">Ready count degraded</span>
          </div>
        </div>

        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Recovery</div>
          <p className="dash-info-line">
            Check network reachability, relay DNS resolution, and local firewall state. Relay sessions will automatically recover when a route is available.
          </p>
          <div className="dash-info-note">
            Signing requests remain blocked or degraded here because runtime has no live relay path to peers.
          </div>
          <Button type="button" variant="primary" onClick={onRetry}>
            Retry Connections
          </Button>
        </div>
      </div>
    </>
  );
}

/* ========================================
   State 5: Signing Blocked
   ======================================== */
function SigningBlockedState({ onStop }: { onStop: () => void }) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light" />
            <span className="dash-hero-title green">Signer Running</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is online, but current policy/readiness gating prevents new signing work from completing.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="danger" onClick={onStop}>
            Stop Signer
          </Button>
        </div>
      </div>

      <div className="dash-blocked-panel">
        <div className="dash-blocked-header">
          <span className="status-light warning" />
          <span className="dash-blocked-title">Signing Blocked</span>
        </div>
        <p className="dash-blocked-copy">
          Requests are not failing outright, but they cannot complete until the blocking condition clears. Use this state for policy prompts, pending operator review, or temporary readiness gating that stops signing before execution.
        </p>
        <div className="dash-two-col">
          <div className="dash-sub-panel">
            <div className="dash-panel-kicker">Common Causes</div>
            <p className="dash-sub-line">Pending signer-policy decision</p>
            <p className="dash-sub-line">Insufficient ready peers for current request type</p>
            <p className="dash-sub-line">Temporary pool imbalance after reconnect</p>
          </div>
          <div className="dash-sub-panel">
            <div className="dash-panel-kicker">Operator Action</div>
            <p className="dash-sub-line">
              Review approvals or open policies before retrying. If readiness is the issue, wait for relay and peer health to recover.
            </p>
            <div className="dash-action-row">
              <Button type="button" variant="primary">
                Open Policies
              </Button>
              <Button type="button" variant="ghost">
                Review Approvals
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ========================================
   Policies View
   ======================================== */

// Mock data for signer policy rules
const MOCK_SIGNER_RULES = [
  { method: "sign_event:1", domain: "primal.net", permission: "Always" as const },
  { method: "nip44_encrypt", domain: "primal.net", permission: "Allow once" as const },
  { method: "get_public_key", domain: "primal.net", permission: "Always" as const },
];

// Mock data for peer policies
const MOCK_PEER_POLICIES = [
  {
    index: 0,
    pubkey: "02a3f8...8f2c",
    permissions: { sign: true, ecdh: true, ping: true, onboard: false },
  },
  {
    index: 1,
    pubkey: "02d7e1...3b9e",
    permissions: { sign: true, ecdh: false, ping: true, onboard: true },
  },
  {
    index: 2,
    pubkey: "029c4a...1f5e",
    permissions: { sign: false, ecdh: false, ping: false, onboard: false },
  },
];

function PoliciesView({ peers: _peers }: { peers: PeerStatus[] }) {
  return (
    <>
      {/* Signer Policies Panel */}
      <div className="policies-panel">
        <div className="policies-panel-header">
          <div className="policies-panel-title">Signer Policies</div>
          <div className="policies-header-right">
            <span className="policies-default-label">Default policy</span>
            <div className="policies-dropdown">
              <span className="policies-dropdown-text">Ask every time</span>
              <span className="policies-dropdown-caret">▾</span>
            </div>
          </div>
        </div>
        <div className="policies-panel-body">
          <p className="policies-description">
            Controls how this signer responds to external signing and encryption requests.
          </p>
          <div className="policies-rules-list">
            {MOCK_SIGNER_RULES.map((rule) => (
              <div className="policies-rule-row" key={rule.method}>
                <span className="policies-method">{rule.method}</span>
                <span className="policies-domain">{rule.domain}</span>
                <span className="policies-rule-divider" />
                <span
                  className={`policies-permission-badge ${rule.permission === "Always" ? "always" : "allow-once"}`}
                >
                  {rule.permission}
                </span>
                <button type="button" className="policies-remove-btn" aria-label="Remove rule">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Peer Policies Panel */}
      <div className="policies-panel">
        <div className="policies-panel-header">
          <div className="policies-panel-title">Peer Policies</div>
        </div>
        <div className="policies-panel-body">
          <p className="policies-description">
            Review which request types each peer is allowed to make from this signer.
          </p>
          <div className="policies-peer-list">
            {MOCK_PEER_POLICIES.map((peer) => (
              <div className="policies-peer-row" key={peer.index}>
                <div className="policies-peer-info">
                  <span className="policies-peer-name">Peer #{peer.index}</span>
                  <span className="policies-peer-key">{peer.pubkey}</span>
                </div>
                <div className="policies-peer-badges">
                  <PermissionBadge tone="success" muted={!peer.permissions.sign}>
                    SIGN
                  </PermissionBadge>
                  <PermissionBadge tone="info" muted={!peer.permissions.ecdh}>
                    ECDH
                  </PermissionBadge>
                  <PermissionBadge tone="ping" muted={!peer.permissions.ping}>
                    PING
                  </PermissionBadge>
                  <PermissionBadge tone="onboard" muted={!peer.permissions.onboard}>
                    ONBOARD
                  </PermissionBadge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ========================================
   Peer Row (reused in Running state)
   ======================================== */
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
