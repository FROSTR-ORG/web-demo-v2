import { Download, FileText, Settings, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import type { OperationFailure } from "../../lib/bifrost/types";
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
import { TestEcdhPanel } from "./panels/TestEcdhPanel";
import { TestSignPanel } from "./panels/TestSignPanel";
import { SettingsSidebar } from "./sidebar/SettingsSidebar";
import { deriveDashboardState } from "./dashboardState";
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
  const [activeSignFailure, setActiveSignFailure] = useState<OperationFailure | null>(null);
  const consumedFailureIdsRef = useRef<Set<string>>(new Set());
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
    const messageHex = signDispatchLog[failure.request_id];
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

  const activeSignFailureMessageHex = useMemo(
    () =>
      activeSignFailure
        ? signDispatchLog[activeSignFailure.request_id]
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
                onRefresh={refreshRuntime}
                onOpenPolicyPrompt={(request) => {
                  setPolicyPromptRequest(request);
                  setActiveModal("policy-prompt");
                }}
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
              />
            )}
          </>
        )}

        {/* Dev-only TestSign + TestEcdh affordances. Gated on
         * `import.meta.env.DEV` so `vite build` dead-code-eliminates them
         * from the production bundle. Also hidden when Paper reference
         * panels are active so pixel-parity demo scenarios are unaffected. */}
        {import.meta.env.DEV && !paperPanels ? (
          <>
            <TestSignPanel signingBlocked={signingBlocked} />
            <TestEcdhPanel ecdhBlocked={ecdhBlocked} />
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
