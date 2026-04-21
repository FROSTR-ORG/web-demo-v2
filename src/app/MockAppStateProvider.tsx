import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { snapshotFromAppState, writeBridgeSnapshot } from "./appStateBridge";
import { AppStateContext } from "./AppStateContext";
import {
  allPackagesDistributed,
  normalizePackageStatePatch,
} from "./distributionPackages";
import type {
  AppStateValue,
  CreateKeysetDraft,
  CreateProfileDraft,
  ImportProfileDraft,
  OnboardingPackageStatePatch,
  ProfileDraft,
  RuntimeCommand,
  SignLifecycleEntry,
} from "./AppStateTypes";

export function MockAppStateProvider({
  value,
  children,
  bridge = true,
}: {
  value: AppStateValue;
  children: ReactNode;
  /**
   * When true (default), the mock provider writes a sessionStorage bridge
   * snapshot on mount and whenever its internal state changes, so the real
   * AppStateProvider can rehydrate if the user navigates out of `/demo/*`
   * into a real application route like `/dashboard/:id`. Pass `false` in
   * isolated test setups where the bridge would be noise.
   */
  bridge?: boolean;
}) {
  // MockAppStateProvider owns its own bridge-serialisable fields so that
  // mutators like `clearCredentials` and `lockProfile` can truly update the
  // visible state from inside the demo shell (e.g. clearing profiles before
  // a navigate("/") hand-off to the real AppStateProvider). The `value` prop
  // supplies the initial seed and all non-state callbacks; internal setters
  // override the mutators that must participate in demo-side state changes.
  const [profiles, setProfiles] = useState(value.profiles);
  const [activeProfile, setActiveProfile] = useState(value.activeProfile);
  const [runtimeStatus, setRuntimeStatus] = useState(value.runtimeStatus);
  const [runtimeRelays, setRuntimeRelays] = useState(value.runtimeRelays);
  const [signerPaused, setSignerPausedState] = useState(value.signerPaused);
  const [createSession, setCreateSession] = useState(value.createSession);
  const [importSession, setImportSession] = useState(value.importSession);
  const [onboardSession, setOnboardSession] = useState(value.onboardSession);
  const [rotateKeysetSession, setRotateKeysetSession] = useState(
    value.rotateKeysetSession,
  );
  const [replaceShareSession, setReplaceShareSession] = useState(
    value.replaceShareSession,
  );
  const [recoverSession, setRecoverSession] = useState(value.recoverSession);
  const [runtimeCompletions, setRuntimeCompletions] = useState(
    value.runtimeCompletions ?? [],
  );
  const [runtimeFailures, setRuntimeFailures] = useState(
    value.runtimeFailures ?? [],
  );
  const [lifecycleEvents, setLifecycleEvents] = useState(
    value.lifecycleEvents ?? [],
  );
  const [signDispatchLog, setSignDispatchLog] = useState<Record<string, string>>(
    value.signDispatchLog ?? {},
  );
  const [signLifecycleLog, setSignLifecycleLog] = useState<
    SignLifecycleEntry[]
  >(value.signLifecycleLog ?? []);
  const [pendingDispatchIndex, setPendingDispatchIndex] = useState<
    Record<string, import("./AppStateTypes").PendingDispatchEntry>
  >(value.pendingDispatchIndex ?? {});
  const [peerDenialQueue, setPeerDenialQueue] = useState<
    import("./AppStateTypes").PeerDeniedEvent[]
  >(value.peerDenialQueue ?? []);
  const [policyOverrides, setPolicyOverrides] = useState<
    import("./AppStateTypes").PolicyOverrideEntry[]
  >(value.policyOverrides ?? []);
  const resolvedDenialIdsRef = useRef<Set<string>>(new Set());

  const enqueuePeerDenial = useCallback(
    (event: import("./AppStateTypes").PeerDeniedEvent) => {
      if (!event || typeof event.id !== "string" || event.id.length === 0) {
        return;
      }
      if (resolvedDenialIdsRef.current.has(event.id)) return;
      setPeerDenialQueue((previous) =>
        previous.some((queued) => queued.id === event.id)
          ? previous
          : [...previous, event],
      );
    },
    [],
  );

  const resolvePeerDenial = useCallback(
    async (
      id: string,
      decision: import("./AppStateTypes").PolicyPromptDecision,
    ) => {
      resolvedDenialIdsRef.current.add(id);
      const pending = peerDenialQueue.find((entry) => entry.id === id);
      setPeerDenialQueue((previous) =>
        previous.filter((entry) => entry.id !== id),
      );
      if (!pending) return;
      const peer = pending.peer_pubkey;
      const verb = pending.verb;
      const addEntry = (
        entry: import("./AppStateTypes").PolicyOverrideEntry,
      ) =>
        setPolicyOverrides((previous) => {
          const index = previous.findIndex(
            (candidate) =>
              candidate.peer === entry.peer &&
              candidate.direction === entry.direction &&
              candidate.method === entry.method,
          );
          if (index === -1) return [...previous, entry];
          const next = previous.slice();
          next[index] = entry;
          return next;
        });
      const now = Date.now();
      switch (decision.action) {
        case "allow-once":
          addEntry({
            peer,
            direction: "respond",
            method: verb,
            value: "allow",
            source: "session",
            createdAt: now,
          });
          break;
        case "allow-always":
          addEntry({
            peer,
            direction: "respond",
            method: verb,
            value: "allow",
            source: "persistent",
            createdAt: now,
          });
          break;
        case "deny-always":
          addEntry({
            peer,
            direction: "respond",
            method: verb,
            value: "deny",
            source: "persistent",
            createdAt: now,
          });
          break;
        case "deny":
          break;
      }
    },
    [peerDenialQueue],
  );

  const removePolicyOverride = useCallback(
    async (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
    }) => {
      // Forward to the caller-supplied implementation first (tests seed
      // a spy here) before pruning the mock's own state copy so the
      // parent can observe the exact (peer, direction, method) args.
      await value.removePolicyOverride(input);
      setPolicyOverrides((previous) =>
        previous.filter(
          (entry) =>
            !(
              entry.peer === input.peer &&
              entry.direction === input.direction &&
              entry.method === input.method
            ),
        ),
      );
    },
    [value],
  );

  /**
   * Forward Peer Policies chip dispatches to the caller-supplied
   * implementation (tests seed a spy here). Mirrors the
   * removePolicyOverride pattern: the parent observes the exact
   * (peer, direction, method, value) args so component tests can
   * assert one call per chip click (VAL-POLICIES-008).
   */
  const setPeerPolicyOverride = useCallback(
    async (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
      value: "unset" | "allow" | "deny";
    }) => {
      await value.setPeerPolicyOverride(input);
    },
    [value],
  );

  const createKeyset = useCallback(
    async (draft: CreateKeysetDraft) => {
      await value.createKeyset(draft);
      if (value.createSession) {
        setCreateSession(value.createSession);
      }
    },
    [value],
  );

  const createProfile = useCallback(
    async (draft: CreateProfileDraft) => {
      const profileId = await value.createProfile(draft);
      setCreateSession((session) =>
        session ? { ...session, createdProfileId: profileId } : session,
      );
      const nextActive =
        value.profiles.find((profile) => profile.id === profileId) ??
        value.activeProfile;
      if (nextActive) {
        setActiveProfile(nextActive);
      }
      return profileId;
    },
    [value],
  );

  const updatePackageState = useCallback(
    (idx: number, patch: OnboardingPackageStatePatch) => {
      value.updatePackageState(idx, patch);
      const normalizedPatch = normalizePackageStatePatch(patch);
      setCreateSession((session) =>
        session
          ? {
              ...session,
              onboardingPackages: session.onboardingPackages.map((entry) =>
                entry.idx === idx ? { ...entry, ...normalizedPatch } : entry,
              ),
            }
          : session,
      );
    },
    [value],
  );

  const clearCreateSession = useCallback(() => {
    value.clearCreateSession();
    setCreateSession(null);
  }, [value]);

  const beginImport = useCallback(
    (backupString: string) => {
      value.beginImport(backupString);
      setImportSession({ backupString: backupString.trim() });
    },
    [value],
  );

  const decryptImportBackup = useCallback(
    async (backupString: string, password: string) => {
      await value.decryptImportBackup(backupString, password);
      setImportSession(
        (session) =>
          value.importSession ??
          session ?? { backupString: backupString.trim() },
      );
    },
    [value],
  );

  const saveImportedProfile = useCallback(
    async (draft: ImportProfileDraft) => {
      const profileId = await value.saveImportedProfile(draft);
      const nextActive =
        value.profiles.find((profile) => profile.id === profileId) ??
        value.activeProfile;
      if (nextActive) {
        setActiveProfile(nextActive);
      }
      return profileId;
    },
    [value],
  );

  const clearImportSession = useCallback(() => {
    value.clearImportSession();
    setImportSession(null);
  }, [value]);

  const decodeOnboardPackage = useCallback(
    async (packageString: string, password: string) => {
      await value.decodeOnboardPackage(packageString, password);
      if (value.onboardSession) {
        setOnboardSession(value.onboardSession);
      }
    },
    [value],
  );

  const startOnboardHandshake = useCallback(async () => {
    await value.startOnboardHandshake();
    if (value.onboardSession) {
      setOnboardSession(value.onboardSession);
    }
  }, [value]);

  const saveOnboardedProfile = useCallback(
    async (draft: Pick<ProfileDraft, "password" | "confirmPassword">) => {
      const profileId = await value.saveOnboardedProfile(draft);
      setOnboardSession(null);
      const nextActive =
        value.profiles.find((profile) => profile.id === profileId) ??
        value.activeProfile;
      if (nextActive) {
        setActiveProfile(nextActive);
      }
      return profileId;
    },
    [value],
  );

  const clearOnboardSession = useCallback(() => {
    value.clearOnboardSession();
    setOnboardSession(null);
  }, [value]);

  const validateRotateKeysetSources: AppStateValue["validateRotateKeysetSources"] =
    useCallback(
      async (input) => {
        await value.validateRotateKeysetSources(input);
        if (value.rotateKeysetSession) {
          setRotateKeysetSession(value.rotateKeysetSession);
        }
      },
      [value],
    );

  const generateRotatedKeyset = useCallback(
    async (distributionPassword: string) => {
      await value.generateRotatedKeyset(distributionPassword);
      if (value.rotateKeysetSession) {
        setRotateKeysetSession(value.rotateKeysetSession);
      }
    },
    [value],
  );

  const createRotatedProfile = useCallback(
    async (draft: ProfileDraft) => {
      const profileId = await value.createRotatedProfile(draft);
      setRotateKeysetSession((session) =>
        session ? { ...session, createdProfileId: profileId } : session,
      );
      const nextActive =
        value.profiles.find((profile) => profile.id === profileId) ??
        value.activeProfile;
      if (nextActive) {
        setActiveProfile(nextActive);
      }
      return profileId;
    },
    [value],
  );

  const updateRotatePackageState = useCallback(
    (idx: number, patch: OnboardingPackageStatePatch) => {
      value.updateRotatePackageState(idx, patch);
      const normalizedPatch = normalizePackageStatePatch(patch);
      setRotateKeysetSession((session) => {
        if (!session) {
          return session;
        }
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
    [value],
  );

  const finishRotateDistribution = useCallback(async () => {
    const profileId = await value.finishRotateDistribution();
    setRotateKeysetSession(null);
    return profileId;
  }, [value]);

  const clearRotateKeysetSession = useCallback(() => {
    value.clearRotateKeysetSession();
    setRotateKeysetSession(null);
  }, [value]);

  const decodeReplaceSharePackage = useCallback(
    async (packageString: string, password: string, profilePassword: string) => {
      await value.decodeReplaceSharePackage(packageString, password, profilePassword);
      if (value.replaceShareSession) {
        setReplaceShareSession(value.replaceShareSession);
      }
    },
    [value],
  );

  const applyReplaceShareUpdate = useCallback(async () => {
    await value.applyReplaceShareUpdate();
    if (value.replaceShareSession) {
      setReplaceShareSession(value.replaceShareSession);
    }
  }, [value]);

  const clearReplaceShareSession = useCallback(() => {
    value.clearReplaceShareSession();
    setReplaceShareSession(null);
  }, [value]);

  const validateRecoverSources: AppStateValue["validateRecoverSources"] =
    useCallback(
      async (input) => {
        await value.validateRecoverSources(input);
        if (value.recoverSession) {
          setRecoverSession(value.recoverSession);
        }
      },
      [value],
    );

  const recoverNsec = useCallback(async () => {
    const recovered = await value.recoverNsec();
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
  }, [value]);

  const clearRecoverSession = useCallback(() => {
    value.clearRecoverSession();
    setRecoverSession(null);
  }, [value]);

  const expireRecoveredNsec = useCallback(() => {
    value.expireRecoveredNsec();
    setRecoverSession(null);
  }, [value]);

  const unlockProfile = useCallback(
    async (id: string, password: string) => {
      await value.unlockProfile(id, password);
      const nextActive =
        value.profiles.find((profile) => profile.id === id) ??
        value.activeProfile;
      if (nextActive) {
        setActiveProfile(nextActive);
      }
      setRuntimeStatus(value.runtimeStatus);
      setRuntimeRelays(value.runtimeRelays);
      setSignerPausedState(false);
    },
    [value],
  );

  const changeProfilePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      await value.changeProfilePassword(oldPassword, newPassword);
    },
    [value],
  );

  const lockProfile = useCallback(() => {
    // Forward to any caller-supplied behaviour first (fixtures may observe).
    value.lockProfile();
    setRuntimeStatus(null);
    setRuntimeRelays([]);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setReplaceShareSession(null);
    setRecoverSession(null);
    setRuntimeCompletions([]);
    setRuntimeFailures([]);
    setLifecycleEvents([]);
    setSignDispatchLog({});
    setSignLifecycleLog([]);
    setPendingDispatchIndex({});
  }, [value]);

  const clearCredentials = useCallback(async () => {
    await value.clearCredentials();
    setProfiles([]);
    setActiveProfile(null);
    setRuntimeStatus(null);
    setRuntimeRelays([]);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setReplaceShareSession(null);
    setRecoverSession(null);
    setRuntimeCompletions([]);
    setRuntimeFailures([]);
    setLifecycleEvents([]);
    setSignDispatchLog({});
    setSignLifecycleLog([]);
    setPendingDispatchIndex({});
  }, [value]);

  const setSignerPaused = useCallback(
    (paused: boolean) => {
      value.setSignerPaused(paused);
      setSignerPausedState(paused);
    },
    [value],
  );

  const restartRuntimeConnections = useCallback(async () => {
    await value.restartRuntimeConnections();
    setSignerPausedState(false);
    setRuntimeRelays(value.runtimeRelays);
    setRuntimeStatus(value.runtimeStatus);
  }, [value]);

  const exportRuntimePackages = useCallback(
    (password: string) => value.exportRuntimePackages(password),
    [value],
  );

  const createProfileBackup = useCallback(
    () => value.createProfileBackup(),
    [value],
  );

  /**
   * Delegates to the seed's `handleRuntimeCommand`. The default fixture
   * (`createDemoAppState`) supplies a stateful mock that generates fresh
   * `mock-request-N` ids and honours the 300ms debounce contract. Tests
   * that want to intercept the dispatch can override by passing their own
   * function as `value.handleRuntimeCommand`.
   *
   * For `sign` commands we mirror the real AppStateProvider and record the
   * captured `request_id → message_hex_32` mapping into `signDispatchLog`
   * so the SigningFailedModal can correlate a later `OperationFailure`
   * back to its originating message (see VAL-OPS-007).
   */
  const handleRuntimeCommand: AppStateValue["handleRuntimeCommand"] =
    useCallback(
      async (cmd: RuntimeCommand) => {
        const result = await value.handleRuntimeCommand(cmd);
        if (result.requestId && cmd.type === "sign") {
          const requestId = result.requestId;
          const messageHex = cmd.message_hex_32;
          setSignDispatchLog((prev) =>
            prev[requestId] === messageHex
              ? prev
              : { ...prev, [requestId]: messageHex },
          );
        }
        // Mirror AppStateProvider's lifecycle-log append so validators
        // and the Sign Activity UI observe the dispatched -> pending step
        // even under the MockAppStateProvider path used by demo gallery
        // scenarios and Vitest component tests.
        if (result.requestId) {
          const requestId = result.requestId;
          const opType = lifecycleOpTypeForCmd(cmd);
          if (opType) {
            const now = Date.now();
            const preview = lifecyclePreviewForCmd(cmd);
            const entry: SignLifecycleEntry = {
              request_id: requestId,
              op_type: opType,
              message_preview: preview,
              status: "pending",
              dispatched_at: now,
              pending_at: now,
              completed_at: null,
              failed_at: null,
              failure_reason: null,
            };
            setSignLifecycleLog((prev) => {
              if (prev.some((existing) => existing.request_id === requestId)) {
                return prev;
              }
              return [...prev, entry];
            });
          }
        }
        return result;
      },
      [value],
    );

  const stateful = useMemo<AppStateValue>(
    () => ({
      ...value,
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
      signLifecycleLog,
      pendingDispatchIndex,
      peerDenialQueue,
      enqueuePeerDenial,
      resolvePeerDenial,
      policyOverrides,
      removePolicyOverride,
      setPeerPolicyOverride,
      handleRuntimeCommand,
      createKeyset,
      createProfile,
      updatePackageState,
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
      restartRuntimeConnections,
    }),
    [
      value,
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
      signLifecycleLog,
      pendingDispatchIndex,
      peerDenialQueue,
      enqueuePeerDenial,
      resolvePeerDenial,
      policyOverrides,
      removePolicyOverride,
      setPeerPolicyOverride,
      handleRuntimeCommand,
      createKeyset,
      createProfile,
      updatePackageState,
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
      restartRuntimeConnections,
    ],
  );

  useEffect(() => {
    if (!bridge) return;
    writeBridgeSnapshot(snapshotFromAppState(stateful));
  }, [stateful, bridge]);

  return (
    <AppStateContext.Provider value={stateful}>
      {children}
    </AppStateContext.Provider>
  );
}

/**
 * Map a RuntimeCommand to a lifecycle op_type. Mirrors the helper in
 * AppStateProvider so the mock path produces identical lifecycle entries
 * under demo / test usage.
 */
function lifecycleOpTypeForCmd(
  cmd: RuntimeCommand,
): "sign" | "ecdh" | "ping" | null {
  switch (cmd.type) {
    case "sign":
      return "sign";
    case "ecdh":
      return "ecdh";
    case "ping":
    case "refresh_peer":
      return "ping";
    case "refresh_all_peers":
    case "onboard":
      return null;
  }
}

/** First 10 hex chars of the sign message or peer pubkey. */
function lifecyclePreviewForCmd(cmd: RuntimeCommand): string | null {
  switch (cmd.type) {
    case "sign":
      return cmd.message_hex_32.slice(0, 10).toLowerCase();
    case "ecdh":
      return cmd.pubkey32_hex.slice(0, 10).toLowerCase();
    case "ping":
    case "refresh_peer":
      return cmd.peer_pubkey32_hex.slice(0, 10).toLowerCase();
    case "refresh_all_peers":
    case "onboard":
      return null;
  }
}


