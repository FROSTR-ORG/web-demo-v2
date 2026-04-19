import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { memberForShare, memberPubkeyXOnly, packagePasswordForShare, runtimeBootstrapFromParts } from "../lib/bifrost/format";
import {
  createKeysetBundle,
  createProfilePackagePair,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
  encodeOnboardPackage,
  onboardPayloadForRemoteShare,
  profilePayloadForShare
} from "../lib/bifrost/packageService";
import { RuntimeClient } from "../lib/bifrost/runtimeClient";
import type {
  KeysetBundle,
  OnboardingPackageView,
  RuntimeStatusSummary,
  SharePackageWire,
  StoredProfileRecord,
  StoredProfileSummary
} from "../lib/bifrost/types";
import { LocalRuntimeSimulator } from "../lib/relay/localSimulator";
import { getProfile, listProfiles, removeProfile, saveProfile, touchProfile } from "../lib/storage/profileStore";

export interface CreateDraft {
  groupName: string;
  threshold: number;
  count: number;
}

export interface ProfileDraft {
  deviceName: string;
  password: string;
  confirmPassword: string;
  relays: string[];
}

interface CreateSession {
  draft: CreateDraft;
  keyset?: KeysetBundle;
  localShare?: SharePackageWire;
  onboardingPackages: OnboardingPackageView[];
  createdProfileId?: string;
}

interface AppStateValue {
  profiles: StoredProfileSummary[];
  activeProfile: StoredProfileSummary | null;
  runtimeStatus: RuntimeStatusSummary | null;
  signerPaused: boolean;
  createSession: CreateSession | null;
  reloadProfiles: () => Promise<void>;
  createKeyset: (draft: CreateDraft) => Promise<void>;
  createProfile: (draft: ProfileDraft) => Promise<string>;
  updatePackageState: (idx: number, patch: Partial<Pick<OnboardingPackageView, "copied" | "qrShown">>) => void;
  finishDistribution: () => Promise<string>;
  unlockProfile: (id: string, password: string) => Promise<void>;
  lockProfile: () => void;
  clearCredentials: () => Promise<void>;
  setSignerPaused: (paused: boolean) => void;
  refreshRuntime: () => void;
}

const DEFAULT_RELAYS = ["wss://relay.primal.net", "wss://relay.damus.io"];

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<StoredProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<StoredProfileSummary | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusSummary | null>(null);
  const [signerPaused, setSignerPausedState] = useState(false);
  const [createSession, setCreateSession] = useState<CreateSession | null>(null);
  const runtimeRef = useRef<RuntimeClient | null>(null);
  const simulatorRef = useRef<LocalRuntimeSimulator | null>(null);

  const reloadProfiles = useCallback(async () => {
    setProfiles(await listProfiles());
  }, []);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const setRuntime = useCallback((runtime: RuntimeClient, simulator?: LocalRuntimeSimulator) => {
    runtimeRef.current = runtime;
    simulatorRef.current = simulator ?? null;
    setRuntimeStatus(runtime.runtimeStatus());
  }, []);

  const createKeyset = useCallback(async (draft: CreateDraft) => {
    const groupName = draft.groupName.trim();
    if (!groupName) {
      throw new Error("Keyset name is required.");
    }
    if (draft.threshold < 2) {
      throw new Error("Threshold must be at least 2.");
    }
    if (draft.count < 3) {
      throw new Error("Total shares must be at least 3.");
    }
    if (draft.threshold > draft.count) {
      throw new Error("Threshold cannot exceed total shares.");
    }

    const keyset = await createKeysetBundle({ ...draft, groupName });
    const localShare = keyset.shares[0];
    setCreateSession({
      draft: { ...draft, groupName },
      keyset,
      localShare,
      onboardingPackages: []
    });
  }, []);

  const createProfile = useCallback(
    async (draft: ProfileDraft) => {
      if (!createSession?.keyset || !createSession.localShare) {
        throw new Error("Create a keyset before creating a profile.");
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

      const { group } = createSession.keyset;
      const localShare = createSession.localShare;
      const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);
      const payload = profilePayloadForShare({
        profileId,
        deviceName,
        share: localShare,
        group,
        relays
      });
      const pair = await createProfilePackagePair(payload, draft.password);
      const createdAt = Date.now();
      const record: StoredProfileRecord = {
        summary: {
          id: profileId,
          label: createSession.draft.groupName,
          deviceName,
          groupName: group.group_name,
          threshold: group.threshold,
          memberCount: group.members.length,
          localShareIdx: localShare.idx,
          groupPublicKey: group.group_pk,
          relays,
          createdAt,
          lastUsedAt: createdAt
        },
        encryptedProfilePackage: pair.profile_string
      };
      await saveProfile(record);

      const localMember = memberForShare(group, localShare);
      const remoteShares = createSession.keyset.shares.filter((share) => share.idx !== localShare.idx);
      const onboardingPackages = await Promise.all(
        remoteShares.map(async (remoteShare) => {
          const password = packagePasswordForShare(group.group_name, remoteShare.idx);
          const payload = onboardPayloadForRemoteShare({ remoteShare, localShare, group, relays });
          const packageText = await encodeOnboardPackage(payload, password);
          return {
            idx: remoteShare.idx,
            memberPubkey: memberPubkeyXOnly(memberForShare(group, remoteShare)),
            packageText,
            password,
            copied: false,
            qrShown: false
          };
        })
      );

      const runtime = new RuntimeClient();
      await runtime.init({}, runtimeBootstrapFromParts(group, localShare));
      const simulator = new LocalRuntimeSimulator(runtime);
      await simulator.attachVirtualPeers({ group, localShare, remoteShares });
      simulator.start();
      simulator.refreshAll();
      setRuntimeStatus(simulator.pump(4));
      runtimeRef.current = runtime;
      simulatorRef.current = simulator;
      setActiveProfile(record.summary);
      setSignerPausedState(false);
      setCreateSession({
        ...createSession,
        createdProfileId: profileId,
        onboardingPackages
      });
      await reloadProfiles();

      void localMember;
      return profileId;
    },
    [createSession, reloadProfiles]
  );

  const updatePackageState = useCallback(
    (idx: number, patch: Partial<Pick<OnboardingPackageView, "copied" | "qrShown">>) => {
      setCreateSession((session) => {
        if (!session) {
          return session;
        }
        return {
          ...session,
          onboardingPackages: session.onboardingPackages.map((entry) => (entry.idx === idx ? { ...entry, ...patch } : entry))
        };
      });
    },
    []
  );

  const finishDistribution = useCallback(async () => {
    if (!createSession?.createdProfileId) {
      throw new Error("No created profile is available.");
    }
    return createSession.createdProfileId;
  }, [createSession]);

  const unlockProfile = useCallback(
    async (id: string, password: string) => {
      const record = await getProfile(id);
      if (!record) {
        throw new Error("Profile was not found.");
      }
      const payload = await decodeProfilePackage(record.encryptedProfilePackage, password);
      const runtime = new RuntimeClient();
      await runtime.init(
        {},
        runtimeBootstrapFromParts(payload.group_package, {
          idx: record.summary.localShareIdx,
          seckey: payload.device.share_secret
        })
      );
      await touchProfile(id);
      setRuntime(runtime);
      setActiveProfile({ ...record.summary, lastUsedAt: Date.now() });
      setSignerPausedState(false);
      await reloadProfiles();
    },
    [reloadProfiles, setRuntime]
  );

  const lockProfile = useCallback(() => {
    runtimeRef.current = null;
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
  }, []);

  const clearCredentials = useCallback(async () => {
    const id = activeProfile?.id;
    runtimeRef.current = null;
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    if (id) {
      await removeProfile(id);
    }
    await reloadProfiles();
  }, [activeProfile, reloadProfiles]);

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
    const timer = window.setInterval(refreshRuntime, 2500);
    return () => window.clearInterval(timer);
  }, [refreshRuntime]);

  const value = useMemo<AppStateValue>(
    () => ({
      profiles,
      activeProfile,
      runtimeStatus,
      signerPaused,
      createSession,
      reloadProfiles,
      createKeyset,
      createProfile,
      updatePackageState,
      finishDistribution,
      unlockProfile,
      lockProfile,
      clearCredentials,
      setSignerPaused,
      refreshRuntime
    }),
    [
      profiles,
      activeProfile,
      runtimeStatus,
      signerPaused,
      createSession,
      reloadProfiles,
      createKeyset,
      createProfile,
      updatePackageState,
      finishDistribution,
      unlockProfile,
      lockProfile,
      clearCredentials,
      setSignerPaused,
      refreshRuntime
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return value;
}

export function defaultProfileDraft(): ProfileDraft {
  return {
    deviceName: "Igloo Web",
    password: "",
    confirmPassword: "",
    relays: DEFAULT_RELAYS
  };
}

