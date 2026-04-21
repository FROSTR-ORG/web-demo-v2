import { PermissionBadge } from "../../../components/ui";
import { shortHex } from "../../../lib/bifrost/format";
import type { PeerStatus } from "../../../lib/bifrost/types";
import { paperLatency, paperPeerKey } from "../mocks";

/**
 * Inline refresh error surface for peers that failed a ping/refresh round
 * (see VAL-OPS-011). Kept minimal so the Paper-parity row visual is
 * preserved; the message is surfaced through `title`/`aria-label` so
 * screen readers and pointer hover both expose the runtime failure cause.
 */
export interface PeerRefreshErrorInfo {
  code: string;
  message: string;
}

export function PeerRow({
  peer,
  paper,
  sidebarOpen,
  refreshError,
}: {
  peer: PeerStatus;
  paper?: boolean;
  sidebarOpen?: boolean;
  refreshError?: PeerRefreshErrorInfo | null;
}) {
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
        <span className="peer-key">{paper ? paperPeerKey(peer.idx, peer.pubkey) : shortHex(peer.pubkey, 12, 8)}</span>
        {peer.online ? (
          <span className="inline-actions">
            {peer.can_sign ? <PermissionBadge>SIGN</PermissionBadge> : null}
            {peer.should_send_nonces ? <PermissionBadge tone="info">ECDH</PermissionBadge> : null}
            {paper ? <PermissionBadge tone="ping">PING</PermissionBadge> : !peer.should_send_nonces ? <PermissionBadge tone="ping">PING</PermissionBadge> : null}
            {paper && peer.idx === 1 ? <PermissionBadge tone="onboard">ONBOARD</PermissionBadge> : null}
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
      <div className="latency-slot">
        {refreshError ? (
          <span
            className="peer-refresh-error"
            data-testid={`peer-refresh-error-${peer.idx}`}
            role="status"
            aria-label={`Refresh failed for peer #${peer.idx}: ${refreshError.message}`}
            title={refreshError.message}
            style={{ color: "#f87171" }}
          >
            Refresh failed
          </span>
        ) : peer.online ? (
          paper ? paperLatency(peer.idx) : "Ready"
        ) : (
          "Offline"
        )}
      </div>
      {sidebarOpen ? (
        <div
          className="peer-row-trailing"
          data-testid={`peer-row-trailing-${peer.idx}`}
          // When the Settings sidebar is open, the scrim (`z-index: 100`)
          // covers the dashboard main area. Lift the trailing action cluster
          // above the scrim while keeping the sidebar panel itself on top.
          // Inline mirror of `.peer-row-trailing` rule in global.css so
          // jsdom-based regression tests can observe the computed z-index.
          style={{ position: "relative", zIndex: 102 }}
        >
          <button
            type="button"
            className="peer-row-trailing-btn"
            aria-label={`Peer #${peer.idx} actions`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <circle cx="7" cy="7" r="1.2" fill="#93C5FD80" />
              <circle cx="7" cy="3" r="1.2" fill="#93C5FD80" />
              <circle cx="7" cy="11" r="1.2" fill="#93C5FD80" />
            </svg>
          </button>
          <button
            type="button"
            className="peer-row-trailing-btn"
            aria-label={`Open peer #${peer.idx}`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
              <path d="M4.5 2.5L10.5 7L4.5 11.5V2.5Z" fill="#93C5FD80" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
