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
  buildProfileBackupEvent,
  createEncryptedProfileBackup,
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
import { RuntimeClient, type RuntimeCommand } from "../lib/bifrost/runtimeClient";
import type {
  BfProfilePayload,
  CompletedOperation,
  GroupPackageWire,
  OperationFailure,
  RuntimeEvent,
  RuntimeSnapshotInput,
  RuntimeStatusSummary,
  SharePackageWire,
  StoredProfileSummary,
} from "../lib/bifrost/types";
import {
  RuntimeRelayPump,
  type RuntimeDrainBatch,
  type RuntimeRelayStatus,
} from "../lib/relay/runtimeRelayPump";
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
import { exportRuntimePackagesFromSnapshot } from "./runtimeExports";
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
  HandleRuntimeCommandResult,
  ImportProfileDraft,
  ImportSession,
  OnboardingPackageStatePatch,
  OnboardSession,
  ProfileDraft,
  RecoverSession,
  RecoverSourceSummary,
  ReplaceShareSession,
  RotateKeysetSession,
} from "./AppStateTypes";

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<StoredProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] =
    useState<StoredProfileSummary | null>(null);
  const [runtimeStatus, setRuntimeStatus] =
    useState<RuntimeStatusSummary | null>(null);
  const [runtimeRelays, setRuntimeRelays] = useState<RuntimeRelayStatus[]>([]);
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
  const [replaceShareSession, setReplaceShareSession] =
    useState<ReplaceShareSession | null>(null);
  const [recoverSession, setRecoverSession] = useState<RecoverSession | null>(
    null,
  );
  const [runtimeCompletions, setRuntimeCompletions] = useState<
    CompletedOperation[]
  >([]);
  const [runtimeFailures, setRuntimeFailures] = useState<OperationFailure[]>(
    [],
  );
  const [lifecycleEvents, setLifecycleEvents] = useState<RuntimeEvent[]>([]);
  const [signDispatchLog, setSignDispatchLog] = useState<
    Record<string, string>
  >({});
  const [bridgeHydrated, setBridgeHydrated] = useState(false);
  const runtimeRef = useRef<RuntimeClient | null>(null);
  const simulatorRef = useRef<LocalRuntimeSimulator | null>(null);
  const relayPumpRef = useRef<RuntimeRelayPump | null>(null);
  const liveRelayUrlsRef = useRef<string[]>([]);
  /**
   * Serialised shape of the most-recent command dispatched via
   * `handleRuntimeCommand`. Used to debounce rapid-fire identical dispatches
   * (e.g. double-clicked buttons) — see VAL-OPS-019 for the contract.
   */
  const lastDispatchRef = useRef<{ key: string; at: number } | null>(null);
  /**
   * Mirror of `signerPaused` as a ref so `handleRuntimeCommand` (whose
   * `useCallback` identity must remain stable) can check the latest value
   * without re-creating the dispatcher on every state change. When paused,
   * the dispatcher no-ops without enqueuing an outbound envelope — see
   * VAL-OPS-017.
   */
  const signerPausedRef = useRef(false);
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
      setRuntimeRelays(snapshot.runtimeRelays ?? []);
      setSignerPausedState(Boolean(snapshot.signerPaused));
      setCreateSession(null);
      setImportSession(null);
      setOnboardSession(null);
      setRotateKeysetSession(null);
      setReplaceShareSession(null);
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

  const stopRelayPump = useCallback((clearStatuses = true) => {
    relayPumpRef.current?.stop();
    relayPumpRef.current = null;
    if (clearStatuses) {
      setRuntimeRelays([]);
    }
  }, []);

  /**
   * Merge a drained batch into the accumulated completions / failures /
   * lifecycle-events slices. Completions and failures are kept sorted by
   * ascending `request_id` (stable string compare) per the feature contract.
   * Callers correlate to originating `pending_operations` entries via the
   * same `request_id`.
   *
   * `completion.request_id` lives inside the discriminated CompletedOperation
   * union; we extract it defensively.
   */
  const absorbDrains = useCallback((drains: RuntimeDrainBatch) => {
    if (drains.completions.length > 0) {
      setRuntimeCompletions((previous) => {
        const merged = [...previous, ...drains.completions];
        merged.sort((a, b) =>
          completionRequestId(a).localeCompare(completionRequestId(b)),
        );
        return merged;
      });
    }
    if (drains.failures.length > 0) {
      setRuntimeFailures((previous) => {
        const merged = [...previous, ...drains.failures];
        merged.sort((a, b) => a.request_id.localeCompare(b.request_id));
        return merged;
      });
    }
    if (drains.events.length > 0) {
      setLifecycleEvents((previous) => [...previous, ...drains.events]);
    }
  }, []);

  const resetDrainSlices = useCallback(() => {
    setRuntimeCompletions([]);
    setRuntimeFailures([]);
    setLifecycleEvents([]);
    setSignDispatchLog({});
    lastDispatchRef.current = null;
  }, []);

  const startLiveRelayPump = useCallback(
    async (runtime: RuntimeClient, relayUrls: string[]) => {
      const relays = Array.from(
        new Set(relayUrls.map((relay) => relay.trim()).filter(Boolean)),
      );
      liveRelayUrlsRef.current = relays;
      stopRelayPump(false);
      resetDrainSlices();
      if (relays.length === 0) {
        setRuntimeRelays([]);
        return runtime.runtimeStatus();
      }

      const pump = new RuntimeRelayPump({
        runtime,
        relays,
        onRelayStatusChange: setRuntimeRelays,
        onDrains: absorbDrains,
      });
      relayPumpRef.current = pump;
      setRuntimeRelays(pump.relayStatuses());
      const status = await pump.start();
      if (relayPumpRef.current === pump) {
        setRuntimeStatus(status);
      }
      return status;
    },
    [absorbDrains, resetDrainSlices, stopRelayPump],
  );

  const setRuntime = useCallback(
    (
      runtime: RuntimeClient,
      simulator?: LocalRuntimeSimulator,
      relayUrls?: string[],
    ) => {
      if (simulatorRef.current && simulatorRef.current !== simulator) {
        simulatorRef.current.stop();
        simulatorRef.current.setOnDrains(undefined);
      }
      if (!relayUrls?.length) {
        liveRelayUrlsRef.current = [];
        stopRelayPump();
      }
      runtimeRef.current = runtime;
      simulatorRef.current = simulator ?? null;
      if (simulator) {
        simulator.setOnDrains(absorbDrains);
      }
      resetDrainSlices();
      setRuntimeStatus(runtime.runtimeStatus());
      if (relayUrls?.length && !simulator) {
        void startLiveRelayPump(runtime, relayUrls).catch((error) => {
          setRuntimeRelays(
            relayUrls.map((url) => ({
              url,
              state: "offline",
              lastError:
                error instanceof Error
                  ? error.message
                  : "Unable to start relay runtime.",
            })),
          );
        });
      }
      // A live RuntimeClient just came online in this SPA session — re-enable the
      // runtime-polling interval by clearing the bridge-hydration flag. Without
      // this reset, `bridgeHydrated` would stay `true` forever after any demo
      // hand-off, permanently disabling the refresh loop even though a real
      // runtime is now backing `runtimeRef`.
      setBridgeHydrated(false);
    },
    [absorbDrains, resetDrainSlices, startLiveRelayPump, stopRelayPump],
  );

  const startRuntimeFromPayload = useCallback(
    async (payload: BfProfilePayload, localShareIdx: number) => {
      setRuntime(
        await createRuntimeFromProfilePayload(payload, localShareIdx),
        undefined,
        payload.device.relays,
      );
    },
    [setRuntime],
  );

  const startRuntimeFromSnapshot = useCallback(
    async (snapshot: RuntimeSnapshotInput, relayUrls: string[] = []) => {
      setRuntime(await createRuntimeFromSnapshot(snapshot), undefined, relayUrls);
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
    const nsec = draft.generatedNsec ?? draft.existingNsec;
    const keyset = nsec
      ? await createKeysetBundleFromNsec({
          ...sessionDraft,
          nsec,
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
      await startRuntimeFromSnapshot(
        onboardSession.runtimeSnapshot,
        onboardSession.payload.relays,
      );
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

  const decodeReplaceSharePackage = useCallback(
    async (
      packageString: string,
      password: string,
      profilePassword: string,
    ) => {
      if (!activeProfile) {
        throw new SetupFlowError(
          "missing_session",
          "No active profile is available.",
        );
      }
      const trimmed = packageString.trim();
      if (!trimmed) {
        throw new SetupFlowError(
          "invalid_package",
          "Replace share package is required.",
        );
      }
      if (!trimmed.startsWith("bfonboard1")) {
        throw new SetupFlowError(
          "invalid_package",
          "Replace share package must start with bfonboard1.",
        );
      }
      try {
        const payload = await decodeBfonboardPackage(trimmed, password);
        const record = await getProfile(activeProfile.id);
        if (!record) {
          throw new SetupFlowError(
            "missing_session",
            "Active profile not found in storage.",
          );
        }
        const currentPayload = await decodeProfilePackage(
          record.encryptedProfilePackage,
          profilePassword,
        );
        const localShareIdx = await resolveShareIndex(
          currentPayload.group_package,
          payload.share_secret,
        );
        setReplaceShareSession({
          phase: "decoded",
          packageString: trimmed,
          password,
          profilePassword,
          decodedPayload: payload,
          localShareIdx,
          oldProfileId: activeProfile.id,
        });
      } catch (error) {
        if (error instanceof SetupFlowError) {
          throw error;
        }
        throw setupErrorFromPackage(error, {
          code: "wrong_password",
          message:
            "The package password could not decrypt this onboarding package.",
        });
      }
    },
    [activeProfile],
  );

  const applyReplaceShareUpdate = useCallback(async () => {
    if (
      !replaceShareSession?.decodedPayload ||
      !replaceShareSession.profilePassword
    ) {
      throw new SetupFlowError(
        "missing_session",
        "Decode a replace share package before applying.",
      );
    }
    if (!activeProfile) {
      throw new SetupFlowError(
        "missing_session",
        "No active profile is available.",
      );
    }

    setReplaceShareSession((session) =>
      session ? { ...session, phase: "applying" } : session,
    );

    try {
      const record = await getProfile(activeProfile.id);
      if (!record) {
        throw new SetupFlowError(
          "missing_session",
          "Active profile not found in storage.",
        );
      }
      const currentPayload = await decodeProfilePackage(
        record.encryptedProfilePackage,
        replaceShareSession.profilePassword,
      );

      const newShare = {
        idx:
          replaceShareSession.localShareIdx ?? activeProfile.localShareIdx,
        seckey: replaceShareSession.decodedPayload.share_secret,
      };

      const newProfileId = await deriveProfileIdFromShareSecret(
        newShare.seckey,
      );

      const newPayload = profilePayloadForShare({
        profileId: newProfileId,
        deviceName: currentPayload.device.name,
        share: newShare,
        group: currentPayload.group_package,
        relays:
          replaceShareSession.decodedPayload.relays.length > 0
            ? replaceShareSession.decodedPayload.relays
            : currentPayload.device.relays,
        manualPeerPolicyOverrides:
          currentPayload.device.manual_peer_policy_overrides ??
          defaultManualPeerPolicyOverrides(
            currentPayload.group_package,
            newShare.idx,
          ),
      });

      const summary = await savePayloadAsProfile(
        newPayload,
        replaceShareSession.profilePassword,
        {
          replaceProfileId: activeProfile.id,
          createdAt: record.summary.createdAt,
          label: record.summary.label,
        },
      );

      setReplaceShareSession((session) =>
        session
          ? {
              ...session,
              phase: "updated",
              newProfileId: summary.id,
            }
          : session,
      );
    } catch (error) {
      setReplaceShareSession((session) =>
        session
          ? {
              ...session,
              phase: "failed",
              error: {
                code:
                  error instanceof SetupFlowError
                    ? error.code
                    : "invalid_package",
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to apply share update.",
              },
            }
          : session,
      );
      throw error;
    }
  }, [
    replaceShareSession,
    activeProfile,
    savePayloadAsProfile,
  ]);

  const clearReplaceShareSession = useCallback(() => {
    setReplaceShareSession(null);
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
      const payloadRelays = payload.device.relays ?? [];
      setRuntime(
        runtime,
        undefined,
        payloadRelays.length > 0 ? payloadRelays : record.summary.relays,
      );
      setActiveProfile({ ...record.summary, lastUsedAt: Date.now() });
      setSignerPausedState(false);
      await reloadProfiles();
    },
    [reloadProfiles, setRuntime],
  );

  const changeProfilePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      if (!activeProfile) {
        throw new Error("No active profile.");
      }
      if (newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters.");
      }
      const record = await getProfile(activeProfile.id);
      if (!record) {
        throw new Error("Profile record not found.");
      }
      const payload = await decodeProfilePackage(
        record.encryptedProfilePackage,
        oldPassword,
      );
      const { record: updatedRecord } = await buildStoredProfileRecord(
        payload,
        newPassword,
        {
          createdAt: record.summary.createdAt,
          lastUsedAt: Date.now(),
          label: record.summary.label,
        },
      );
      await saveProfile(updatedRecord);
      await reloadProfiles();
    },
    [activeProfile, reloadProfiles],
  );

  const lockProfile = useCallback(() => {
    abortOnboardHandshake();
    runtimeRef.current = null;
    liveRelayUrlsRef.current = [];
    stopRelayPump();
    simulatorRef.current?.stop();
    simulatorRef.current?.setOnDrains(undefined);
    simulatorRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setReplaceShareSession(null);
    setRecoverSession(null);
    resetDrainSlices();
  }, [abortOnboardHandshake, resetDrainSlices, stopRelayPump]);

  const clearCredentials = useCallback(async () => {
    abortOnboardHandshake();
    const id = activeProfile?.id;
    runtimeRef.current = null;
    liveRelayUrlsRef.current = [];
    stopRelayPump();
    simulatorRef.current?.stop();
    simulatorRef.current?.setOnDrains(undefined);
    simulatorRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setReplaceShareSession(null);
    setRecoverSession(null);
    resetDrainSlices();
    if (id) {
      await removeProfile(id);
    }
    await reloadProfiles();
  }, [
    abortOnboardHandshake,
    activeProfile,
    reloadProfiles,
    resetDrainSlices,
    stopRelayPump,
  ]);

  const exportRuntimePackages = useCallback(
    async (password: string) => {
      const runtime = runtimeRef.current;
      const profile = activeProfile;
      if (!runtime || !profile) {
        throw new Error("No unlocked runtime is available to export.");
      }
      const snapshot = runtime.snapshot();
      return exportRuntimePackagesFromSnapshot({
        profile,
        snapshot,
        password,
        peerCount: runtimeStatus?.peers.length ?? snapshot.status.known_peers,
      });
    },
    [activeProfile, runtimeStatus],
  );

  const createProfileBackup = useCallback(async () => {
    const runtime = runtimeRef.current;
    const profile = activeProfile;
    if (!runtime || !profile) {
      throw new Error("No unlocked runtime is available to create a backup.");
    }
    const snapshot = runtime.snapshot();
    const payload = profilePayloadForShare({
      profileId: profile.id,
      deviceName: profile.deviceName,
      share: snapshot.bootstrap.share,
      group: snapshot.bootstrap.group,
      relays: profile.relays,
      manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
        snapshot.bootstrap.group,
        snapshot.bootstrap.share.idx,
      ),
    });
    const backup = await createEncryptedProfileBackup(payload);
    const event = await buildProfileBackupEvent({
      shareSecret: snapshot.bootstrap.share.seckey,
      backup,
    });
    return { backup, event };
  }, [activeProfile]);

  const restartRuntimeConnections = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setRuntimeRelays([]);
      setRuntimeStatus(null);
      return;
    }
    setSignerPausedState(false);
    if (simulatorRef.current) {
      simulatorRef.current.start();
      simulatorRef.current.refreshAll();
      setRuntimeStatus(simulatorRef.current.pump(3));
      return;
    }
    const relays = liveRelayUrlsRef.current.length
      ? liveRelayUrlsRef.current
      : activeProfile?.relays ?? [];
    await startLiveRelayPump(runtime, relays);
    if (relayPumpRef.current) {
      const status = await relayPumpRef.current.refreshAll();
      if (runtimeRef.current === runtime) {
        setRuntimeStatus(status);
      }
    }
  }, [activeProfile, startLiveRelayPump]);

  // Keep the signerPausedRef in lock-step with the signerPaused state so
  // `handleRuntimeCommand` (which reads the ref to avoid re-creating the
  // callback on every state change) always sees the latest value — including
  // transitions driven by `lockProfile`, `clearCredentials`, and the bridge
  // rehydration path.
  useEffect(() => {
    signerPausedRef.current = signerPaused;
  }, [signerPaused]);

  const setSignerPaused = useCallback((paused: boolean) => {
    signerPausedRef.current = paused;
    setSignerPausedState(paused);
    if (paused) {
      simulatorRef.current?.stop();
      stopRelayPump(false);
      setRuntimeRelays((relays) =>
        relays.map((relay) => ({ ...relay, state: "offline" })),
      );
    } else {
      if (simulatorRef.current) {
        simulatorRef.current.start();
        simulatorRef.current.refreshAll();
        setRuntimeStatus(simulatorRef.current.pump(3));
        return;
      }
      void restartRuntimeConnections();
    }
  }, [restartRuntimeConnections, stopRelayPump]);

  /**
   * Forward a runtime command (sign / ecdh / ping / refresh / onboard) to the
   * underlying WASM runtime and return the generated `request_id` captured
   * from the next `pending_operations` snapshot.
   *
   * Debounce contract: identical commands (by serialised payload) dispatched
   * within {@link HANDLE_COMMAND_DEBOUNCE_WINDOW_MS} of the previous
   * dispatch are coalesced. The returned `debounced` flag tells the caller
   * whether the underlying runtime received the command this call — this is
   * deterministic and safe to assert in tests (VAL-OPS-019).
   *
   * No plaintext command payload is logged to console; the only visible
   * error paths surface `BifrostError` objects the runtime itself produced.
   */
  const handleRuntimeCommand = useCallback(
    async (cmd: RuntimeCommand): Promise<HandleRuntimeCommandResult> => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error(
          "Cannot dispatch runtime command: no runtime is active.",
        );
      }
      // VAL-OPS-017: while the signer is paused, silently refuse to dispatch
      // any runtime command. No outbound envelope should be enqueued, no
      // pending_operation should be registered. Callers observe this state
      // via the returned `{ requestId: null, debounced: false }` shape.
      if (signerPausedRef.current) {
        return { requestId: null, debounced: false };
      }
      const key = commandKey(cmd);
      const now = Date.now();
      const previous = lastDispatchRef.current;
      if (
        previous &&
        previous.key === key &&
        now - previous.at < HANDLE_COMMAND_DEBOUNCE_MS
      ) {
        return { requestId: null, debounced: true };
      }
      lastDispatchRef.current = { key, at: now };

      const before = new Set<string>();
      const expectedType = pendingOpTypeFor(cmd);
      try {
        const statusBefore = runtime.runtimeStatus();
        for (const op of statusBefore.pending_operations) {
          before.add(op.request_id);
        }
      } catch {
        // If the runtime can't produce a status snapshot before dispatch we
        // still forward the command. Callers lose the request_id correlation
        // for this call but the operation itself is unaffected.
      }

      runtime.handleCommand(cmd);

      if (expectedType === null) {
        // refresh_all_peers fans out to pings internally; no single pending
        // op represents the command's request_id.
        return { requestId: null, debounced: false };
      }

      // The runtime queues the command on `handleCommand` but does not update
      // `pending_operations` until the next tick processes the queue. Drive
      // one immediately so the captured request_id is visible to this call.
      try {
        runtime.tick(now);
      } catch {
        // tick failure is surfaced through the status snapshot below.
      }

      let requestId: string | null = null;
      try {
        const statusAfter = runtime.runtimeStatus();
        for (const op of statusAfter.pending_operations) {
          if (op.op_type === expectedType && !before.has(op.request_id)) {
            requestId = op.request_id;
            break;
          }
        }
        setRuntimeStatus(statusAfter);
      } catch {
        requestId = null;
      }
      // Record sign-command metadata so callers (SigningFailedModal) can
      // correlate later `OperationFailure`s back to the original
      // `message_hex_32` and Retry re-dispatches the identical command.
      if (requestId && cmd.type === "sign") {
        const messageHex = cmd.message_hex_32;
        setSignDispatchLog((prev) =>
          prev[requestId!] === messageHex
            ? prev
            : { ...prev, [requestId!]: messageHex },
        );
      }
      return { requestId, debounced: false };
    },
    [],
  );

  const refreshRuntime = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setRuntimeStatus(null);
      return;
    }
    if (signerPaused) {
      setRuntimeStatus(runtime.runtimeStatus());
      return;
    }
    if (!signerPaused && simulatorRef.current) {
      setRuntimeStatus(simulatorRef.current.pump(3));
      return;
    }
    if (!signerPaused && relayPumpRef.current) {
      // refreshAll() fans out refresh_all_peers then calls pump() internally;
      // pump() is what invokes our onDrains callback, so completions and
      // failures will flow into the slices on this tick.
      void relayPumpRef.current.refreshAll().then((status) => {
        if (runtimeRef.current === runtime) {
          setRuntimeStatus(status);
        }
      });
      return;
    }
    // Fallback (no relay pump, no simulator): tick the runtime directly and
    // drain completions/failures/events ourselves so the AppState slices stay
    // synchronised even in unit-test scenarios that skip the pump.
    runtime.tick(Date.now());
    const drains: RuntimeDrainBatch = {
      completions: runtime.drainCompletions(),
      failures: runtime.drainFailures(),
      events: runtime.drainRuntimeEvents(),
    };
    absorbDrains(drains);
    setRuntimeStatus(runtime.runtimeStatus());
  }, [absorbDrains, signerPaused]);

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

  useEffect(() => {
    // VAL-OPS-021: re-show of a hidden tab must deliver any pending
    // completions that accumulated while hidden (within 3s of visible). When
    // the browser re-fires visibilitychange with `visible`, force an extra
    // refresh tick so any drained completions immediately populate state.
    function onVisibility() {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible" && runtimeRef.current) {
        refreshRuntime();
      }
    }
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshRuntime]);

  useEffect(() => {
    // VAL-OPS-028: window-close during an in-flight op must leave no ghost
    // pending op in IndexedDB. pending_operations is held in runtime memory
    // (never persisted), but we still tear down pumps and simulator so the
    // relay sockets are closed cleanly (code 1000/1001). On next mount the
    // runtime is re-initialised from the stored encrypted profile with an
    // empty pending_operations set, regardless of what was in-flight here.
    function onBeforeUnload() {
      try {
        relayPumpRef.current?.stop();
      } catch {
        // best-effort cleanup during teardown
      }
      try {
        simulatorRef.current?.stop();
      } catch {
        // best-effort cleanup during teardown
      }
    }
    if (typeof window === "undefined") return;
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      profiles,
      activeProfile,
      runtimeStatus,
      runtimeRelays,
      signerPaused,
      createSession,
      importSession,
      onboardSession,
      rotateKeysetSession,
      replaceShareSession,
      recoverSession,
      runtimeCompletions,
      runtimeFailures,
      lifecycleEvents,
      signDispatchLog,
      reloadProfiles,
      handleRuntimeCommand,
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
      decodeReplaceSharePackage,
      applyReplaceShareUpdate,
      clearReplaceShareSession,
      validateRecoverSources,
      recoverNsec,
      clearRecoverSession,
      expireRecoveredNsec,
      unlockProfile,
      changeProfilePassword,
      lockProfile,
      clearCredentials,
      exportRuntimePackages,
      createProfileBackup,
      setSignerPaused,
      refreshRuntime,
      restartRuntimeConnections,
    }),
    [
      profiles,
      activeProfile,
      runtimeStatus,
      runtimeRelays,
      signerPaused,
      createSession,
      importSession,
      onboardSession,
      rotateKeysetSession,
      replaceShareSession,
      recoverSession,
      runtimeCompletions,
      runtimeFailures,
      lifecycleEvents,
      signDispatchLog,
      reloadProfiles,
      handleRuntimeCommand,
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
      decodeReplaceSharePackage,
      applyReplaceShareUpdate,
      clearReplaceShareSession,
      validateRecoverSources,
      recoverNsec,
      clearRecoverSession,
      expireRecoveredNsec,
      unlockProfile,
      changeProfilePassword,
      lockProfile,
      clearCredentials,
      exportRuntimePackages,
      createProfileBackup,
      setSignerPaused,
      refreshRuntime,
      restartRuntimeConnections,
    ],
  );

  // Dev-only multi-device e2e test hook. Gated on `import.meta.env.DEV` so
  // Vite's dead-code elimination strips this whole effect — and every symbol
  // it references — from production bundles. The hook exposes:
  //
  //   - `window.__appState`: latest `AppStateValue` snapshot (including
  //      `handleRuntimeCommand`, `runtimeStatus`, `runtimeCompletions`,
  //      `runtimeFailures`, etc.) so a Playwright spec can dispatch runtime
  //      commands and poll pending_operations / completions via
  //      `page.evaluate`.
  //   - `window.__iglooTestSeedRuntime({group, share, relays})`: minimal
  //      seeding helper that boots a real `RuntimeClient` with the supplied
  //      group + share and starts the live relay pump against `relays`.
  //      Does NOT persist a profile to IndexedDB — the hook's only purpose
  //      is to stand up a runtime quickly for multi-device specs that
  //      connect two browser contexts to the bifrost-devtools relay.
  //   - `window.__iglooTestCreateKeysetBundle(params)`: exposes the WASM
  //      keyset generator so a single browser can produce a shared 2-of-N
  //      keyset, then distribute shares across contexts for round-trip
  //      specs (ECDH / sign / ping).
  //   - `window.__iglooTestMemberPubkey32(group, shareIdx)`: derives the
  //      32-byte x-only hex pubkey for a given member, matching the
  //      `pubkey32_hex` argument shape expected by the ECDH runtime
  //      command.
  //
  // This is infrastructure for `src/e2e/multi-device/*.spec.ts`; production
  // UI code must never reference these hooks.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof window === "undefined") return;
    const globalWindow = window as typeof window & {
      __appState?: AppStateValue;
      __iglooTestSeedRuntime?: (input: {
        group: GroupPackageWire;
        share: SharePackageWire;
        relays: string[];
        deviceName?: string;
      }) => Promise<void>;
      __iglooTestCreateKeysetBundle?: typeof createKeysetBundle;
      __iglooTestMemberPubkey32?: (
        group: GroupPackageWire,
        shareIdx: number,
      ) => string;
    };
    globalWindow.__appState = value;
    globalWindow.__iglooTestSeedRuntime = async (input) => {
      const payload: BfProfilePayload = {
        profile_id: `igloo-test-${input.share.idx}`,
        version: 1,
        device: {
          name: input.deviceName ?? `Test Device ${input.share.idx}`,
          share_secret: input.share.seckey,
          manual_peer_policy_overrides: [],
          relays: input.relays,
        },
        group_package: input.group,
      };
      await startRuntimeFromPayload(payload, input.share.idx);
    };
    globalWindow.__iglooTestCreateKeysetBundle = createKeysetBundle;
    globalWindow.__iglooTestMemberPubkey32 = (group, shareIdx) => {
      const member = group.members.find((entry) => entry.idx === shareIdx);
      if (!member) {
        throw new Error(
          `group is missing member for share ${shareIdx}`,
        );
      }
      return memberPubkeyXOnly(member);
    };
    return () => {
      if (globalWindow.__appState === value) {
        delete globalWindow.__appState;
      }
    };
  }, [value, startRuntimeFromPayload]);

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

/**
 * Extracts the `request_id` field from a {@link CompletedOperation} regardless
 * of which variant it is. All variants (Sign/Ecdh/Ping/Onboard) carry an
 * interior `request_id` string on their single payload key.
 */
function completionRequestId(completion: CompletedOperation): string {
  const payload =
    (completion as { Sign?: { request_id: string } }).Sign ??
    (completion as { Ecdh?: { request_id: string } }).Ecdh ??
    (completion as { Ping?: { request_id: string } }).Ping ??
    (completion as { Onboard?: { request_id: string } }).Onboard;
  return payload?.request_id ?? "";
}

/**
 * Serialise a RuntimeCommand into a deterministic string suitable for
 * identity comparison across dispatch calls. Two semantically-identical
 * commands (same verb + payload) must produce the same string so that the
 * debounce window can coalesce them.
 */
function commandKey(cmd: RuntimeCommand): string {
  switch (cmd.type) {
    case "sign":
      return `sign:${cmd.message_hex_32}`;
    case "ecdh":
      return `ecdh:${cmd.pubkey32_hex}`;
    case "ping":
      return `ping:${cmd.peer_pubkey32_hex}`;
    case "refresh_peer":
      return `refresh_peer:${cmd.peer_pubkey32_hex}`;
    case "refresh_all_peers":
      return "refresh_all_peers";
    case "onboard":
      return `onboard:${cmd.peer_pubkey32_hex}`;
  }
}

/**
 * Map a RuntimeCommand verb to the PendingOperation `op_type` string used by
 * the WASM runtime_status snapshot. Returns `null` for commands that do not
 * register a pending entry (e.g. `refresh_all_peers` fans out to pings
 * already).
 */
function pendingOpTypeFor(cmd: RuntimeCommand): string | null {
  switch (cmd.type) {
    case "sign":
      return "Sign";
    case "ecdh":
      return "Ecdh";
    case "ping":
    case "refresh_peer":
      return "Ping";
    case "onboard":
      return "Onboard";
    case "refresh_all_peers":
      return null;
  }
}

const HANDLE_COMMAND_DEBOUNCE_MS = 300;
export const HANDLE_COMMAND_DEBOUNCE_WINDOW_MS = HANDLE_COMMAND_DEBOUNCE_MS;
