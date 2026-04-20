import type {
  BfOnboardPayload,
  BfProfilePayload,
  KeysetBundle,
  OnboardingPackageView,
  OnboardingResponse,
  RecoveredNsecResult,
  RotateKeysetBundleResult,
  RuntimeSnapshotInput,
  RuntimeStatusSummary,
  SharePackageWire,
  StoredProfileSummary
} from "../lib/bifrost/types";

export interface CreateDraft {
  groupName: string;
  threshold: number;
  count: number;
}

export interface CreateKeysetDraft extends CreateDraft {
  generatedNsec?: string;
}

export interface ProfileDraft {
  deviceName: string;
  password: string;
  confirmPassword: string;
  relays: string[];
}

export interface CreateProfileDraft extends ProfileDraft {
  distributionPassword: string;
  confirmDistributionPassword: string;
}

export type ImportProfileDraft = Pick<ProfileDraft, "password" | "confirmPassword"> & {
  replaceExisting?: boolean;
};

export interface CreateSession {
  draft: CreateDraft;
  keyset?: KeysetBundle;
  localShare?: SharePackageWire;
  onboardingPackages: OnboardingPackageView[];
  createdProfileId?: string;
}

export interface ImportSession {
  backupString: string;
  payload?: BfProfilePayload;
  localShareIdx?: number;
  conflictProfile?: StoredProfileSummary;
}

export interface OnboardSession {
  phase: "decoded" | "handshaking" | "ready_to_save" | "failed";
  packageString: string;
  payload: BfOnboardPayload;
  error?: {
    code: SetupFlowError["code"];
    message: string;
    details?: Record<string, unknown>;
  };
  requestBundle?: {
    request_id: string;
    local_pubkey32: string;
    bootstrap_state_hex: string;
    event_json: string;
  };
  response?: OnboardingResponse;
  runtimeSnapshot?: RuntimeSnapshotInput;
  localShareIdx?: number;
}

export interface RotateKeysetSession {
  phase: "sources_validated" | "rotated" | "profile_created" | "distribution_ready";
  sourceProfile: StoredProfileSummary;
  sourcePayload?: BfProfilePayload;
  sourceShares: SharePackageWire[];
  threshold: number;
  count: number;
  rotated?: RotateKeysetBundleResult;
  distributionPassword?: string;
  localShare?: SharePackageWire;
  onboardingPackages: OnboardingPackageView[];
  createdProfileId?: string;
}

export interface RecoverSourceSummary {
  idx: number;
  memberPubkey: string;
  relays: string[];
}

export interface RecoverSession {
  sourceProfile: StoredProfileSummary;
  sourcePayload?: BfProfilePayload;
  localShare?: SharePackageWire;
  externalShares: SharePackageWire[];
  sources: RecoverSourceSummary[];
  recovered?: RecoveredNsecResult;
  expiresAt?: number;
}

export class SetupFlowError extends Error {
  constructor(
    public readonly code:
      | "wrong_password"
      | "invalid_package"
      | "duplicate_share"
      | "group_mismatch"
      | "insufficient_sources"
      | "generation_failed"
      | "recovery_failed"
      | "profile_conflict"
      | "missing_session"
      | "relay_unreachable"
      | "onboard_timeout"
      | "onboard_rejected"
      | "invalid_onboard_response",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SetupFlowError";
  }
}

export interface AppStateValue {
  profiles: StoredProfileSummary[];
  activeProfile: StoredProfileSummary | null;
  runtimeStatus: RuntimeStatusSummary | null;
  signerPaused: boolean;
  createSession: CreateSession | null;
  importSession: ImportSession | null;
  onboardSession: OnboardSession | null;
  rotateKeysetSession: RotateKeysetSession | null;
  recoverSession: RecoverSession | null;
  reloadProfiles: () => Promise<void>;
  createKeyset: (draft: CreateKeysetDraft) => Promise<void>;
  createProfile: (draft: CreateProfileDraft) => Promise<string>;
  updatePackageState: (idx: number, patch: Partial<Pick<OnboardingPackageView, "packageCopied" | "passwordCopied" | "qrShown" | "copied">>) => void;
  finishDistribution: () => Promise<string>;
  clearCreateSession: () => void;
  beginImport: (backupString: string) => void;
  decryptImportBackup: (backupString: string, password: string) => Promise<void>;
  saveImportedProfile: (draft: ImportProfileDraft) => Promise<string>;
  clearImportSession: () => void;
  decodeOnboardPackage: (packageString: string, password: string) => Promise<void>;
  startOnboardHandshake: () => Promise<void>;
  saveOnboardedProfile: (draft: Pick<ProfileDraft, "password" | "confirmPassword">) => Promise<string>;
  clearOnboardSession: () => void;
  validateRotateKeysetSources: (input: {
    profileId: string;
    profilePassword: string;
    sourcePackages: Array<{ packageText: string; password: string }>;
    threshold: number;
    count: number;
  }) => Promise<void>;
  generateRotatedKeyset: (distributionPassword: string) => Promise<void>;
  createRotatedProfile: (draft: ProfileDraft) => Promise<string>;
  updateRotatePackageState: (idx: number, patch: Partial<Pick<OnboardingPackageView, "packageCopied" | "passwordCopied" | "qrShown" | "copied">>) => void;
  finishRotateDistribution: () => Promise<string>;
  clearRotateKeysetSession: () => void;
  validateRecoverSources: (input: {
    profileId: string;
    profilePassword: string;
    sourcePackages: Array<{ packageText: string; password: string }>;
  }) => Promise<void>;
  recoverNsec: () => Promise<RecoveredNsecResult>;
  clearRecoverSession: () => void;
  expireRecoveredNsec: () => void;
  unlockProfile: (id: string, password: string) => Promise<void>;
  lockProfile: () => void;
  clearCredentials: () => Promise<void>;
  setSignerPaused: (paused: boolean) => void;
  refreshRuntime: () => void;
}
