import { useLocation } from "react-router-dom";

export type DashboardDemoState = "running" | "connecting" | "stopped" | "relays-offline" | "signing-blocked";
export type DashboardDemoModal = "policy-prompt" | "signing-failed" | "clear-credentials" | "export-profile" | "export-complete";
export type DashboardDemoExportMode = "profile" | "share";
export type DashboardDemoView = "dashboard" | "policies" | "recover";
export type DashboardDemoRecoverStep = "collect" | "success";

export interface DemoUiState {
  welcome?: {
    unlockingProfileId?: string;
    unlockError?: string;
    passwordPreset?: string;
    variant?: "rotate-keyset-first" | "replace-share-first";
  };
  create?: {
    validationError?: boolean;
    keysetNamePreset?: string;
    nsecPreset?: string;
  };
  import?: {
    backupPreset?: string;
    passwordPreset?: string;
    profilePasswordPreset?: string;
    errorVariant?: "wrong-password" | "corrupted";
  };
  onboard?: {
    packagePreset?: string;
    passwordPreset?: string;
    failedVariant?: "timeout" | "rejected";
  };
  shared?: {
    profileNamePreset?: string;
    passwordPreset?: string;
    relayPreset?: string;
    lockedPackageIndexes?: number[];
    completionPreset?: boolean;
  };
  recover?: {
    variant?: "incompatible-shares" | "success";
    revealed?: boolean;
    copied?: boolean;
  };
  rotateKeyset?: {
    passwordPreset?: string;
  };
  replaceShare?: {
    packagePreset?: string;
    passwordPreset?: string;
  };
  dashboard?: {
    state?: DashboardDemoState;
    view?: DashboardDemoView;
    showPolicies?: boolean;
    recoverStep?: DashboardDemoRecoverStep;
    recoverVariant?: "incompatible-shares";
    recoverCopied?: boolean;
    modal?: DashboardDemoModal;
    settingsOpen?: boolean;
    exportMode?: DashboardDemoExportMode;
    hideMockControls?: boolean;
    showMockControls?: boolean;
    paperPanels?: boolean;
  };
  progress?: {
    frozen?: boolean;
    activeIndex?: number;
    completedCount?: number;
    labelOverride?: string;
  };
}

export function useDemoUi(): DemoUiState {
  const location = useLocation();
  return ((location.state as { demoUi?: DemoUiState } | null)?.demoUi ?? {}) as DemoUiState;
}
