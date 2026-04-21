import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { PermissionBadge } from "../../../components/ui";
import { shortHex } from "../../../lib/bifrost/format";
import type { PeerStatus } from "../../../lib/bifrost/types";
import { paperLatency, paperPeerKey } from "../mocks";

/**
 * Inline refresh/ping error surface for peers whose most recent
 * ping / refresh_peer / refresh_all_peers round-trip produced an
 * `OperationFailure` from the runtime (VAL-OPS-011 / VAL-OPS-015).
 * Kept minimal so the Paper-parity row visual is preserved; the failure
 * cause is surfaced through an `AlertTriangle` icon + `title` / `aria-label`
 * so pointer hover, screen readers, and the visible row state all expose
 * the runtime failure reason. Secret material is NEVER included in the
 * message — the runtime's `OperationFailure.message` is surfaced verbatim
 * and the runtime does not place secrets in that field.
 */
export interface PeerRefreshErrorInfo {
  code: string;
  message: string;
  /**
   * Epoch milliseconds recording when the indicator was raised, used by
   * the dashboard's 30s auto-clear sweep (see feature
   * `fix-m1-non-sign-failure-surface`). Optional so legacy callers
   * / tests that construct an indicator without a timestamp continue to
   * work; the sweep treats a missing timestamp as "never expires" (the
   * peer coming back online clears it).
   */
  failedAt?: number;
}

/**
 * Convert a `PeerStatus.last_seen` epoch value into the Paper-faithful
 * "Last seen <X> ago" copy used in the trailing slot of an online peer
 * row. The runtime's `peer_permission_states` surface exposes `last_seen`
 * as a Unix timestamp in **seconds** (see `bifrost-signer/src/lib.rs`
 * `now_unix_secs`). Demo/mock fixtures occasionally seed it in
 * milliseconds (`Date.now()`), so we auto-detect the unit by magnitude —
 * anything greater than 10^12 is treated as ms, otherwise seconds —
 * before computing the delta so both paths produce a plausible label.
 *
 * Exposed as a named export so the Vitest component test can exercise
 * the boundary conditions (just-now / seconds / minutes / hours / days /
 * null / stale-in-the-future clock skew) without rendering the whole
 * row.
 */
export function formatLastSeen(
  lastSeen: number | null | undefined,
  nowMs: number,
): string {
  if (lastSeen === null || lastSeen === undefined) return "Last seen —";
  // Accept either seconds (runtime `now_unix_secs`) or milliseconds
  // (demo fixtures / `Date.now()`). 10^12 ms ≈ Sept 2001, so values below
  // that threshold are reliably seconds.
  const lastSeenMs = lastSeen > 1e12 ? lastSeen : lastSeen * 1000;
  const diffSecs = Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
  if (diffSecs <= 1) return "Last seen just now";
  if (diffSecs < 60) return `Last seen ${diffSecs}s ago`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Last seen ${days}d ago`;
}

/**
 * Forces PeerRow to re-compute relative-time copy at ~1s cadence even if
 * the enclosing `runtime_status` snapshot hasn't changed. Together with
 * the parent's 2.5s poll tick this keeps the rendered `last_seen` string
 * advancing within the <=3s window VAL-OPS-010/011 require after a
 * Refresh click — without relying solely on props churn.
 */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
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
  const now = useNow();

  // Paper-reference mode keeps the static "24ms/38ms/Ready" latency copy
  // used by demo-gallery screenshots so pixel-parity regressions don't
  // drift when the real dashboard adopts the relative-time string.
  const onlineLatencyLabel = paper
    ? paperLatency(peer.idx)
    : formatLastSeen(peer.last_seen, now);

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
            style={{
              color: "#f87171",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <AlertTriangle size={12} aria-hidden="true" focusable="false" />
            Refresh failed
          </span>
        ) : peer.online ? (
          <span
            className="peer-last-seen"
            data-testid={`peer-last-seen-${peer.idx}`}
            title={
              peer.last_seen === null || peer.last_seen === undefined
                ? undefined
                : new Date(
                    peer.last_seen > 1e12
                      ? peer.last_seen
                      : peer.last_seen * 1000,
                  ).toISOString()
            }
          >
            {onlineLatencyLabel}
          </span>
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
