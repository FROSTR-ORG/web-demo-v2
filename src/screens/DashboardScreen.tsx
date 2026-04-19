import { ChevronDown, Clock, Download, FileText, HelpCircle, RotateCw, Settings, SlidersHorizontal, Trash2, X, XCircle } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button, PermissionBadge, StatusPill } from "../components/ui";
import { shortHex } from "../lib/bifrost/format";
import type { PeerStatus } from "../lib/bifrost/types";

type DashboardState = "running" | "connecting" | "stopped" | "relays-offline" | "signing-blocked";
type ModalState = "none" | "policy-prompt" | "signing-failed" | "clear-credentials";

export function DashboardScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile, runtimeStatus, lockProfile, clearCredentials, refreshRuntime } = useAppState();
  const [mockState, setMockState] = useState<DashboardState>("running");
  const [showPolicies, setShowPolicies] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalState>("none");
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <Button type="button" variant="header" size="icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
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
          <div className="dash-modal-triggers">
            <span className="dash-modal-trigger-label">Modals:</span>
            <button
              type="button"
              className="dash-modal-trigger-btn"
              onClick={() => setActiveModal("policy-prompt")}
              aria-label="Open Policy Prompt"
            >
              Policy Prompt
            </button>
            <button
              type="button"
              className="dash-modal-trigger-btn"
              onClick={() => setActiveModal("signing-failed")}
              aria-label="Open Signing Failed"
            >
              Signing Failed
            </button>
          </div>
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

      {/* Modal overlays */}
      {activeModal === "policy-prompt" && (
        <SignerPolicyPromptModal onClose={() => setActiveModal("none")} />
      )}
      {activeModal === "signing-failed" && (
        <SigningFailedModal onClose={() => setActiveModal("none")} />
      )}
      {activeModal === "clear-credentials" && (
        <ClearCredentialsModal
          groupName={activeProfile.groupName}
          shareIdx={runtimeStatus.metadata.member_idx}
          deviceName={activeProfile.deviceName}
          onCancel={() => setActiveModal("none")}
          onConfirm={async () => {
            await clearCredentials();
            navigate("/");
          }}
        />
      )}

      {/* Settings sidebar */}
      {settingsOpen && (
        <SettingsSidebar
          profile={activeProfile}
          relays={activeProfile.relays}
          groupPublicKey={activeProfile.groupPublicKey}
          threshold={activeProfile.threshold}
          memberCount={activeProfile.memberCount}
          shareIdx={runtimeStatus.metadata.member_idx}
          onClose={() => setSettingsOpen(false)}
          onLock={() => {
            lockProfile();
            navigate("/");
          }}
          onClearCredentials={() => setActiveModal("clear-credentials")}
        />
      )}
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

// Mock data for peer policies — full-length pubkeys truncated via shortHex at render time
const MOCK_PEER_POLICIES = [
  {
    index: 0,
    pubkey: "02a3f8e4c71b9d0256f8a23e41d7b9c0e5f6a8d3b2c1e0f4a5b6c7d8e9f08f2c",
    permissions: { sign: true, ecdh: true, ping: true, onboard: false },
  },
  {
    index: 1,
    pubkey: "02d7e1b3a94c6f8e2d5a7b0c3e1f4d6a8b9c0e2f3a5b7d8c1e4f6a9b2d73b9e",
    permissions: { sign: true, ecdh: false, ping: true, onboard: true },
  },
  {
    index: 2,
    pubkey: "029c4a7e3b1d8f6a2c5e9d0b4f7a1c3e6d8b2f5a9c0e4d7b3a6f1e8c2d91f5e",
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
                  <span className="policies-peer-key">{shortHex(peer.pubkey, 6, 4)}</span>
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

/* ========================================
   Signer Policy Prompt Modal
   ======================================== */
function SignerPolicyPromptModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="policy-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="policy-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="policy-modal-header">
          <div className="policy-modal-header-row">
            <div className="policy-modal-title-group">
              <div className="policy-modal-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 1L18 5.5V14.5L10 19L2 14.5V5.5L10 1Z" stroke="#EAB308" strokeWidth="1.5" fill="none" />
                  <path d="M10 7V11M10 13V13.5" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="policy-modal-title">Signer Policy</h2>
            </div>
            <button type="button" className="policy-modal-close" onClick={onClose} aria-label="Close modal">
              <X size={16} />
            </button>
          </div>
          <p className="policy-modal-subtitle">
            A peer is requesting permission to sign on your behalf
          </p>
        </div>

        {/* Request info */}
        <div className="policy-modal-request">
          <span className="policy-request-badge">SIGN</span>
          <span className="policy-request-peer">from Peer #2</span>
          <span className="policy-request-key">029c4a...1f5e</span>
          <span className="policy-request-domain"> · primal.net</span>
        </div>

        {/* Details table */}
        <div className="policy-details-table">
          <div className="policy-detail-row">
            <span className="policy-detail-label">EVENT KIND</span>
            <span className="policy-detail-value">kind:1 (Short Text Note)</span>
          </div>
          <div className="policy-detail-row">
            <span className="policy-detail-label">CONTENT</span>
            <span className="policy-detail-value">&ldquo;gm nostr, anyone up for a coffee meetup...&rdquo;</span>
          </div>
          <div className="policy-detail-row">
            <span className="policy-detail-label">PUBKEY</span>
            <span className="policy-detail-value mono">029c4a...1f5e</span>
          </div>
          <div className="policy-detail-row">
            <span className="policy-detail-label">DOMAIN</span>
            <span className="policy-detail-value bold">primal.net</span>
          </div>
        </div>

        {/* Expiration timer */}
        <div className="policy-expiry">
          <Clock size={14} />
          <span>Expires in 42s</span>
        </div>

        {/* Action buttons — 3 rows × 2 buttons */}
        <div className="policy-actions">
          <div className="policy-action-row">
            <button type="button" className="policy-btn deny" onClick={onClose}>
              Deny
            </button>
            <button type="button" className="policy-btn allow" onClick={onClose}>
              Allow once
            </button>
          </div>
          <div className="policy-action-row">
            <button type="button" className="policy-btn allow-outline" onClick={onClose}>
              Always allow
            </button>
            <button type="button" className="policy-btn allow-outline" onClick={onClose}>
              Always for kind:1
            </button>
          </div>
          <div className="policy-action-row">
            <button type="button" className="policy-btn deny-outline" onClick={onClose}>
              Always deny for kind:1
            </button>
            <button type="button" className="policy-btn deny-outline" onClick={onClose}>
              Always deny for primal.net
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================
   Signing Failed Modal
   ======================================== */
function SigningFailedModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="policy-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="signing-failed-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="signing-failed-header">
          <div className="signing-failed-title-group">
            <div className="signing-failed-icon">
              <XCircle size={20} color="#EF4444" />
            </div>
            <h2 className="signing-failed-title">Signing Failed</h2>
          </div>
          <button type="button" className="policy-modal-close" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="signing-failed-body">
          <p className="signing-failed-description">
            Unable to complete signature for event kind:1. All 3 retry attempts exhausted.
          </p>
          <div className="signing-failed-code">
            <span className="signing-failed-code-text">
              Round: r-0x4f2a · Peers responded: 1/2 · Error: insufficient partial signatures
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="signing-failed-actions">
          <button type="button" className="signing-failed-dismiss" onClick={onClose}>
            Dismiss
          </button>
          <button type="button" className="signing-failed-retry" onClick={onClose}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================================
   Settings Sidebar
   ======================================== */
interface SettingsSidebarProps {
  profile: { groupName: string; deviceName: string };
  relays: string[];
  groupPublicKey: string;
  threshold: number;
  memberCount: number;
  shareIdx: number;
  onClose: () => void;
  onLock: () => void;
  onClearCredentials: () => void;
}

function SettingsSidebar({
  profile,
  relays: initialRelays,
  groupPublicKey,
  threshold,
  memberCount,
  shareIdx,
  onClose,
  onLock,
  onClearCredentials,
}: SettingsSidebarProps) {
  const [relays, setRelays] = useState(initialRelays);
  const [newRelay, setNewRelay] = useState("");

  function handleRemoveRelay(index: number) {
    setRelays((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddRelay() {
    const trimmed = newRelay.trim();
    if (trimmed && !relays.includes(trimmed)) {
      setRelays((prev) => [...prev, trimmed]);
      setNewRelay("");
    }
  }

  return (
    <>
      {/* Scrim */}
      <div className="settings-scrim" onClick={onClose} data-testid="settings-scrim" />

      {/* Sidebar panel */}
      <div className="settings-sidebar" role="dialog" aria-label="Settings" data-testid="settings-sidebar">
        <div className="settings-sidebar-scroll">
          {/* Header */}
          <div className="settings-header">
            <div className="settings-title">Settings</div>
            <button
              type="button"
              className="settings-close"
              onClick={onClose}
              aria-label="Close settings"
            >
              <X size={16} />
            </button>
          </div>

          {/* DEVICE PROFILE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Device Profile</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Profile Name</span>
                <div className="settings-row-value">
                  <span>{profile.deviceName}</span>
                  <span className="settings-edit-icon">✎</span>
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Profile Password</span>
                <div className="settings-row-value">
                  <span>••••••••</span>
                  <button type="button" className="settings-change-btn">Change</button>
                </div>
              </div>
              {/* Relays */}
              <div className="settings-relays">
                {relays.map((relay, idx) => (
                  <div className="settings-relay-row" key={relay}>
                    <div className="settings-relay-url">{relay}</div>
                    <button
                      type="button"
                      className="settings-relay-remove"
                      aria-label={`Remove ${relay}`}
                      onClick={() => handleRemoveRelay(idx)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="settings-relay-row">
                  <input
                    className="settings-relay-input"
                    type="text"
                    placeholder="wss://..."
                    value={newRelay}
                    onChange={(e) => setNewRelay(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddRelay();
                    }}
                  />
                  <button
                    type="button"
                    className="settings-relay-add"
                    onClick={handleAddRelay}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
            <div className="settings-hint">
              Configuration for this device's share (Share #{shareIdx})
            </div>
          </div>

          {/* GROUP PROFILE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Group Profile</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Keyset Name</span>
                <span className="settings-row-text">{profile.groupName}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Keyset npub</span>
                <span className="settings-row-npub">{shortHex(groupPublicKey, 10, 8)}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Threshold</span>
                <span className="settings-row-text">{threshold} of {memberCount}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Created</span>
                <span className="settings-row-text">Feb 24, 2026</span>
              </div>
              <div className="settings-row settings-row-last">
                <span className="settings-row-label">Updated</span>
                <span className="settings-row-text">Mar 8, 2026</span>
              </div>
            </div>
            <div className="settings-hint">
              Shared across all peers. Synced via Nostr.
            </div>
          </div>

          {/* ROTATE SHARE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Rotate Share</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-row">
              <div className="settings-action-info">
                <div className="settings-action-name">Rotate Share</div>
                <div className="settings-action-desc">
                  Replace only this device's local share from Settings while keeping the same group public key and keyset membership.
                </div>
              </div>
              <button type="button" className="settings-btn-blue">Rotate Share</button>
            </div>
          </div>

          {/* EXPORT & BACKUP */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Export &amp; Backup</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-group">
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Export Profile</div>
                  <div className="settings-action-desc">
                    Encrypted backup of your share and configuration
                  </div>
                </div>
                <button type="button" className="settings-btn-blue">Export</button>
              </div>
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Export Share</div>
                  <div className="settings-action-desc">
                    Unencrypted share key in hex
                  </div>
                </div>
                <button type="button" className="settings-btn-muted">Copy</button>
              </div>
            </div>
          </div>

          {/* PROFILE SECURITY */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Profile Security</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-group">
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Lock Profile</div>
                  <div className="settings-action-desc">
                    Return to profile list to open another profile
                  </div>
                </div>
                <button type="button" className="settings-btn-red" onClick={onLock}>
                  Lock
                </button>
              </div>
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Clear Credentials</div>
                  <div className="settings-action-desc">
                    Delete this device's saved profile, share, password, and relay configuration
                  </div>
                </div>
                <button type="button" className="settings-btn-red" onClick={onClearCredentials}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ========================================
   Clear Credentials Modal
   ======================================== */
function ClearCredentialsModal({
  groupName,
  shareIdx,
  deviceName,
  onCancel,
  onConfirm,
}: {
  groupName: string;
  shareIdx: number;
  deviceName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="clear-creds-backdrop" role="dialog" aria-modal="true" data-testid="clear-credentials-modal">
      <div className="clear-creds-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="clear-creds-header">
          <div className="clear-creds-title-group">
            <div className="clear-creds-icon">
              <Trash2 size={20} />
            </div>
            <h2 className="clear-creds-title">Clear Credentials</h2>
          </div>
          <button
            type="button"
            className="clear-creds-close"
            onClick={onCancel}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="clear-creds-body">
          <p className="clear-creds-description">
            Are you sure you want to clear this device's saved credentials? This removes the local profile, share, password, and relay configuration from this device. This action cannot be undone. Other peers and the shared group profile are not changed.
          </p>
          <div className="clear-creds-badge">
            {groupName} · Share #{shareIdx} · {deviceName}
          </div>
        </div>

        {/* Actions */}
        <div className="clear-creds-actions">
          <button type="button" className="clear-creds-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="clear-creds-confirm" onClick={onConfirm}>
            Clear Credentials
          </button>
        </div>
      </div>
    </div>
  );
}
