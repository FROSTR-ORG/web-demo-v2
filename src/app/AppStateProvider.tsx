import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { memberForShare, memberPubkeyXOnly } from "../lib/bifrost/format";
import {
  BifrostPackageError,
  buildOnboardingRuntimeSnapshot,
  createKeysetBundle,
  createKeysetBundleFromNsec,
  createOnboardingRequestBundle,
  defaultManualPeerPolicyOverrides,
  defaultBifrostEventKind,
  decodeBfonboardPackage,
  decodeOnboardingResponseEvent,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
  profilePayloadForShare,
  recoverNsecFromShares,
  resolveShareIndex,
  rotateKeysetBundle,
} from "../lib/bifrost/packageService";
import { RuntimeClient } from "../lib/bifrost/runtimeClient";
import type {
  BfProfilePayload,
  RuntimeSnapshotInput,
  RuntimeStatusSummary,
  StoredProfileSummary,
} from "../lib/bifrost/types";
import {
  OnboardingRelayError,
  runOnboardingRelayHandshake,
} from "../lib/relay/browserRelayClient";
import { LocalRuntimeSimulator } from "../lib/relay/localSimulator";
import {
  getProfile,
  listProfiles,
  removeProfile,
  saveProfile,
  touchProfile,
} from "../lib/storage/profileStore";
import { BRIDGE_EVENT, consumeBridgeSnapshot } from "./appStateBridge";
import { AppStateContext } from "./AppStateContext";
import {
  allPackagesDistributed,
  buildRemoteOnboardingPackages,
  normalizePackageStatePatch,
} from "./distributionPackages";
import {
  buildStoredProfileRecord,
  createRuntimeFromProfilePayload,
  createRuntimeFromSnapshot,
} from "./profileRuntime";
import {
  decodeExternalBfshareSources,
  loadSavedProfileSource,
} from "./sourceShareCollection";
import {
  isAbortError,
  makeAbortError,
  setupErrorFromOnboardingRelay,
  setupErrorFromPackage,
} from "./setupFlowErrors";
import { SetupFlowError } from "./AppStateTypes";
import type {
  AppStateValue,
  CreateDraft,
  CreateKeysetDraft,
  CreateProfileDraft,
  CreateSession,
  ImportProfileDraft,
  ImportSession,
  OnboardingPackageStatePatch,
  OnboardSession,
  ProfileDraft,
  RecoverSession,
  RecoverSourceSummary,
  RotateKeysetSession,
} from "./AppStateTypes";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<StoredProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] =
    useState<StoredProfileSummary | null>(null);
  const [runtimeStatus, setRuntimeStatus] =
    useState<RuntimeStatusSummary | null>(null);
  const [signerPaused, setSignerPausedState] = useState(false);
  const [createSession, setCreateSession] = useState<CreateSession | null>(
    null,
  );
  const [importSession, setImportSession] = useState<ImportSession | null>(
    null,
  );
  const [onboardSession, setOnboardSession] = useState<OnboardSession | null>(
    null,
  );
  const [rotateKeysetSession, setRotateKeysetSession] =
    useState<RotateKeysetSession | null>(null);
  const [recoverSession, setRecoverSession] = useState<RecoverSession | null>(
    null,
  );
  const [bridgeHydrated, setBridgeHydrated] = useState(false);
  const runtimeRef = useRef<RuntimeClient | null>(null);
  const simulatorRef = useRef<LocalRuntimeSimulator | null>(null);
  const onboardHandshakeRef = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const onboardHandshakeSeq = useRef(0);

  const abortOnboardHandshake = useCallback(() => {
    onboardHandshakeRef.current?.controller.abort();
    onboardHandshakeRef.current = null;
  }, []);

  const reloadProfiles = useCallback(async () => {
    setProfiles(await listProfiles());
  }, []);

  // On mount — and whenever a demo MockAppStateProvider announces a new snapshot
  // via BRIDGE_EVENT — consume the sessionStorage bridge if present. When no
  // bridge exists on initial mount, fall back to the original IndexedDB reload.
  useEffect(() => {
    function applyBridge(): boolean {
      const snapshot = consumeBridgeSnapshot();
      if (!snapshot) {
        return false;
      }
      setProfiles(Array.isArray(snapshot.profiles) ? snapshot.profiles : []);
      setActiveProfile(snapshot.activeProfile ?? null);
      setRuntimeStatus(snapshot.runtimeStatus ?? null);
      setSignerPausedState(Boolean(snapshot.signerPaused));
      setCreateSession(null);
      setImportSession(null);
      setOnboardSession(null);
      setRotateKeysetSession(null);
      setRecoverSession(null);
      setBridgeHydrated(true);
      return true;
    }

    const hydratedOnMount = applyBridge();
    if (!hydratedOnMount) {
      void reloadProfiles();
    }

    function onBridgeUpdate() {
      applyBridge();
    }
    window.addEventListener(BRIDGE_EVENT, onBridgeUpdate);
    return () => window.removeEventListener(BRIDGE_EVENT, onBridgeUpdate);
  }, [reloadProfiles]);

  const setRuntime = useCallback(
    (runtime: RuntimeClient, simulator?: LocalRuntimeSimulator) => {
      if (simulatorRef.current && simulatorRef.current !== simulator) {
        simulatorRef.current.stop();
      }
      runtimeRef.current = runtime;
      simulatorRef.current = simulator ?? null;
      setRuntimeStatus(runtime.runtimeStatus());
      // A live RuntimeClient just came online in this SPA session — re-enable the
      // runtime-polling interval by clearing the bridge-hydration flag. Without
      // this reset, `bridgeHydrated` would stay `true` forever after any demo
      // hand-off, permanently disabling the refresh loop even though a real
      // runtime is now backing `runtimeRef`.
      setBridgeHydrated(false);
    },
    [],
  );

  const startRuntimeFromPayload = useCallback(
    async (payload: BfProfilePayload, localShareIdx: number) => {
      setRuntime(await createRuntimeFromProfilePayload(payload, localShareIdx));
    },
    [setRuntime],
  );

  const startRuntimeFromSnapshot = useCallback(
    async (snapshot: RuntimeSnapshotInput) => {
      setRuntime(await createRuntimeFromSnapshot(snapshot));
    },
    [setRuntime],
  );

  const savePayloadAsProfile = useCallback(
    async (
      payload: BfProfilePayload,
      password: string,
      options: {
        replaceProfileId?: string;
        createdAt?: number;
        label?: string;
      } = {},
    ) => {
      if (password.length < 8) {
        throw new Error("Profile password must be at least 8 characters.");
      }
      const { record, normalizedPayload, localShareIdx } =
        await buildStoredProfileRecord(payload, password, {
          createdAt: options.createdAt,
          label: options.label,
        });

      await saveProfile(record);
      if (
        options.replaceProfileId &&
        options.replaceProfileId !== record.summary.id
      ) {
        await removeProfile(options.replaceProfileId);
      }
      await startRuntimeFromPayload(normalizedPayload, localShareIdx);
      setActiveProfile(record.summary);
      setSignerPausedState(false);
      await reloadProfiles();
      return record.summary;
    },
    [reloadProfiles, startRuntimeFromPayload],
  );

  const createKeyset = useCallback(async (draft: CreateKeysetDraft) => {
    const groupName = draft.groupName.trim();
    if (!groupName) {
      throw new Error("Keyset name is required.");
    }
    if (draft.threshold < 2) {
      throw new Error("Threshold must be at least 2.");
    }
    if (draft.count < 2) {
      throw new Error("Total shares must be at least 2.");
    }
    if (draft.threshold > draft.count) {
      throw new Error("Threshold cannot exceed total shares.");
    }

    const sessionDraft: CreateDraft = {
      groupName,
      threshold: draft.threshold,
      count: draft.count,
    };
    const keyset = draft.generatedNsec
      ? await createKeysetBundleFromNsec({
          ...sessionDraft,
          nsec: draft.generatedNsec,
        })
      : await createKeysetBundle(sessionDraft);
    const localShare = keyset.shares[0];
    setCreateSession({
      draft: sessionDraft,
      keyset,
      localShare,
      onboardingPackages: [],
    });
  }, []);

  const createProfile = useCallback(
    async (draft: CreateProfileDraft) => {
      if (!createSession?.keyset || !createSession.localShare) {
        throw new Error("Create a keyset before creating a profile.");
      }
      const deviceName = draft.deviceName.trim();
      const relays = draft.relays.map((relay) => relay.trim()).filter(Boolean);
      const distributionPassword = draft.distributionPassword.trim();
      if (!deviceName) {
        throw new Error("Profile name is required.");
      }
      if (draft.password.length < 8) {
        throw new Error("Profile password must be at least 8 characters.");
      }
      if (draft.password !== draft.confirmPassword) {
        throw new Error("Profile passwords do not match.");
      }
      if (distributionPassword.length < 8) {
        throw new Error(
          "Remote package password must be at least 8 characters.",
        );
      }
      if (distributionPassword !== draft.confirmDistributionPassword) {
        throw new Error("Remote package passwords do not match.");
      }
      if (relays.length === 0) {
        throw new Error("At least one relay is required.");
      }

      const { group } = createSession.keyset;
      const localShare = createSession.localShare;
      const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);
      const payload = profilePayloadForShare({
        profileId,
        deviceName,
        share: localShare,
        group,
        relays,
        manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
          group,
          localShare.idx,
        ),
      });
      const createdAt = Date.now();
      const { record } = await buildStoredProfileRecord(
        payload,
        draft.password,
        {
          createdAt,
          lastUsedAt: createdAt,
          label: createSession.draft.groupName,
        },
      );
      await saveProfile(record);

      const remoteShares = createSession.keyset.shares.filter(
        (share) => share.idx !== localShare.idx,
      );
      const onboardingPackages = await buildRemoteOnboardingPackages({
        remoteShares,
        localShare,
        group,
        relays,
        password: distributionPassword,
      });

      const runtime = await createRuntimeFromProfilePayload(
        payload,
        localShare.idx,
      );
      const simulator = new LocalRuntimeSimulator(runtime);
      await simulator.attachVirtualPeers({ group, localShare, remoteShares });
      simulator.start();
      simulator.refreshAll();
      setRuntime(runtime, simulator);
      setRuntimeStatus(simulator.pump(4));
      setActiveProfile(record.summary);
      setSignerPausedState(false);
      setCreateSession({
        ...createSession,
        createdProfileId: profileId,
        onboardingPackages,
      });
      await reloadProfiles();

      return profileId;
    },
    [createSession, reloadProfiles, setRuntime],
  );

  const updatePackageState = useCallback(
    (idx: number, patch: OnboardingPackageStatePatch) => {
      setCreateSession((session) => {
        if (!session) {
          return session;
        }
        const normalizedPatch = normalizePackageStatePatch(patch);
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) =>
            entry.idx === idx ? { ...entry, ...normalizedPatch } : entry,
          ),
        };
      });
    },
    [],
  );

  const finishDistribution = useCallback(async () => {
    if (!createSession?.createdProfileId) {
      throw new Error("No created profile is available.");
    }
    return createSession.createdProfileId;
  }, [createSession]);

  const clearCreateSession = useCallback(() => {
    setCreateSession(null);
  }, []);

  const beginImport = useCallback((backupString: string) => {
    setImportSession({ backupString: backupString.trim() });
  }, []);

  const decryptImportBackup = useCallback(
    async (backupString: string, password: string) => {
      const trimmed = backupString.trim();
      if (!trimmed) {
        throw new SetupFlowError(
          "invalid_package",
          "Profile backup is required.",
        );
      }
      if (!trimmed.startsWith("bfprofile1")) {
        throw new SetupFlowError(
          "invalid_package",
          "Profile backup must start with bfprofile1.",
        );
      }
      try {
        const payload = await decodeProfilePackage(trimmed, password);
        const localShareIdx = await resolveShareIndex(
          payload.group_package,
          payload.device.share_secret,
        );
        const profileId =
          payload.profile_id ||
          (await deriveProfileIdFromShareSecret(payload.device.share_secret));
        const conflictRecord = await getProfile(profileId);
        setImportSession({
          backupString: trimmed,
          payload: { ...payload, profile_id: profileId },
          localShareIdx,
          conflictProfile: conflictRecord?.summary,
        });
      } catch (error) {
        if (error instanceof SetupFlowError) {
          throw error;
        }
        throw setupErrorFromPackage(error, {
          code: "wrong_password",
          message: "The backup password could not decrypt this profile.",
        });
      }
    },
    [],
  );

  const saveImportedProfile = useCallback(
    async (draft: ImportProfileDraft) => {
      if (!importSession?.payload) {
        throw new SetupFlowError(
          "missing_session",
          "Decrypt a profile backup before saving it.",
        );
      }
      if (draft.password !== draft.confirmPassword) {
        throw new Error("Profile passwords do not match.");
      }
      if (importSession.conflictProfile && !draft.replaceExisting) {
        throw new SetupFlowError(
          "profile_conflict",
          "A profile with this id already exists.",
          {
            profileId: importSession.conflictProfile.id,
            label: importSession.conflictProfile.label,
          },
        );
      }
      const summary = await savePayloadAsProfile(
        importSession.payload,
        draft.password,
      );
      return summary.id;
    },
    [importSession, savePayloadAsProfile],
  );

  const clearImportSession = useCallback(() => {
    setImportSession(null);
  }, []);

  const decodeOnboardPackage = useCallback(
    async (packageString: string, password: string) => {
      abortOnboardHandshake();
      const trimmed = packageString.trim();
      if (!trimmed) {
        throw new SetupFlowError(
          "invalid_package",
          "Onboarding package is required.",
        );
      }
      if (!trimmed.startsWith("bfonboard1")) {
        throw new SetupFlowError(
          "invalid_package",
          "Onboarding package must start with bfonboard1.",
        );
      }
      try {
        const payload = await decodeBfonboardPackage(trimmed, password);
        setOnboardSession({
          phase: "decoded",
          packageString: trimmed,
          payload,
        });
      } catch (error) {
        throw setupErrorFromPackage(error, {
          code: "wrong_password",
          message:
            "The package password could not decrypt this onboarding package.",
        });
      }
    },
    [abortOnboardHandshake],
  );

  const startOnboardHandshake = useCallback(async () => {
    if (!onboardSession?.payload) {
      throw new SetupFlowError(
        "missing_session",
        "Decode an onboarding package before starting the handshake.",
      );
    }
    const baseSession = onboardSession;
    abortOnboardHandshake();
    const attempt = {
      id: onboardHandshakeSeq.current + 1,
      controller: new AbortController(),
    };
    onboardHandshakeSeq.current = attempt.id;
    onboardHandshakeRef.current = attempt;
    const eventKind = await defaultBifrostEventKind();
    try {
      if (
        attempt.controller.signal.aborted ||
        onboardHandshakeRef.current?.id !== attempt.id
      ) {
        throw makeAbortError();
      }
      const requestBundle = await createOnboardingRequestBundle({
        shareSecret: baseSession.payload.share_secret,
        peerPubkey32Hex: baseSession.payload.peer_pk,
        eventKind,
      });
      setOnboardSession({
        ...baseSession,
        phase: "handshaking",
        requestBundle,
      });

      const response = await runOnboardingRelayHandshake({
        relays: baseSession.payload.relays,
        eventKind,
        sourcePeerPubkey: baseSession.payload.peer_pk,
        localPubkey: requestBundle.local_pubkey32,
        requestEventJson: requestBundle.event_json,
        signal: attempt.controller.signal,
        decodeEvent: async (event) => {
          try {
            return await decodeOnboardingResponseEvent({
              event,
              shareSecret: baseSession.payload.share_secret,
              expectedPeerPubkey32Hex: baseSession.payload.peer_pk,
              expectedLocalPubkey32Hex: requestBundle.local_pubkey32,
              requestId: requestBundle.request_id,
            });
          } catch (error) {
            if (
              error instanceof BifrostPackageError &&
              error.code === "verification_failed"
            ) {
              throw new OnboardingRelayError("onboard_rejected", error.message);
            }
            throw new OnboardingRelayError(
              "invalid_onboard_response",
              error instanceof Error
                ? error.message
                : "Invalid onboarding response.",
            );
          }
        },
      });
      if (
        attempt.controller.signal.aborted ||
        onboardHandshakeRef.current?.id !== attempt.id
      ) {
        throw makeAbortError();
      }
      const runtimeSnapshot = await buildOnboardingRuntimeSnapshot({
        group: response.group,
        shareSecret: baseSession.payload.share_secret,
        peerPubkey32Hex: baseSession.payload.peer_pk,
        responseNonces: response.nonces,
        bootstrapStateHex: requestBundle.bootstrap_state_hex,
      });
      setOnboardSession({
        ...baseSession,
        phase: "ready_to_save",
        requestBundle,
        response,
        runtimeSnapshot,
        localShareIdx: runtimeSnapshot.bootstrap.share.idx,
      });
      if (onboardHandshakeRef.current?.id === attempt.id) {
        onboardHandshakeRef.current = null;
      }
    } catch (error) {
      if (
        isAbortError(error) ||
        onboardHandshakeRef.current?.id !== attempt.id
      ) {
        throw error;
      }
      if (onboardHandshakeRef.current?.id === attempt.id) {
        onboardHandshakeRef.current = null;
      }
      const setupError = setupErrorFromOnboardingRelay(error);
      setOnboardSession({
        ...baseSession,
        phase: "failed",
        error: {
          code: setupError.code,
          message: setupError.message,
          details: setupError.details,
        },
      });
      throw setupError;
    }
  }, [abortOnboardHandshake, onboardSession]);

  const saveOnboardedProfile = useCallback(
    async (draft: Pick<ProfileDraft, "password" | "confirmPassword">) => {
      if (
        onboardSession?.phase !== "ready_to_save" ||
        !onboardSession.response ||
        !onboardSession.runtimeSnapshot
      ) {
        throw new SetupFlowError(
          "missing_session",
          "Complete onboarding before saving this profile.",
        );
      }
      if (draft.password.length < 8) {
        throw new Error("Profile password must be at least 8 characters.");
      }
      if (draft.password !== draft.confirmPassword) {
        throw new Error("Profile passwords do not match.");
      }

      const share = onboardSession.runtimeSnapshot.bootstrap.share;
      const group = onboardSession.response.group;
      const profileId = await deriveProfileIdFromShareSecret(share.seckey);
      const payload = profilePayloadForShare({
        profileId,
        deviceName: "Igloo Web",
        share,
        group,
        relays: onboardSession.payload.relays,
        manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
          group,
          share.idx,
        ),
      });
      const createdAt = Date.now();
      const { record } = await buildStoredProfileRecord(
        payload,
        draft.password,
        {
          createdAt,
          lastUsedAt: createdAt,
          label: group.group_name,
        },
      );
      await saveProfile(record);
      await startRuntimeFromSnapshot(onboardSession.runtimeSnapshot);
      setActiveProfile(record.summary);
      setSignerPausedState(false);
      setOnboardSession(null);
      await reloadProfiles();
      return profileId;
    },
    [onboardSession, reloadProfiles, startRuntimeFromSnapshot],
  );

  const clearOnboardSession = useCallback(() => {
    abortOnboardHandshake();
    setOnboardSession(null);
  }, [abortOnboardHandshake]);

  const validateRotateKeysetSources = useCallback(
    async (input: {
      profileId: string;
      profilePassword: string;
      sourcePackages: Array<{ packageText: string; password: string }>;
      threshold: number;
      count: number;
    }) => {
      if (
        input.threshold < 2 ||
        input.count < 2 ||
        input.threshold > input.count
      ) {
        throw new SetupFlowError(
          "invalid_package",
          "New keyset configuration is invalid.",
        );
      }
      const { record, sourcePayload, localIdx, localShare } =
        await loadSavedProfileSource({
          profileId: input.profileId,
          profilePassword: input.profilePassword,
        });
      const seen = new Set<number>([localIdx]);
      const external = await decodeExternalBfshareSources({
        group: sourcePayload.group_package,
        sourcePackages: input.sourcePackages,
        seenShareIndexes: seen,
      });
      const shares = [localShare, ...external.shares];

      if (shares.length < sourcePayload.group_package.threshold) {
        throw new SetupFlowError(
          "insufficient_sources",
          `Collect ${sourcePayload.group_package.threshold} source shares before continuing.`,
        );
      }

      setRotateKeysetSession({
        phase: "sources_validated",
        sourceProfile: record.summary,
        sourcePayload,
        sourceShares: shares,
        threshold: input.threshold,
        count: input.count,
        onboardingPackages: [],
      });
    },
    [],
  );

  const generateRotatedKeyset = useCallback(
    async (distributionPassword: string) => {
      if (
        !rotateKeysetSession?.sourcePayload ||
        rotateKeysetSession.sourceShares.length === 0
      ) {
        throw new SetupFlowError(
          "missing_session",
          "Validate source shares before rotating.",
        );
      }
      if (distributionPassword.length < 8) {
        throw new Error("Distribution password must be at least 8 characters.");
      }
      try {
        const rotated = await rotateKeysetBundle({
          group: rotateKeysetSession.sourcePayload.group_package,
          shares: rotateKeysetSession.sourceShares,
          threshold: rotateKeysetSession.threshold,
          count: rotateKeysetSession.count,
        });
        if (
          rotated.next.group.group_pk !==
          rotateKeysetSession.sourcePayload.group_package.group_pk
        ) {
          throw new SetupFlowError(
            "generation_failed",
            "Rotation changed the group public key.",
            { failedPhase: "Verify same group config + group public key" },
          );
        }
        setRotateKeysetSession((session) =>
          session
            ? {
                ...session,
                phase: "rotated",
                rotated,
                distributionPassword,
              }
            : session,
        );
      } catch (error) {
        throw new SetupFlowError(
          "generation_failed",
          error instanceof Error
            ? error.message
            : "Unable to generate rotated shares.",
          error instanceof SetupFlowError
            ? error.details
            : { failedPhase: "Generate Fresh Shares" },
        );
      }
    },
    [rotateKeysetSession],
  );

  const createRotatedProfile = useCallback(
    async (draft: ProfileDraft) => {
      if (
        !rotateKeysetSession?.rotated ||
        !rotateKeysetSession.sourcePayload ||
        !rotateKeysetSession.distributionPassword
      ) {
        throw new SetupFlowError(
          "missing_session",
          "Generate rotated shares before creating a profile.",
        );
      }
      const deviceName = draft.deviceName.trim();
      const relays = draft.relays.map((relay) => relay.trim()).filter(Boolean);
      if (!deviceName) {
        throw new Error("Profile name is required.");
      }
      if (draft.password.length < 8) {
        throw new Error("Profile password must be at least 8 characters.");
      }
      if (draft.password !== draft.confirmPassword) {
        throw new Error("Profile passwords do not match.");
      }
      if (relays.length === 0) {
        throw new Error("At least one relay is required.");
      }

      const previousLocalIdx = rotateKeysetSession.sourceShares[0]?.idx;
      const nextBundle = rotateKeysetSession.rotated.next;
      const localShare =
        nextBundle.shares.find((share) => share.idx === previousLocalIdx) ??
        nextBundle.shares[0];
      if (!localShare) {
        throw new SetupFlowError(
          "generation_failed",
          "Rotation did not produce a local share.",
        );
      }
      const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);
      const payload = profilePayloadForShare({
        profileId,
        deviceName,
        share: localShare,
        group: nextBundle.group,
        relays,
        manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
          nextBundle.group,
          localShare.idx,
        ),
      });
      const summary = await savePayloadAsProfile(payload, draft.password, {
        replaceProfileId: rotateKeysetSession.sourceProfile.id,
        createdAt: rotateKeysetSession.sourceProfile.createdAt,
        label: rotateKeysetSession.sourceProfile.label,
      });

      const remoteShares = nextBundle.shares.filter(
        (share) => share.idx !== localShare.idx,
      );
      const onboardingPackages = await buildRemoteOnboardingPackages({
        remoteShares,
        localShare,
        group: nextBundle.group,
        relays,
        password: rotateKeysetSession.distributionPassword,
      });

      setRotateKeysetSession((session) =>
        session
          ? {
              ...session,
              phase: "profile_created",
              localShare,
              onboardingPackages,
              createdProfileId: summary.id,
            }
          : session,
      );
      return summary.id;
    },
    [rotateKeysetSession, savePayloadAsProfile],
  );

  const updateRotatePackageState = useCallback(
    (idx: number, patch: OnboardingPackageStatePatch) => {
      setRotateKeysetSession((session) => {
        if (!session) {
          return session;
        }
        const normalizedPatch = normalizePackageStatePatch(patch);
        const onboardingPackages = session.onboardingPackages.map((entry) =>
          entry.idx === idx ? { ...entry, ...normalizedPatch } : entry,
        );
        const distributed = allPackagesDistributed(onboardingPackages);
        return {
          ...session,
          phase:
            distributed && session.createdProfileId
              ? "distribution_ready"
              : session.createdProfileId
                ? "profile_created"
                : session.phase,
          onboardingPackages,
        };
      });
    },
    [],
  );

  const finishRotateDistribution = useCallback(async () => {
    if (
      !rotateKeysetSession?.createdProfileId ||
      rotateKeysetSession.phase !== "distribution_ready"
    ) {
      throw new SetupFlowError(
        "missing_session",
        "No rotated profile is available.",
      );
    }
    const profileId = rotateKeysetSession.createdProfileId;
    setRotateKeysetSession(null);
    return profileId;
  }, [rotateKeysetSession]);

  const clearRotateKeysetSession = useCallback(() => {
    setRotateKeysetSession(null);
  }, []);

  const validateRecoverSources = useCallback(
    async (input: {
      profileId: string;
      profilePassword: string;
      sourcePackages: Array<{ packageText: string; password: string }>;
    }) => {
      const { record, sourcePayload, localIdx, localShare } =
        await loadSavedProfileSource({
          profileId: input.profileId,
          profilePassword: input.profilePassword,
        });
      const requiredExternalSources = Math.max(
        0,
        sourcePayload.group_package.threshold - 1,
      );
      if (input.sourcePackages.length < requiredExternalSources) {
        throw new SetupFlowError(
          "insufficient_sources",
          `Collect ${requiredExternalSources} external source packages before continuing.`,
        );
      }

      const seen = new Set<number>([localIdx]);
      const external = await decodeExternalBfshareSources({
        group: sourcePayload.group_package,
        sourcePackages: input.sourcePackages,
        seenShareIndexes: seen,
      });
      const externalShares = external.shares;
      const sources: RecoverSourceSummary[] = [
        {
          idx: localIdx,
          memberPubkey: memberPubkeyXOnly(
            memberForShare(sourcePayload.group_package, localShare),
          ),
          relays: sourcePayload.device.relays,
        },
        ...external.sources,
      ];

      const shares = [localShare, ...externalShares];
      if (shares.length < sourcePayload.group_package.threshold) {
        throw new SetupFlowError(
          "insufficient_sources",
          `Collect ${sourcePayload.group_package.threshold} source shares before continuing.`,
        );
      }

      setRecoverSession({
        sourceProfile: record.summary,
        sourcePayload,
        localShare,
        externalShares,
        sources,
      });
    },
    [],
  );

  const recoverNsec = useCallback(async () => {
    if (!recoverSession?.sourcePayload || !recoverSession.localShare) {
      throw new SetupFlowError(
        "missing_session",
        "Validate recovery sources before recovering.",
      );
    }

    const shares = [
      recoverSession.localShare,
      ...recoverSession.externalShares,
    ];
    if (shares.length < recoverSession.sourcePayload.group_package.threshold) {
      throw new SetupFlowError(
        "insufficient_sources",
        `Collect ${recoverSession.sourcePayload.group_package.threshold} source shares before continuing.`,
      );
    }

    try {
      const recovered = await recoverNsecFromShares({
        group: recoverSession.sourcePayload.group_package,
        shares,
      });
      setRecoverSession((session) =>
        session
          ? {
              ...session,
              recovered,
              expiresAt: Date.now() + 60_000,
            }
          : session,
      );
      return recovered;
    } catch (error) {
      throw new SetupFlowError(
        "recovery_failed",
        error instanceof Error
          ? error.message
          : "Unable to recover the Nostr private key.",
      );
    }
  }, [recoverSession]);

  const clearRecoverSession = useCallback(() => {
    setRecoverSession(null);
  }, []);

  const expireRecoveredNsec = useCallback(() => {
    setRecoverSession(null);
  }, []);

  const unlockProfile = useCallback(
    async (id: string, password: string) => {
      const record = await getProfile(id);
      if (!record) {
        throw new Error("Profile was not found.");
      }
      const payload = await decodeProfilePackage(
        record.encryptedProfilePackage,
        password,
      );
      const runtime = await createRuntimeFromProfilePayload(
        payload,
        record.summary.localShareIdx,
      );
      await touchProfile(id);
      setRuntime(runtime);
      setActiveProfile({ ...record.summary, lastUsedAt: Date.now() });
      setSignerPausedState(false);
      await reloadProfiles();
    },
    [reloadProfiles, setRuntime],
  );

  const lockProfile = useCallback(() => {
    abortOnboardHandshake();
    runtimeRef.current = null;
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setRecoverSession(null);
  }, [abortOnboardHandshake]);

  const clearCredentials = useCallback(async () => {
    abortOnboardHandshake();
    const id = activeProfile?.id;
    runtimeRef.current = null;
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setRecoverSession(null);
    if (id) {
      await removeProfile(id);
    }
    await reloadProfiles();
  }, [abortOnboardHandshake, activeProfile, reloadProfiles]);

  const setSignerPaused = useCallback((paused: boolean) => {
    setSignerPausedState(paused);
    if (paused) {
      simulatorRef.current?.stop();
    } else {
      simulatorRef.current?.start();
      simulatorRef.current?.refreshAll();
    }
  }, []);

  const refreshRuntime = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setRuntimeStatus(null);
      return;
    }
    if (!signerPaused && simulatorRef.current) {
      setRuntimeStatus(simulatorRef.current.pump(3));
      return;
    }
    runtime.tick(Date.now());
    setRuntimeStatus(runtime.runtimeStatus());
  }, [signerPaused]);

  useEffect(() => {
    // When the provider was hydrated from the demo bridge there is no real
    // RuntimeClient backing the visible runtimeStatus — running the tick loop
    // would immediately null it out and force a redirect to "/". Skip the
    // interval in that case. Whenever a live RuntimeClient is subsequently
    // established (unlockProfile → setRuntime, or the tail of createProfile),
    // `bridgeHydrated` is explicitly reset to `false` so this effect re-runs
    // and the polling interval resumes.
    if (bridgeHydrated && !runtimeRef.current) {
      return;
    }
    const timer = window.setInterval(refreshRuntime, 2500);
    return () => window.clearInterval(timer);
  }, [refreshRuntime, bridgeHydrated]);

  const value = useMemo<AppStateValue>(
    () => ({
      profiles,
      activeProfile,
      runtimeStatus,
      signerPaused,
      createSession,
      importSession,
      onboardSession,
      rotateKeysetSession,
      recoverSession,
      reloadProfiles,
      createKeyset,
      createProfile,
      updatePackageState,
      finishDistribution,
      clearCreateSession,
      beginImport,
      decryptImportBackup,
      saveImportedProfile,
      clearImportSession,
      decodeOnboardPackage,
      startOnboardHandshake,
      saveOnboardedProfile,
      clearOnboardSession,
      validateRotateKeysetSources,
      generateRotatedKeyset,
      createRotatedProfile,
      updateRotatePackageState,
      finishRotateDistribution,
      clearRotateKeysetSession,
      validateRecoverSources,
      recoverNsec,
      clearRecoverSession,
      expireRecoveredNsec,
      unlockProfile,
      lockProfile,
      clearCredentials,
      setSignerPaused,
      refreshRuntime,
    }),
    [
      profiles,
      activeProfile,
      runtimeStatus,
      signerPaused,
      createSession,
      importSession,
      onboardSession,
      rotateKeysetSession,
      recoverSession,
      reloadProfiles,
      createKeyset,
      createProfile,
      updatePackageState,
      finishDistribution,
      clearCreateSession,
      beginImport,
      decryptImportBackup,
      saveImportedProfile,
      clearImportSession,
      decodeOnboardPackage,
      startOnboardHandshake,
      saveOnboardedProfile,
      clearOnboardSession,
      validateRotateKeysetSources,
      generateRotatedKeyset,
      createRotatedProfile,
      updateRotatePackageState,
      finishRotateDistribution,
      clearRotateKeysetSession,
      validateRecoverSources,
      recoverNsec,
      clearRecoverSession,
      expireRecoveredNsec,
      unlockProfile,
      lockProfile,
      clearCredentials,
      setSignerPaused,
      refreshRuntime,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
