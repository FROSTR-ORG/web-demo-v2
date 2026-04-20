import { Download, FileText, Settings, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
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
import { SettingsSidebar } from "./sidebar/SettingsSidebar";
import { ConnectingState } from "./states/ConnectingState";
import { PoliciesState } from "./states/PoliciesState";
import { RelaysOfflineState } from "./states/RelaysOfflineState";
import { RunningState } from "./states/RunningState";
import { SigningBlockedState } from "./states/SigningBlockedState";
import { StoppedState } from "./states/StoppedState";
import type { DashboardState, ModalState } from "./types";

export type { DashboardState, ModalState } from "./types";

export function DashboardScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile, runtimeStatus, lockProfile, clearCredentials, refreshRuntime } = useAppState();
  const demoUi = useDemoUi();
  const [mockState, setMockState] = useState<DashboardState>(demoUi.dashboard?.state ?? "running");
  const [showPolicies, setShowPolicies] = useState(Boolean(demoUi.dashboard?.showPolicies));
  const [activeModal, setActiveModal] = useState<ModalState>(demoUi.dashboard?.modal ?? "none");
  const [settingsOpen, setSettingsOpen] = useState(Boolean(demoUi.dashboard?.settingsOpen));
  const showMockControls = Boolean(demoUi.dashboard?.showMockControls);
  const paperPanels = Boolean(demoUi.dashboard?.paperPanels);

  if (!profileId) {
    return <Navigate to="/" replace />;
  }
  if (!activeProfile || activeProfile.id !== profileId || !runtimeStatus) {
    return <Navigate to="/" replace />;
  }

  const onlineCount = runtimeStatus.peers.filter((peer) => peer.online).length;
  const signReadyLabel = `${runtimeStatus.readiness.signing_peer_count}/${runtimeStatus.readiness.threshold} sign ready`;

  function handleLock() {
    lockProfile();
    navigate("/");
  }

  async function handleClearCredentials() {
    // Both providers' `clearCredentials` now truly empty `profiles` (and
    // clear the active profile + runtime). The MockAppStateProvider is
    // stateful, so its bridge-write effect then writes the empty snapshot
    // before the `navigate("/")` reaches the real AppStateProvider — no
    // Dashboard-side workaround required.
    await clearCredentials();
    navigate("/");
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
          <Button type="button" variant="header" onClick={() => setActiveModal("export-profile")}>
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
          <PoliciesState peers={runtimeStatus.peers} />
        ) : (
          <>
            {mockState === "running" && (
              <RunningState
                relays={activeProfile.relays}
                onlineCount={onlineCount}
                signReadyLabel={signReadyLabel}
                peers={runtimeStatus.peers}
                pendingOperations={runtimeStatus.pending_operations}
                paperPanels={paperPanels}
                sidebarOpen={settingsOpen}
                onStop={() => setMockState("stopped")}
                onRefresh={refreshRuntime}
                onOpenPolicyPrompt={() => setActiveModal("policy-prompt")}
              />
            )}

            {mockState === "connecting" && (
              <ConnectingState relays={activeProfile.relays} />
            )}

            {mockState === "stopped" && (
              <StoppedState onStart={() => setMockState("running")} />
            )}

            {mockState === "relays-offline" && (
              <RelaysOfflineState
                onStop={() => setMockState("stopped")}
                onRetry={() => setMockState("connecting")}
              />
            )}

            {mockState === "signing-blocked" && (
              <SigningBlockedState onStop={() => setMockState("stopped")} />
            )}
          </>
        )}
      </section>

      {activeModal === "policy-prompt" && (
        <PolicyPromptModal onClose={() => setActiveModal("none")} />
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
          onConfirm={handleClearCredentials}
        />
      )}
      {activeModal === "export-profile" && (
        <ExportProfileModal
          groupName={activeProfile.groupName}
          threshold={activeProfile.threshold}
          memberCount={activeProfile.memberCount}
          shareIdx={runtimeStatus.metadata.member_idx}
          relayCount={activeProfile.relays.length}
          peerCount={runtimeStatus.peers.length}
          onCancel={() => setActiveModal("none")}
          onExport={() => setActiveModal("export-complete")}
        />
      )}
      {activeModal === "export-complete" && (
        <ExportCompleteModal onDone={() => setActiveModal("none")} />
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
            setActiveModal("export-profile");
          }}
        />
      )}
    </AppShell>
  );
}
