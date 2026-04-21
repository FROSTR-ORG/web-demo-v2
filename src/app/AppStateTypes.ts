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
  StoredProfileSummary,
} from "../lib/bifrost/types";
import type { RuntimeRelayStatus } from "../lib/relay/runtimeRelayPump";
import type { RuntimeExportPackages } from "./runtimeExports";

export interface CreateDraft {
  groupName: string;
  threshold: number;
  count: number;
}

export interface CreateKeysetDraft extends CreateDraft {
  generatedNsec?: string;
  existingNsec?: string;
}

export interface ProfileDraft {
  deviceName: string;
  password: string;
  confirmPassword: string;
  relays: string[];
}

export interface PeerPermissionMap {
  sign: boolean;
  ecdh: boolean;
  ping: boolean;
  onboard: boolean;
}

export interface CreateProfileDraft extends ProfileDraft {
  distributionPassword: string;
  confirmDistributionPassword: string;
  peerPermissions?: Record<number, PeerPermissionMap>;
}

export type ImportProfileDraft = Pick<
  ProfileDraft,
  "password" | "confirmPassword"
> & {
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
  phase:
    | "sources_validated"
    | "rotated"
    | "profile_created"
    | "distribution_ready";
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

export interface ReplaceShareSession {
  phase: "idle" | "decoding" | "decoded" | "applying" | "updated" | "failed";
  packageString: string;
  password: string;
  profilePassword: string;
  decodedPayload?: BfOnboardPayload;
  localShareIdx?: number;
  newProfileId?: string;
  oldProfileId?: string;
  error?: {
    code: SetupFlowError["code"];
    message: string;
    details?: Record<string, unknown>;
  };
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

export type OnboardingPackageStatePatch = Partial<
  Pick<
    OnboardingPackageView,
    "packageCopied" | "passwordCopied" | "qrShown" | "copied"
  >
>;

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
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SetupFlowError";
  }
}

export interface AppStateValue {
  profiles: StoredProfileSummary[];
  activeProfile: StoredProfileSummary | null;
  runtimeStatus: RuntimeStatusSummary | null;
  runtimeRelays: RuntimeRelayStatus[];
  signerPaused: boolean;
  createSession: CreateSession | null;
  importSession: ImportSession | null;
  onboardSession: OnboardSession | null;
  rotateKeysetSession: RotateKeysetSession | null;
  replaceShareSession: ReplaceShareSession | null;
  recoverSession: RecoverSession | null;
  reloadProfiles: () => Promise<void>;
  createKeyset: (draft: CreateKeysetDraft) => Promise<void>;
  createProfile: (draft: CreateProfileDraft) => Promise<string>;
  updatePackageState: (idx: number, patch: OnboardingPackageStatePatch) => void;
  finishDistribution: () => Promise<string>;
  clearCreateSession: () => void;
  beginImport: (backupString: string) => void;
  decryptImportBackup: (
    backupString: string,
    password: string,
  ) => Promise<void>;
  saveImportedProfile: (draft: ImportProfileDraft) => Promise<string>;
  clearImportSession: () => void;
  decodeOnboardPackage: (
    packageString: string,
    password: string,
  ) => Promise<void>;
  startOnboardHandshake: () => Promise<void>;
  saveOnboardedProfile: (
    draft: Pick<ProfileDraft, "password" | "confirmPassword">,
  ) => Promise<string>;
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
  updateRotatePackageState: (
    idx: number,
    patch: OnboardingPackageStatePatch,
  ) => void;
  finishRotateDistribution: () => Promise<string>;
  clearRotateKeysetSession: () => void;
  decodeReplaceSharePackage: (
    packageString: string,
    password: string,
    profilePassword: string,
  ) => Promise<void>;
  applyReplaceShareUpdate: () => Promise<void>;
  clearReplaceShareSession: () => void;
  validateRecoverSources: (input: {
    profileId: string;
    profilePassword: string;
    sourcePackages: Array<{ packageText: string; password: string }>;
  }) => Promise<void>;
  recoverNsec: () => Promise<RecoveredNsecResult>;
  clearRecoverSession: () => void;
  expireRecoveredNsec: () => void;
  unlockProfile: (id: string, password: string) => Promise<void>;
  changeProfilePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  lockProfile: () => void;
  clearCredentials: () => Promise<void>;
  exportRuntimePackages: (password: string) => Promise<RuntimeExportPackages>;
  createProfileBackup: () => Promise<{
    backup: { ciphertext: string; nonce: string; version: number };
    event: {
      id: string;
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
      sig: string;
    };
  }>;
  setSignerPaused: (paused: boolean) => void;
  refreshRuntime: () => void;
  restartRuntimeConnections: () => Promise<void>;
}

export type { RuntimeExportPackages, RuntimeExportMetadata } from "./runtimeExports";
