import { AlertTriangle } from "lucide-react";
import { PeerPermissionTag } from "../../../components/PeerPermissionTags";
import { shortHex } from "../../../lib/bifrost/format";
import { resolveRequestPolicyAllows } from "../../../lib/bifrost/policy";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../../lib/bifrost/types";
import type { PeerLatencySample } from "../../../app/AppStateTypes";
import { paperLatency, paperPeerKey } from "../mocks";

export const PEER_LATENCY_FRESH_MS = 60_000;

export function freshPeerLatencyMs(
  sample: PeerLatencySample | null | undefined,
  nowMs: number,
): number | null {
  if (!sample) return null;
  const ageMs = Math.max(0, nowMs - sample.measuredAt);
  return ageMs <= PEER_LATENCY_FRESH_MS ? sample.latencyMs : null;
}

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

export function PeerRow({
  peer,
  paper,
  sidebarOpen,
  refreshError,
  permissionState,
  latencySample,
  nowMs = Date.now(),
}: {
  peer: PeerStatus;
  paper?: boolean;
  sidebarOpen?: boolean;
  refreshError?: PeerRefreshErrorInfo | null;
  /**
   * When provided (runtime mode), the inline verb badges are derived
   * from `effective_policy.request.*` rather than the legacy
   * `peer.can_sign` / `peer.should_send_nonces` heuristics. This keeps
   * PeerRow chips consistent with the Peer Policies card chips for the
   * same (peer, verb) tuple within a single `runtime_status` snapshot
   * (VAL-POLICIES-005 / VAL-POLICIES-006 / VAL-POLICIES-020). When
   * undefined (legacy tests / Paper fixtures) PeerRow falls back to the
   * heuristic behaviour so existing pixel-parity scenarios do not
   * regress.
   */
  permissionState?: PeerPermissionState | null;
  latencySample?: PeerLatencySample | null;
  nowMs?: number;
}) {
  const incomingPct = Math.min(100, peer.incoming_available);
  const outgoingPct = Math.min(100, peer.outgoing_available);
  const lowPool = peer.online && Math.min(peer.incoming_available, peer.outgoing_available) < 25;
  const rowState = peer.online ? (lowPool ? "warning" : "") : "offline";

  const measuredLatencyMs = freshPeerLatencyMs(latencySample, nowMs);
  const onlineLatencyLabel = paper
    ? paperLatency(peer.idx)
    : measuredLatencyMs === null
      ? "--"
      : `${measuredLatencyMs}ms`;
  const latencyTitle = paper
    ? undefined
    : measuredLatencyMs === null
      ? "No fresh peer RTT sample yet."
      : "Peer RTT measured from Ping dispatch to completion.";

  // When an effective_policy-backed permissionState is provided, badges
  // are driven directly by the runtime grant matrix. Otherwise fall back
  // to the legacy heuristic surface (Paper/demo fixtures + tests that
  // predate m3-peer-policies-view).
  const usePolicy = !paper && !!permissionState;
  const grants = {
    sign: usePolicy
      ? resolveRequestPolicyAllows(permissionState, "sign")
      : peer.can_sign,
    ecdh: usePolicy
      ? resolveRequestPolicyAllows(permissionState, "ecdh")
      : peer.should_send_nonces,
    ping: usePolicy
      ? resolveRequestPolicyAllows(permissionState, "ping")
      : paper || !peer.should_send_nonces,
    onboard: usePolicy
      ? resolveRequestPolicyAllows(permissionState, "onboard")
      : !!paper && peer.idx === 1,
  };

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
        {/*
         * Badge rendering rules (VAL-POLICIES-001 cross-surface parity):
         *   - Runtime mode (`usePolicy === true`, i.e. a live
         *     `peer_permission_states` snapshot is present): render all
         *     four verb badges sourced from `effective_policy.request.*`
         *     regardless of `peer.online`. The PoliciesState card always
         *     renders one row per peer with its four chips; PeerRow must
         *     match so the two surfaces never disagree for the same
         *     (peer, verb) tuple. The offline visual treatment is
         *     conveyed via the enclosing `.peer-row.offline` container
         *     (greyed opacity + red online dot) rather than by hiding
         *     the badges.
         *   - Legacy / Paper fixture path (`usePolicy === false`): keep
         *     the historical behaviour of suppressing badges for offline
         *     peers so the demo-gallery + dashboard-running pixel-parity
         *     regression specs remain green.
         */}
        {peer.online || usePolicy ? (
          <span className="inline-actions">
            {grants.sign ? <PeerPermissionTag method="sign" /> : null}
            {grants.ecdh ? <PeerPermissionTag method="ecdh" /> : null}
            {grants.ping ? <PeerPermissionTag method="ping" /> : null}
            {grants.onboard ? <PeerPermissionTag method="onboard" /> : null}
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
            className="peer-latency"
            data-testid={`peer-latency-${peer.idx}`}
            title={latencyTitle}
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
