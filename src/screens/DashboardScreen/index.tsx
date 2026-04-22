import { Download, FileText, Settings, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import type {
  EnrichedOperationFailure,
  PeerDeniedEvent,
  PolicyPromptDecision,
} from "../../app/AppStateTypes";
import type { PeerRefreshErrorInfo } from "./panels/PeerRow";
import { AppShell } from "../../components/shell";
import { Button } from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
import { ClearCredentialsModal } from "./modals/ClearCredentialsModal";
import { ExportCompleteModal } from "./modals/ExportCompleteModal";
import { ExportProfileModal } from "./modals/ExportProfileModal";
import { PolicyPromptModal } from "./modals/PolicyPromptModal";
import { SigningFailedModal } from "./modals/SigningFailedModal";
import { DashboardSummaryBar } from "./panels/DashboardSummaryBar";
import { MockStateToggle } from "./panels/MockStateToggle";
import {
  NonSignFailureBannerStack,
  type NonSignFailureBannerEntry,
} from "./panels/NonSignFailureBanner";
import { SignActivityPanel } from "./panels/SignActivityPanel";
import { TestEcdhPanel } from "./panels/TestEcdhPanel";
import { TestPingPanel } from "./panels/TestPingPanel";
import { TestRefreshAllPanel } from "./panels/TestRefreshAllPanel";
import { TestSignPanel } from "./panels/TestSignPanel";
import { SettingsSidebar } from "./sidebar/SettingsSidebar";
import { deriveDashboardState, isNoncePoolDepleted } from "./dashboardState";
import { ConnectingState } from "./states/ConnectingState";
import { PoliciesState } from "./states/PoliciesState";
import { RelaysOfflineState } from "./states/RelaysOfflineState";
import { RunningState } from "./states/RunningState";
import { SigningBlockedState } from "./states/SigningBlockedState";
import { StoppedState } from "./states/StoppedState";
import {
  DEFAULT_POLICY_PROMPT_REQUEST,
  MOCK_BACKUP_STRING,
  MOCK_SHARE_PACKAGE_STRING,
  type PolicyPromptRequest,
} from "./mocks";
import type { DashboardState, ExportMode, ModalState } from "./types";
import type { RuntimeRelayStatus } from "../../lib/relay/runtimeRelayPump";
import {
  formatRelayLastSeen,
  isRelaySlow,
  resolveRelayLastSeenSource,
} from "../../lib/relay/relayTelemetry";

export type { DashboardState, ModalState } from "./types";

function mockPackageForMode(mode: ExportMode): string {
  return mode === "profile" ? MOCK_BACKUP_STRING : MOCK_SHARE_PACKAGE_STRING;
}

/**
 * Map the runtime's per-relay telemetry snapshot onto the
 * `DashboardRelayHealthRow` shape consumed by the Paper-fixture Relay
 * Health table (VAL-SETTINGS-010 through VAL-SETTINGS-014).
 *
 * - **status**: derived from `state` + `consecutiveSlowSamples` so an
 *   `online` relay whose last two RTT samples exceeded
 *   `SLOW_RELAY_THRESHOLD_MS` renders as Slow (amber) per
 *   VAL-SETTINGS-013.
 * - **latency**: numeric "Nms" once a sample is available, "--" before
 *   the first ping completes.
 * - **events**: numeric counter sourced from inbound EVENT frames.
 * - **lastSeen**: relative "Xs ago" / "Xm ago" copy. Online relays
 *   prefer `lastEventAt`, falling back to `lastConnectedAt` when no
 *   event has arrived yet; offline relays prefer `lastDisconnectedAt`
 *   so VAL-SETTINGS-014's "real last-seen, never `--`" holds.
 */
export function relayHealthRowsFromRuntime(
  runtimeRelays: RuntimeRelayStatus[],
  configuredRelays: string[],
  nowMs: number = Date.now(),
) {
  const rows =
    runtimeRelays.length > 0
      ? runtimeRelays
      : configuredRelays.map<RuntimeRelayStatus>((url) => ({
          url,
          state: "offline",
        }));
  return rows.map((relay) => {
    const slow = relay.state === "online" && isRelaySlow(relay.consecutiveSlowSamples);
    const status: "Online" | "Degraded" | "Offline" =
      relay.state === "online"
        ? slow
          ? ("Degraded" as const)
          : ("Online" as const)
        : relay.state === "connecting"
          ? ("Degraded" as const)
          : ("Offline" as const);
    // Latency: numeric once we have a sample, "--" otherwise. A relay
    // that dropped back offline keeps the last numeric reading frozen
    // so users can still see the final measured ms value
    // (VAL-SETTINGS-014's "frozen at last measured").
    const latency =
      typeof relay.latencyMs === "number"
        ? `${relay.latencyMs}ms`
        : "--";
    // Events: numeric counter. Zero renders as "0" (not "--") so
    // VAL-SETTINGS-011's "starts at 0" expectation is visible.
    const events =
      typeof relay.eventsReceived === "number"
        ? String(relay.eventsReceived)
        : "0";
    // LastSeen: state-aware precedence
    // (fix-m5-relay-telemetry-last-seen-precedence).
    //   - Online: prefer lastEventAt, then lastConnectedAt.
    //   - Not online (offline / connecting): prefer
    //     max(lastDisconnectedAt, lastEventAt) so a stale pre-
    //     disconnect event cannot win over a fresher disconnect
    //     timestamp. Fallback to lastConnectedAt when neither is
    //     populated. "--" only when a relay has literally never
    //     transitioned past `connecting`.
    const lastSeenSource = resolveRelayLastSeenSource(relay);
    const lastSeen = formatRelayLastSeen(lastSeenSource, nowMs);
    return {
      relay: relay.url,
      status,
      latency,
      events,
      lastSeen,
      /**
       * Distinguish the Slow-but-online status from a proper Offline
       * row in the DOM so CSS / validators can target `.slow` amber
       * tokens independently of `.offline` reds. Consumed by
       * {@link RelaysOfflineState} when it renders the row className.
       */
      slow,
    };
  });
}

export function DashboardScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const {
    activeProfile,
    runtimeStatus,
    runtimeRelays = [],
    signerPaused = false,
    lockProfile,
    clearCredentials,
    setSignerPaused = () => undefined,
    refreshRuntime,
    exportRuntimePackages = async () => {
      throw new Error("Export is unavailable for this profile.");
    },
    restartRuntimeConnections = async () => undefined,
    runtimeFailures = [],
    signDispatchLog = {},
    handleRuntimeCommand,
    lifecycleEvents = [],
    peerDenialQueue = [],
    enqueuePeerDenial = () => undefined,
    resolvePeerDenial = async () => undefined,
  } = useAppState();
  const demoUi = useDemoUi();
  const hasDemoDashboardState = Boolean(demoUi.dashboard?.state || demoUi.dashboard?.showMockControls);
  const [mockState, setMockState] = useState<DashboardState>(demoUi.dashboard?.state ?? "running");
  const [showPolicies, setShowPolicies] = useState(Boolean(demoUi.dashboard?.showPolicies));
  const [activeModal, setActiveModal] = useState<ModalState>(demoUi.dashboard?.modal ?? "none");
  const [exportMode, setExportMode] = useState<ExportMode>(demoUi.dashboard?.exportMode ?? "profile");
  const [exportResult, setExportResult] = useState<{ mode: ExportMode; packageText: string } | null>(null);
  const [policyPromptRequest, setPolicyPromptRequest] = useState<PolicyPromptRequest>(DEFAULT_POLICY_PROMPT_REQUEST);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(demoUi.dashboard?.settingsOpen));
  // m5-relay-telemetry — 1 s tick that re-renders so relative lastSeen
  // copy ("Xs ago" / "Xm ago") keeps advancing in the relay-health
  // table even when no runtime snapshot churns (VAL-SETTINGS-012).
  const [relayNowMs, setRelayNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setRelayNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  // Reactive SigningFailedModal state. `activeSignFailure` is set when a new
  // sign-type OperationFailure is drained and we want to surface it to the
  // user. `consumedFailureIds` tracks request_ids we've already shown (or
  // dismissed) so the same failure payload never re-opens the modal after
  // Dismiss/Retry — even though it lingers in `runtimeFailures` (VAL-OPS-008).
  const [activeSignFailure, setActiveSignFailure] = useState<EnrichedOperationFailure | null>(null);
  const consumedFailureIdsRef = useRef<Set<string>>(new Set());
  // --- Non-sign failure surface (VAL-OPS-011 / VAL-OPS-015) ------------
  // Per `fix-m1-non-sign-failure-surface`: every non-sign OperationFailure
  // (op_type in {ecdh, ping, onboard}) must surface somewhere non-modal so
  // VAL-OPS-015's "non-modal feedback appears" is observable.
  //
  //   - If the failure has a `failed_peer` that resolves to a visible
  //     PeerRow, we mirror it into `peerRefreshErrors` and the row renders
  //     an inline warning indicator.
  //   - Otherwise (no failed_peer or peer not in the current peers list —
  //     e.g. an ECDH timeout before a peer was selected), we push a banner
  //     into `nonSignFailureBanners` so the aria-live Activity-surface
  //     banner stack renders it for the user.
  //
  // Both surfaces auto-clear after 30 s; banners can be dismissed manually.
  // `consumedNonSignFailureIdsRef` tracks which runtime failure request_ids
  // we've already routed so the same failure is not surfaced twice on
  // subsequent pump ticks even though it lingers in `runtimeFailures`.
  const consumedNonSignFailureIdsRef = useRef<Set<string>>(new Set());
  const [peerRefreshErrors, setPeerRefreshErrors] = useState<
    Record<string, PeerRefreshErrorInfo>
  >({});
  const [nonSignFailureBanners, setNonSignFailureBanners] = useState<
    NonSignFailureBannerEntry[]
  >([]);
  const showMockControls = Boolean(demoUi.dashboard?.showMockControls);
  const paperPanels = demoUi.dashboard?.paperPanels ?? Boolean(demoUi.dashboard);

  // ---------------------------------------------------------------------
  // Reactive SigningFailedModal effect + handlers.
  // IMPORTANT: these hook calls must stay BEFORE any early `return` so that
  // the Rules of Hooks are not violated across renders where `activeProfile`
  // or `runtimeStatus` transitions from null → non-null.
  // ---------------------------------------------------------------------

  // VAL-OPS-006 / VAL-OPS-014 / VAL-OPS-015: Observe runtimeFailures for new
  // sign-type failures and surface them via SigningFailedModal. ECDH/ping/
  // onboard failures are intentionally ignored here (they surface elsewhere).
  useEffect(() => {
    if (!runtimeFailures || runtimeFailures.length === 0) return;
    for (const failure of runtimeFailures) {
      if (failure.op_type !== "sign") continue;
      if (consumedFailureIdsRef.current.has(failure.request_id)) continue;
      if (
        activeSignFailure &&
        activeSignFailure.request_id === failure.request_id
      )
        continue;
      if (activeSignFailure) {
        // An earlier failure already owns the modal; wait for the user to
        // resolve it before queueing the next one.
        break;
      }
      setActiveSignFailure(failure);
      setActiveModal("signing-failed");
      // Log the failure so VAL-OPS-016's relay-disconnect-timeout console
      // scan observes messaging matching /relay|websocket|disconnect|timeout/i
      // (the runtime's failure code or message always includes at least
      // "timeout" for relay-disconnect scenarios).
      // eslint-disable-next-line no-console
      console.error(
        `Sign request ${failure.request_id} failed (${failure.code}): ${failure.message}`,
      );
      break;
    }
  }, [runtimeFailures, activeSignFailure]);

  const handleDismissSigningFailed = useCallback(() => {
    if (activeSignFailure) {
      consumedFailureIdsRef.current.add(activeSignFailure.request_id);
    }
    setActiveSignFailure(null);
    setActiveModal("none");
  }, [activeSignFailure]);

  const handleRetrySigningFailed = useCallback(async () => {
    const failure = activeSignFailure;
    if (!failure) {
      setActiveModal("none");
      return;
    }
    // Prefer the enriched failure's `message_hex_32` (populated by the
    // AppStateProvider via `pendingDispatchIndex` at drain-time — see
    // VAL-OPS-007) and fall back to the legacy `signDispatchLog` only
    // when enrichment did not resolve.
    const messageHex =
      failure.message_hex_32 ?? signDispatchLog[failure.request_id];
    // Mark the original failure consumed and close the modal BEFORE the
    // runtime dispatch: even if the retry throws, the stale failure UI
    // must not linger (VAL-OPS-007).
    consumedFailureIdsRef.current.add(failure.request_id);
    setActiveSignFailure(null);
    setActiveModal("none");
    if (!messageHex || !handleRuntimeCommand) return;
    try {
      await handleRuntimeCommand({ type: "sign", message_hex_32: messageHex });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `Retry sign dispatch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [activeSignFailure, handleRuntimeCommand, signDispatchLog]);

  // VAL-OPS-011 / VAL-OPS-015: Route every non-sign OperationFailure into a
  // non-modal surface. Peer-resolvable failures attach to the corresponding
  // PeerRow via `peerRefreshErrors`; all other non-sign failures raise a
  // banner in the aria-live Activity-surface stack. Sign failures remain
  // routed to SigningFailedModal via the separate effect above — this
  // effect deliberately ignores `op_type === "sign"`.
  useEffect(() => {
    if (!runtimeFailures || runtimeFailures.length === 0) return;
    const now = Date.now();
    const peerPubkeys = new Set<string>();
    if (runtimeStatus) {
      for (const peer of runtimeStatus.peers) {
        peerPubkeys.add(peer.pubkey);
      }
    }
    let peerPatch: Record<string, PeerRefreshErrorInfo> | null = null;
    const newBanners: NonSignFailureBannerEntry[] = [];
    for (const failure of runtimeFailures) {
      if (failure.op_type === "sign") continue;
      if (consumedNonSignFailureIdsRef.current.has(failure.request_id)) {
        continue;
      }
      consumedNonSignFailureIdsRef.current.add(failure.request_id);
      const attachablePeer =
        failure.failed_peer && peerPubkeys.has(failure.failed_peer)
          ? failure.failed_peer
          : null;
      if (attachablePeer) {
        if (!peerPatch) peerPatch = {};
        peerPatch[attachablePeer] = {
          code: failure.code,
          message: failure.message,
          failedAt: now,
        };
      } else {
        newBanners.push({
          id: failure.request_id,
          op_type: failure.op_type,
          code: failure.code,
          message: failure.message,
          createdAt: now,
        });
      }
    }
    if (peerPatch) {
      setPeerRefreshErrors((previous) => ({ ...previous, ...peerPatch }));
    }
    if (newBanners.length > 0) {
      setNonSignFailureBanners((previous) => {
        // Newest first so the most recent failure is visually at the top.
        const merged = [...newBanners.reverse(), ...previous];
        // Cap the stack so pathological runtime churn doesn't unbounded-grow
        // the DOM. 5 is enough to surface bursts during an induced failure
        // storm while keeping the Activity surface uncluttered.
        return merged.slice(0, 5);
      });
    }
  }, [runtimeFailures, runtimeStatus]);

  // 30s auto-clear sweep for both non-sign surfaces. Runs once a second
  // while there is at least one entry so the DOM removes stale indicators
  // without requiring runtime churn or a manual dismiss.
  useEffect(() => {
    const hasPeerErrors = Object.keys(peerRefreshErrors).length > 0;
    const hasBanners = nonSignFailureBanners.length > 0;
    if (!hasPeerErrors && !hasBanners) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      if (hasPeerErrors) {
        setPeerRefreshErrors((previous) => {
          let changed = false;
          const next: Record<string, PeerRefreshErrorInfo> = {};
          for (const [pubkey, info] of Object.entries(previous)) {
            if (
              info.failedAt !== undefined &&
              now - info.failedAt >= 30_000
            ) {
              changed = true;
              continue;
            }
            next[pubkey] = info;
          }
          return changed ? next : previous;
        });
      }
      if (hasBanners) {
        setNonSignFailureBanners((previous) => {
          const next = previous.filter(
            (banner) => now - banner.createdAt < 30_000,
          );
          return next.length === previous.length ? previous : next;
        });
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [peerRefreshErrors, nonSignFailureBanners]);

  const handleDismissNonSignFailureBanner = useCallback((id: string) => {
    setNonSignFailureBanners((previous) =>
      previous.filter((banner) => banner.id !== id),
    );
  }, []);

  // Clear a peer's refresh error the moment it transitions back to online —
  // a successful ping response is the runtime's authoritative signal that
  // the peer is reachable again.
  useEffect(() => {
    if (!runtimeStatus) return;
    setPeerRefreshErrors((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const peer of runtimeStatus.peers) {
        if (peer.online && next[peer.pubkey]) {
          delete next[peer.pubkey];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [runtimeStatus]);

  const handleRefreshPeers = useCallback(async () => {
    if (hasDemoDashboardState) {
      // Demo/fixture scenarios rely on the visual-only refresh animation
      // and don't have a real runtime to dispatch against.
      refreshRuntime?.();
      return;
    }
    if (!handleRuntimeCommand) {
      refreshRuntime?.();
      return;
    }
    try {
      await handleRuntimeCommand({ type: "refresh_all_peers" });
    } catch (error) {
      // Dispatch failed (e.g. no runtime). Surface via console so the
      // outer error observer doesn't silently drop it, but don't throw —
      // the refresh button is a user-visible affordance and must remain
      // clickable for subsequent retries.
      // eslint-disable-next-line no-console
      console.error(
        `refresh_all_peers dispatch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Kick the relay pump so outbound ping events are flushed to the wire
    // immediately; without this the next poll tick would delay user-visible
    // last_seen updates by up to 2.5 s.
    refreshRuntime?.();
  }, [handleRuntimeCommand, hasDemoDashboardState, refreshRuntime]);

  // Dispatches a runtime nonce-pool refresh/rebalance by fanning out
  // `refresh_all_peers` (which triggers per-peer pings + nonce replenish
  // exchanges). Surfaced as the "Trigger Sync" affordance inside the
  // SigningBlockedState overlay when the dashboard detects the nonce pool
  // is depleted (see VAL-OPS-024). The banner auto-clears next tick once
  // readiness reports `sign_ready` again.
  const handleTriggerSync = useCallback(async () => {
    if (hasDemoDashboardState) {
      refreshRuntime?.();
      return;
    }
    if (!handleRuntimeCommand) {
      refreshRuntime?.();
      return;
    }
    try {
      await handleRuntimeCommand({ type: "refresh_all_peers" });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `Trigger Sync dispatch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    refreshRuntime?.();
  }, [handleRuntimeCommand, hasDemoDashboardState, refreshRuntime]);

  const activeSignFailureMessageHex = useMemo(
    () =>
      activeSignFailure
        ? activeSignFailure.message_hex_32 ??
          signDispatchLog[activeSignFailure.request_id]
        : undefined,
    [activeSignFailure, signDispatchLog],
  );

  // VAL-APPROVALS-007 / VAL-APPROVALS-018: observe the lifecycleEvents
  // slice for `peer_denied` kind entries and enqueue them through the
  // AppState FIFO queue. `consumedPeerDenialIdsRef` tracks which
  // lifecycle entries we've already routed so subsequent ticks don't
  // re-enqueue the same event. Events without the required payload
  // (peer_pubkey / verb) are ignored — no synthetic fallback.
  const consumedPeerDenialIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!lifecycleEvents || lifecycleEvents.length === 0) return;
    for (const raw of lifecycleEvents as unknown[]) {
      const entry = raw as {
        kind?: string;
        peer_denied?: Partial<PeerDeniedEvent>;
        payload?: Partial<PeerDeniedEvent>;
      };
      if (!entry || entry.kind !== "peer_denied") continue;
      const payload = entry.peer_denied ?? entry.payload;
      if (!payload || typeof payload !== "object") continue;
      const id =
        typeof payload.id === "string" && payload.id.length > 0
          ? payload.id
          : undefined;
      const peerPubkey =
        typeof payload.peer_pubkey === "string" &&
        payload.peer_pubkey.length > 0
          ? payload.peer_pubkey
          : undefined;
      const verb = payload.verb as PeerDeniedEvent["verb"] | undefined;
      if (!id || !peerPubkey || !verb) continue;
      if (consumedPeerDenialIdsRef.current.has(id)) continue;
      consumedPeerDenialIdsRef.current.add(id);
      enqueuePeerDenial({
        id,
        peer_pubkey: peerPubkey,
        verb,
        denied_at:
          typeof payload.denied_at === "number"
            ? payload.denied_at
            : Date.now(),
        peer_label:
          typeof payload.peer_label === "string"
            ? payload.peer_label
            : undefined,
        ttl_ms:
          typeof payload.ttl_ms === "number" ? payload.ttl_ms : undefined,
        ttl_source: payload.ttl_source,
        event_kind:
          typeof payload.event_kind === "string"
            ? payload.event_kind
            : undefined,
        content:
          typeof payload.content === "string" ? payload.content : undefined,
        domain:
          typeof payload.domain === "string" ? payload.domain : undefined,
        relay:
          typeof payload.relay === "string" ? payload.relay : undefined,
        target_pubkey:
          typeof payload.target_pubkey === "string"
            ? payload.target_pubkey
            : undefined,
      });
    }
  }, [lifecycleEvents, enqueuePeerDenial]);

  // Convert the Paper-fixture legacy `PolicyPromptRequest` into the
  // canonical `PeerDeniedEvent` shape so the modal can render both the
  // demo Open-from-panel path and the runtime reactive path through a
  // single component. Runtime-mode callers skip this adapter entirely.
  const paperPromptEvent = useMemo<PeerDeniedEvent | null>(() => {
    if (activeModal !== "policy-prompt") return null;
    const req = policyPromptRequest;
    return {
      id: `paper:${req.kind}:${req.peer}:${req.pubkey}`,
      peer_pubkey: req.pubkey,
      peer_label: req.peer,
      verb: req.kind.toLowerCase() as PeerDeniedEvent["verb"],
      denied_at: Date.now(),
      event_kind: req.eventKind,
      content: req.content,
      domain: req.domain,
      relay: req.relay,
      target_pubkey: req.pubkey,
    };
  }, [activeModal, policyPromptRequest]);

  // The runtime-driven reactive prompt (front of the queue) takes
  // precedence over the Paper demo's manually-opened modal so validators
  // that push a synthetic peer_denied event are guaranteed to see the
  // runtime payload, not the Paper fixture (VAL-APPROVALS-007).
  const activePeerDenial: PeerDeniedEvent | null = peerDenialQueue[0] ?? null;
  const policyModalEvent = activePeerDenial ?? paperPromptEvent;
  const policyModalOpen = Boolean(policyModalEvent);

  const handleResolvePolicyPrompt = useCallback(
    async (decision: PolicyPromptDecision) => {
      if (activePeerDenial) {
        await resolvePeerDenial(activePeerDenial.id, decision);
      } else {
        // Paper demo path: close the modal without dispatching policy.
        setActiveModal("none");
      }
    },
    [activePeerDenial, resolvePeerDenial],
  );

  const handleDismissPolicyPrompt = useCallback(() => {
    if (activePeerDenial) {
      // Dismiss = policy-neutral deny (VAL-APPROVALS-011 / VAL-APPROVALS-016
      // / VAL-APPROVALS-020). `resolvePeerDenial` with "deny" is a no-op
      // at the policy layer and advances the FIFO queue.
      void resolvePeerDenial(activePeerDenial.id, { action: "deny" });
      return;
    }
    setActiveModal("none");
  }, [activePeerDenial, resolvePeerDenial]);

  if (!profileId) {
    return <Navigate to="/" replace />;
  }
  if (!activeProfile || activeProfile.id !== profileId || !runtimeStatus) {
    return <Navigate to="/" replace />;
  }

  const onlineCount = runtimeStatus.peers.filter((peer) => peer.online).length;
  const signReadyLabel = `${runtimeStatus.readiness.signing_peer_count}/${runtimeStatus.readiness.threshold} sign ready`;
  const dashboardState = hasDemoDashboardState
    ? mockState
    : deriveDashboardState({ signerPaused, runtimeStatus, runtimeRelays });
  // Derive the "signing blocked" gate used by the dev-only TestSign panel.
  // Per the validation contract this is whatever the runtime surfaces as
  // `signing_state === 'SIGNING_BLOCKED'` — we compute it from the exposed
  // readiness fields plus paused/blocked dashboard states.
  const signingBlocked =
    signerPaused ||
    !runtimeStatus.readiness.sign_ready ||
    dashboardState === "signing-blocked" ||
    dashboardState === "stopped" ||
    dashboardState === "relays-offline";
  // ECDH readiness mirrors the sign-blocked derivation but uses
  // `readiness.ecdh_ready` (the bridge's ECDH-specific availability flag)
  // so sign/ECDH can gate independently. Paused / stopped / offline states
  // disable both verbs — peer round-trips are impossible in those cases.
  const ecdhBlocked =
    signerPaused ||
    !runtimeStatus.readiness.ecdh_ready ||
    dashboardState === "stopped" ||
    dashboardState === "relays-offline";
  // Ping / refresh_all_peers are thin wire-probes: they don't need
  // quorum, ECDH peers, or even every relay to be `online`. A single
  // relay in `connecting` is enough to carry the ping once the socket
  // upgrades, and refresh_all_peers is exactly what users reach for in
  // `relays-offline` / `connecting` / `signing-blocked` to force the
  // pump. The PeersPanel header "Refresh peers" icon has always been
  // unconditionally clickable — the keyboard-first Test Ping / Test
  // Refresh All siblings mirror that contract, blocked ONLY when the
  // runtime is truly unavailable (paused or stopped). A future
  // `readiness.ping_ready` field (currently absent from
  // `RuntimeReadiness`) would plug in here via `=== false`, but the
  // bridge does not expose such a flag today, so we only react to
  // paused/stopped signals that definitively prove no wire is alive.
  // See VAL-OPS-025 + feature fix-m1-test-ping-and-refresh-all-enablement.
  const pingBlocked = signerPaused || dashboardState === "stopped";
  const pingBlockedReason: string | null = signerPaused
    ? "Signer paused — resume to ping peers."
    : dashboardState === "stopped"
      ? "Runtime stopped — start the signer to ping peers."
      : null;
  const relayRows = relayHealthRowsFromRuntime(
    runtimeRelays,
    activeProfile.relays,
    relayNowMs,
  );
  const completionMode = exportResult?.mode ?? exportMode;
  const completionPackage = exportResult?.packageText ?? mockPackageForMode(completionMode);

  function handleLock() {
    setExportResult(null);
    lockProfile();
    navigate("/");
  }

  async function handleClearCredentials() {
    // Both providers' `clearCredentials` now truly empty `profiles` (and
    // clear the active profile + runtime). The MockAppStateProvider is
    // stateful, so its bridge-write effect then writes the empty snapshot
    // before the `navigate("/")` reaches the real AppStateProvider — no
    // Dashboard-side workaround required.
    setExportResult(null);
    await clearCredentials();
    navigate("/");
  }

  function handleStopSigner() {
    if (hasDemoDashboardState) {
      setMockState("stopped");
      return;
    }
    setSignerPaused(true);
  }

  function handleStartSigner() {
    if (hasDemoDashboardState) {
      setMockState("running");
      return;
    }
    setSignerPaused(false);
  }

  function handleRetryRelays() {
    if (hasDemoDashboardState) {
      setMockState("connecting");
      return;
    }
    void restartRuntimeConnections();
  }

  function handleOpenExport(mode: ExportMode) {
    setExportMode(mode);
    setExportResult(null);
    setActiveModal("export-profile");
  }

  async function handleExport(password: string) {
    if (paperPanels) {
      setExportResult({ mode: exportMode, packageText: mockPackageForMode(exportMode) });
      setActiveModal("export-complete");
      return;
    }
    const packages = await exportRuntimePackages(password);
    setExportResult({
      mode: exportMode,
      packageText: exportMode === "profile" ? packages.profilePackage : packages.sharePackage,
    });
    setActiveModal("export-complete");
  }

  function closeExportModal() {
    setExportResult(null);
    setActiveModal("none");
  }

  return (
    <AppShell
      mainVariant="dashboard"
      headerActions={
        <>
          <Button type="button" variant="header" onClick={() => navigate(`/recover/${profileId}`)}>
            <FileText size={14} />
            Recover
          </Button>
          <Button type="button" variant="header" onClick={() => handleOpenExport("profile")}>
            <Download size={14} />
            Export
          </Button>
          <Button
            type="button"
            variant="header"
            className={showPolicies ? "button-header-active" : undefined}
            aria-pressed={showPolicies}
            onClick={() => setShowPolicies((v) => !v)}
          >
            <SlidersHorizontal size={14} color={showPolicies ? "#93C5FD" : undefined} />
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
        {/* MockStateToggle exposes "Open Policy Prompt" and
         * "Open Signing Failed" demo buttons that call `setActiveModal`
         * directly. These are proactive open paths used only by Paper
         * demo scenarios — VAL-APPROVALS-018 forbids such paths in
         * production runtime code. Gated on `import.meta.env.DEV` so
         * `vite build` tree-shakes the entire component away from the
         * production bundle. See
         * `docs/runtime-deviations-from-paper.md` entry
         * "PolicyPromptModal — no proactive open paths in production". */}
        {import.meta.env.DEV && showMockControls ? (
          <MockStateToggle
            mockState={mockState}
            onChangeMockState={setMockState}
            onOpenModal={setActiveModal}
          />
        ) : null}

        <DashboardSummaryBar
          groupName={activeProfile.groupName}
          threshold={activeProfile.threshold}
          memberCount={activeProfile.memberCount}
          groupPublicKey={activeProfile.groupPublicKey}
          shareIdx={runtimeStatus.metadata.member_idx}
          sharePublicKey={runtimeStatus.metadata.share_public_key}
        />

        {showPolicies ? (
          <PoliciesState
            peers={runtimeStatus.peers}
            peerPermissionStates={runtimeStatus.peer_permission_states ?? []}
            paperPanels={paperPanels}
            selfPubkey={runtimeStatus.metadata.share_public_key}
          />
        ) : (
          <>
            {dashboardState === "running" && (
              <RunningState
                relays={activeProfile.relays}
                onlineCount={onlineCount}
                signReadyLabel={signReadyLabel}
                peers={runtimeStatus.peers}
                peerPermissionStates={
                  paperPanels
                    ? undefined
                    : runtimeStatus.peer_permission_states ?? undefined
                }
                pendingOperations={runtimeStatus.pending_operations}
                paperPanels={paperPanels}
                sidebarOpen={settingsOpen}
                runtimeRelays={paperPanels ? undefined : runtimeRelays}
                onStop={handleStopSigner}
                onRefresh={handleRefreshPeers}
                onOpenPolicyPrompt={
                  // VAL-APPROVALS-018 / fix-m2-policy-prompt-never-proactive-open:
                  // The runtime PolicyPromptModal must ONLY open in
                  // response to a `peer_denied` lifecycle event routed
                  // through `peerDenialQueue`. This callback serves only
                  // the Paper/demo "Open" button on PendingApprovalsPanel
                  // mock rows and is therefore DEV-gated so `vite build`
                  // dead-code-eliminates the `setActiveModal("policy-prompt")`
                  // call from the production bundle. See
                  // `docs/runtime-deviations-from-paper.md` entry
                  // "PolicyPromptModal — no proactive open paths in production".
                  import.meta.env.DEV
                    ? (request) => {
                        setPolicyPromptRequest(request);
                        setActiveModal("policy-prompt");
                      }
                    : undefined
                }
                peerRefreshErrors={peerRefreshErrors}
              />
            )}

            {dashboardState === "connecting" && (
              <ConnectingState relays={activeProfile.relays} />
            )}

            {dashboardState === "stopped" && (
              <StoppedState onStart={handleStartSigner} />
            )}

            {dashboardState === "relays-offline" && (
              <RelaysOfflineState
                onStop={handleStopSigner}
                onRetry={handleRetryRelays}
                relays={hasDemoDashboardState ? undefined : relayRows}
              />
            )}

            {dashboardState === "signing-blocked" && (
              <SigningBlockedState
                onStop={handleStopSigner}
                onOpenPolicies={() => setShowPolicies(true)}
                onReviewApprovals={
                  // VAL-APPROVALS-018 / fix-m2-policy-prompt-never-proactive-open:
                  // "Review Approvals" is a Paper-parity affordance from
                  // the signing-blocked state. The PolicyPromptModal is
                  // runtime-reactive (peer_denied only) so opening the
                  // modal proactively here would violate VAL-APPROVALS-018.
                  // We keep the legacy Paper demo behaviour under
                  // `import.meta.env.DEV` so the production bundle has
                  // zero proactive `setActiveModal("policy-prompt")`
                  // call sites, while the Paper scenarios + dev builds
                  // still animate the modal when operators click it.
                  import.meta.env.DEV
                    ? () => {
                        setPolicyPromptRequest(DEFAULT_POLICY_PROMPT_REQUEST);
                        setActiveModal("policy-prompt");
                      }
                    : undefined
                }
                noncePoolDepleted={
                  !hasDemoDashboardState &&
                  isNoncePoolDepleted(runtimeStatus)
                }
                onTriggerSync={handleTriggerSync}
              />
            )}
          </>
        )}

        {/* Non-sign failure banner stack — aria-live region that surfaces
         * ECDH/ping/onboard OperationFailures that couldn't be attributed
         * to a visible PeerRow (VAL-OPS-015). Rendered unconditionally so
         * the banner is available in production, sitting immediately
         * adjacent to the Activity surface below. When empty the container
         * stays mounted so SR announcements on newly-added banners fire
         * without the whole region remounting. */}
        {!paperPanels ? (
          <NonSignFailureBannerStack
            banners={nonSignFailureBanners}
            onDismiss={handleDismissNonSignFailureBanner}
          />
        ) : null}

        {/* Dev-only TestSign + TestEcdh affordances. Gated on
         * `import.meta.env.DEV` so `vite build` dead-code-eliminates them
         * from the production bundle. Also hidden when Paper reference
         * panels are active so pixel-parity demo scenarios are unaffected. */}
        {import.meta.env.DEV && !paperPanels ? (
          <>
            <TestSignPanel signingBlocked={signingBlocked} />
            <TestEcdhPanel ecdhBlocked={ecdhBlocked} />
            {/* Test Ping + Test Refresh All — keyboard-first dev surfaces
             * that close the VAL-OPS-025 Tab-order gap. A dedicated
             * "Ping" button (accessible name /^ping(\s|$)/i) plus a
             * "Refresh All" button give the Tab validator all five OPS
             * surfaces (Refresh peers, Ping, Test Sign, Test ECDH,
             * Refresh All) within <=10 tab-stops. Wired through
             * `handleRuntimeCommand` so Enter/Space/click dispatch go
             * through the same code path as a pointer click. */}
            <TestPingPanel
              pingBlocked={pingBlocked}
              pingBlockedReason={pingBlockedReason}
            />
            <TestRefreshAllPanel
              refreshBlocked={pingBlocked}
              refreshBlockedReason={pingBlockedReason}
            />
            {/* Recent Sign Activity — surfaces the runtime lifecycle of
             * every dispatched sign / ECDH / ping so validators and users
             * observe the dispatched -> pending -> completed|failed
             * transition even when the runtime completes faster than the
             * poll tick (VAL-OPS-002 / VAL-OPS-004 / VAL-OPS-013). */}
            <SignActivityPanel />
          </>
        ) : null}
      </section>

      {policyModalOpen && policyModalEvent ? (
        <PolicyPromptModal
          event={policyModalEvent}
          onResolve={handleResolvePolicyPrompt}
          onDismiss={handleDismissPolicyPrompt}
        />
      ) : null}
      {activeModal === "signing-failed" && (
        <SigningFailedModal
          failure={activeSignFailure ?? undefined}
          messageHex={activeSignFailureMessageHex}
          onClose={handleDismissSigningFailed}
          onDismiss={handleDismissSigningFailed}
          onRetry={activeSignFailure ? handleRetrySigningFailed : undefined}
        />
      )}
      {activeModal === "clear-credentials" && (
        <ClearCredentialsModal
          groupName={activeProfile.groupName}
          shareIdx={runtimeStatus.metadata.member_idx}
          deviceName={activeProfile.deviceName}
          onCancel={() => setActiveModal("none")}
          onConfirm={handleClearCredentials}
        />
      )}
      {activeModal === "export-profile" && (
        <ExportProfileModal
          mode={exportMode}
          groupName={activeProfile.groupName}
          threshold={activeProfile.threshold}
          memberCount={activeProfile.memberCount}
          shareIdx={runtimeStatus.metadata.member_idx}
          relayCount={activeProfile.relays.length}
          peerCount={runtimeStatus.peers.length}
          onCancel={closeExportModal}
          onExport={handleExport}
        />
      )}
      {activeModal === "export-complete" && (
        <ExportCompleteModal
          mode={completionMode}
          packageText={completionPackage}
          onDone={closeExportModal}
        />
      )}

      {settingsOpen && (
        <SettingsSidebar
          profile={activeProfile}
          relays={activeProfile.relays}
          groupPublicKey={activeProfile.groupPublicKey}
          threshold={activeProfile.threshold}
          memberCount={activeProfile.memberCount}
          shareIdx={runtimeStatus.metadata.member_idx}
          onClose={() => setSettingsOpen(false)}
          onLock={handleLock}
          onClearCredentials={() => setActiveModal("clear-credentials")}
          onExport={() => {
            // Keep the Settings sidebar open while the Export Profile and
            // Export Complete modals are shown so clicking Done on the
            // Backup Ready modal returns the user to the same sidebar rows
            // (VAL-DSH-031 / VAL-CROSS-011). The modals stack above the
            // sidebar via `.export-modal-backdrop { z-index: 200 }`.
            handleOpenExport("profile");
          }}
          onExportShare={() => handleOpenExport("share")}
        />
      )}
    </AppShell>
  );
}
