import { Download, FileText, Settings, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import type { EnrichedOperationFailure } from "../../app/AppStateTypes";
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

export type { DashboardState, ModalState } from "./types";

function mockPackageForMode(mode: ExportMode): string {
  return mode === "profile" ? MOCK_BACKUP_STRING : MOCK_SHARE_PACKAGE_STRING;
}

function relayHealthRowsFromRuntime(
  runtimeRelays: RuntimeRelayStatus[],
  configuredRelays: string[],
) {
  const rows =
    runtimeRelays.length > 0
      ? runtimeRelays
      : configuredRelays.map<RuntimeRelayStatus>((url) => ({
          url,
          state: "offline",
        }));
  return rows.map((relay) => ({
    relay: relay.url,
    status:
      relay.state === "online"
        ? ("Online" as const)
        : relay.state === "connecting"
          ? ("Degraded" as const)
          : ("Offline" as const),
    latency: "--",
    events: "--",
    lastSeen:
      relay.state === "online"
        ? "now"
        : relay.lastError
          ? relay.lastError
          : "--",
  }));
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
  // Ping / refresh_all_peers require only that the runtime is alive on the
  // wire — they don't need quorum or ECDH peers. Gate on the paused state
  // plus the broader not-running dashboard states so the dev-only Ping /
  // Refresh All buttons never dispatch into a dead runtime.
  const pingBlocked =
    signerPaused ||
    !runtimeStatus.readiness.runtime_ready ||
    dashboardState === "stopped" ||
    dashboardState === "relays-offline" ||
    dashboardState === "connecting";
  const relayRows = relayHealthRowsFromRuntime(runtimeRelays, activeProfile.relays);
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
        {showMockControls ? (
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
          />
        ) : (
          <>
            {dashboardState === "running" && (
              <RunningState
                relays={activeProfile.relays}
                onlineCount={onlineCount}
                signReadyLabel={signReadyLabel}
                peers={runtimeStatus.peers}
                pendingOperations={runtimeStatus.pending_operations}
                paperPanels={paperPanels}
                sidebarOpen={settingsOpen}
                onStop={handleStopSigner}
                onRefresh={handleRefreshPeers}
                onOpenPolicyPrompt={(request) => {
                  setPolicyPromptRequest(request);
                  setActiveModal("policy-prompt");
                }}
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
                onReviewApprovals={() => {
                  setPolicyPromptRequest(DEFAULT_POLICY_PROMPT_REQUEST);
                  setActiveModal("policy-prompt");
                }}
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
            <TestPingPanel pingBlocked={pingBlocked} />
            <TestRefreshAllPanel refreshBlocked={pingBlocked} />
            {/* Recent Sign Activity — surfaces the runtime lifecycle of
             * every dispatched sign / ECDH / ping so validators and users
             * observe the dispatched -> pending -> completed|failed
             * transition even when the runtime completes faster than the
             * poll tick (VAL-OPS-002 / VAL-OPS-004 / VAL-OPS-013). */}
            <SignActivityPanel />
          </>
        ) : null}
      </section>

      {activeModal === "policy-prompt" && (
        <PolicyPromptModal request={policyPromptRequest} onClose={() => setActiveModal("none")} />
      )}
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
