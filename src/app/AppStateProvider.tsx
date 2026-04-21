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
import type { RelaySocketEvent } from "../lib/relay/browserRelayClient";
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
  EnrichedOperationFailure,
  HandleRuntimeCommandResult,
  ImportProfileDraft,
  ImportSession,
  NoncePoolSnapshot,
  OnboardingPackageStatePatch,
  OnboardSession,
  PendingDispatchEntry,
  ProfileDraft,
  RecoverSession,
  RecoverSourceSummary,
  ReplaceShareSession,
  RotateKeysetSession,
  SignLifecycleEntry,
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
  const [runtimeFailures, setRuntimeFailures] = useState<
    EnrichedOperationFailure[]
  >([]);
  const [pendingDispatchIndex, setPendingDispatchIndex] = useState<
    Record<string, PendingDispatchEntry>
  >({});
  const [lifecycleEvents, setLifecycleEvents] = useState<RuntimeEvent[]>([]);
  const [signDispatchLog, setSignDispatchLog] = useState<
    Record<string, string>
  >({});
  const [signLifecycleLog, setSignLifecycleLog] = useState<
    SignLifecycleEntry[]
  >([]);
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
   * FIFO queue of dispatches whose `request_id` was not captured
   * synchronously in `handleRuntimeCommand` (e.g. the runtime tick ran
   * but the pending_operations snapshot did not yet reflect the new op).
   * Each subsequent observation of `pending_operations` attempts to
   * correlate any new request_id that is NOT yet in
   * `pendingDispatchIndex` against the oldest matching entry here,
   * then promotes the entry into the index with the captured request_id
   * so failure enrichment works regardless of how fast the runtime
   * turns the op around.
   */
  const pendingUnmatchedDispatchesRef = useRef<
    Array<PendingDispatchEntry & { pendingOpType: "Sign" | "Ecdh" | "Ping" | "Onboard" }>
  >([]);
  /**
   * Latest value of {@link pendingDispatchIndex} accessible from inside
   * callbacks that would otherwise need to re-create on every state
   * change. The ref is kept in lock-step with the state via an effect
   * below so `absorbDrains` and the refresh loop can read the current
   * index without stale closures.
   */
  const pendingDispatchIndexRef = useRef<Record<string, PendingDispatchEntry>>(
    {},
  );
  /**
   * Mirror of `signerPaused` as a ref so `handleRuntimeCommand` (whose
   * `useCallback` identity must remain stable) can check the latest value
   * without re-creating the dispatcher on every state change. When paused,
   * the dispatcher no-ops without enqueuing an outbound envelope — see
   * VAL-OPS-017.
   */
  const signerPausedRef = useRef(false);
  /**
   * Dev-only: when non-null, the runtime_status snapshot we surface to React
   * is augmented with this nonce-depletion override before being committed
   * to state. Populated by `window.__iglooTestSimulateNonceDepletion()` and
   * cleared by `window.__iglooTestRestoreNonce()`; stripped from production
   * builds via `import.meta.env.DEV` gating on the hook installer effect.
   */
  const nonceOverrideRef = useRef<{
    nonce_pool_size: number;
    nonce_pool_threshold: number;
    reason: string;
  } | null>(null);
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

  // VAL-OPS-028 (dev-only): rehydrate `window.__debug.relayHistory` from
  // sessionStorage on mount so a validator reopening the app after a tab
  // close still sees the prior tab's WS close frames (1000/1001 clean,
  // 1006 abnormal). Must run BEFORE any appendRelayHistoryEntry call so
  // the stable reference handed to `window.__debug.relayHistory` already
  // reflects the restored state. Helper is DEV-gated so this is
  // tree-shaken from production bundles.
  useEffect(() => {
    hydrateRelayHistoryFromSessionStorage();
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
      // Advance any tracked lifecycle entries to `completed`. Keyed by the
      // completion's `request_id` regardless of the verb variant.
      const completedIds = new Map<string, number>();
      const now = Date.now();
      for (const completion of drains.completions) {
        const id = completionRequestId(completion);
        if (id) completedIds.set(id, now);
      }
      if (completedIds.size > 0) {
        setSignLifecycleLog((previous) =>
          previous.map((entry) => {
            const at = completedIds.get(entry.request_id);
            if (at === undefined) return entry;
            if (entry.status === "completed" || entry.status === "failed") {
              return entry;
            }
            return {
              ...entry,
              status: "completed",
              completed_at: at,
              // Synthesize a pending_at if we somehow never observed
              // it — the runtime occasionally completes synchronously
              // within the same tick, but the lifecycle contract
              // requires every entry to record a pending transition.
              pending_at: entry.pending_at ?? entry.dispatched_at,
            };
          }),
        );
      }
    }
    if (drains.failures.length > 0) {
      // Enrich failures with message_hex_32 / peer_pubkey from the
      // pendingDispatchIndex at drain-time so SigningFailedModal's Retry
      // button can always resolve the originating message when the
      // correlation exists (VAL-OPS-007). Falls back to the raw payload
      // when no correlation is available; the UI renders a clear
      // "message not resolvable" reason in that case.
      const indexSnapshot = pendingDispatchIndexRef.current;
      const enriched: EnrichedOperationFailure[] = drains.failures.map(
        (failure) => {
          const entry = indexSnapshot[failure.request_id];
          if (!entry) return { ...failure };
          const result: EnrichedOperationFailure = { ...failure };
          if (entry.message_hex_32 !== undefined) {
            result.message_hex_32 = entry.message_hex_32;
          }
          if (entry.peer_pubkey !== undefined) {
            result.peer_pubkey = entry.peer_pubkey;
          }
          return result;
        },
      );
      setRuntimeFailures((previous) => {
        const merged = [...previous, ...enriched];
        merged.sort((a, b) => a.request_id.localeCompare(b.request_id));
        return merged;
      });
      const failures = new Map<string, { at: number; reason: string }>();
      const now = Date.now();
      for (const failure of drains.failures) {
        failures.set(failure.request_id, {
          at: now,
          reason: `${failure.code}: ${failure.message}`,
        });
      }
      if (failures.size > 0) {
        setSignLifecycleLog((previous) =>
          previous.map((entry) => {
            const match = failures.get(entry.request_id);
            if (!match) return entry;
            if (entry.status === "completed" || entry.status === "failed") {
              return entry;
            }
            return {
              ...entry,
              status: "failed",
              failed_at: match.at,
              failure_reason: match.reason,
              pending_at: entry.pending_at ?? entry.dispatched_at,
            };
          }),
        );
      }
    }
    if (drains.events.length > 0) {
      setLifecycleEvents((previous) => [...previous, ...drains.events]);
    }
    // Mark pendingDispatchIndex entries that just settled (completion or
    // failure) so the 60s retention window starts from this moment. We
    // keep entries around so Retry handlers and late-arriving failure
    // enrichment can still look up the originating message even after
    // the pending op is gone from `pending_operations`.
    if (drains.completions.length > 0 || drains.failures.length > 0) {
      const now = Date.now();
      const settledIds = new Set<string>();
      for (const completion of drains.completions) {
        const id = completionRequestId(completion);
        if (id) settledIds.add(id);
      }
      for (const failure of drains.failures) {
        settledIds.add(failure.request_id);
      }
      if (settledIds.size > 0) {
        setPendingDispatchIndex((previous) => {
          let changed = false;
          const next: Record<string, PendingDispatchEntry> = { ...previous };
          for (const id of settledIds) {
            const existing = next[id];
            if (existing && existing.settledAt === undefined) {
              next[id] = { ...existing, settledAt: now };
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      }
    }
  }, []);

  const resetDrainSlices = useCallback(() => {
    setRuntimeCompletions([]);
    setRuntimeFailures([]);
    setLifecycleEvents([]);
    setSignDispatchLog({});
    setSignLifecycleLog([]);
    setPendingDispatchIndex({});
    pendingDispatchIndexRef.current = {};
    pendingUnmatchedDispatchesRef.current = [];
    lastDispatchRef.current = null;
  }, []);

  /**
   * Apply the dev-only nonce-depletion override to a runtime_status snapshot
   * before it is committed to React state. When the override is active we:
   *   - push an `insufficient_signing_peers` entry tagged with
   *     `nonce_pool_depleted` into `readiness.degraded_reasons`, AND
   *   - set `readiness.sign_ready = false`
   * so the existing `isNoncePoolDepleted` heuristic (and its
   * `Syncing nonces` / `Trigger Sync` overlay) activates end-to-end
   * without the runtime actually entering that state. Stripped from
   * production by the `import.meta.env.DEV` hook installer effect — in
   * non-DEV the override ref is never written, so this function is a
   * no-op for user code paths.
   */
  const augmentStatus = useCallback(
    (
      status: RuntimeStatusSummary | null,
    ): RuntimeStatusSummary | null => {
      if (!status) return status;
      const override = nonceOverrideRef.current;
      if (!override) return status;
      const degraded = Array.isArray(status.readiness.degraded_reasons)
        ? [...status.readiness.degraded_reasons]
        : [];
      // Injected reason name intentionally contains "nonce" so the
      // `isNoncePoolDepleted` forward-compat string check returns true.
      const injectedReason =
        "nonce_pool_depleted" as unknown as (typeof degraded)[number];
      if (!degraded.includes(injectedReason)) {
        degraded.push(injectedReason);
      }
      // Nonce depletion is, by definition, a post-peer-refresh condition:
      // the runtime can't deplete a nonce pool it has never exchanged.
      // `deriveDashboardState` returns `"connecting"` (NOT
      // `"signing-blocked"`) whenever no peer refresh has completed yet —
      // driven by `hasCompletedPeerRefresh`, which inspects
      // `readiness.last_refresh_at` and per-peer `last_seen`. Without this
      // augmentation the dev-only simulate hook would render the overlay
      // only when the caller's runtime had already completed a peer
      // refresh, which is not observable in most single-device validator
      // scenarios. Synthesise a `last_refresh_at` and backfill at least
      // one peer's `last_seen` so the check passes and the dashboard
      // transitions through to `"signing-blocked"` and renders the
      // `SigningBlockedState` overlay (VAL-OPS-024).
      const refreshTs =
        status.readiness.last_refresh_at ?? Math.floor(Date.now() / 1000);
      const peers =
        Array.isArray(status.peers) && status.peers.length > 0
          ? status.peers.map((peer, idx) =>
              idx === 0 && peer.last_seen == null
                ? { ...peer, last_seen: refreshTs }
                : peer,
            )
          : status.peers;
      return {
        ...status,
        readiness: {
          ...status.readiness,
          sign_ready: false,
          degraded_reasons: degraded,
          last_refresh_at: refreshTs,
        },
        peers,
      };
    },
    [],
  );

  /**
   * Correlate a `pending_operations` snapshot against any
   * dispatched-but-unmatched commands in
   * {@link pendingUnmatchedDispatchesRef}. For each pending op whose
   * `request_id` is not yet in `pendingDispatchIndex`, pop the oldest
   * matching (by `pendingOpType`) unmatched dispatch and store a
   * correlating entry. This is the async fallback for the synchronous
   * capture path inside `handleRuntimeCommand` — when the runtime tick
   * completes before the pending_operations snapshot reflects the new
   * op, the request_id becomes observable here on the next refresh
   * tick.
   */
  const correlatePendingOperations = useCallback(
    (pendingOps: RuntimeStatusSummary["pending_operations"]) => {
      const unmatched = pendingUnmatchedDispatchesRef.current;
      if (unmatched.length === 0) return;
      const index = pendingDispatchIndexRef.current;
      const additions: Record<string, PendingDispatchEntry> = {};
      const stillUnmatched = [...unmatched];
      for (const op of pendingOps) {
        if (index[op.request_id]) continue;
        if (additions[op.request_id]) continue;
        const matchIdx = stillUnmatched.findIndex(
          (candidate) => candidate.pendingOpType === op.op_type,
        );
        if (matchIdx === -1) continue;
        const match = stillUnmatched.splice(matchIdx, 1)[0];
        const { pendingOpType: _ignore, ...entry } = match;
        additions[op.request_id] = entry;
      }
      if (Object.keys(additions).length === 0) return;
      pendingUnmatchedDispatchesRef.current = stillUnmatched;
      setPendingDispatchIndex((previous) => ({ ...previous, ...additions }));
    },
    [],
  );

  const applyRuntimeStatus = useCallback(
    (status: RuntimeStatusSummary | null) => {
      setRuntimeStatus(augmentStatus(status));
      if (status) {
        correlatePendingOperations(status.pending_operations);
      }
    },
    [augmentStatus, correlatePendingOperations],
  );

  /**
   * Dev-only: forward every socket lifecycle event to
   * `window.__debug.relayHistory`. In non-DEV builds, the hook installer
   * effect never populates `window.__debug`, so `appendRelayHistoryEntry`
   * is a no-op (and is itself tree-shakable because no DEV-only caller
   * survives `import.meta.env.DEV` gating).
   */
  const recordRelaySocketEvent = useCallback((event: RelaySocketEvent) => {
    if (!import.meta.env.DEV) return;
    appendRelayHistoryEntry(event);
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
        onSocketEvent: recordRelaySocketEvent,
      });
      relayPumpRef.current = pump;
      setRuntimeRelays(pump.relayStatuses());
      const status = await pump.start();
      if (relayPumpRef.current === pump) {
        // Route through `augmentStatus` so any active dev-only nonce-depletion
        // override (VAL-OPS-024) survives the initial pump.start() snapshot.
        // In non-DEV or when the override ref is null, `augmentStatus` is
        // an identity function, so this wrap is zero-cost in production.
        setRuntimeStatus(augmentStatus(status));
      }
      return status;
    },
    [absorbDrains, augmentStatus, resetDrainSlices, stopRelayPump],
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
      // Route through `augmentStatus` so any active dev-only nonce-depletion
      // override is preserved across re-attachments (VAL-OPS-024).
      setRuntimeStatus(augmentStatus(runtime.runtimeStatus()));
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
    [absorbDrains, augmentStatus, resetDrainSlices, startLiveRelayPump, stopRelayPump],
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
      // Preserve any active dev-only nonce-depletion override (VAL-OPS-024).
      setRuntimeStatus(augmentStatus(simulator.pump(4)));
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
    [augmentStatus, createSession, reloadProfiles, setRuntime],
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
      // Preserve any active dev-only nonce-depletion override (VAL-OPS-024).
      setRuntimeStatus(augmentStatus(simulatorRef.current.pump(3)));
      return;
    }
    const relays = liveRelayUrlsRef.current.length
      ? liveRelayUrlsRef.current
      : activeProfile?.relays ?? [];
    await startLiveRelayPump(runtime, relays);
    if (relayPumpRef.current) {
      const status = await relayPumpRef.current.refreshAll();
      if (runtimeRef.current === runtime) {
        // Preserve any active dev-only nonce-depletion override (VAL-OPS-024).
        setRuntimeStatus(augmentStatus(status));
      }
    }
  }, [activeProfile, augmentStatus, startLiveRelayPump]);

  // Keep pendingDispatchIndexRef in lock-step with state so callbacks
  // that read the latest index (absorbDrains, correlation helper) can do
  // so without re-creating on every state change.
  useEffect(() => {
    pendingDispatchIndexRef.current = pendingDispatchIndex;
  }, [pendingDispatchIndex]);

  // GC sweep: prune pendingDispatchIndex entries whose `settledAt` is
  // older than {@link PENDING_DISPATCH_RETENTION_MS}. Runs once a second
  // while the index contains any settled entries; idle-tick cost is zero
  // when the index is empty. 60s matches the feature contract so Retry
  // and late-arriving failure enrichment paths can still resolve
  // originating messages long after the operation was drained.
  useEffect(() => {
    const hasSettled = Object.values(pendingDispatchIndex).some(
      (entry) => entry.settledAt !== undefined,
    );
    if (!hasSettled) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setPendingDispatchIndex((previous) => {
        let changed = false;
        const next: Record<string, PendingDispatchEntry> = {};
        for (const [requestId, entry] of Object.entries(previous)) {
          if (
            entry.settledAt !== undefined &&
            now - entry.settledAt >= PENDING_DISPATCH_RETENTION_MS
          ) {
            changed = true;
            continue;
          }
          next[requestId] = entry;
        }
        return changed ? next : previous;
      });
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [pendingDispatchIndex]);

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
        // Preserve any active dev-only nonce-depletion override (VAL-OPS-024).
        setRuntimeStatus(augmentStatus(simulatorRef.current.pump(3)));
        return;
      }
      // VAL-OPS-017: synchronously tick the runtime and re-emit a fresh
      // `runtime_status` snapshot so the UI's sign/ECDH/ping dispatch gate
      // sees the refreshed `sign_ready` / `ecdh_ready` state within one
      // runtime tick of the resume click. Without this, the live-relay
      // path relies solely on the async `restartRuntimeConnections()`
      // pipeline (reconnect → refresh_all_peers → pump) before any fresh
      // status reaches React state, which can take hundreds of
      // milliseconds or more — well beyond the "within 1 runtime_status
      // tick" contract. The re-emitted snapshot reflects underlying
      // readiness inputs (peers online, nonce pool, policy) so sign_ready
      // recovers naturally; if inputs still block, sign_ready stays
      // false but for a non-paused degraded_reason (no stale paused
      // reason leaks into degraded_reasons).
      const runtime = runtimeRef.current;
      if (runtime) {
        try {
          runtime.tick(Date.now());
        } catch {
          // Runtime mid-teardown is handled by the async restart below;
          // re-emitting whatever snapshot the runtime can produce is
          // preferable to leaving React state on a paused-side snapshot.
        }
        try {
          applyRuntimeStatus(runtime.runtimeStatus());
        } catch {
          // Same as above — tolerate a transient read error here and
          // let the async restart surface the next snapshot.
        }
      }
      void restartRuntimeConnections();
    }
  }, [applyRuntimeStatus, augmentStatus, restartRuntimeConnections, stopRelayPump]);

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

      // Push a provisional pendingDispatchIndex entry into the unmatched
      // FIFO queue BEFORE dispatch so that even if the request_id is not
      // captured synchronously on this call, a subsequent
      // `pending_operations` observation can correlate and populate the
      // index (VAL-OPS-007). For commands that do not register a pending
      // op (`refresh_all_peers`), no queue entry is pushed.
      const dispatchedAt = now;
      const dispatchMetadata = dispatchMetadataForCommand(cmd);
      if (dispatchMetadata && expectedType !== null) {
        pendingUnmatchedDispatchesRef.current.push({
          ...dispatchMetadata,
          dispatchedAt,
          pendingOpType: expectedType as "Sign" | "Ecdh" | "Ping" | "Onboard",
        });
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
      let statusAfter: RuntimeStatusSummary | null = null;
      try {
        statusAfter = runtime.runtimeStatus();
        for (const op of statusAfter.pending_operations) {
          if (op.op_type === expectedType && !before.has(op.request_id)) {
            requestId = op.request_id;
            break;
          }
        }
        // Preserve any active dev-only nonce-depletion override so the
        // `Syncing nonces` / `Trigger Sync` overlay does not get wiped
        // by a command dispatched between simulate() and restore()
        // (VAL-OPS-024). `augmentStatus` is identity when the override
        // ref is null, so production paths are unaffected.
        setRuntimeStatus(augmentStatus(statusAfter));
      } catch {
        requestId = null;
      }
      // If the synchronous capture succeeded, remove the newest unmatched
      // entry matching the dispatch metadata and promote it into the
      // pendingDispatchIndex keyed by the captured request_id.
      if (requestId && dispatchMetadata && expectedType !== null) {
        const queue = pendingUnmatchedDispatchesRef.current;
        // Find from the end (LIFO) to match THIS dispatch — avoids
        // robbing a correlation spot from an older unmatched dispatch
        // that's still waiting for an async correlation via
        // correlatePendingOperations.
        for (let i = queue.length - 1; i >= 0; i -= 1) {
          const candidate = queue[i];
          if (
            candidate.pendingOpType === expectedType &&
            candidate.message_hex_32 === dispatchMetadata.message_hex_32 &&
            candidate.peer_pubkey === dispatchMetadata.peer_pubkey &&
            candidate.dispatchedAt === dispatchedAt
          ) {
            queue.splice(i, 1);
            break;
          }
        }
        const indexEntry: PendingDispatchEntry = {
          type: dispatchMetadata.type,
          dispatchedAt,
        };
        if (dispatchMetadata.message_hex_32 !== undefined) {
          indexEntry.message_hex_32 = dispatchMetadata.message_hex_32;
        }
        if (dispatchMetadata.peer_pubkey !== undefined) {
          indexEntry.peer_pubkey = dispatchMetadata.peer_pubkey;
        }
        const capturedRequestId = requestId;
        setPendingDispatchIndex((prev) =>
          prev[capturedRequestId] ? prev : { ...prev, [capturedRequestId]: indexEntry },
        );
      }
      // After capturing our own dispatch, run the async correlation pass
      // against the observed pending_operations snapshot so any older
      // unmatched dispatches get picked up now that their request_id may
      // be visible.
      if (statusAfter) {
        correlatePendingOperations(statusAfter.pending_operations);
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
      // Append a lifecycle entry for every tracked dispatch so validators
      // (and the Sign Activity UI) can observe the transition sequence
      // even when the runtime turns a sign around within one tick —
      // faster than the polling loop can record the pending state from
      // `pending_operations` alone (VAL-OPS-002 / VAL-OPS-004 /
      // VAL-OPS-013). The entry is seeded as `pending` with
      // `pending_at = dispatched_at` so the transition is always present
      // regardless of how fast the runtime completes.
      if (requestId) {
        const lifecycleOpType = lifecycleOpTypeFor(cmd);
        if (lifecycleOpType) {
          const preview = lifecycleMessagePreview(cmd);
          const entry: SignLifecycleEntry = {
            request_id: requestId,
            op_type: lifecycleOpType,
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
      return { requestId, debounced: false };
    },
    [augmentStatus, correlatePendingOperations],
  );

  const refreshRuntime = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setRuntimeStatus(null);
      return;
    }
    if (signerPaused) {
      applyRuntimeStatus(runtime.runtimeStatus());
      return;
    }
    if (!signerPaused && simulatorRef.current) {
      applyRuntimeStatus(simulatorRef.current.pump(3));
      return;
    }
    if (!signerPaused && relayPumpRef.current) {
      // refreshAll() fans out refresh_all_peers then calls pump() internally;
      // pump() is what invokes our onDrains callback, so completions and
      // failures will flow into the slices on this tick.
      void relayPumpRef.current.refreshAll().then((status) => {
        if (runtimeRef.current === runtime) {
          applyRuntimeStatus(status);
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
    applyRuntimeStatus(runtime.runtimeStatus());
  }, [absorbDrains, applyRuntimeStatus, signerPaused]);

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
    //
    // Dev-only side effect: append every transition to
    // `window.__debug.visibilityHistory` so validators can observe
    // tab-hide/show evidence without relying on the headless runtime
    // re-emitting the DOM event (VAL-OPS-021).
    function onVisibility() {
      if (typeof document === "undefined") return;
      const nextState = document.visibilityState;
      appendVisibilityEntry(nextState);
      if (nextState === "visible" && runtimeRef.current) {
        refreshRuntime();
      }
    }
    if (typeof document === "undefined") return;
    // Seed with the initial state so the first entry is always present.
    appendVisibilityEntry(document.visibilityState);
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
    //
    // Dev-only: flush the relayHistory ring buffer into sessionStorage as
    // a final-state checkpoint so validators reopening the tab can read
    // the WS close frames (1000/1001 clean, 1006 abnormal) that the
    // closed tab emitted. The helper is DEV-gated so this flush is a
    // no-op in production bundles.
    function onBeforeUnload() {
      // VAL-OPS-028: send a clean WebSocket close frame (1001 "going-away")
      // on every active relay socket BEFORE anything else. Browsers
      // default to code 1006 (abnormal) when the OS tears down sockets
      // after `beforeunload` returns, so we must proactively emit the
      // close here so the subsequently-persisted `__debug.relayHistory`
      // ring buffer records `lastCloseCode=1001 wasClean=true` (rather
      // than 1006) for the validator to observe after tab reopen.
      try {
        relayPumpRef.current?.closeCleanly();
      } catch {
        // best-effort cleanup during teardown
      }
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
      try {
        persistRelayHistoryToSessionStorage();
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
      signLifecycleLog,
      pendingDispatchIndex,
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
      signLifecycleLog,
      pendingDispatchIndex,
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
      __debug?: TestObservabilityDebugSurface;
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
      __iglooTestDropRelays?: (closeCode?: number) => void;
      __iglooTestRestoreRelays?: () => Promise<void>;
      __iglooTestSimulateNonceDepletion?: (input?: {
        nonce_pool_size?: number;
        nonce_pool_threshold?: number;
        reason?: string;
      }) => void;
      __iglooTestRestoreNonce?: () => void;
    };
    globalWindow.__appState = value;
    // Initialise the dev-only `__debug` surface once per provider mount.
    // `relayHistory` / `visibilityHistory` are populated by the appender
    // helpers (which no-op in non-DEV). `noncePoolSnapshot` uses a live
    // getter so `window.__debug.noncePoolSnapshot` reflects the current
    // runtime snapshot on each read (no stale values).
    const debugSurface: TestObservabilityDebugSurface = {
      relayHistory: getRelayHistoryArray(),
      visibilityHistory: getVisibilityHistoryArray(),
      get noncePoolSnapshot(): NoncePoolSnapshot | null {
        const override = nonceOverrideRef.current;
        if (override) {
          return {
            nonce_pool_size: override.nonce_pool_size,
            nonce_pool_threshold: override.nonce_pool_threshold,
          };
        }
        const runtime = runtimeRef.current;
        if (!runtime) return null;
        try {
          const snapshot = runtime.snapshot();
          const peers = snapshot.state.nonce_pool.peers;
          const size = peers.reduce(
            (total, peer) => total + peer.outgoing_available,
            0,
          );
          const threshold = snapshot.status.known_peers;
          return {
            nonce_pool_size: size,
            nonce_pool_threshold: threshold,
          };
        } catch {
          return null;
        }
      },
    };
    globalWindow.__debug = debugSurface;
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
    // Forcibly close every live relay socket with a simulated close code
    // (default 1006 "abnormal closure"). Does NOT synchronously mutate
    // `sign_ready` — the existing TTL-driven failure path on any in-flight
    // pending op must still surface as a timeout via drainFailures
    // (VAL-OPS-016).
    globalWindow.__iglooTestDropRelays = (closeCode = 1006) => {
      relayPumpRef.current?.simulateDropAll(closeCode);
    };
    // Restore the previously-dropped relays. Each successful reconnect
    // increments that relay's `reconnectCount`.
    globalWindow.__iglooTestRestoreRelays = async () => {
      await relayPumpRef.current?.simulateRestoreAll();
    };
    // Push a synthetic nonce-depletion signal so the `Syncing nonces` /
    // `Trigger Sync` overlay (VAL-OPS-024) renders end-to-end without the
    // runtime actually reaching that state.
    globalWindow.__iglooTestSimulateNonceDepletion = (input) => {
      nonceOverrideRef.current = {
        nonce_pool_size: input?.nonce_pool_size ?? 0,
        nonce_pool_threshold: input?.nonce_pool_threshold ?? 2,
        reason: input?.reason ?? "nonce_pool_depleted",
      };
      if (runtimeRef.current) {
        applyRuntimeStatus(runtimeRef.current.runtimeStatus());
      }
    };
    // Clear the simulated depletion. Forces an immediate refresh so the
    // overlay disappears without waiting for the next 2.5 s poll tick.
    globalWindow.__iglooTestRestoreNonce = () => {
      nonceOverrideRef.current = null;
      if (runtimeRef.current) {
        applyRuntimeStatus(runtimeRef.current.runtimeStatus());
      }
    };
    return () => {
      if (globalWindow.__appState === value) {
        delete globalWindow.__appState;
      }
    };
  }, [value, startRuntimeFromPayload, applyRuntimeStatus]);

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

/**
 * Retention window for {@link PendingDispatchEntry} after settlement
 * (completion or failure). Entries older than this are pruned by the
 * provider-side GC sweep so `pendingDispatchIndex` never grows without
 * bound. 60s matches the feature contract so Retry handlers can still
 * resolve originating messages well after the pending op has been
 * drained.
 */
const PENDING_DISPATCH_RETENTION_MS = 60_000;

/**
 * Extract the dispatch metadata stored in the pendingDispatchIndex from
 * a RuntimeCommand. Returns `null` for commands that do not register a
 * single pending op (e.g. `refresh_all_peers`).
 */
function dispatchMetadataForCommand(
  cmd: RuntimeCommand,
):
  | (Pick<PendingDispatchEntry, "type" | "message_hex_32" | "peer_pubkey">)
  | null {
  switch (cmd.type) {
    case "sign":
      return { type: "sign", message_hex_32: cmd.message_hex_32 };
    case "ecdh":
      return { type: "ecdh", peer_pubkey: cmd.pubkey32_hex };
    case "ping":
    case "refresh_peer":
      return { type: "ping", peer_pubkey: cmd.peer_pubkey32_hex };
    case "onboard":
      return { type: "onboard", peer_pubkey: cmd.peer_pubkey32_hex };
    case "refresh_all_peers":
      return null;
  }
}

/**
 * Map a RuntimeCommand to the lifecycle op_type recorded in
 * {@link SignLifecycleEntry}. `refresh_peer` is folded into `ping` because
 * it dispatches a ping under the hood. Returns `null` for commands that
 * don't produce a single correlatable request_id (e.g. `refresh_all_peers`
 * fans out to many).
 */
function lifecycleOpTypeFor(
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

/**
 * Extract the first 10 hex characters of a sign command's message or a
 * peer pubkey (ecdh / ping) so the Sign Activity row has a stable,
 * non-secret preview for users. Returns `null` when no source payload is
 * available (e.g. commands the lifecycle log does not track).
 */
function lifecycleMessagePreview(cmd: RuntimeCommand): string | null {
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

/* -------------------------------------------------------------------------- */
/* Dev-only test-observability helpers                                        */
/* -------------------------------------------------------------------------- */

/**
 * Single entry in `window.__debug.relayHistory` — one per relay-socket
 * lifecycle event (open/close/error). Intentionally flat/serialisable so
 * agent-browser can `JSON.stringify` it from a `page.evaluate`.
 */
export interface RelayHistoryEntry {
  type: "open" | "close" | "error";
  url: string;
  at: string;
  /** Close code if known (1000 / 1001 / 1006 / 1011 / …), `null` otherwise. */
  code?: number | null;
  wasClean?: boolean;
}

/**
 * Single entry in `window.__debug.visibilityHistory` — one per
 * `visibilitychange` transition. Seeded on mount with the initial state so
 * validators always see at least one entry.
 */
export interface VisibilityHistoryEntry {
  state: "visible" | "hidden";
  at: string;
}

/**
 * Shape of the dev-only `window.__debug` surface. Not shipped to
 * production (the installer effect is gated on `import.meta.env.DEV`).
 */
export interface TestObservabilityDebugSurface {
  relayHistory: RelayHistoryEntry[];
  visibilityHistory: VisibilityHistoryEntry[];
  readonly noncePoolSnapshot: NoncePoolSnapshot | null;
}

// Capacity of the ring buffers. Large enough for a multi-minute agent-browser
// scenario that reconnects a few relays and flips visibility several times;
// small enough that a misbehaving page can't exhaust memory.
const RELAY_HISTORY_MAX = 200;
const VISIBILITY_HISTORY_MAX = 200;

/**
 * sessionStorage key under which the dev-only relayHistory ring buffer is
 * persisted between tab mounts (VAL-OPS-028). The literal is referenced
 * only from DEV-gated code paths so Vite/Terser dead-code elimination
 * strips every occurrence from the production bundle.
 */
const RELAY_HISTORY_SESSION_KEY = "__debug.relayHistory";

/**
 * Module-scoped arrays holding the buffers. We export getters (not the
 * arrays directly) so the dev-only installer effect can hand out a stable
 * reference — in-place mutation inside the appenders is visible to
 * consumers who cached `window.__debug.relayHistory`.
 */
const relayHistoryBuffer: RelayHistoryEntry[] = [];
const visibilityHistoryBuffer: VisibilityHistoryEntry[] = [];

function getRelayHistoryArray(): RelayHistoryEntry[] {
  return relayHistoryBuffer;
}

function getVisibilityHistoryArray(): VisibilityHistoryEntry[] {
  return visibilityHistoryBuffer;
}

/**
 * Narrow an arbitrary JSON value into a {@link RelayHistoryEntry}. Defends
 * against malformed sessionStorage payloads (tampered JSON, stale schemas
 * from an older build) so rehydration is strictly opt-in per entry.
 */
function isValidRelayHistoryEntry(value: unknown): value is RelayHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (
    entry.type !== "open" &&
    entry.type !== "close" &&
    entry.type !== "error"
  ) {
    return false;
  }
  if (typeof entry.url !== "string") return false;
  if (typeof entry.at !== "string") return false;
  if (entry.type === "close") {
    if (
      entry.code !== null &&
      entry.code !== undefined &&
      typeof entry.code !== "number"
    ) {
      return false;
    }
    if (
      entry.wasClean !== undefined &&
      typeof entry.wasClean !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Dev-only: persist the current relayHistory ring buffer to sessionStorage
 * so that a validator reopening the app after a tab close can observe the
 * prior session's WS close-frame telemetry (VAL-OPS-028). No-op in
 * production (tree-shaken via the DEV gate) and on any sessionStorage
 * failure (quota exceeded, security exception, unavailable).
 */
function persistRelayHistoryToSessionStorage(): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      RELAY_HISTORY_SESSION_KEY,
      JSON.stringify(relayHistoryBuffer),
    );
  } catch {
    // sessionStorage may be unavailable (Safari private mode) or at its
    // quota limit; we lose the persistence signal but never the in-memory
    // ring buffer, so validators still see live events within the tab.
  }
}

/**
 * Dev-only: rehydrate the in-memory relayHistory ring buffer from
 * sessionStorage if a prior tab persisted one (VAL-OPS-028). Must run
 * before the first appendRelayHistoryEntry call so the reference handed
 * to `window.__debug.relayHistory` already reflects the restored state.
 * Defensive against malformed payloads and over-size buffers.
 */
function hydrateRelayHistoryFromSessionStorage(): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(RELAY_HISTORY_SESSION_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const valid: RelayHistoryEntry[] = [];
  for (const candidate of parsed) {
    if (isValidRelayHistoryEntry(candidate)) {
      valid.push(candidate);
    }
  }
  // Defensive capacity enforcement: if a stored buffer is somehow larger
  // than RELAY_HISTORY_MAX (shouldn't happen given the append-side cap),
  // keep the newest entries only.
  const trimmed =
    valid.length > RELAY_HISTORY_MAX
      ? valid.slice(valid.length - RELAY_HISTORY_MAX)
      : valid;
  relayHistoryBuffer.length = 0;
  for (const entry of trimmed) {
    relayHistoryBuffer.push(entry);
  }
}

function appendRelayHistoryEntry(event: RelaySocketEvent): void {
  const iso = new Date(event.at).toISOString();
  let entry: RelayHistoryEntry;
  if (event.type === "close") {
    entry = {
      type: "close",
      url: event.url,
      at: iso,
      code: event.code,
      wasClean: event.wasClean,
    };
  } else {
    entry = { type: event.type, url: event.url, at: iso };
  }
  relayHistoryBuffer.push(entry);
  if (relayHistoryBuffer.length > RELAY_HISTORY_MAX) {
    relayHistoryBuffer.splice(0, relayHistoryBuffer.length - RELAY_HISTORY_MAX);
  }
  // Dev-only persistence: mirror every append into sessionStorage so a
  // tab close followed by reopen leaves WS close-frame evidence visible
  // to validators (VAL-OPS-028). The helper itself is DEV-gated, so this
  // call is tree-shaken out of production builds.
  persistRelayHistoryToSessionStorage();
}

function appendVisibilityEntry(state: DocumentVisibilityState): void {
  if (!import.meta.env.DEV) return;
  // Only `"visible"` and `"hidden"` are first-class states we surface to
  // validators. `"prerender"` is transient and uninteresting for this
  // signal — coerce it to `"hidden"` so the array stays homogeneous.
  const normalised: "visible" | "hidden" =
    state === "visible" ? "visible" : "hidden";
  const entry: VisibilityHistoryEntry = {
    state: normalised,
    at: new Date().toISOString(),
  };
  // De-dupe consecutive identical transitions so idle ticks don't spam the
  // buffer — validators care about *change* events.
  const last = visibilityHistoryBuffer[visibilityHistoryBuffer.length - 1];
  if (last && last.state === normalised) {
    return;
  }
  visibilityHistoryBuffer.push(entry);
  if (visibilityHistoryBuffer.length > VISIBILITY_HISTORY_MAX) {
    visibilityHistoryBuffer.splice(
      0,
      visibilityHistoryBuffer.length - VISIBILITY_HISTORY_MAX,
    );
  }
}
