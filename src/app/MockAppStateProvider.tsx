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
import { PROFILE_NAME_MAX_LENGTH } from "./AppStateTypes";

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
  // fix-m7-scrutiny-r1-sponsor-concurrency-and-badge — Map-based
  // sessions state mirroring the real provider. The single-slot
  // `onboardSponsorSession` remains as a derived convenience view on
  // the active request_id for backward compat.
  const [onboardSponsorSessions, setOnboardSponsorSessions] = useState<
    Record<string, import("./AppStateTypes").OnboardSponsorSession>
  >(() => {
    if (
      value.onboardSponsorSessions &&
      Object.keys(value.onboardSponsorSessions).length > 0
    ) {
      return value.onboardSponsorSessions;
    }
    if (!value.onboardSponsorSession) return {};
    const key =
      value.activeOnboardSponsorRequestId ??
      value.onboardSponsorSession.requestId ??
      "local-mock-active";
    return { [key]: value.onboardSponsorSession };
  });
  const [
    activeOnboardSponsorRequestId,
    setActiveOnboardSponsorRequestId,
  ] = useState<string | null>(() => {
    // Prefer an explicit activeOnboardSponsorRequestId from the
    // fixture value; fall back to promoting the single-slot
    // `onboardSponsorSession` to the active entry so legacy test
    // fixtures (which only set the single-slot field) keep
    // surfacing the session through the derived convenience field.
    if (
      value.activeOnboardSponsorRequestId !== undefined &&
      value.activeOnboardSponsorRequestId !== null
    ) {
      return value.activeOnboardSponsorRequestId;
    }
    if (!value.onboardSponsorSession) return null;
    return (
      value.onboardSponsorSession.requestId ?? "local-mock-active"
    );
  });
  const onboardSponsorSession = useMemo(
    () =>
      activeOnboardSponsorRequestId !== null
        ? onboardSponsorSessions[activeOnboardSponsorRequestId] ?? null
        : null,
    [activeOnboardSponsorRequestId, onboardSponsorSessions],
  );
  const [runtimeCompletions, setRuntimeCompletions] = useState(
    value.runtimeCompletions ?? [],
  );
  const [runtimeFailures, setRuntimeFailures] = useState(
    value.runtimeFailures ?? [],
  );
  const [lifecycleEvents, setLifecycleEvents] = useState(
    value.lifecycleEvents ?? [],
  );
  const [runtimeEventLog, setRuntimeEventLog] = useState<
    import("./AppStateTypes").RuntimeEventLogEntry[]
  >(value.runtimeEventLog ?? []);
  const clearRuntimeEventLog = useCallback(() => {
    setRuntimeEventLog([]);
  }, []);
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
  const rotateSessionPackageSecretsRef = useRef<
    Map<number, { packageText: string; password: string }>
  >(new Map());

  useEffect(() => {
    if (rotateKeysetSession === null) {
      rotateSessionPackageSecretsRef.current = new Map();
    }
  }, [rotateKeysetSession]);

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

  /**
   * Forward matrix-wide override clears to the caller-supplied
   * implementation (tests seed a spy here) before pruning the mock's
   * own `policyOverrides` copy so the parent can observe the dispatch
   * (VAL-POLICIES-009).
   */
  const clearPolicyOverrides = useCallback(async () => {
    await value.clearPolicyOverrides();
    setPolicyOverrides([]);
  }, [value]);

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

  const setPackageDeviceLabel = useCallback(
    (idx: number, deviceLabel: string) => {
      value.setPackageDeviceLabel(idx, deviceLabel);
      setCreateSession((session) => {
        if (!session) {
          return session;
        }
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) =>
            entry.idx === idx ? { ...entry, deviceLabel } : entry,
          ),
        };
      });
    },
    [value],
  );

  // fix-followup-distribute-2a — mirror encodeDistributionPackage
  // so screens driven by MockAppStateProvider (demo gallery, component
  // tests) see the same packageCreated flip + redacted-preview path.
  // Delegates to the seeded implementation (tests typically inject a
  // spy via `value.encodeDistributionPackage`) then mutates the local
  // createSession mirror so UI state stays consistent.
  const encodeDistributionPackage = useCallback(
    async (idx: number, password: string) => {
      await value.encodeDistributionPackage(idx, password);
      setCreateSession((session) => {
        if (!session) return session;
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) => {
            if (entry.idx !== idx) return entry;
            // Best-effort preview: if the caller-supplied seed
            // implementation populated a packageText on its own
            // createSession we mirror that; otherwise we fall back to
            // a stable placeholder so tests that inspect the preview
            // observe a non-empty value.
            const seedEntry = value.createSession?.onboardingPackages.find(
              (candidate) => candidate.idx === idx,
            );
            const preview =
              seedEntry && seedEntry.packageText.length > 0
                ? seedEntry.packageText
                : "bfonboard1mock-preview";
            return {
              ...entry,
              packageText: preview,
              password: "[redacted]",
              packageCreated: true,
            };
          }),
        };
      });
    },
    [value],
  );

  const retryDistributionPackageAdoption = useCallback(
    async (idx: number) => {
      await value.retryDistributionPackageAdoption(idx);
      const retryRequestId = `mock-retry-${idx}-${Date.now()}-${Math.random()}`;
      setCreateSession((session) => {
        if (!session) return session;
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) =>
            entry.idx === idx
              ? {
                  ...entry,
                  pendingDispatchRequestId: retryRequestId,
                  adoptionError: undefined,
                }
              : entry,
          ),
        };
      });
    },
    [value],
  );

  // fix-followup-distribute-2a — mirror markPackageDistributed so
  // screens driven by MockAppStateProvider see the chip flip to
  // "Distributed" immediately.
  const markPackageDistributed = useCallback(
    (idx: number) => {
      value.markPackageDistributed(idx);
      setCreateSession((session) => {
        if (!session) return session;
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) =>
            entry.idx === idx
              ? {
                  ...entry,
                  manuallyMarkedDistributed: true,
                  pendingDispatchRequestId: undefined,
                  adoptionError: undefined,
                }
              : entry,
          ),
        };
      });
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

  // m7-onboard-sponsor — delegate to the seeded mutator (tests typically
  // inject a spy via `value.createOnboardSponsorPackage`) but mirror the
  // generated session locally so UI rendering follows the real
  // AppStateProvider contract.
  //
  // fix-m7-scrutiny-r1-sponsor-concurrency-and-badge — store the
  // session in the Map keyed by a fresh sentinel request_id (the
  // underlying mock mutator doesn't return a real runtime request_id)
  // and update activeRequestId so the UI focuses the latest dispatch.
  const createOnboardSponsorPackage = useCallback(
    async (input: Parameters<AppStateValue["createOnboardSponsorPackage"]>[0]) => {
      const packageText = await value.createOnboardSponsorPackage(input);
      const sentinelKey = `local-mock-${Date.now()}-${Math.floor(
        Math.random() * 1_000_000,
      )}`;
      setOnboardSponsorSessions((previous) => ({
        ...previous,
        [sentinelKey]: {
          deviceLabel: input.deviceLabel.trim(),
          packageText,
          relays: input.relays,
          createdAt: Date.now(),
          requestId: null,
          status: "awaiting_adoption",
        },
      }));
      setActiveOnboardSponsorRequestId(sentinelKey);
      return packageText;
    },
    [value],
  );

  const clearOnboardSponsorSession = useCallback(
    (requestId?: string) => {
      value.clearOnboardSponsorSession(requestId);
      const targetKey = requestId ?? activeOnboardSponsorRequestId;
      if (targetKey === null) return;
      setOnboardSponsorSessions((previous) => {
        if (!(targetKey in previous)) return previous;
        const next = { ...previous };
        delete next[targetKey];
        return next;
      });
      if (targetKey === activeOnboardSponsorRequestId) {
        setActiveOnboardSponsorRequestId(null);
      }
    },
    [value, activeOnboardSponsorRequestId],
  );

  const validateRotateKeysetSources: AppStateValue["validateRotateKeysetSources"] =
    useCallback(
      async (input) => {
        await value.validateRotateKeysetSources(input);
        rotateSessionPackageSecretsRef.current = new Map();
        if (value.rotateKeysetSession) {
          setRotateKeysetSession(value.rotateKeysetSession);
        }
      },
      [value],
    );

  const generateRotatedKeyset = useCallback(
    async () => {
      await value.generateRotatedKeyset();
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
        value.rotateKeysetSession ??
        (session
          ? {
              ...session,
              createdProfileId: profileId,
              phase:
                session.phase === "distribution_ready"
                  ? "distribution_ready"
                  : "profile_created",
            }
          : session),
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

  const encodeRotateDistributionPackage = useCallback(
    async (idx: number, password: string) => {
      await value.encodeRotateDistributionPackage(idx, password);
      const seedEntry = value.rotateKeysetSession?.onboardingPackages.find(
        (candidate) => candidate.idx === idx,
      );
      const packageText =
        seedEntry && seedEntry.packageText.length > 0
          ? seedEntry.packageText
          : `bfonboard1mock-rotate-${idx}`;
      rotateSessionPackageSecretsRef.current = new Map(
        rotateSessionPackageSecretsRef.current,
      ).set(idx, { packageText, password });
      setRotateKeysetSession((session) => {
        if (!session) return session;
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) =>
            entry.idx === idx
              ? {
                  ...entry,
                  packageText:
                    seedEntry && seedEntry.packageText.length > 0
                      ? seedEntry.packageText
                      : "bfonboard1mock-preview",
                  password: "[redacted]",
                  packageCreated: true,
                }
              : entry,
          ),
        };
      });
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
        return {
          ...session,
          phase:
            allPackagesDistributed(onboardingPackages) && session.createdProfileId
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

  const markRotatePackageDistributed = useCallback(
    (idx: number) => {
      value.markRotatePackageDistributed(idx);
      setRotateKeysetSession((session) => {
        if (!session) return session;
        const onboardingPackages = session.onboardingPackages.map((entry) =>
          entry.idx === idx
            ? { ...entry, manuallyMarkedDistributed: true }
            : entry,
        );
        return {
          ...session,
          phase:
            allPackagesDistributed(onboardingPackages) && session.createdProfileId
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

  const getRotateSessionPackageSecret = useCallback(
    (idx: number): { packageText: string; password: string } | null => {
      const entry = rotateSessionPackageSecretsRef.current.get(idx);
      if (!entry) return null;
      return { packageText: entry.packageText, password: entry.password };
    },
    [],
  );

  const finishRotateDistribution = useCallback(async () => {
    const profileId = await value.finishRotateDistribution();
    rotateSessionPackageSecretsRef.current = new Map();
    setRotateKeysetSession(null);
    return profileId;
  }, [value]);

  const clearRotateKeysetSession = useCallback(() => {
    value.clearRotateKeysetSession();
    rotateSessionPackageSecretsRef.current = new Map();
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

  /**
   * Mock-side `updateProfileName`: mirrors the real AppStateProvider
   * contract so the Settings sidebar wired against MockAppStateProvider
   * sees the same validation and active-profile update (VAL-SETTINGS-001 /
   * 002 / 024 / 025, VAL-CROSS-004). Empty / whitespace-only / oversize
   * names are rejected at this layer, matching the real mutator. The
   * caller-supplied `value.updateProfileName` is invoked AFTER local
   * validation and BEFORE the local `activeProfile` state is mutated so
   * fixtures can observe or override the dispatch.
   */
  const updateProfileName = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        throw new Error("Profile name cannot be empty.");
      }
      if (trimmed.length > PROFILE_NAME_MAX_LENGTH) {
        throw new Error(
          `Profile name must be at most ${PROFILE_NAME_MAX_LENGTH} characters.`,
        );
      }
      await value.updateProfileName(trimmed);
      setActiveProfile((previous) =>
        previous ? { ...previous, deviceName: trimmed } : previous,
      );
    },
    [value],
  );

  /**
   * Mock-side `updateRelays`: mirrors AppStateProvider validation so
   * demo + test paths see the same rejections (VAL-SETTINGS-004 /
   * VAL-SETTINGS-023). On success the caller-supplied
   * `value.updateRelays` is invoked, then the local `activeProfile`
   * mirror is updated so every surface reading it reflects the new
   * list without waiting for a parent re-render.
   */
  const updateRelays = useCallback(
    async (relays: string[]) => {
      const { normalizeRelayList } = await import("../lib/relay/relayUrl");
      const { RELAY_EMPTY_ERROR } = await import("./AppStateTypes");
      const normalized = normalizeRelayList(relays, {
        onDuplicate: "throw",
      });
      if (normalized.length === 0) {
        throw new Error(RELAY_EMPTY_ERROR);
      }
      await value.updateRelays(normalized);
      setActiveProfile((previous) =>
        previous ? { ...previous, relays: normalized } : previous,
      );
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
    // Match real AppStateProvider semantics (VAL-EVENTLOG-016): flush the
    // dashboard event-log ring buffer so no stale rows bleed across a
    // lock/unlock cycle in demo / mock-backed flows.
    setRuntimeEventLog([]);
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
    // Match real AppStateProvider semantics (VAL-EVENTLOG-016): flush the
    // dashboard event-log ring buffer so no stale rows bleed across a
    // clear-credentials reset in demo / mock-backed flows.
    setRuntimeEventLog([]);
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

  const publishProfileBackup = useCallback(
    (password: string) => value.publishProfileBackup(password),
    [value],
  );

  const restoreProfileFromRelay = useCallback(
    (input: Parameters<AppStateValue["restoreProfileFromRelay"]>[0]) =>
      value.restoreProfileFromRelay(input),
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
      onboardSponsorSession,
      onboardSponsorSessions,
      activeOnboardSponsorRequestId,
      runtimeCompletions,
      runtimeFailures,
      lifecycleEvents,
      runtimeEventLog,
      signDispatchLog,
      signLifecycleLog,
      pendingDispatchIndex,
      peerDenialQueue,
      enqueuePeerDenial,
      resolvePeerDenial,
      policyOverrides,
      removePolicyOverride,
      setPeerPolicyOverride,
      clearPolicyOverrides,
      clearRuntimeEventLog,
      handleRuntimeCommand,
      createKeyset,
      createProfile,
      updatePackageState,
      setPackageDeviceLabel,
      encodeDistributionPackage,
      retryDistributionPackageAdoption,
      markPackageDistributed,
      clearCreateSession,
      beginImport,
      decryptImportBackup,
      saveImportedProfile,
      clearImportSession,
      decodeOnboardPackage,
      startOnboardHandshake,
      saveOnboardedProfile,
      clearOnboardSession,
      createOnboardSponsorPackage,
      clearOnboardSponsorSession,
      validateRotateKeysetSources,
      generateRotatedKeyset,
      createRotatedProfile,
      encodeRotateDistributionPackage,
      updateRotatePackageState,
      markRotatePackageDistributed,
      finishRotateDistribution,
      getRotateSessionPackageSecret,
      clearRotateKeysetSession,
      decodeReplaceSharePackage,
      applyReplaceShareUpdate,
      clearReplaceShareSession,
      validateRecoverSources,
      recoverNsec,
      clearRecoverSession,
      expireRecoveredNsec,
      unlockProfile,
      updateProfileName,
      updateRelays,
      changeProfilePassword,
      lockProfile,
      clearCredentials,
      exportRuntimePackages,
      createProfileBackup,
      publishProfileBackup,
      restoreProfileFromRelay,
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
      onboardSponsorSession,
      onboardSponsorSessions,
      activeOnboardSponsorRequestId,
      runtimeCompletions,
      runtimeFailures,
      lifecycleEvents,
      runtimeEventLog,
      signDispatchLog,
      signLifecycleLog,
      pendingDispatchIndex,
      peerDenialQueue,
      enqueuePeerDenial,
      resolvePeerDenial,
      policyOverrides,
      removePolicyOverride,
      setPeerPolicyOverride,
      clearPolicyOverrides,
      clearRuntimeEventLog,
      handleRuntimeCommand,
      createKeyset,
      createProfile,
      updatePackageState,
      setPackageDeviceLabel,
      encodeDistributionPackage,
      retryDistributionPackageAdoption,
      markPackageDistributed,
      clearCreateSession,
      beginImport,
      decryptImportBackup,
      saveImportedProfile,
      clearImportSession,
      decodeOnboardPackage,
      startOnboardHandshake,
      saveOnboardedProfile,
      clearOnboardSession,
      createOnboardSponsorPackage,
      clearOnboardSponsorSession,
      validateRotateKeysetSources,
      generateRotatedKeyset,
      createRotatedProfile,
      encodeRotateDistributionPackage,
      updateRotatePackageState,
      markRotatePackageDistributed,
      finishRotateDistribution,
      getRotateSessionPackageSecret,
      clearRotateKeysetSession,
      decodeReplaceSharePackage,
      applyReplaceShareUpdate,
      clearReplaceShareSession,
      validateRecoverSources,
      recoverNsec,
      clearRecoverSession,
      expireRecoveredNsec,
      unlockProfile,
      updateProfileName,
      updateRelays,
      changeProfilePassword,
      lockProfile,
      clearCredentials,
      exportRuntimePackages,
      createProfileBackup,
      publishProfileBackup,
      restoreProfileFromRelay,
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
