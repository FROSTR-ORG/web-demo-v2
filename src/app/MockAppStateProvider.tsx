import {
  useCallback,
  useEffect,
  useMemo,
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
   */
  const handleRuntimeCommand: AppStateValue["handleRuntimeCommand"] =
    useCallback((cmd: RuntimeCommand) => value.handleRuntimeCommand(cmd), [
      value,
    ]);

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


