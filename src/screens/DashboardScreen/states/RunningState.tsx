import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui";
import type {
  PendingDispatchEntry,
  PeerLatencySample,
} from "../../../app/AppStateTypes";
import type {
  PeerPermissionState,
  PendingOperation,
  PeerStatus,
} from "../../../lib/bifrost/types";
import type { RuntimeRelayStatus } from "../../../lib/relay/runtimeRelayPump";
import {
  MOCK_EVENT_LOG_ROWS,
  MOCK_PENDING_APPROVAL_ROWS,
  type PolicyPromptRequest,
} from "../mocks";
import { EventLogPanel } from "../panels/EventLogPanel";
import { PeersPanel } from "../panels/PeersPanel";
import type { PeerRefreshErrorInfo } from "../panels/PeerRow";
import {
  PendingApprovalsPanel,
  deriveApprovalRowsFromRuntime,
  filterPendingApprovalOperations,
  formatApprovalTtl,
} from "../panels/PendingApprovalsPanel";
import { RelayHealthPanel } from "../panels/RelayHealthPanel";

/**
 * 1-second tick for TTL countdown refresh. Matches VAL-APPROVALS-002's
 * "TTL updates every 1s ±200ms" requirement. Local to RunningState so
 * the PendingApprovalsPanel itself remains a pure presentational
 * component — the tick drives a `now` state that re-derives rows and
 * nearest-SLA text.
 */
const APPROVALS_TTL_TICK_MS = 1_000;

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
  peerRefreshErrors,
  peerPermissionStates,
  runtimeRelays,
  pendingDispatchIndex,
  peerLatencyByPubkey,
}: {
  relays: string[];
  onlineCount: number;
  signReadyLabel: string;
  peers: PeerStatus[];
  pendingOperations: PendingOperation[];
  pendingDispatchIndex?: Record<string, PendingDispatchEntry>;
  peerLatencyByPubkey?: Record<string, PeerLatencySample>;
  paperPanels: boolean;
  sidebarOpen?: boolean;
  onStop: () => void;
  onRefresh?: () => void | Promise<void>;
  onOpenPolicyPrompt?: (request: PolicyPromptRequest) => void;
  peerRefreshErrors?: Record<string, PeerRefreshErrorInfo>;
  /**
   * Passed through to PeersPanel so PeerRow inline badges reflect the
   * live `effective_policy.request.*` grant matrix (VAL-POLICIES-006 /
   * VAL-POLICIES-020). Undefined in Paper/demo fixture scenarios that
   * predate runtime_status.peer_permission_states.
   */
  peerPermissionStates?: PeerPermissionState[];
  /**
   * m5-relay-telemetry — per-relay telemetry snapshot sourced from
   * {@link RuntimeRelayPump}. Rendered by {@link RelayHealthPanel} in
   * runtime mode (paperPanels=false) so validators and users can
   * observe live Relay RTT / Events / Last-Seen columns
   * (VAL-SETTINGS-010 through VAL-SETTINGS-014). Omitted in Paper/demo
   * mode to preserve pixel-parity.
   */
  runtimeRelays?: RuntimeRelayStatus[];
}) {
  // Drive a 1 s clock so the runtime-mode PendingApprovalsPanel's TTL
  // chips and "Nearest: <ttl>" header update live without requiring any
  // surrounding AppState churn. In Paper/demo mode the mock rows have
  // static TTL strings so the clock has no observable effect — we still
  // run the interval unconditionally because stopping/restarting it on
  // `paperPanels` would add churn for no user-visible benefit.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(
      () => setNowMs(Date.now()),
      APPROVALS_TTL_TICK_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const visiblePendingOperations = useMemo(
    () =>
      paperPanels
        ? pendingOperations
        : filterPendingApprovalOperations(
            pendingOperations,
            pendingDispatchIndex,
          ),
    [paperPanels, pendingOperations, pendingDispatchIndex],
  );

  const runtimeRows = useMemo(
    () =>
      // Paper/demo mode: use the Paper-fixture rows so visual-fidelity
      // tests continue to pass. Runtime mode: derive rows directly from
      // the live `pending_operations` snapshot.
      paperPanels
        ? MOCK_PENDING_APPROVAL_ROWS
        : deriveApprovalRowsFromRuntime(
            visiblePendingOperations,
            peers,
            nowMs,
          ),
    [paperPanels, visiblePendingOperations, peers, nowMs],
  );

  const nearestLabel = useMemo(() => {
    if (runtimeRows.length === 0) return undefined;
    if (paperPanels) return runtimeRows[0]?.ttl;
    // Compute from live operations so the header always matches the
    // smallest remaining TTL even when the first row happens not to be
    // the soonest (ordering is preserved from the runtime snapshot).
    let minRemaining = Infinity;
    for (const op of visiblePendingOperations) {
      const remaining = op.timeout_at * 1000 - nowMs;
      if (remaining < minRemaining) minRemaining = remaining;
    }
    if (!Number.isFinite(minRemaining)) return undefined;
    return formatApprovalTtl(minRemaining);
  }, [paperPanels, runtimeRows, visiblePendingOperations, nowMs]);

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
        peerRefreshErrors={peerRefreshErrors}
        peerPermissionStates={peerPermissionStates}
        peerLatencyByPubkey={peerLatencyByPubkey}
        nowMs={nowMs}
      />

      {/*
        Paper mode: render the Paper-fixture rows so visual-fidelity
        tests continue to match the canonical reference. Runtime mode:
        render the panel with no `rows` prop so it consumes the real
        {@link AppStateValue.runtimeEventLog} buffer driven by
        AppStateProvider's drain pipeline.
      */}
      {paperPanels ? <EventLogPanel rows={MOCK_EVENT_LOG_ROWS} /> : <EventLogPanel />}
      <PendingApprovalsPanel
        rows={runtimeRows}
        onOpenPolicyPrompt={paperPanels ? onOpenPolicyPrompt : undefined}
        nearest={nearestLabel}
      />
      {/* Runtime-mode Relay Health table (m5-relay-telemetry). Hidden in
       * Paper/demo mode so pixel-parity scenarios continue to render
       * identically. Deviation tracked in
       * `docs/runtime-deviations-from-paper.md`. */}
      {!paperPanels && runtimeRelays && runtimeRelays.length > 0 ? (
        <RelayHealthPanel runtimeRelays={runtimeRelays} />
      ) : null}
    </>
  );
}
