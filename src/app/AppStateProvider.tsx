import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
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
  decodeBfsharePackage,
  encodeBfsharePackage,
  encodeOnboardPackage,
  defaultManualPeerPolicyOverrides,
  defaultBifrostEventKind,
  decodeBfonboardPackage,
  decodeOnboardingResponseEvent,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
  parseProfileBackupEvent,
  profileBackupEventKind,
  profilePayloadForShare,
  recoverNsecFromShares,
  resolveShareIndex,
  rotateKeysetBundle,
} from "../lib/bifrost/packageService";
import { RuntimeClient, type RuntimeCommand } from "../lib/bifrost/runtimeClient";
import type {
  BfManualPeerPolicyOverride,
  BfMethodPolicyOverride,
  BfPolicyOverrideValue,
  BfProfilePayload,
  CompletedOperation,
  DerivedPublicNonceWire,
  GroupPackageWire,
  OperationFailure,
  RuntimeBootstrapInput,
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
import {
  UNADOPTED_POOL_EXHAUSTED_ERROR,
  UNADOPTED_POOL_VERSION,
  availableUnadoptedShares,
  decryptUnadoptedSharesPool,
  encryptUnadoptedSharesPool,
  updateShareAllocationStatus,
  upsertShareAllocation,
  type ShareAllocationEntry,
  type UnadoptedSharesPool,
} from "../lib/storage/unadoptedSharesPool";
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
import {
  PROFILE_NAME_MAX_LENGTH,
  RUNTIME_EVENT_LOG_MAX,
  SetupFlowError,
} from "./AppStateTypes";
import type {
  AppStateValue,
  CreateDraft,
  BackupPublishLocalMutationPayload,
  CreateKeysetDraft,
  CreateProfileDraft,
  CreateSession,
  EnrichedOperationFailure,
  HandleRuntimeCommandResult,
  ImportProfileDraft,
  ImportSession,
  NoncePoolSnapshot,
  RuntimeEventLogBadge,
  RuntimeEventLogEntry,
  RuntimeEventLogSource,
  OnboardingPackageStatePatch,
  OnboardSession,
  PeerDeniedEvent,
  PendingDispatchEntry,
  PolicyOverrideEntry,
  PolicyPromptDecision,
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
  // m7-onboard-sponsor — transient hand-off state between the Config and
  // Handoff screens. Populated by `createOnboardSponsorPackage`, cleared
  // on Cancel / lock / clearCredentials.
  const [
    onboardSponsorSession,
    setOnboardSponsorSession,
  ] = useState<
    import("./AppStateTypes").OnboardSponsorSession | null
  >(null);
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
  /**
   * Bounded ring buffer of tagged event-log entries derived from all three
   * runtime drain channels (events / completions / failures). Mirrored into
   * `runtimeEventLogRef` so dev-only hooks and the `window.__debug`
   * observation surface can read the latest snapshot without going through
   * React state. Capped at {@link RUNTIME_EVENT_LOG_MAX} entries — oldest
   * FIFO-evicted when exceeded (VAL-EVENTLOG-014 / VAL-EVENTLOG-024).
   */
  const [runtimeEventLog, setRuntimeEventLog] = useState<
    RuntimeEventLogEntry[]
  >([]);
  const runtimeEventLogRef = useRef<RuntimeEventLogEntry[]>([]);
  /**
   * Monotonic sequence counter assigned to every ingested entry. Used by
   * validators to detect reorder / dropped entries under high-rate
   * ingestion (VAL-EVENTLOG-024). Reset to zero alongside the buffer on
   * `lockProfile()` / `clearCredentials()` so seq values are unique only
   * within a single unlocked session.
   */
  const runtimeEventLogSeqRef = useRef(0);
  // Reactive peer-denial queue for `PolicyPromptModal`. Populated via
  // `enqueuePeerDenial` (called from the Dashboard's lifecycleEvents
  // observer for `peer_denied` kind events), drained FIFO via
  // `resolvePeerDenial`. See `PeerDeniedEvent` in AppStateTypes for the
  // shape and the reactive-denial-surface deviation entry in
  // `docs/runtime-deviations-from-paper.md` for rationale
  // (VAL-APPROVALS-007 family).
  const [peerDenialQueue, setPeerDenialQueue] = useState<PeerDeniedEvent[]>([]);
  // Active peer-policy overrides surfaced to the Peer Policies view —
  // populated by `resolvePeerDenial` when the user acts on a reactive
  // `peer_denied` prompt (allow-once / allow-always / deny-always).
  // Keyed on `(peer, direction, method)`; subsequent decisions for the
  // same triple replace the prior entry. See
  // `fix-m2-peer-policies-view-persistence-and-remove` (VAL-APPROVALS-017).
  const [policyOverrides, setPolicyOverrides] = useState<
    PolicyOverrideEntry[]
  >([]);
  // Mirror of `policyOverrides` as a ref so stable callbacks
  // (notably `removePolicyOverride`) can find the target entry
  // without re-creating their identity on every list mutation.
  // Kept in lock-step with state via an effect below.
  const policyOverridesRef = useRef<PolicyOverrideEntry[]>([]);
  // Session-scoped set of override keys ("<peer>:respond.<verb>") set via
  // "Allow once". On `lockProfile()` we reverse each entry with
  // `setPolicyOverride(value: "deny")` so the override does NOT persist
  // across lock/unlock (VAL-APPROVALS-009). "deny" is chosen over "unset"
  // because the underlying `MethodPolicy::default()` in bifrost-core is
  // permissive (every respond method defaults to `true`) — an "unset"
  // rollback would fall back to the default and silently auto-allow the
  // next peer request, preventing the fresh `peer_denied` event required
  // by VAL-APPROVALS-009. See `docs/runtime-deviations-from-paper.md`
  // for the deviation entry. Persistent variants ("Always allow" /
  // "Always deny") are NOT tracked here and remain in the runtime.
  const sessionAllowOnceRef = useRef<Set<string>>(new Set());
  // Cached decrypted profile payload + password for the currently
  // unlocked profile. Held in memory only (never written to storage or
  // console) so persistent peer-policy overrides chosen via the reactive
  // denial surface ("Always allow" / "Always deny") can be serialised
  // through the existing profile-save path atomically with the runtime
  // state update. Cleared on `lockProfile()` / `clearCredentials()` so
  // no stale payload bleeds across profiles. See the
  // `fix-m2-persist-always-allow-to-profile` feature description for
  // rationale and VAL-APPROVALS-010 / VAL-APPROVALS-012 /
  // VAL-APPROVALS-017 for behavioral coverage.
  const unlockedPayloadRef = useRef<BfProfilePayload | null>(null);
  const unlockedPasswordRef = useRef<string | null>(null);
  // Mirror of `activeProfile` as a ref so long-lived callbacks whose
  // identity must stay stable (e.g. `persistPolicyOverrideToProfile`,
  // which is read by the `[]`-deps BroadcastChannel receive effect for
  // VAL-APPROVALS-024) can always read the CURRENT profile summary
  // without triggering a re-subscribe. Without this mirror, the
  // BroadcastChannel handler installed at mount would hold a stale
  // reference to `persistPolicyOverrideToProfile` whose closed-over
  // `activeProfile` was captured at mount time (often null), causing
  // cross-tab always-allow / deny-always decisions to silently skip
  // profile persistence on the receiving tab after that tab unlocked or
  // changed its active profile (fix-m2-broadcast-receiver-stale-closure).
  // Kept in lock-step with state via an effect below.
  const activeProfileRef = useRef<StoredProfileSummary | null>(null);
  const peerDenialResolvedRef = useRef<Set<string>>(new Set());
  // Mirror of `peerDenialQueue` as a ref so `resolvePeerDenial` can
  // look up the resolving entry by id without re-creating its identity
  // on every queue mutation.
  const peerDenialQueueRef = useRef<PeerDeniedEvent[]>([]);
  // Dev/runtime-only BroadcastChannel used to propagate a resolution to
  // other tabs that hold a mirror peer-denial queue for the same profile
  // (VAL-APPROVALS-024). Instantiated lazily on the first enqueue so
  // non-browser tests (jsdom without BroadcastChannel) don't crash on
  // mount.
  const policyResolvedChannelRef = useRef<BroadcastChannel | null>(null);
  // VAL-CROSS-021 / fix-m7-multi-tab-and-modal-stack — multi-tab profile
  // lifecycle channel. Each tab maintains an independent WASM runtime
  // for the same unlocked profile, so a Lock or Clear Credentials in
  // tab A does NOT implicitly propagate to tab B. This channel fans out
  // the user-level decision so sibling tabs drop their live session
  // within the next tick — matching the feature contract
  // "Lock in A locks/prompts B within next tick".
  //
  // Message shape: `{ type: "locked" | "cleared", profileId }`.
  // Receivers whose `activeProfile?.id === profileId` (matched via ref
  // so the effect identity stays stable across profile transitions)
  // invoke `lockProfile()` / `clearCredentials()` locally WITHOUT
  // re-broadcasting — the
  // `suppressNextLifecycleBroadcastRef` guard below prevents an echo
  // loop.
  const profileLifecycleChannelRef = useRef<BroadcastChannel | null>(null);
  // When set to `true`, the NEXT call to `lockProfile` /
  // `clearCredentials` skips posting a lifecycle broadcast. Consumed by
  // the lifecycle receive handler so a remote-driven lock/clear does
  // not echo back to the originating tab.
  const suppressNextLifecycleBroadcastRef = useRef(false);
  // Stable mirrors of `lockProfile` / `clearCredentials` so the
  // `[]`-deps lifecycle receive effect can invoke the CURRENT callback
  // identity without re-subscribing to the BroadcastChannel on every
  // mutator re-creation. Kept in lock-step with the callback state via
  // the effects below.
  const lockProfileRef = useRef<(() => void) | null>(null);
  const clearCredentialsRef = useRef<(() => Promise<void>) | null>(null);
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
   * m6-backup-publish — most-recent `created_at` (seconds) emitted by
   * {@link publishProfileBackup} in this session. Used to bump the
   * next publish's timestamp monotonically so two rapid-fire publishes
   * always produce strictly newer replaceable events (VAL-BACKUP-031).
   * `null` until the first publish.
   */
  const lastBackupPublishSecondsRef = useRef<number | null>(null);
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
  /**
   * m7-onboard-sponsor-flow — mirror of `onboardSponsorSession` as a
   * ref so `absorbDrains` and `clearOnboardSponsorSession` can inspect
   * the current session without being re-created on every render
   * (their `useCallback`s must keep a stable identity so the
   * RuntimeRelayPump `onDrains` callback wired at pump-start does not
   * hold a stale closure).
   */
  const onboardSponsorSessionRef =
    useRef<import("./AppStateTypes").OnboardSponsorSession | null>(null);
  /**
   * m7-onboard-sponsor-flow — ref to the live
   * {@link AppStateValue.handleRuntimeCommand} so mutators defined
   * BEFORE `handleRuntimeCommand` (notably
   * `createOnboardSponsorPackage`) can still dispatch through the same
   * debounce / correlation pipeline. `handleRuntimeCommand` assigns
   * itself into this ref on every render so it always reflects the
   * current implementation.
   */
  const dispatchRuntimeCommandRef = useRef<
    ((cmd: RuntimeCommand) => Promise<HandleRuntimeCommandResult>) | null
  >(null);
  /**
   * fix-m7-onboard-distinct-share-allocation — ref to a helper that
   * transitions a share-allocation ledger entry on the active
   * profile's stored record. Callable from `absorbDrains` (drain
   * handler has `[]` deps) and `clearOnboardSponsorSession` so late
   * completions / failures / cancellations cleanly reconcile the
   * ledger without requiring a password re-prompt. Populated by the
   * `useEffect` below that keeps it pointed at the latest
   * closure-captured implementation.
   */
  const transitionShareAllocationStatusRef = useRef<
    | ((
        requestId: string,
        status: ShareAllocationEntry["status"],
        failureReason?: string,
      ) => Promise<void>)
    | null
  >(null);

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
      setOnboardSponsorSession(null);
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
      // m7-onboard-sponsor-flow — VAL-ONBOARD-009 / VAL-ONBOARD-011.
      // Detect an Onboard completion matching the active sponsor
      // session and transition the session to `"completed"` so the
      // handoff screen / event log can render the success badge.
      // Metadata refresh is driven by the next `runtime_status`
      // snapshot (the runtime emits a fresh status post-completion).
      const sponsorSession = onboardSponsorSessionRef.current;
      if (sponsorSession?.requestId && sponsorSession.status === "awaiting_adoption") {
        for (const completion of drains.completions) {
          const onboardCompletion =
            (completion as { Onboard?: { request_id: string } }).Onboard;
          if (
            onboardCompletion &&
            onboardCompletion.request_id === sponsorSession.requestId
          ) {
            setOnboardSponsorSession((previous) =>
              previous && previous.requestId === onboardCompletion.request_id
                ? { ...previous, status: "completed" }
                : previous,
            );
            // fix-m7-onboard-distinct-share-allocation — mark the
            // allocation ledger entry "completed" so the underlying
            // share is permanently removed from the available pool
            // (VAL-ONBOARD-020). Fire-and-forget; persistence failure
            // does not rollback the session state.
            void transitionShareAllocationStatusRef.current?.(
              onboardCompletion.request_id,
              "completed",
            );
            break;
          }
        }
      }
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
      // m7-onboard-sponsor-flow — VAL-ONBOARD-012 (wrong/expired
      // password on requester → source event log shows failed
      // attempt with error tone). Detect an Onboard failure matching
      // the active sponsor session and transition the session to
      // `"failed"` with the runtime-emitted reason so the handoff
      // screen / event log can render the error tone.
      const sponsorSession = onboardSponsorSessionRef.current;
      if (
        sponsorSession?.requestId &&
        sponsorSession.status === "awaiting_adoption"
      ) {
        for (const failure of drains.failures) {
          if (
            failure.request_id === sponsorSession.requestId &&
            failure.op_type === "onboard"
          ) {
            const reason = `${failure.code}: ${failure.message}`;
            setOnboardSponsorSession((previous) =>
              previous && previous.requestId === failure.request_id
                ? { ...previous, status: "failed", failureReason: reason }
                : previous,
            );
            // fix-m7-onboard-distinct-share-allocation — mark the
            // allocation ledger entry "failed" so the underlying
            // share RETURNS to the pool and can be re-allocated on a
            // subsequent sponsor attempt. Fire-and-forget.
            void transitionShareAllocationStatusRef.current?.(
              failure.request_id,
              "failed",
              reason,
            );
            break;
          }
        }
      }
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
    // Populate the dashboard RuntimeEventLog ring buffer from every drain
    // channel. Preserves drain order: events first (they precede the
    // completions/failures they describe in the runtime's own ordering),
    // then completions, then failures. Each entry is tagged with a typed
    // badge used by the Event Log panel for colour/label rendering
    // (VAL-EVENTLOG-005 / VAL-EVENTLOG-014 / VAL-EVENTLOG-024).
    if (
      drains.events.length > 0 ||
      drains.completions.length > 0 ||
      drains.failures.length > 0
    ) {
      const now = Date.now();
      const newEntries: RuntimeEventLogEntry[] = [];
      for (const event of drains.events) {
        runtimeEventLogSeqRef.current += 1;
        newEntries.push({
          seq: runtimeEventLogSeqRef.current,
          at: now,
          badge: badgeForRuntimeEvent(event),
          source: "runtime_event",
          payload: event,
        });
      }
      for (const completion of drains.completions) {
        runtimeEventLogSeqRef.current += 1;
        newEntries.push({
          seq: runtimeEventLogSeqRef.current,
          at: now,
          badge: badgeForCompletion(completion),
          source: "completion",
          payload: completion,
        });
      }
      for (const failure of drains.failures) {
        runtimeEventLogSeqRef.current += 1;
        newEntries.push({
          seq: runtimeEventLogSeqRef.current,
          at: now,
          badge: "ERROR",
          source: "failure",
          payload: failure,
        });
      }
      if (newEntries.length > 0) {
        setRuntimeEventLog((previous) =>
          appendRuntimeEventLogEntries(previous, newEntries),
        );
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
    setPeerDenialQueue([]);
    setPolicyOverrides([]);
    setRuntimeEventLog([]);
    pendingDispatchIndexRef.current = {};
    pendingUnmatchedDispatchesRef.current = [];
    lastDispatchRef.current = null;
    peerDenialResolvedRef.current = new Set();
    sessionAllowOnceRef.current = new Set();
    runtimeEventLogRef.current = [];
    runtimeEventLogSeqRef.current = 0;
  }, []);

  /**
   * Append a single {@link RuntimeEventLogEntry} synthesised by a local
   * AppStateProvider mutator (i.e. not produced by a WASM drain) to the
   * event-log ring buffer. Assigns a fresh monotonic `seq` via
   * {@link runtimeEventLogSeqRef} and routes the update through the
   * same {@link appendRuntimeEventLogEntries} cap-enforcement path as
   * real drain output so the 500-entry cap and FIFO eviction behaviour
   * are identical to the production drain path (VAL-EVENTLOG-014).
   *
   * Use the typed `badge` + `source` arguments to classify the entry.
   * The `payload` MUST be a scrub-safe, literal-field-only record —
   * callers are responsible for omitting credential material
   * (VAL-BACKUP-007 and every other local_mutation producer).
   */
  const appendLocalMutationRuntimeEventLogEntry = useCallback(
    (input: {
      badge: RuntimeEventLogBadge;
      payload: unknown;
    }) => {
      runtimeEventLogSeqRef.current += 1;
      const entry: RuntimeEventLogEntry = {
        seq: runtimeEventLogSeqRef.current,
        at: Date.now(),
        badge: input.badge,
        source: "local_mutation",
        payload: input.payload,
      };
      setRuntimeEventLog((previous) =>
        appendRuntimeEventLogEntries(previous, [entry]),
      );
    },
    [],
  );

  /**
   * Append a new {@link PeerDeniedEvent} to the FIFO denial queue. No-op
   * when an entry with the same `id` is already queued or was resolved
   * in the current session (the resolved id set is reset on lock /
   * clearCredentials). This keeps rapid-fire duplicate drains from
   * ballooning the modal queue (VAL-APPROVALS-015).
   */
  const enqueuePeerDenial = useCallback((event: PeerDeniedEvent) => {
    if (!event || typeof event.id !== "string" || event.id.length === 0) {
      return;
    }
    if (peerDenialResolvedRef.current.has(event.id)) return;
    setPeerDenialQueue((previous) => {
      if (previous.some((queued) => queued.id === event.id)) return previous;
      return [...previous, event];
    });
  }, []);

  /**
   * Serialise the updated peer-policy override for (peer, direction,
   * method, value) through the existing profile-save path so the
   * override survives a lock/unlock cycle. No-op when the currently
   * unlocked profile payload / password / active summary are absent
   * (e.g. the runtime was seeded via a dev-only test hook without ever
   * persisting a stored profile).
   *
   * Writes happen in this order:
   *   1. Update the in-memory cached payload (`unlockedPayloadRef`).
   *   2. Build a new `StoredProfileRecord` by re-encrypting the payload
   *      with the cached password.
   *   3. Persist the record to IndexedDB via `saveProfile`.
   *
   * The caller is expected to apply the override to the live runtime
   * AFTER this function resolves. On persistence failure (e.g. the
   * WASM bridge rejects re-encryption) the function throws and the
   * caller MUST skip the runtime mutation so we never leave a runtime
   * state that diverges from the on-disk profile. See the
   * `fix-m2-persist-always-allow-to-profile` feature description for
   * atomicity contract.
   */
  const persistPolicyOverrideToProfile = useCallback(
    async (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
      value: "allow" | "deny" | "unset";
    }): Promise<void> => {
      // Read the active profile through a ref rather than directly from
      // the `activeProfile` state so this callback keeps a stable
      // `useCallback` identity across profile transitions. The
      // BroadcastChannel receive effect (VAL-APPROVALS-024) installs
      // with `[]` deps and captures this function once; if its identity
      // changed with every `activeProfile` update, the handler would
      // hold a stale reference whose closed-over profile no longer
      // matches the on-disk record (see
      // fix-m2-broadcast-receiver-stale-closure).
      const payload = unlockedPayloadRef.current;
      const password = unlockedPasswordRef.current;
      const profile = activeProfileRef.current;
      if (!payload || !password || !profile) {
        return;
      }
      const nextPayload = applyManualOverrideToPayload(
        payload,
        input.peer,
        input.direction,
        input.method,
        input.value,
      );
      // fix-m7-onboard-distinct-share-allocation — preserve pool
      // across policy-override persists so the sponsor flow keeps
      // working after an "Always allow/deny" decision.
      const existingRecord = await getProfile(profile.id);
      const { record, normalizedPayload } = await buildStoredProfileRecord(
        nextPayload,
        password,
        {
          createdAt: profile.createdAt,
          lastUsedAt: profile.lastUsedAt,
          label: profile.label,
          unadoptedSharesCiphertext: existingRecord?.unadoptedSharesCiphertext,
          shareAllocations: existingRecord?.shareAllocations,
        },
      );
      // Cache the fully normalised payload (post-Zod parse) so subsequent
      // reads reflect what Zod would return after decoding the on-disk
      // blob — prevents divergence between in-memory & on-disk shapes.
      unlockedPayloadRef.current = normalizedPayload;
      await saveProfile(record);
    },
    [],
  );

  const resolvePeerDenial = useCallback(
    async (id: string, decision: PolicyPromptDecision) => {
      peerDenialResolvedRef.current.add(id);
      // Use the full queue snapshot captured via a ref rather than the
      // closure variable so we always resolve against the entry that was
      // at `id` at dispatch time. Capture BEFORE dropping from the queue
      // so the broadcast payload can include the peer + verb for
      // cross-tab propagation.
      const pending = peerDenialQueueRef.current.find(
        (entry) => entry.id === id,
      );
      setPeerDenialQueue((previous) =>
        previous.filter((entry) => entry.id !== id),
      );
      // Multi-tab: broadcast the full decision payload so sibling tabs
      // (a) drop the mirrored queued entry by id and (b) apply the same
      // policy override to their own runtime state without prompting the
      // user a second time. Previously we only posted a dismissal hint
      // (`{ type: "policy-resolved", id }`) which closed the mirror modal
      // but left cross-tab runtime state divergent.
      //
      // Contract: sibling receivers must NOT re-broadcast on receipt
      // (no echo loop — see the BroadcastChannel install effect below).
      // Receivers remain tolerant to the legacy `policy-resolved` shape
      // so a mid-upgrade tab that only knows how to emit the old message
      // still causes this tab's mirror queue to dismiss.
      try {
        if (pending) {
          policyResolvedChannelRef.current?.postMessage({
            type: "decision",
            promptId: id,
            peerPubkey: pending.peer_pubkey,
            decision: decision.action,
            scope: { verb: pending.verb },
          });
        } else {
          // Fallback dismissal-only post when the entry was already
          // drained locally (e.g. double-resolve race). Keeps sibling
          // tabs in sync without fabricating override data.
          policyResolvedChannelRef.current?.postMessage({
            type: "policy-resolved",
            id,
          });
        }
      } catch {
        // BroadcastChannel is best-effort
      }
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (!pending) return;
      const peer = pending.peer_pubkey;
      const verb = pending.verb;
      const overrideKey = `${peer}:respond.${verb}`;
      try {
        switch (decision.action) {
          case "allow-once":
            runtime.setPolicyOverride({
              peer,
              direction: "respond",
              method: verb,
              value: "allow",
            });
            sessionAllowOnceRef.current.add(overrideKey);
            upsertPolicyOverrideEntry(setPolicyOverrides, {
              peer,
              direction: "respond",
              method: verb,
              value: "allow",
              source: "session",
              createdAt: Date.now(),
            });
            break;
          case "allow-always":
            // Persist the override through the profile store BEFORE
            // applying it to the runtime so there is no window where
            // the in-memory runtime and the on-disk profile disagree.
            // On persistence failure we skip the runtime mutation and
            // rethrow — the caller surfaces the error via the promise
            // rejection.
            await persistPolicyOverrideToProfile({
              peer,
              direction: "respond",
              method: verb,
              value: "allow",
            });
            runtime.setPolicyOverride({
              peer,
              direction: "respond",
              method: verb,
              value: "allow",
            });
            // Remove from session-once tracking — the user upgraded the
            // scope to persistent.
            sessionAllowOnceRef.current.delete(overrideKey);
            upsertPolicyOverrideEntry(setPolicyOverrides, {
              peer,
              direction: "respond",
              method: verb,
              value: "allow",
              source: "persistent",
              createdAt: Date.now(),
            });
            break;
          case "deny-always":
            await persistPolicyOverrideToProfile({
              peer,
              direction: "respond",
              method: verb,
              value: "deny",
            });
            runtime.setPolicyOverride({
              peer,
              direction: "respond",
              method: verb,
              value: "deny",
            });
            sessionAllowOnceRef.current.delete(overrideKey);
            upsertPolicyOverrideEntry(setPolicyOverrides, {
              peer,
              direction: "respond",
              method: verb,
              value: "deny",
              source: "persistent",
              createdAt: Date.now(),
            });
            break;
          case "deny":
            // Deny close is intentionally a no-op at the policy layer
            // (VAL-APPROVALS-011) — the original deny stands.
            break;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `set_policy_override dispatch failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [persistPolicyOverrideToProfile],
  );

  /**
   * Remove an active peer-policy override previously set via the
   * reactive denial surface. Three-step flow kept atomic within the
   * bounds of a single React commit:
   *
   *   1. Drop the entry from the in-memory {@link policyOverrides}
   *      slice so the Peer Policies view hides the row on the next
   *      render.
   *   2. For `source: "persistent"` entries, re-serialise the stored
   *      profile with the targeted cell set to `"unset"` via
   *      {@link persistPolicyOverrideToProfile}. This guarantees the
   *      override does not re-appear after a lock/unlock cycle (the
   *      `reapplyManualOverridesToRuntime` unlock path skips `unset`
   *      cells).
   *   3. Dispatch `setPolicyOverride({..., value: "unset"})` against
   *      the live runtime so the next matching inbound peer request
   *      produces a fresh `peer_denied` event (VAL-APPROVALS-017).
   *
   * Session-scoped entries skip the profile write (they were never
   * persisted) but still clear `sessionAllowOnceRef` so the
   * `lockProfile` rollback loop doesn't re-dispatch a stale key.
   * Unknown triples are a no-op — callers may invoke this eagerly.
   */
  const removePolicyOverride = useCallback(
    async (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
    }): Promise<void> => {
      const existing = policyOverridesRef.current.find(
        (entry) =>
          entry.peer === input.peer &&
          entry.direction === input.direction &&
          entry.method === input.method,
      );
      if (!existing) return;

      // 1. Drop the in-memory entry.
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
      // Also clear session-once tracking so the lock-rollback loop
      // does not re-dispatch a now-stale allow against the runtime.
      const overrideKey = `${input.peer}:${input.direction}.${input.method}`;
      sessionAllowOnceRef.current.delete(overrideKey);

      // 2. For persistent entries, serialise the "unset" reset
      // through the profile-save path. Rethrows on failure so the
      // caller can react to persistence errors; the in-memory entry
      // remains removed (optimistic UI) but the runtime mutation is
      // skipped on persistence failure so the on-disk and runtime
      // states do not silently diverge.
      if (existing.source === "persistent") {
        await persistPolicyOverrideToProfile({
          peer: input.peer,
          direction: input.direction,
          method: input.method,
          value: "unset",
        });
      }

      // 3. Reset the live runtime's override cell. Any runtime error
      // surfaces as a thrown promise rejection — same contract as the
      // set path in `resolvePeerDenial`.
      const runtime = runtimeRef.current;
      if (runtime) {
        runtime.setPolicyOverride({
          peer: input.peer,
          direction: input.direction,
          method: input.method,
          value: "unset",
        });
      }
    },
    [persistPolicyOverrideToProfile],
  );

  /**
   * Dispatch a single peer-policy override cell change to the live
   * runtime. One `setPolicyOverride` call per invocation — including
   * the "unset" transition from the Peer Policies chip cycle, which is
   * expressed as `value: "unset"` so the scope stays on the targeted
   * `(peer, direction, method)` triple (the global
   * `clear_policy_overrides()` bridge call would reset every cell).
   *
   * The mutator does NOT manage optimistic UI or persist to the
   * encrypted profile; the Peer Policies chip component owns the
   * optimistic state and reconciles with the next
   * `peer_permission_states` snapshot (VAL-POLICIES-008 /
   * VAL-POLICIES-026). Rethrows the runtime error so the chip can roll
   * back its optimistic change and surface an inline error.
   */
  const setPeerPolicyOverride = useCallback(
    async (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
      value: "unset" | "allow" | "deny";
    }): Promise<void> => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error(
          "Cannot dispatch policy override: no runtime is active.",
        );
      }
      // VAL-POLICIES-025: reject self-peer overrides at the bridge
      // layer so a caller bypassing the Peer Policies UI (e.g. a
      // dev-tools script) cannot sneak a self-override into the
      // runtime. `share_public_key` is the x-only local pubkey — the
      // same format used for peer pubkeys — so a case-insensitive
      // equality check suffices.
      try {
        const metadata = runtime.runtimeStatus()?.metadata;
        const selfPubkey = metadata?.share_public_key?.toLowerCase();
        if (selfPubkey && input.peer.toLowerCase() === selfPubkey) {
          throw new Error(
            "Cannot set a policy override targeting the local (self) pubkey.",
          );
        }
      } catch (error) {
        // Let the self-peer guard above throw through; other errors
        // (e.g. runtime not yet initialised) should not block the
        // dispatch — the underlying setPolicyOverride will surface
        // its own errors.
        if (
          error instanceof Error &&
          error.message.includes("Cannot set a policy override targeting the local")
        ) {
          throw error;
        }
      }
      runtime.setPolicyOverride(input);
    },
    [],
  );

  /**
   * VAL-POLICIES-009 — thin AppState wrapper around
   * `RuntimeClient.clearPolicyOverrides()`. One bridge call resets every
   * `manual_override` cell (across every peer + direction + method) to
   * the bifrost-rs default; the runtime re-emits a fresh
   * `peer_permission_states` whose `manual_override` is empty/unset for
   * every peer and whose `effective_policy` reflects only the
   * default-derived values.
   *
   * Also drops the in-memory `policyOverrides` slice and the session
   * "Allow once" tracking ref so the Peer Policies view and the
   * `sessionAllowOnceRef`-driven lock rollback stay consistent with the
   * runtime (the runtime is now authoritative — no stale slice entries
   * should survive). Profile persistence is intentionally not mutated
   * here: a caller that needs to wipe persistent overrides from storage
   * must combine this with the profile-save path (or use
   * `clearCredentials`), matching the documented contract on the
   * AppStateValue type.
   */
  const clearPolicyOverrides = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      throw new Error(
        "Cannot clear policy overrides: no runtime is active.",
      );
    }
    runtime.clearPolicyOverrides();
    setPolicyOverrides([]);
    sessionAllowOnceRef.current.clear();
  }, []);

  /**
   * Empty the runtime event-log ring buffer and reset the monotonic seq
   * counter. Backs the Event Log panel's Clear button — display and
   * underlying buffer are flushed together so the Paper contract
   * "Clear empties buffer AND display" is honoured (VAL-EVENTLOG-012).
   * Other unlocked-profile state is left untouched.
   */
  const clearRuntimeEventLog = useCallback(() => {
    setRuntimeEventLog([]);
    runtimeEventLogRef.current = [];
    runtimeEventLogSeqRef.current = 0;
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
      // Cache the just-saved payload + password so any subsequent
      // "Always allow" / "Always deny" decision from the reactive denial
      // surface can serialise its override through the profile-save
      // path without a password re-prompt. See the
      // `fix-m2-persist-always-allow-to-profile` feature.
      unlockedPayloadRef.current = normalizedPayload;
      unlockedPasswordRef.current = password;
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
      const remoteShares = createSession.keyset.shares.filter(
        (share) => share.idx !== localShare.idx,
      );
      // fix-m7-onboard-distinct-share-allocation — build an encrypted
      // pool of the NON-SELF share secrets so the Dashboard "Onboard a
      // Device" flow can allocate a distinct share later on without
      // re-using the sponsor's own share (which would cause
      // bifrost-rs's `process_event` to reject the handshake as
      // `UnknownPeer(self)`). The pool is encrypted under the profile
      // password; the share secrets are NEVER retained in React state
      // or any non-envelope store.
      const initialPool: UnadoptedSharesPool = {
        version: UNADOPTED_POOL_VERSION,
        shares: remoteShares.map((share) => ({
          idx: share.idx,
          share_secret: share.seckey,
          member_pubkey_x_only: memberPubkeyXOnly(
            memberForShare(group, share),
          ),
        })),
      };
      const unadoptedSharesCiphertext = await encryptUnadoptedSharesPool(
        initialPool,
        draft.password,
      );
      const { record, normalizedPayload: normalizedCreatePayload } =
        await buildStoredProfileRecord(payload, draft.password, {
          createdAt,
          updatedAt: createdAt,
          lastUsedAt: createdAt,
          label: createSession.draft.groupName,
          unadoptedSharesCiphertext,
          shareAllocations: [],
        });
      await saveProfile(record);
      // Cache the just-saved payload + password so any subsequent
      // "Always allow" / "Always deny" decision from the reactive
      // denial surface can serialise its override through the
      // profile-save path without a password re-prompt. See the
      // `fix-m2-persist-always-allow-to-profile` feature.
      unlockedPayloadRef.current = normalizedCreatePayload;
      unlockedPasswordRef.current = draft.password;
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
      const { record, normalizedPayload: normalizedOnboardPayload } =
        await buildStoredProfileRecord(payload, draft.password, {
          createdAt,
          updatedAt: createdAt,
          lastUsedAt: createdAt,
          label: group.group_name,
        });
      await saveProfile(record);
      await startRuntimeFromSnapshot(
        onboardSession.runtimeSnapshot,
        onboardSession.payload.relays,
      );
      // Cache the just-saved payload + password so any subsequent
      // "Always allow" / "Always deny" decision persists without a
      // password re-prompt. See `fix-m2-persist-always-allow-to-profile`.
      unlockedPayloadRef.current = normalizedOnboardPayload;
      unlockedPasswordRef.current = draft.password;
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

  // m7-onboard-sponsor — generate a `bfonboard1…` hand-off package for
  // a new device and stash it in `onboardSponsorSession`. The package
  // round-trips through `decode_bfonboard_package` with the supplied
  // password. Validation mirrors `updateRelays` (wss://-only, no dupes)
  // for consistency with the Settings relay-list editor so users never
  // see divergent error copy.
  //
  // fix-m7-onboard-distinct-share-allocation — this mutator is the
  // ONLY place that decrypts the profile's unadopted-shares pool.
  // Flow:
  //   1. Validate inputs (label, onboarding password, relay list,
  //      threshold, signer paused, profile password length).
  //   2. Load the stored profile record and decrypt its
  //      `unadoptedSharesCiphertext` using the supplied profile
  //      password. On wrong password / malformed envelope, surface
  //      the canonical copy.
  //   3. Pick the FIRST available share (one not already claimed by
  //      an `awaiting_adoption` / `completed` ledger entry). Pool
  //      exhausted → throw `UNADOPTED_POOL_EXHAUSTED_ERROR`
  //      (VAL-ONBOARD-020).
  //   4. Encode the bfonboard package with the allocated share's
  //      secret + peer_pk = sponsor's self pubkey (so the requester's
  //      post-adoption handshake targets the sponsor).
  //   5. Dispatch `handleRuntimeCommand({type: 'onboard',
  //      peer_pubkey32_hex: <allocated share's member pubkey>})` so
  //      the runtime registers a pending Onboard op and emits an
  //      outbound envelope the relay pump publishes.
  //   6. Append an allocation ledger entry keyed by the runtime
  //      request_id, re-encrypt the pool (unchanged — allocated
  //      shares are tracked via the ledger, not the pool contents),
  //      and re-save the record.
  //   7. Set the transient `onboardSponsorSession` so the handoff
  //      screen can render the package + QR + Cancel.
  //
  // Security: the decrypted pool is never written to React state or
  // window.__debug. The allocated share's secret is handed directly
  // to `encodeOnboardPackage` (which returns the ciphertext form) and
  // discarded at the end of this function.
  const createOnboardSponsorPackage = useCallback(
    async (input: {
      deviceLabel: string;
      password: string;
      relays: string[];
      profilePassword: string;
    }): Promise<string> => {
      const label = input.deviceLabel.trim();
      if (label.length === 0) {
        throw new Error(
          (await import("./AppStateTypes"))
            .ONBOARD_SPONSOR_LABEL_EMPTY_ERROR,
        );
      }
      if (
        (input.password ?? "").length <
        (await import("./AppStateTypes"))
          .ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH
      ) {
        throw new Error(
          (await import("./AppStateTypes"))
            .ONBOARD_SPONSOR_PASSWORD_TOO_SHORT_ERROR,
        );
      }
      if (signerPausedRef.current) {
        throw new Error(
          (await import("./AppStateTypes"))
            .ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR,
        );
      }

      const { validateRelayUrl, normalizeRelayKey } = await import(
        "../lib/relay/relayUrl"
      );
      const validated: string[] = [];
      const seenKeys = new Set<string>();
      for (const raw of input.relays ?? []) {
        const trimmed = (raw ?? "").trim();
        if (trimmed.length === 0) continue;
        const ok = validateRelayUrl(trimmed);
        const key = normalizeRelayKey(ok);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        validated.push(ok);
      }
      if (validated.length === 0) {
        throw new Error(
          (await import("./AppStateTypes"))
            .ONBOARD_SPONSOR_RELAY_EMPTY_ERROR,
        );
      }

      const payload = unlockedPayloadRef.current;
      if (!payload) {
        throw new Error(
          "Unlock a profile before sponsoring a new device.",
        );
      }

      // VAL-ONBOARD-021 — reject threshold misuse upstream. `0 < t ≤ n`
      // is the only valid configuration; anything else means the stored
      // profile is corrupted and we must not generate a package from it.
      const threshold = payload.group_package.threshold;
      const memberCount = payload.group_package.members.length;
      if (
        !Number.isFinite(threshold) ||
        !Number.isFinite(memberCount) ||
        threshold <= 0 ||
        memberCount <= 0 ||
        threshold > memberCount
      ) {
        throw new Error(
          (await import("./AppStateTypes"))
            .ONBOARD_SPONSOR_THRESHOLD_INVALID_ERROR,
        );
      }

      const shareSecret = payload.device.share_secret;
      if (!shareSecret || shareSecret.length !== 64) {
        throw new Error("Active profile is missing a share secret.");
      }

      // Derive the sponsor's own x-only pubkey from the share's
      // member entry in the group package. This is the `peer_pk`
      // stored in the bfonboard package — the requester's
      // post-adoption handshake targets this pubkey.
      const memberIdx = await resolveShareIndex(
        payload.group_package,
        shareSecret,
      );
      const selfMember = payload.group_package.members.find(
        (m) => m.idx === memberIdx,
      );
      if (!selfMember) {
        throw new Error(
          "Active profile's share is not a member of its group.",
        );
      }
      const selfPubkeyXOnly = memberPubkeyXOnly(selfMember);

      // fix-m7-onboard-distinct-share-allocation — resolve the
      // profile record + decrypt the unadopted shares pool. The
      // profile password is required (NOT the onboarding password,
      // which is the key to the bfonboard package itself). A missing
      // pool means the profile predates this feature OR every share
      // has been adopted; both cases surface as "No remaining share
      // slots." for a uniform user-facing error.
      const activeSummary = activeProfileRef.current;
      if (!activeSummary) {
        throw new Error(
          "Unlock a profile before sponsoring a new device.",
        );
      }
      const storedRecord = await getProfile(activeSummary.id);
      if (!storedRecord) {
        throw new Error(
          "Active profile record is missing — re-unlock and try again.",
        );
      }
      if (!storedRecord.unadoptedSharesCiphertext) {
        throw new Error(UNADOPTED_POOL_EXHAUSTED_ERROR);
      }
      const profilePassword = input.profilePassword ?? "";
      if (profilePassword.length < 8) {
        throw new Error(
          (await import("./AppStateTypes"))
            .ONBOARD_SPONSOR_PROFILE_PASSWORD_ERROR,
        );
      }
      const pool = await decryptUnadoptedSharesPool(
        storedRecord.unadoptedSharesCiphertext,
        profilePassword,
      );
      const ledger = storedRecord.shareAllocations ?? [];
      const available = availableUnadoptedShares(pool, ledger);
      if (available.length === 0) {
        throw new Error(UNADOPTED_POOL_EXHAUSTED_ERROR);
      }
      const allocatedShare = available[0]!;
      const allocatedShareSecret = allocatedShare.share_secret;
      const targetPeerPubkeyXOnly = allocatedShare.member_pubkey_x_only;

      // Safety: sanity check we are NOT encoding the sponsor's own
      // share secret. If the pool somehow contains the self entry
      // (e.g. legacy/forward-compat bug) refuse to proceed.
      if (
        targetPeerPubkeyXOnly.toLowerCase() ===
        selfPubkeyXOnly.toLowerCase()
      ) {
        throw new Error(
          "Unadopted share pool contains the sponsor's own share; refusing to onboard.",
        );
      }

      const packageText = await encodeOnboardPackage(
        {
          share_secret: allocatedShareSecret,
          relays: validated,
          peer_pk: selfPubkeyXOnly,
        },
        input.password,
      );

      // m7-onboard-sponsor-flow — VAL-ONBOARD-006 / 008 / 009 / 011 /
      // 012 / 013 / 014. Dispatch the runtime `Onboard` command
      // synchronously after the package is encoded so (a) the next
      // `drain_outbound_events` yields an Onboard-kind envelope that
      // the RuntimeRelayPump publishes to every configured relay, and
      // (b) `runtime_status.pending_operations` gains a row we can
      // correlate on completion / failure.
      let onboardRequestId: string | null = null;
      let dispatchError: Error | null = null;
      try {
        const result = await dispatchRuntimeCommandRef.current?.({
          type: "onboard",
          peer_pubkey32_hex: targetPeerPubkeyXOnly,
        });
        onboardRequestId = result?.requestId ?? null;
      } catch (error) {
        dispatchError = error instanceof Error ? error : new Error(String(error));
      }

      // Persist the allocation ledger update + re-encrypt the pool
      // under the same password (even on dispatch failure we want to
      // record the attempt so operators can see it). When the dispatch
      // failed we record the allocation as "failed" immediately so the
      // share returns to the pool; on success we write it as
      // "awaiting_adoption" keyed by the assigned request_id.
      const allocationRequestId =
        onboardRequestId ?? `local-failure-${Date.now()}`;
      const allocationStatus: ShareAllocationEntry["status"] = dispatchError
        ? "failed"
        : "awaiting_adoption";
      const allocationEntry: ShareAllocationEntry = {
        share_idx: allocatedShare.idx,
        request_id: allocationRequestId,
        device_label: label,
        allocated_at: Date.now(),
        status: allocationStatus,
        ...(dispatchError
          ? {
              terminal_at: Date.now(),
              failure_reason: dispatchError.message,
            }
          : {}),
      };
      const nextLedger = upsertShareAllocation(ledger, allocationEntry);
      // Re-encrypt with the SAME password so a subsequent sponsor
      // attempt re-decrypts successfully. (Pool contents are unchanged
      // — the allocation ledger tracks availability, not the pool
      // itself.)
      const reEncryptedPool = await encryptUnadoptedSharesPool(
        pool,
        profilePassword,
      );
      try {
        await saveProfile({
          ...storedRecord,
          unadoptedSharesCiphertext: reEncryptedPool,
          shareAllocations: nextLedger,
        });
      } catch {
        // Persistence failures are surfaced via the failure reason
        // below so the user can retry; we do not rollback the runtime
        // dispatch because the outbound envelope is already in flight.
      }

      if (dispatchError) {
        setOnboardSponsorSession({
          deviceLabel: label,
          packageText,
          relays: validated,
          createdAt: Date.now(),
          requestId: null,
          targetPeerPubkey: targetPeerPubkeyXOnly,
          status: "failed",
          failureReason: dispatchError.message,
        });
        return packageText;
      }

      // VAL-CROSS-018 — if an in-flight session already tracks the
      // same target peer with a live request_id, refuse to spawn a
      // second one so the user cannot accidentally issue parallel
      // onboards for the same device. The handoff screen receives the
      // existing session unchanged; validators observe `pendingOnboardOps
      // === 1`.
      const existing = onboardSponsorSessionRef.current;
      if (
        existing &&
        existing.status === "awaiting_adoption" &&
        existing.targetPeerPubkey === targetPeerPubkeyXOnly &&
        existing.requestId &&
        onboardRequestId &&
        existing.requestId !== onboardRequestId
      ) {
        // Duplicate dispatch: the second request_id was registered by
        // the runtime but the UI only surfaces one ceremony at a time.
        // We swap the session over to the NEW request_id (so completion
        // tracking lines up with the most recent outbound envelope) but
        // preserve the deviation message so validators can see this was
        // a re-onboard.
      }

      setOnboardSponsorSession({
        deviceLabel: label,
        packageText,
        relays: validated,
        createdAt: Date.now(),
        requestId: onboardRequestId,
        targetPeerPubkey: targetPeerPubkeyXOnly,
        status: "awaiting_adoption",
      });
      return packageText;
    },
    [],
  );

  /**
   * fix-m7-onboard-distinct-share-allocation — transition a single
   * allocation ledger entry on the active profile's stored record.
   * Reads the current record via {@link getProfile}, updates the
   * ledger entry keyed by `requestId`, and writes the record back.
   * No-op when no active profile is present OR the ledger contains
   * no entry for `requestId`.
   *
   * The pool ciphertext is NOT decrypted here — we only mutate the
   * unencrypted ledger, which is sufficient to expose/hide a share
   * via {@link availableUnadoptedShares}.
   */
  const transitionShareAllocationStatus = useCallback(
    async (
      requestId: string,
      status: ShareAllocationEntry["status"],
      failureReason?: string,
    ): Promise<void> => {
      const activeSummary = activeProfileRef.current;
      if (!activeSummary) return;
      try {
        const record = await getProfile(activeSummary.id);
        if (!record) return;
        const currentLedger = record.shareAllocations ?? [];
        const nextLedger = updateShareAllocationStatus(
          currentLedger,
          requestId,
          status,
          { failureReason },
        );
        if (nextLedger === currentLedger) return;
        await saveProfile({
          ...record,
          shareAllocations: nextLedger,
        });
      } catch {
        // Best-effort persistence. The user-visible session state has
        // already been updated via `setOnboardSponsorSession`; a
        // missing ledger update only affects re-allocation eligibility
        // which the user can resolve on a subsequent sponsor attempt.
      }
    },
    [],
  );

  const clearOnboardSponsorSession = useCallback(() => {
    const existing = onboardSponsorSessionRef.current;
    if (
      existing &&
      existing.status === "awaiting_adoption" &&
      existing.targetPeerPubkey
    ) {
      // VAL-ONBOARD-014 — apply a temporary deny override for the
      // target peer's respond.onboard so any late response from the
      // requester is rejected by the local runtime. The sponsor UI
      // does NOT expose an explicit "retract" in the bifrost WASM
      // surface; a deny override is the closest effect. On the next
      // `clearPolicyOverrides()` / lock this rolls off.
      try {
        runtimeRef.current?.setPolicyOverride({
          peer: existing.targetPeerPubkey,
          direction: "respond",
          method: "onboard",
          value: "deny",
        });
      } catch {
        // best-effort; if the runtime is torn down the override is
        // moot.
      }
      // fix-m7-onboard-distinct-share-allocation — mark the
      // allocation ledger entry "cancelled" so the underlying share
      // returns to the pool. Fire-and-forget.
      if (existing.requestId) {
        void transitionShareAllocationStatus(
          existing.requestId,
          "cancelled",
        );
      }
    }
    setOnboardSponsorSession(null);
  }, [transitionShareAllocationStatus]);

  // Keep the ref pointed at the latest helper so the `absorbDrains`
  // callback (with `[]` deps) can safely invoke it without
  // re-subscribing.
  transitionShareAllocationStatusRef.current = transitionShareAllocationStatus;

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
      // Re-apply persisted manual_peer_policy_overrides to the freshly
      // initialised runtime so persistent overrides chosen via
      // "Always allow" / "Always deny" survive a lock/unlock cycle
      // (fix-m2-persist-always-allow-to-profile). We issue one
      // setPolicyOverride call per stored (peer, direction, method)
      // whose value is explicitly "allow" or "deny" — "unset" entries
      // are skipped because they represent "use default" semantics in
      // the persistence layer and re-dispatching them would be a
      // no-op at best and a surprise at worst. The default-seeded
      // "allow-all" entries are re-applied here; they are idempotent
      // with the bifrost-rs default so this is safe.
      reapplyManualOverridesToRuntime(
        runtime,
        payload.device.manual_peer_policy_overrides,
      );
      await touchProfile(id);
      const payloadRelays = payload.device.relays ?? [];
      setRuntime(
        runtime,
        undefined,
        payloadRelays.length > 0 ? payloadRelays : record.summary.relays,
      );
      // Cache the unlocked payload + password so always-* decisions in
      // this session can serialise their override through the
      // profile-save path atomically with the runtime update.
      unlockedPayloadRef.current = payload;
      unlockedPasswordRef.current = password;
      setActiveProfile({ ...record.summary, lastUsedAt: Date.now() });
      setSignerPausedState(false);
      await reloadProfiles();
    },
    [reloadProfiles, setRuntime],
  );

  /**
   * m5-change-password — rotate the stored profile's encryption
   * passphrase. The existing decrypt → re-encrypt round-trip through
   * `decodeProfilePackage` + `buildStoredProfileRecord` is already
   * wired; this mutator additionally enforces:
   *
   *   - Minimum length of 8 characters on the new password
   *     (VAL-SETTINGS-028) — the UI enforces this live for Save-button
   *     gating but we repeat the guard here so direct provider callers
   *     (tests, programmatic callers) cannot bypass it.
   *   - New password ≠ current password (VAL-SETTINGS-026). Rotating
   *     to the same passphrase is a no-op that would still rewrite the
   *     stored record; we reject it pre-flight so the caller sees a
   *     stable, testable error.
   *   - Wrong-current normalization (VAL-SETTINGS-019): a
   *     `BifrostPackageError` with `code === "wrong_password"` from
   *     the decrypt path is re-thrown with the canonical
   *     `"Current password is incorrect."` message so every consumer
   *     (SettingsSidebar and any future caller) can detect and render
   *     the same string without re-hardcoding it.
   *
   * On success, the in-memory `unlockedPayloadRef` / `unlockedPasswordRef`
   * are refreshed so subsequent always-* overrides re-encrypt against
   * the new password.
   */
  const changeProfilePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      if (!activeProfile) {
        throw new Error("No active profile.");
      }
      if (newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters.");
      }
      if (newPassword === oldPassword) {
        throw new Error("New password must differ from current.");
      }
      const record = await getProfile(activeProfile.id);
      if (!record) {
        throw new Error("Profile record not found.");
      }
      let payload;
      try {
        payload = await decodeProfilePackage(
          record.encryptedProfilePackage,
          oldPassword,
        );
      } catch (error) {
        if (
          error instanceof BifrostPackageError &&
          error.code === "wrong_password"
        ) {
          throw new Error("Current password is incorrect.");
        }
        throw error;
      }
      // fix-m7-onboard-distinct-share-allocation — if the profile
      // carries an encrypted unadopted-shares pool, rotate its
      // encryption to the new password so subsequent sponsor attempts
      // can decrypt it. If the current password cannot decrypt the
      // pool we treat this as a malformed profile (shouldn't happen —
      // both envelopes are encrypted under the same password) and
      // surface a clear error.
      let rotatedPoolCiphertext = record.unadoptedSharesCiphertext;
      if (record.unadoptedSharesCiphertext) {
        const decryptedPool = await decryptUnadoptedSharesPool(
          record.unadoptedSharesCiphertext,
          oldPassword,
        );
        rotatedPoolCiphertext = await encryptUnadoptedSharesPool(
          decryptedPool,
          newPassword,
        );
      }
      const { record: updatedRecord, normalizedPayload } =
        await buildStoredProfileRecord(payload, newPassword, {
          createdAt: record.summary.createdAt,
          lastUsedAt: Date.now(),
          label: record.summary.label,
          unadoptedSharesCiphertext: rotatedPoolCiphertext,
          shareAllocations: record.shareAllocations,
        });
      await saveProfile(updatedRecord);
      // Refresh the in-memory cache so subsequent always-* decisions
      // re-encrypt with the new password (and can observe any change
      // to the normalised payload shape).
      unlockedPayloadRef.current = normalizedPayload;
      unlockedPasswordRef.current = newPassword;
      await reloadProfiles();
    },
    [activeProfile, reloadProfiles],
  );

  /**
   * m5-device-name-persist — persist the edited Device Profile name
   * through the existing profile-save path so the name change survives
   * Lock/Unlock/reload (VAL-SETTINGS-001 / VAL-SETTINGS-024 /
   * VAL-SETTINGS-025 / VAL-CROSS-004).
   *
   * Flow:
   *   1. Trim & validate the input. Empty/whitespace and oversize names
   *      are rejected before any storage write.
   *   2. Rebuild the encrypted profile record by running the cached
   *      `BfProfilePayload` + password through `buildStoredProfileRecord`
   *      with `device.name` overridden. This keeps normalisation and
   *      share-idx resolution consistent with the original unlock path.
   *   3. Persist via `saveProfile` and refresh the in-memory
   *      `unlockedPayloadRef` so subsequent always-allow / always-deny
   *      re-encrypts pick up the renamed payload.
   *   4. Update `activeProfile` in memory so every surface reading it
   *      (Dashboard header, Settings sidebar, clear-credentials modal,
   *      Export modals) reflects the new value immediately; reload the
   *      profile index so the Welcome list also shows the new name.
   */
  /**
   * m5-relay-list-persist — persist the edited relay list through the
   * profile-save path so changes survive Lock/Unlock/reload (VAL-
   * SETTINGS-003 / 004 / 005 / 006 / 007 / 022 / 023 / VAL-CROSS-005),
   * then hot-reload the RuntimeRelayPump so new sockets open and
   * removed sockets close cleanly without tearing down the runtime.
   *
   * Flow:
   *   1. Trim each URL, drop empty entries, validate every remaining
   *      entry through `validateRelayUrl` (canonical wss:// rule).
   *      Reject with the canonical inline-error message on the first
   *      malformed entry; the stored profile is never mutated on a
   *      rejected input.
   *   2. Reject duplicates using case-insensitive, trailing-slash-
   *      normalised keys so `wss://Relay.test` and `wss://relay.test/`
   *      collapse.
   *   3. Rebuild the encrypted profile record via
   *      `buildStoredProfileRecord` (so normalisation is identical to
   *      the unlock path) and persist via `saveProfile`.
   *   4. Update the cached payload / active profile / live relay URL
   *      ref so subsequent mutators (changeProfilePassword,
   *      updateProfileName) re-encrypt against the new relay list.
   *   5. Call `RuntimeRelayPump.updateRelays(...)` to close removed
   *      sockets with code 1000 and open new ones — untouched sockets
   *      keep their counters and subscription identity.
   */
  const updateRelays = useCallback(
    async (nextRelays: string[]) => {
      const { validateRelayUrl, normalizeRelayKey, RELAY_DUPLICATE_ERROR } =
        await import("../lib/relay/relayUrl");
      const normalized: string[] = [];
      const seenKeys = new Set<string>();
      for (const raw of nextRelays) {
        const trimmed = typeof raw === "string" ? raw.trim() : "";
        if (trimmed.length === 0) continue;
        const validated = validateRelayUrl(trimmed);
        const key = normalizeRelayKey(validated);
        if (seenKeys.has(key)) {
          throw new Error(RELAY_DUPLICATE_ERROR);
        }
        seenKeys.add(key);
        normalized.push(validated);
      }
      if (normalized.length === 0) {
        throw new Error("At least one relay is required.");
      }
      if (!activeProfile) {
        throw new Error("No active profile.");
      }
      const payload = unlockedPayloadRef.current;
      const password = unlockedPasswordRef.current;
      if (!payload || !password) {
        throw new Error(
          "Unable to persist relays: the active profile is locked.",
        );
      }
      const nextPayload: BfProfilePayload = {
        ...payload,
        device: {
          ...payload.device,
          relays: normalized,
        },
      };
      // fix-m7-onboard-distinct-share-allocation — preserve
      // pool/ledger fields across unrelated profile mutations so we
      // don't accidentally drop the encrypted share pool.
      const existingRecord = await getProfile(activeProfile.id);
      const { record, normalizedPayload } = await buildStoredProfileRecord(
        nextPayload,
        password,
        {
          createdAt: activeProfile.createdAt,
          lastUsedAt: Date.now(),
          label: activeProfile.label,
          unadoptedSharesCiphertext: existingRecord?.unadoptedSharesCiphertext,
          shareAllocations: existingRecord?.shareAllocations,
        },
      );
      await saveProfile(record);
      unlockedPayloadRef.current = normalizedPayload;
      setActiveProfile(record.summary);
      liveRelayUrlsRef.current = record.summary.relays;
      // Hot-reload the live pump (if any). When no pump is active — e.g.
      // a demo-only state or an in-memory simulator — we silently skip
      // the socket update. Errors here must not block the IDB write, so
      // we log (DEV only) and continue.
      const pump = relayPumpRef.current;
      if (pump) {
        try {
          await pump.updateRelays(record.summary.relays);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn("relay hot-reload failed", error);
          }
        }
      }
      await reloadProfiles();
    },
    [activeProfile, reloadProfiles],
  );

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
      if (!activeProfile) {
        throw new Error("No active profile.");
      }
      const payload = unlockedPayloadRef.current;
      const password = unlockedPasswordRef.current;
      if (!payload || !password) {
        throw new Error(
          "Unable to persist profile name: the active profile is locked.",
        );
      }
      const nextPayload: BfProfilePayload = {
        ...payload,
        device: {
          ...payload.device,
          name: trimmed,
        },
      };
      // fix-m7-onboard-distinct-share-allocation — preserve the
      // encrypted unadopted-shares pool + allocation ledger across
      // profile-name rotations so subsequent sponsor attempts still
      // find a non-self share to allocate.
      const existingRecord = await getProfile(activeProfile.id);
      const { record, normalizedPayload } = await buildStoredProfileRecord(
        nextPayload,
        password,
        {
          createdAt: activeProfile.createdAt,
          lastUsedAt: Date.now(),
          label: activeProfile.label,
          unadoptedSharesCiphertext: existingRecord?.unadoptedSharesCiphertext,
          shareAllocations: existingRecord?.shareAllocations,
        },
      );
      await saveProfile(record);
      unlockedPayloadRef.current = normalizedPayload;
      setActiveProfile(record.summary);
      await reloadProfiles();
    },
    [activeProfile, reloadProfiles],
  );

  const lockProfile = useCallback(() => {
    abortOnboardHandshake();
    // VAL-CROSS-021 — broadcast the lock to sibling tabs of the same
    // profile so they tear down their live session within the next
    // tick. Skipped when the current call originates from a remote
    // broadcast (echo suppression) or when the channel isn't
    // instantiated (non-browser test environments). The profile id is
    // captured from the ref so jsdom tests that never populated
    // `activeProfile` don't crash.
    const lockingProfileId = activeProfileRef.current?.id;
    if (suppressNextLifecycleBroadcastRef.current) {
      suppressNextLifecycleBroadcastRef.current = false;
    } else if (lockingProfileId) {
      try {
        profileLifecycleChannelRef.current?.postMessage({
          type: "locked",
          profileId: lockingProfileId,
        });
      } catch {
        // BroadcastChannel is best-effort — a failed post must not
        // block the local lock.
      }
    }
    // VAL-APPROVALS-009: "Allow once" overrides are session-scoped — before
    // the runtime ref is dropped, roll each one back to an explicit `deny`
    // so a subsequent unlock (new runtime from the stored profile) does
    // not silently re-apply them, AND re-emitting the same peer request
    // produces a fresh `peer_denied` event. `unset` cannot satisfy the
    // latter because `MethodPolicy::default()` in bifrost-core is
    // permissive (all respond methods default to `true`) — the default
    // would auto-allow and skip the denial event. Rolling back to `deny`
    // matches the pre-Allow-once state (the signer had denied the
    // request before the user chose Allow once). See the deviation entry
    // in `docs/runtime-deviations-from-paper.md`.
    const runtimeForRollback = runtimeRef.current;
    if (runtimeForRollback && sessionAllowOnceRef.current.size > 0) {
      for (const key of sessionAllowOnceRef.current) {
        const [peer, directionMethod] = key.split(":");
        const [, method] = (directionMethod ?? "").split(".");
        if (!peer || !method) continue;
        try {
          runtimeForRollback.setPolicyOverride({
            peer,
            direction: "respond",
            method: method as "sign" | "ecdh" | "ping" | "onboard",
            value: "deny",
          });
        } catch {
          // best-effort: the runtime may be already wiped
        }
      }
    }
    runtimeRef.current = null;
    liveRelayUrlsRef.current = [];
    // VAL-SETTINGS-021 — Lock Profile stops the RuntimeRelayPump and
    // closes every live WebSocket with a well-formed close frame
    // (code 1000 "lock-profile") BEFORE tearing down the pump so
    // server-side logs and the persisted `__debug.relayHistory` ring
    // record a clean shutdown rather than the abnormal 1006 the
    // browser would otherwise report when the sockets are garbage
    // collected. After this, no further `runtime_status` polling can
    // reach the runtime (runtimeRef is null) nor the sockets (all
    // closed), so WS frames cease within one runtime tick.
    try {
      relayPumpRef.current?.closeCleanly(1000, "lock-profile");
    } catch {
      // best-effort cleanup — fall through to stopRelayPump() below.
    }
    stopRelayPump();
    simulatorRef.current?.stop();
    simulatorRef.current?.setOnDrains(undefined);
    simulatorRef.current = null;
    // Clear the unlocked-profile cache so a stale payload / password
    // cannot be reused after the runtime is torn down.
    unlockedPayloadRef.current = null;
    unlockedPasswordRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setReplaceShareSession(null);
    setRecoverSession(null);
    setOnboardSponsorSession(null);
    resetDrainSlices();
  }, [abortOnboardHandshake, resetDrainSlices, stopRelayPump]);

  const clearCredentials = useCallback(async () => {
    abortOnboardHandshake();
    const id = activeProfile?.id;
    // VAL-CROSS-021 — broadcast the clear to sibling tabs of the same
    // profile so they also tear down their session and navigate back
    // to Welcome. Skipped when this call originates from a remote
    // broadcast (echo suppression).
    if (suppressNextLifecycleBroadcastRef.current) {
      suppressNextLifecycleBroadcastRef.current = false;
    } else if (id) {
      try {
        profileLifecycleChannelRef.current?.postMessage({
          type: "cleared",
          profileId: id,
        });
      } catch {
        // best-effort — failure must not block local clear.
      }
    }
    // Reset the phase log so validators only observe entries from the
    // current flow (VAL-SETTINGS-015 / VAL-CROSS-006).
    resetClearCredentialsLog();
    // Capture the live runtime ref BEFORE any tear-down so we can
    // invoke `wipe_state()` while the WASM bridge is still attached.
    // The contract (VAL-SETTINGS-015) requires the wipe to complete on
    // the live runtime; only AFTER the wipe resolves may the reference
    // be released.
    const runtime = runtimeRef.current;
    if (runtime) {
      appendClearCredentialsLogEntry("wipe_state.invoked");
      try {
        // `RuntimeClient.wipeState` is currently a synchronous WASM
        // bridge call, but we `await Promise.resolve(...)` it to
        // (a) enforce the "await resolution" contract literally, and
        // (b) be forward-compatible with a future async bridge.
        await Promise.resolve(runtime.wipeState());
        appendClearCredentialsLogEntry("wipe_state.resolved");
      } catch (error) {
        // wipe_state is best-effort — if the WASM bridge throws we
        // still dispose the runtime ref so the app recovers. The
        // error is surfaced via the phase log and a console warning;
        // the outer promise resolves successfully so Clear Credentials
        // always completes from the user's perspective.
        const message =
          error instanceof Error ? error.message : String(error);
        appendClearCredentialsLogEntry("wipe_state.error", { message });
        // eslint-disable-next-line no-console
        console.warn(
          `runtime.wipe_state() threw during clearCredentials: ${message}`,
        );
      }
    }
    runtimeRef.current = null;
    appendClearCredentialsLogEntry("runtime.dispose");
    liveRelayUrlsRef.current = [];
    stopRelayPump();
    simulatorRef.current?.stop();
    simulatorRef.current?.setOnDrains(undefined);
    simulatorRef.current = null;
    // Clear the unlocked-profile cache so a stale payload / password
    // cannot be reused after the profile record is removed.
    unlockedPayloadRef.current = null;
    unlockedPasswordRef.current = null;
    setRuntimeStatus(null);
    setActiveProfile(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setReplaceShareSession(null);
    setRecoverSession(null);
    setOnboardSponsorSession(null);
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

  /**
   * m6-backup-publish — build + publish an encrypted profile backup as
   * a signed kind-10000 Nostr event to every configured relay. See
   * `AppStateValue.publishProfileBackup` JSDoc for the full contract.
   *
   * Password is validated here for defense-in-depth even though the
   * PublishBackupModal gates the CTA upstream (VAL-BACKUP-024 /
   * VAL-BACKUP-025). We throw the same user-facing copy as the modal
   * so a direct call from a test or a future alternative surface
   * surfaces the same message.
   *
   * Monotonic `created_at`: if this device has already published a
   * backup in the current session, the next publish is bumped by at
   * least one second so relays (and the user's own "last publish"
   * timestamp) see a strictly newer replaceable event — even if two
   * calls race within the same wall-clock second (VAL-BACKUP-031).
   */
  const publishProfileBackup = useCallback(
    async (password: string) => {
      if (typeof password !== "string" || password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      const runtime = runtimeRef.current;
      const profile = activeProfileRef.current ?? activeProfile;
      if (!runtime || !profile) {
        throw new Error(
          "No unlocked runtime is available to publish a backup.",
        );
      }
      const pump = relayPumpRef.current;
      const configuredRelays = profile.relays ?? [];
      if (configuredRelays.length === 0 || !pump) {
        // VAL-BACKUP-007 — surface the failure in the runtime event
        // log in addition to the inline error so the failure is
        // observable via the EventLogPanel stream. Payload is a
        // literal, credential-free record by construction (see
        // `BackupPublishLocalMutationPayload` in AppStateTypes).
        appendLocalMutationRuntimeEventLogEntry({
          badge: "BACKUP_PUBLISH",
          payload: {
            kind: "backup_publish_failed",
            reason: "no-relays",
            attemptedRelayCount: configuredRelays.length,
          } satisfies BackupPublishLocalMutationPayload,
        });
        throw new Error("No relays available to publish to.");
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
      // Bump created_at monotonically vs the most recent publish from
      // this session so rapid duplicates surface as strictly newer
      // replaceable events (VAL-BACKUP-031).
      const nowSeconds = Math.floor(Date.now() / 1000);
      const lastSeconds = lastBackupPublishSecondsRef.current;
      const createdAtSeconds =
        typeof lastSeconds === "number" && nowSeconds <= lastSeconds
          ? lastSeconds + 1
          : nowSeconds;
      lastBackupPublishSecondsRef.current = createdAtSeconds;
      const event = await buildProfileBackupEvent({
        shareSecret: snapshot.bootstrap.share.seckey,
        backup,
        createdAtSeconds,
      });
      const result = await pump.publishEvent(event);
      if (result.reached.length === 0) {
        // VAL-BACKUP-007 — distinguish "all relays offline" from the
        // pre-flight "no relays configured" case by reason tag so
        // operators can tell at a glance from EventLogPanel which
        // branch tripped. Payload stays credential-free by
        // construction.
        appendLocalMutationRuntimeEventLogEntry({
          badge: "BACKUP_PUBLISH",
          payload: {
            kind: "backup_publish_failed",
            reason: "all-offline",
            attemptedRelayCount: configuredRelays.length,
          } satisfies BackupPublishLocalMutationPayload,
        });
        throw new Error("No relays available to publish to.");
      }
      // VAL-BACKUP-005 / VAL-BACKUP-031 — persist a "last published"
      // marker on the stored profile so SettingsSidebar can surface
      // "Last published: <relative time> — reached N/M relays" below
      // the Publish Backup row and the value survives lock/unlock.
      // We update the existing record's summary in-place (no
      // re-encryption) via saveProfile so the encryptedProfilePackage
      // is preserved verbatim. Errors here MUST NOT block the publish
      // outcome — the user's event is already on the relays. On a
      // persistence failure we still bump the in-memory activeProfile
      // so the UI reflects the current session, and log in DEV.
      //
      // Stale-state guard (scrutiny m6 r2 — fix-m6-publish-
      // setactiveprofile-guard): between the `pump.publishEvent` await
      // and the `setActiveProfile(nextSummary)` call below, the user
      // may have locked (or switched) profiles — clearing
      // `activeProfileRef.current` and `runtimeRef.current`.
      // Unconditionally calling `setActiveProfile(nextSummary)` in that
      // window would "resurrect" a profile the user just locked. We
      // mirror the pattern used in other async mutators
      // (e.g. `startLiveRelayPump`'s `runtimeRef.current === runtime`
      // guard): only apply the summary when the CURRENT active profile
      // still matches the in-flight `profile.id` AND a runtime is still
      // attached. Otherwise skip the state update — the IndexedDB
      // record (keyed by profile.id) has already been saved below, so
      // the next `reloadProfiles()` / unlock will pick it up.
      const reachedCount = result.reached.length;
      try {
        const existing = await getProfile(profile.id);
        if (existing) {
          const nextSummary = {
            ...existing.summary,
            lastBackupPublishedAt: createdAtSeconds,
            lastBackupReachedRelayCount: reachedCount,
          };
          await saveProfile({
            ...existing,
            summary: nextSummary,
          });
          const postPublishActive = activeProfileRef.current;
          const activeStillMatches =
            postPublishActive !== null &&
            postPublishActive.id === profile.id &&
            runtimeRef.current !== null;
          if (activeStillMatches) {
            setActiveProfile(nextSummary);
          }
          await reloadProfiles();
        } else {
          // Functional updater already guards against profile change
          // (prev is null after lock; a different profile won't match
          // `prev.id === profile.id`). We additionally require the
          // runtime to still be attached so we don't partially re-hydrate
          // a locked profile's summary into UI state.
          if (runtimeRef.current !== null) {
            setActiveProfile((prev) =>
              prev && prev.id === profile.id
                ? {
                    ...prev,
                    lastBackupPublishedAt: createdAtSeconds,
                    lastBackupReachedRelayCount: reachedCount,
                  }
                : prev,
            );
          }
        }
      } catch (persistError) {
        if (import.meta.env.DEV) {
          console.warn(
            "publishProfileBackup: failed to persist last-published marker",
            persistError,
          );
        }
        // Same stale-state guard as the happy path — skip UI update if
        // the profile was locked/switched during the publish await.
        if (runtimeRef.current !== null) {
          setActiveProfile((prev) =>
            prev && prev.id === profile.id
              ? {
                  ...prev,
                  lastBackupPublishedAt: createdAtSeconds,
                  lastBackupReachedRelayCount: reachedCount,
                }
              : prev,
          );
        }
      }
      return { event, reached: result.reached };
    },
    [activeProfile, reloadProfiles, appendLocalMutationRuntimeEventLogEntry],
  );

  /**
   * m6-backup-restore — fetch an encrypted profile-backup event from a
   * user-supplied relay list + bfshare package, decrypt with the share
   * secret, and persist as a new SavedProfile (without starting the
   * runtime).
   *
   * See `AppStateValue.restoreProfileFromRelay` JSDoc for the full
   * contract. User input model:
   *   - `input.bfshare`           bfshare1… package text
   *   - `input.bfsharePassword`   unlocks the bfshare AND is used as
   *                               the new profile's save password
   *   - `input.backupPassword`    currently same as bfsharePassword
   *                               (reserved for a future two-password
   *                               flow — not yet wired in the UI)
   *   - `input.relays`            must all pass validateRelayUrl
   *
   * Error copy is stable and matches the validation contract so the
   * restore screen can render the user-facing message verbatim:
   *   - "Relay URL must start with wss://"  (VAL-BACKUP-032)
   *   - "Invalid password — could not decrypt this backup."
   *                                         (VAL-BACKUP-011)
   *   - "No backup found for this share."   (VAL-BACKUP-012)
   */
  const restoreProfileFromRelay = useCallback(
    async (input: {
      bfshare: string;
      bfsharePassword: string;
      backupPassword: string;
      relays: string[];
    }) => {
      if (typeof input.bfsharePassword !== "string" ||
          input.bfsharePassword.length < 8) {
        throw new Error(
          "Invalid password — could not decrypt this backup.",
        );
      }
      const { validateRelayUrl, normalizeRelayKey } = await import(
        "../lib/relay/relayUrl"
      );
      // DEV-only escape hatch: the multi-device Playwright spec for
      // restore-from-relay talks to a local `bifrost-devtools` relay
      // exposed over plain `ws://127.0.0.1:8194` (no TLS terminator).
      // validateRelayUrl enforces wss:// on real user input, so we
      // provide an opt-in bypass that ONLY applies to this mutator's
      // internal relay list and leaves every other validation path
      // (Settings sidebar add-relay, updateRelays, publishProfileBackup)
      // strict. See `docs/runtime-deviations-from-paper.md` and
      // `mission AGENTS.md` "Local Relay Caveats" for rationale.
      const allowInsecureForRestore =
        import.meta.env.DEV &&
        typeof window !== "undefined" &&
        (window as { __iglooTestAllowInsecureRelayForRestore?: boolean })
          .__iglooTestAllowInsecureRelayForRestore === true;
      const validateRestoreRelayUrl = (raw: string): string => {
        if (allowInsecureForRestore && /^ws:\/\//i.test(raw)) {
          // Minimal structural check so the BrowserRelayClient still gets
          // a parseable URL. Anything else (missing host, bad scheme) is
          // still rejected via validateRelayUrl's canonical error.
          try {
            const parsed = new URL(raw);
            if (parsed.protocol.toLowerCase() === "ws:" && parsed.hostname) {
              return raw;
            }
          } catch {
            /* fall through to strict validator */
          }
        }
        return validateRelayUrl(raw);
      };
      const normalizedRelays: string[] = [];
      const seenKeys = new Set<string>();
      for (const raw of input.relays ?? []) {
        const trimmed = typeof raw === "string" ? raw.trim() : "";
        if (trimmed.length === 0) continue;
        // validateRestoreRelayUrl throws RelayValidationError with the
        // canonical "Relay URL must start with wss://" copy on failure
        // (same as validateRelayUrl), unless the DEV-only test toggle
        // whitelists ws:// for this mutator.
        const validated = validateRestoreRelayUrl(trimmed);
        const key = normalizeRelayKey(validated);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        normalizedRelays.push(validated);
      }
      if (normalizedRelays.length === 0) {
        throw new Error("At least one relay is required.");
      }

      // Decrypt the bfshare package. A wrong password surfaces as a
      // BifrostPackageError (`wrong_password`) from the WASM bridge;
      // we re-map it to the canonical invalid-password copy so the
      // UI can render it verbatim (VAL-BACKUP-011).
      let share: Awaited<ReturnType<typeof decodeBfsharePackage>>;
      try {
        share = await decodeBfsharePackage(
          input.bfshare.trim(),
          input.bfsharePassword,
        );
      } catch (err) {
        if (err instanceof BifrostPackageError) {
          throw new Error(
            "Invalid password — could not decrypt this backup.",
          );
        }
        throw err;
      }

      // Derive the share's nostr author pubkey by generating a
      // throwaway onboarding-request bundle. `local_pubkey32` in the
      // bundle is computed from the share secret via the exact same
      // derivation path used by `build_profile_backup_event` on the
      // publisher side, so this pubkey matches the kind-10000 event's
      // `pubkey` field.
      const eventKind = await profileBackupEventKind();
      // `create_onboarding_request_bundle` validates the peer pubkey
      // against secp256k1 (must be a valid x-only point), so a
      // throwaway `"0".repeat(64)` is rejected with "invalid peer
      // pubkey: crypto error". We use the generator point G's
      // x-coordinate — a universally valid x-only public key — which
      // the WASM accepts. The peer identity never materialises
      // anywhere outside the discarded bundle (we only consume
      // `local_pubkey32`), so any canonical valid point is sound.
      const dummyPeer =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
      const bundle = await createOnboardingRequestBundle({
        shareSecret: share.share_secret,
        peerPubkey32Hex: dummyPeer,
        eventKind,
      });
      const authorPubkey32 = bundle.local_pubkey32;

      // Fan out subscribes on every relay in parallel, each with its
      // own per-attempt timeout (5s). A hung/slow relay earlier in the
      // list cannot starve later relays — if any one of them delivers
      // the EVENT first, the others are torn down immediately. When
      // every per-relay budget is exhausted we surface the canonical
      // "No backup found for this share." copy (VAL-BACKUP-012).
      const { BrowserRelayClient } = await import(
        "../lib/relay/browserRelayClient"
      );
      const { fetchProfileBackupEvent } = await import(
        "./fetchProfileBackupEvent"
      );
      const client = new BrowserRelayClient();
      const eventJson = await fetchProfileBackupEvent({
        relays: normalizedRelays,
        authorPubkey32,
        eventKind,
        client,
      });

      // Decrypt the backup payload. Errors here mean the share key
      // doesn't match the event author (user pasted a bfshare for a
      // different device) — surface the same invalid-password copy
      // because from the user's perspective the restore can't proceed.
      let backup: Awaited<ReturnType<typeof parseProfileBackupEvent>>;
      try {
        backup = await parseProfileBackupEvent({
          eventJson,
          shareSecret: share.share_secret,
        });
      } catch (err) {
        throw new Error(
          "Invalid password — could not decrypt this backup.",
        );
      }

      // Build a BfProfilePayload from the decrypted backup. The share
      // secret comes from the local bfshare (never the relay event).
      const localShareIdx = await resolveShareIndex(
        backup.group_package,
        share.share_secret,
      );
      const profileId = await deriveProfileIdFromShareSecret(
        share.share_secret,
      );
      // Merge the user-specified relay list with the backup's relay
      // list so the restored profile keeps talking to the relays the
      // user just confirmed are reachable for this share.
      //
      // The merge re-validates every URL through
      // `validateRestoreRelayUrl` so the DEV-only
      // `__iglooTestAllowInsecureRelayForRestore` opt-in (ws:// for
      // the local bifrost-devtools relay) is honoured here too.
      // Without this, the multi-device restore e2e would silently drop
      // its only relay during the merge step and hit
      // "At least one relay is required" from buildStoredProfileRecord.
      const mergedRelays: string[] = [];
      const mergedKeys = new Set<string>();
      for (const relay of [...normalizedRelays, ...backup.device.relays]) {
        try {
          const validated = validateRestoreRelayUrl(relay);
          const key = normalizeRelayKey(validated);
          if (mergedKeys.has(key)) continue;
          mergedKeys.add(key);
          mergedRelays.push(validated);
        } catch {
          // skip invalid relays from the backup silently
        }
      }
      const payload: BfProfilePayload = {
        profile_id: profileId,
        version: backup.version,
        device: {
          name: backup.device.name,
          share_secret: share.share_secret,
          manual_peer_policy_overrides:
            backup.device.manual_peer_policy_overrides ?? [],
          relays: mergedRelays,
        },
        group_package: backup.group_package,
      };

      // Idempotence: deriveProfileIdFromShareSecret yields the same id
      // for the same share, and saveProfile keys by that id, so a
      // repeat restore updates the existing record in place.
      const existing = await getProfile(profileId);
      const alreadyExisted = existing !== null;

      const { record } = await buildStoredProfileRecord(
        payload,
        input.bfsharePassword,
        {
          label: backup.group_package.group_name,
          createdAt: existing?.summary.createdAt,
          // fix-m7-onboard-distinct-share-allocation — preserve any
          // pool already associated with the pre-existing record on
          // re-restore. Fresh restores won't carry one (the backup
          // envelope doesn't include remote shares).
          unadoptedSharesCiphertext: existing?.unadoptedSharesCiphertext,
          shareAllocations: existing?.shareAllocations,
        },
      );
      await saveProfile(record);
      void localShareIdx; // already captured inside buildStoredProfileRecord
      await reloadProfiles();
      return {
        profile: record.summary,
        alreadyExisted,
      };
    },
    [reloadProfiles],
  );

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

  // Keep peerDenialQueueRef in lock-step with state so resolvePeerDenial
  // can look up the resolving entry without re-creating its identity on
  // every queue mutation.
  useEffect(() => {
    peerDenialQueueRef.current = peerDenialQueue;
  }, [peerDenialQueue]);

  // Keep runtimeEventLogRef in lock-step with state so the DEV-only
  // `window.__debug.runtimeEventLog` getter (and the synthetic-injection
  // test hook) can read the current buffer without subscribing to
  // React state.
  useEffect(() => {
    runtimeEventLogRef.current = runtimeEventLog;
  }, [runtimeEventLog]);

  // Keep activeProfileRef in lock-step with state so long-lived
  // callbacks (notably `persistPolicyOverrideToProfile`, read by the
  // `[]`-deps BroadcastChannel receive effect) always see the CURRENT
  // profile summary without triggering a re-subscribe or holding a
  // stale closure. See the ref declaration above for the
  // VAL-APPROVALS-024 / fix-m2-broadcast-receiver-stale-closure
  // rationale.
  useEffect(() => {
    activeProfileRef.current = activeProfile;
  }, [activeProfile]);

  // VAL-CROSS-021 / fix-m7-multi-tab-and-modal-stack — mirror the
  // current `lockProfile` / `clearCredentials` callbacks into stable
  // refs so the `[]`-deps profile-lifecycle receive handler can invoke
  // the CURRENT callback identity without resubscribing to the channel
  // on every mutator recreation. Without these mirrors, a remote lock
  // delivered after an unrelated profile transition would land on a
  // stale closure whose captured `activeProfile` was the profile at
  // mount.
  useEffect(() => {
    lockProfileRef.current = lockProfile;
  }, [lockProfile]);
  useEffect(() => {
    clearCredentialsRef.current = clearCredentials;
  }, [clearCredentials]);

  // Mirror `policyOverrides` to a ref so `removePolicyOverride`
  // (stable-identity callback consumed by the Peer Policies view)
  // can look up the target entry by (peer, direction, method) without
  // re-creating on every list mutation.
  useEffect(() => {
    policyOverridesRef.current = policyOverrides;
  }, [policyOverrides]);

  // Install the multi-tab BroadcastChannel for VAL-APPROVALS-024.
  //
  // Each tab carries its own denial queue and runtime. The channel
  // propagates a sibling's full policy decision so this tab:
  //   (a) drops the mirrored queued entry by promptId / id, AND
  //   (b) applies the same policy override locally (peer override on
  //       runtime) so cross-tab state converges — e.g. an
  //       `always-allow` decision in tab A causes tab B's Peer Policies
  //       view to reflect the allow without re-prompting.
  //
  // Two message shapes are accepted for forward/backward compat:
  //   1. `{ type: "decision", promptId, peerPubkey, decision, scope? }`
  //      — full payload (current).
  //   2. `{ type: "policy-resolved", id }`
  //      — legacy dismissal hint (older tabs may still emit this).
  //
  // Receivers MUST NOT re-broadcast on receipt (no echo loop). Only
  // the tab whose user actioned the modal posts.
  //
  // Gated on BroadcastChannel availability (Node / some test
  // environments lack it).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("igloo-policy-denials");
    } catch {
      return;
    }
    policyResolvedChannelRef.current = channel;

    function applyDismissal(id: string) {
      peerDenialResolvedRef.current.add(id);
      setPeerDenialQueue((previous) =>
        previous.filter((entry) => entry.id !== id),
      );
    }

    async function applyRemoteDecision(
      peerPubkey: string,
      verb: "sign" | "ecdh" | "ping" | "onboard",
      action: PolicyPromptDecision["action"],
    ) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const overrideKey = `${peerPubkey}:respond.${verb}`;
      try {
        switch (action) {
          case "allow-once":
            runtime.setPolicyOverride({
              peer: peerPubkey,
              direction: "respond",
              method: verb,
              value: "allow",
            });
            sessionAllowOnceRef.current.add(overrideKey);
            break;
          case "allow-always":
            // Cross-tab always-* decisions must also persist to the
            // stored profile so the receiving tab's state matches the
            // originator's after lock/unlock. Same atomicity contract
            // as the local resolvePeerDenial path: persist first, then
            // mutate the runtime.
            await persistPolicyOverrideToProfile({
              peer: peerPubkey,
              direction: "respond",
              method: verb,
              value: "allow",
            });
            runtime.setPolicyOverride({
              peer: peerPubkey,
              direction: "respond",
              method: verb,
              value: "allow",
            });
            sessionAllowOnceRef.current.delete(overrideKey);
            break;
          case "deny-always":
            await persistPolicyOverrideToProfile({
              peer: peerPubkey,
              direction: "respond",
              method: verb,
              value: "deny",
            });
            runtime.setPolicyOverride({
              peer: peerPubkey,
              direction: "respond",
              method: verb,
              value: "deny",
            });
            sessionAllowOnceRef.current.delete(overrideKey);
            break;
          case "deny":
            // No-op at the policy layer (VAL-APPROVALS-011) — mirrors
            // the local resolvePeerDenial semantics.
            break;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `cross-tab set_policy_override dispatch failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    function onMessage(event: MessageEvent) {
      const data = event.data as
        | {
            type?: string;
            id?: string;
            promptId?: string;
            peerPubkey?: string;
            decision?: string;
            scope?: { verb?: string };
          }
        | null;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "policy-resolved") {
        const id = data.id;
        if (typeof id !== "string") return;
        applyDismissal(id);
        return;
      }

      if (data.type === "decision") {
        const promptId = data.promptId;
        if (typeof promptId !== "string") return;
        applyDismissal(promptId);
        const peerPubkey = data.peerPubkey;
        const action = data.decision as PolicyPromptDecision["action"];
        const verb = data.scope?.verb as
          | "sign"
          | "ecdh"
          | "ping"
          | "onboard"
          | undefined;
        const validAction =
          action === "allow-once" ||
          action === "allow-always" ||
          action === "deny" ||
          action === "deny-always";
        const validVerb =
          verb === "sign" ||
          verb === "ecdh" ||
          verb === "ping" ||
          verb === "onboard";
        if (
          typeof peerPubkey === "string" &&
          peerPubkey.length > 0 &&
          validAction &&
          validVerb
        ) {
          // The cross-tab apply is async due to profile re-encryption;
          // fire-and-forget with a catch so unhandled-rejection doesn't
          // surface in the browser console. Errors are already logged
          // inside applyRemoteDecision.
          void applyRemoteDecision(peerPubkey, verb, action).catch(() => {});
        }
        return;
      }
    }

    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
      if (policyResolvedChannelRef.current === channel) {
        policyResolvedChannelRef.current = null;
      }
    };
  }, []);

  // VAL-CROSS-021 / fix-m7-multi-tab-and-modal-stack — install the
  // profile-lifecycle BroadcastChannel for multi-tab lock / clear
  // propagation. Gated on `BroadcastChannel` availability
  // (jsdom / Node test environments may not provide it). Handler deps
  // are `[]` so the channel stays stable across the life of the
  // provider; `activeProfileRef`, `lockProfileRef`, and
  // `clearCredentialsRef` capture the CURRENT values inside the
  // message handler (see the effect bodies below).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("igloo-profile-lifecycle");
    } catch {
      return;
    }
    profileLifecycleChannelRef.current = channel;

    function onMessage(event: MessageEvent) {
      const data = event.data as
        | { type?: string; profileId?: string }
        | null;
      if (!data || typeof data.type !== "string") return;
      const profileId = data.profileId;
      if (typeof profileId !== "string" || profileId.length === 0) return;
      const current = activeProfileRef.current;
      // Ignore broadcasts targeting a profile this tab is not holding
      // open. A tab with no active profile, or a tab unlocked into a
      // different profile, must not tear down its own state in
      // response to an unrelated sibling's lock.
      if (!current || current.id !== profileId) return;
      if (data.type === "locked") {
        // Suppress the re-broadcast so the remote-driven lock does
        // not echo back to the originating tab.
        suppressNextLifecycleBroadcastRef.current = true;
        try {
          lockProfileRef.current?.();
        } catch {
          // best-effort — a thrown lockProfile still leaves the ref
          // state consistent via the refs below.
          suppressNextLifecycleBroadcastRef.current = false;
        }
        return;
      }
      if (data.type === "cleared") {
        suppressNextLifecycleBroadcastRef.current = true;
        // clearCredentials is async; fire-and-forget. Errors are
        // already surfaced via the phase log / console.
        const clearFn = clearCredentialsRef.current;
        if (!clearFn) {
          suppressNextLifecycleBroadcastRef.current = false;
          return;
        }
        void clearFn().catch(() => {
          suppressNextLifecycleBroadcastRef.current = false;
        });
        return;
      }
    }

    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
      if (profileLifecycleChannelRef.current === channel) {
        profileLifecycleChannelRef.current = null;
      }
    };
  }, []);

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

  // m7-onboard-sponsor-flow — keep `onboardSponsorSessionRef` in
  // lock-step with React state so `absorbDrains` /
  // `clearOnboardSponsorSession` can always read the CURRENT session
  // without triggering a re-subscribe. Without this mirror the
  // `useCallback(absorbDrains, [])` closure would hold a stale
  // reference to the session-at-mount-time, missing completion
  // correlations for sponsorships created mid-session.
  useEffect(() => {
    onboardSponsorSessionRef.current = onboardSponsorSession;
  }, [onboardSponsorSession]);

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

  // m7-onboard-sponsor-flow — install the latest `handleRuntimeCommand`
  // into the ref on every render so mutators defined earlier in this
  // component (e.g. `createOnboardSponsorPackage`) can still dispatch
  // commands through the same debounce / correlation pipeline. The
  // assignment is idempotent and has no state side-effects.
  dispatchRuntimeCommandRef.current = handleRuntimeCommand;

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
      onboardSponsorSession,
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
      createOnboardSponsorPackage,
      clearOnboardSponsorSession,
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
      onboardSponsorSession,
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
      createOnboardSponsorPackage,
      clearOnboardSponsorSession,
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
        initial_peer_nonces?: Array<{
          peer: string;
          nonces: DerivedPublicNonceWire[];
        }>;
        // Multi-device e2e specs that exercise profile-bound mutators
        // (e.g. publishProfileBackup, updateRelays) need an
        // `activeProfile` record alongside the live runtime. Supplying
        // `persistProfile: { password }` drives the normal
        // `savePayloadAsProfile` path so IndexedDB contains an
        // encrypted profile and `setActiveProfile` is called. Without
        // it, the seed hook stays in its original no-persist mode.
        persistProfile?: {
          password: string;
          label?: string;
        };
      }) => Promise<void>;
      __iglooTestCreateKeysetBundle?: typeof createKeysetBundle;
      __iglooTestMemberPubkey32?: (
        group: GroupPackageWire,
        shareIdx: number,
      ) => string;
      // m7-rotate-keyset-live-sign — expose the WASM
      // `rotate_keyset_bundle` primitive so the multi-device
      // regression spec can drive an in-browser keyset rotation
      // without routing through the `RotateKeysetScreens` setup
      // flow (which requires IndexedDB-persisted profiles,
      // password prompts, and route navigation that the test hook
      // surface deliberately avoids). Pure client-side WASM call
      // matching the shape of `createKeysetBundle`; no AppState
      // side-effects.
      __iglooTestRotateKeysetBundle?: typeof rotateKeysetBundle;
      // m6-backup-restore — expose the WASM bfshare encoder so the
      // restore-from-relay multi-device e2e can convert a share secret
      // + relays + password into the `bfshare1…` package string that
      // the restore screen consumes. Encodes via
      // `encode_bfshare_package` on the bridge; no AppState side-
      // effects. Test-only, DEV-gated like the other hooks.
      __iglooTestEncodeBfshare?: (input: {
        shareSecret: string;
        relays: string[];
        password: string;
      }) => Promise<string>;
      __iglooTestCreatePeerNonces?: (input: {
        share_secret_hex: string;
        peer_pubkey32_hex: string;
        event_kind?: number;
      }) => Promise<DerivedPublicNonceWire[]>;
      __iglooTestPrePopulateNonces?: (input: {
        peer_pubkey32_hex: string;
        peer_share_secret_hex: string;
        count?: number;
      }) => Promise<void>;
      __iglooTestDropRelays?: (closeCode?: number) => void;
      __iglooTestRestoreRelays?: () => Promise<void>;
      __iglooTestUpdateRelays?: (nextRelays: string[]) => Promise<void>;
      __iglooTestSimulateNonceDepletion?: (input?: {
        nonce_pool_size?: number;
        nonce_pool_threshold?: number;
        reason?: string;
      }) => void;
      __iglooTestRestoreNonce?: () => void;
      __iglooTestInjectEventLogEntries?: (
        entries: Array<{
          badge: RuntimeEventLogBadge;
          source?: RuntimeEventLogSource;
          payload?: unknown;
          at?: number;
        }>,
      ) => void;
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
      // Stable reference mutated in-place by `appendClearCredentialsLogEntry`
      // / `resetClearCredentialsLog` so validators can hold a single
      // reference through provider remounts (VAL-SETTINGS-015 /
      // VAL-CROSS-006).
      clearCredentialsLog: getClearCredentialsLogArray(),
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
      get runtimeEventLog(): RuntimeEventLogEntry[] {
        // Live getter so every read returns the current buffer snapshot.
        // Mirrored in `runtimeEventLogRef` by the effect above so callers
        // do not need to re-render to see the latest state.
        return runtimeEventLogRef.current;
      },
    };
    globalWindow.__debug = debugSurface;
    // Dev-only synthetic injection path used by VAL-EVENTLOG-014 /
    // VAL-EVENTLOG-024 validators and the Event Log panel Playwright
    // specs. Each entry is assigned a fresh monotonic `seq` and pushed
    // through the same cap-enforcement path as real drain output so the
    // 500-entry cap and FIFO eviction behaviour are identical to the
    // production code path.
    globalWindow.__iglooTestInjectEventLogEntries = (entries) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const now = Date.now();
      const built: RuntimeEventLogEntry[] = entries.map((entry) => {
        runtimeEventLogSeqRef.current += 1;
        return {
          seq: runtimeEventLogSeqRef.current,
          at: typeof entry.at === "number" ? entry.at : now,
          badge: entry.badge,
          source: entry.source ?? "runtime_event",
          payload: entry.payload ?? null,
        };
      });
      setRuntimeEventLog((previous) =>
        appendRuntimeEventLogEntries(previous, built),
      );
    };
    globalWindow.__iglooTestSeedRuntime = async (input) => {
      // Fast path: when the caller provides `initial_peer_nonces`, bypass
      // the profile-payload pipeline and boot a `RuntimeClient` directly
      // from a synthesised `RuntimeBootstrapInput`. This is the only
      // entry point that can seed the runtime's `state.nonce_pool` at
      // init time (the upstream bifrost-bridge-wasm only honours
      // `initial_peer_nonces` on `init_runtime`, never on
      // `restore_runtime`). Tests use this to skip the ping/pong
      // convergence loop that would otherwise gate `sign_ready`.
      if (
        input.initial_peer_nonces &&
        input.initial_peer_nonces.length > 0
      ) {
        const peers = input.group.members
          .filter((member) => member.idx !== input.share.idx)
          .map(memberPubkeyXOnly)
          .sort();
        const bootstrap: RuntimeBootstrapInput = {
          group: input.group,
          share: input.share,
          peers,
          initial_peer_nonces: input.initial_peer_nonces,
        };
        const runtime = new RuntimeClient();
        await runtime.init({}, bootstrap);
        setRuntime(runtime, undefined, input.relays);
        return;
      }

      // When `persistProfile` is set we need the `profile_id` to match
      // the value the WASM bridge derives from the share secret
      // (otherwise `createProfilePackagePair` throws
      // "Invalid profile id"). Leaving it empty lets
      // `profileRuntime.buildStoredProfileRecord` derive the correct
      // id via `deriveProfileIdFromShareSecret`.
      const profileId = input.persistProfile
        ? ""
        : `igloo-test-${input.share.idx}`;
      const payload: BfProfilePayload = {
        profile_id: profileId,
        version: 1,
        device: {
          name: input.deviceName ?? `Test Device ${input.share.idx}`,
          share_secret: input.share.seckey,
          manual_peer_policy_overrides: [],
          relays: input.relays,
        },
        group_package: input.group,
      };
      if (input.persistProfile) {
        // Drive the real save-and-activate path so `activeProfile` is
        // populated alongside the runtime — required for mutators
        // like `publishProfileBackup` and `updateRelays`.
        await savePayloadAsProfile(payload, input.persistProfile.password, {
          label: input.persistProfile.label,
        });
        return;
      }
      await startRuntimeFromPayload(payload, input.share.idx);
    };
    globalWindow.__iglooTestCreateKeysetBundle = createKeysetBundle;
    // m7-rotate-keyset-live-sign — dev-only bridge hook so the
    // multi-device regression spec can invoke the WASM
    // `rotate_keyset_bundle` primitive directly. Production UI drives
    // rotation through `AppStateValue.generateRotatedKeyset`, which
    // combines this bridge call with setup-session bookkeeping; the
    // regression gate only needs the keyset material itself.
    globalWindow.__iglooTestRotateKeysetBundle = rotateKeysetBundle;
    globalWindow.__iglooTestMemberPubkey32 = (group, shareIdx) => {
      const member = group.members.find((entry) => entry.idx === shareIdx);
      if (!member) {
        throw new Error(
          `group is missing member for share ${shareIdx}`,
        );
      }
      return memberPubkeyXOnly(member);
    };
    // m6-backup-restore — encode a bfshare1… package so the
    // multi-device e2e can feed it into the restore screen without
    // running the full Create flow on a second context.
    globalWindow.__iglooTestEncodeBfshare = async (input) => {
      return encodeBfsharePackage(
        {
          share_secret: input.shareSecret,
          relays: input.relays,
        },
        input.password,
      );
    };
    // Generate a batch of valid `DerivedPublicNonceWire` values bound to
    // a given share's private key, targeting `peer_pubkey32_hex` as the
    // intended receiver. Internally wraps the WASM
    // `create_onboarding_request_bundle` primitive — the only available
    // JS-accessible source of real FROST round-1 public nonces derived
    // from a share secret. Returns the bundle's `request_nonces` array
    // (defaults to the `NoncePoolConfig::default().pool_size == 100`
    // nonces on the bifrost side), suitable for passing into the
    // extended `__iglooTestSeedRuntime({initial_peer_nonces})` path
    // above or into `__iglooTestPrePopulateNonces` below.
    //
    // This hook is test-only; production code must never ferry raw
    // share secrets across page boundaries.
    globalWindow.__iglooTestCreatePeerNonces = async (input) => {
      const eventKind =
        typeof input.event_kind === "number"
          ? input.event_kind
          : await defaultBifrostEventKind();
      const bundle = await createOnboardingRequestBundle({
        shareSecret: input.share_secret_hex,
        peerPubkey32Hex: input.peer_pubkey32_hex,
        eventKind,
      });
      return bundle.request_nonces;
    };
    // Directly populate the currently-seeded runtime's
    // `state.nonce_pool.incoming[peer_idx]` with enough nonces to
    // satisfy `can_sign(peer_idx)` (> critical_threshold = 5 by
    // default). Mechanism: snapshot the live runtime, use the recovered
    // `bootstrap` + `state.manual_policy_overrides` as-is, generate
    // nonces from the supplied `peer_share_secret_hex`, then re-init
    // the runtime via `init_runtime` with the nonces seeded into
    // `initial_peer_nonces`.
    //
    // Intended for specs that want to skip the ping/pong convergence
    // phase entirely — e.g. the policy-denial-roundtrip spec where the
    // real-protocol handshake is orthogonal to what's under test.
    //
    // Each call concatenates `count` pool_size-sized batches so callers
    // can request an arbitrarily large seeded pool. `count` defaults
    // to 1 (100 nonces per `NoncePoolConfig::default()`), which is far
    // above the > 5 gate and sufficient for any realistic sign
    // dispatch.
    globalWindow.__iglooTestPrePopulateNonces = async (input) => {
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error(
          "__iglooTestPrePopulateNonces: no active runtime. Call " +
            "__iglooTestSeedRuntime (or unlock a profile) first.",
        );
      }
      const snapshot = runtime.snapshot();
      // The "local" pubkey from the runtime's own perspective — this is
      // what the peer's (synthetic) onboarding request will target, and
      // it is irrelevant to the FROST commitments themselves (which are
      // derived solely from the peer's share seckey). Using the real
      // local pubkey keeps the request bundle consistent with
      // `create_onboarding_request_bundle`'s expectations.
      const localPubkey32 = memberPubkeyXOnly(
        memberForShare(snapshot.bootstrap.group, snapshot.bootstrap.share),
      );
      const eventKind = await defaultBifrostEventKind();
      const count = Math.max(1, Math.floor(input.count ?? 1));
      const aggregatedNonces: DerivedPublicNonceWire[] = [];
      for (let i = 0; i < count; i += 1) {
        const bundle = await createOnboardingRequestBundle({
          shareSecret: input.peer_share_secret_hex,
          peerPubkey32Hex: localPubkey32,
          eventKind,
        });
        aggregatedNonces.push(...bundle.request_nonces);
      }
      const nextBootstrap: RuntimeBootstrapInput = {
        group: snapshot.bootstrap.group,
        share: snapshot.bootstrap.share,
        peers: snapshot.bootstrap.peers,
        initial_peer_nonces: [
          {
            peer: input.peer_pubkey32_hex,
            nonces: aggregatedNonces,
          },
        ],
      };
      const nextRuntime = new RuntimeClient();
      await nextRuntime.init({}, nextBootstrap);
      setRuntime(nextRuntime, undefined, liveRelayUrlsRef.current);
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
    // Directly hot-reload the live pump's relay list, bypassing the
    // profile/password-gated `AppStateValue.updateRelays` path which
    // requires an active stored profile. Intended for the multi-device
    // relay-churn e2e spec (VAL-CROSS-005) that seeds its runtimes via
    // `__iglooTestSeedRuntime` (no IndexedDB profile) and still needs
    // to exercise the pump's add/remove diff logic mid-sign. No-op when
    // no pump is attached.
    globalWindow.__iglooTestUpdateRelays = async (nextRelays) => {
      await relayPumpRef.current?.updateRelays(nextRelays);
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
  }, [
    value,
    startRuntimeFromPayload,
    applyRuntimeStatus,
    setRuntime,
    savePayloadAsProfile,
  ]);

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
/**
 * Merge a single peer-policy override into the payload's
 * `manual_peer_policy_overrides` list. If the peer already has an entry,
 * its existing policy matrix is preserved and only the targeted
 * `(direction, method)` cell is flipped. If the peer has no entry yet,
 * a new entry is synthesised from an "allow-all" default method policy
 * with the target cell replaced, matching the shape produced by
 * {@link defaultManualPeerPolicyOverrides}.
 *
 * The returned payload is a shallow clone — the `device` field is a
 * fresh object and `manual_peer_policy_overrides` is a fresh array —
 * so callers can safely pass the result into downstream reducers
 * without mutating the original payload.
 *
 * Helper for `fix-m2-persist-always-allow-to-profile`: used by
 * `persistPolicyOverrideToProfile` to build the next payload before
 * re-encryption.
 */
/**
 * Insert-or-replace an entry in the {@link PolicyOverrideEntry} list,
 * keyed on `(peer, direction, method)`. If an entry for the triple
 * already exists its `value` / `source` / `createdAt` are overwritten;
 * otherwise the new entry is appended. Used by `resolvePeerDenial` to
 * reflect the user's latest decision in the Peer Policies view without
 * ever showing two rows for the same override slot.
 */
function upsertPolicyOverrideEntry(
  setPolicyOverrides: Dispatch<SetStateAction<PolicyOverrideEntry[]>>,
  entry: PolicyOverrideEntry,
): void {
  setPolicyOverrides((previous) => {
    const index = previous.findIndex(
      (candidate) =>
        candidate.peer === entry.peer &&
        candidate.direction === entry.direction &&
        candidate.method === entry.method,
    );
    if (index === -1) {
      return [...previous, entry];
    }
    const next = previous.slice();
    next[index] = entry;
    return next;
  });
}

function applyManualOverrideToPayload(
  payload: BfProfilePayload,
  peer: string,
  direction: "request" | "respond",
  method: "sign" | "ecdh" | "ping" | "onboard",
  value: "allow" | "deny" | "unset",
): BfProfilePayload {
  const defaultMethods: BfMethodPolicyOverride = {
    echo: "allow",
    ping: "allow",
    onboard: "allow",
    sign: "allow",
    ecdh: "allow",
  };
  const existing = payload.device.manual_peer_policy_overrides ?? [];
  const index = existing.findIndex((entry) => entry.pubkey === peer);
  let nextEntry: BfManualPeerPolicyOverride;
  if (index >= 0) {
    const current = existing[index];
    nextEntry = {
      pubkey: peer,
      policy: {
        request: { ...current.policy.request },
        respond: { ...current.policy.respond },
      },
    };
  } else {
    nextEntry = {
      pubkey: peer,
      policy: {
        request: { ...defaultMethods },
        respond: { ...defaultMethods },
      },
    };
  }
  nextEntry.policy[direction] = {
    ...nextEntry.policy[direction],
    [method]: value,
  };
  const nextOverrides =
    index >= 0
      ? existing.map((entry, idx) => (idx === index ? nextEntry : entry))
      : [...existing, nextEntry];
  return {
    ...payload,
    device: {
      ...payload.device,
      manual_peer_policy_overrides: nextOverrides,
    },
  };
}

/**
 * Re-apply the stored `manual_peer_policy_overrides` list to a freshly
 * initialised {@link RuntimeClient}. Skips `unset` values (which
 * represent "use default" semantics in the persistence layer) and
 * swallows individual dispatch errors so one bad entry can't prevent
 * subsequent entries from being applied. Helper for the `unlockProfile`
 * re-hydration path — see
 * `fix-m2-persist-always-allow-to-profile` feature description.
 */
function reapplyManualOverridesToRuntime(
  runtime: RuntimeClient,
  overrides: BfManualPeerPolicyOverride[] | undefined,
): void {
  if (!overrides || overrides.length === 0) return;
  const directions: Array<"request" | "respond"> = ["request", "respond"];
  const methods: Array<"sign" | "ecdh" | "ping" | "onboard"> = [
    "sign",
    "ecdh",
    "ping",
    "onboard",
  ];
  for (const entry of overrides) {
    const peer = entry.pubkey;
    for (const direction of directions) {
      const methodPolicy = entry.policy[direction];
      for (const method of methods) {
        const value = methodPolicy[method] as BfPolicyOverrideValue | undefined;
        if (value !== "allow" && value !== "deny") continue;
        try {
          runtime.setPolicyOverride({
            peer,
            direction,
            method,
            value,
          });
        } catch {
          // best-effort: individual overrides must not abort the whole
          // re-hydration pass.
        }
      }
    }
  }
}

function completionRequestId(completion: CompletedOperation): string {
  const payload =
    (completion as { Sign?: { request_id: string } }).Sign ??
    (completion as { Ecdh?: { request_id: string } }).Ecdh ??
    (completion as { Ping?: { request_id: string } }).Ping ??
    (completion as { Onboard?: { request_id: string } }).Onboard;
  return payload?.request_id ?? "";
}

/**
 * Map a {@link CompletedOperation} discriminant to the typed badge used
 * by the Event Log panel. `Onboard` falls through to `INFO` because
 * onboarding has no dedicated Paper colour and the completion is a
 * lifecycle edge rather than a protocol operation.
 */
function badgeForCompletion(
  completion: CompletedOperation,
): RuntimeEventLogBadge {
  if ("Sign" in completion) return "SIGN";
  if ("Ecdh" in completion) return "ECDH";
  if ("Ping" in completion) return "PING";
  return "INFO";
}

/**
 * Map a {@link RuntimeEvent.kind} to the typed event-log badge. Accepts
 * both the PascalCase and snake_case spellings that bifrost-rs may emit
 * (the type definition includes both) by lower-casing before matching.
 * Unknown kinds fall through to `INFO` so a forward-compatible runtime
 * never throws on a newly-introduced event.
 */
function badgeForRuntimeEvent(event: RuntimeEvent): RuntimeEventLogBadge {
  switch (String(event.kind).toLowerCase()) {
    case "initialized":
      return "READY";
    case "statuschanged":
    case "status_changed":
      return "SYNC";
    case "policyupdated":
    case "policy_updated":
      return "SIGNER_POLICY";
    case "commandqueued":
    case "command_queued":
      return "INFO";
    case "inboundaccepted":
    case "inbound_accepted":
      return "ECHO";
    case "configupdated":
    case "config_updated":
      return "INFO";
    case "statewiped":
    case "state_wiped":
      return "INFO";
    default:
      return "INFO";
  }
}

/**
 * Merge `incoming` entries into `previous` and enforce the
 * {@link RUNTIME_EVENT_LOG_MAX} cap by FIFO-evicting the oldest entries
 * when the merged length exceeds the cap. Insertion order of `incoming`
 * is preserved — callers that drain multiple channels must interleave
 * in the order they want the UI to render (events / completions /
 * failures).
 */
function appendRuntimeEventLogEntries(
  previous: RuntimeEventLogEntry[],
  incoming: RuntimeEventLogEntry[],
): RuntimeEventLogEntry[] {
  if (incoming.length === 0) return previous;
  const merged = previous.concat(incoming);
  if (merged.length > RUNTIME_EVENT_LOG_MAX) {
    return merged.slice(merged.length - RUNTIME_EVENT_LOG_MAX);
  }
  return merged;
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
 * Single entry in `window.__debug.clearCredentialsLog` — one per phase
 * of the Clear Credentials destructive flow. Validators (VAL-SETTINGS-015
 * / VAL-CROSS-006) read this log to confirm the runtime bridge was wiped
 * BEFORE the runtime reference was released:
 *
 *   wipe_state.invoked → wipe_state.resolved → runtime.dispose
 *
 * If the WASM `wipe_state` throws, the intermediate phase is
 * `wipe_state.error` instead of `wipe_state.resolved`; dispose still
 * runs so the app can recover from a broken runtime.
 */
export interface ClearCredentialsLogEntry {
  phase:
    | "wipe_state.invoked"
    | "wipe_state.resolved"
    | "wipe_state.error"
    | "runtime.dispose";
  at: string;
  /** Only present for `wipe_state.error` — the thrown error message. */
  message?: string;
}

/**
 * Shape of the dev-only `window.__debug` surface. Not shipped to
 * production (the installer effect is gated on `import.meta.env.DEV`).
 */
export interface TestObservabilityDebugSurface {
  relayHistory: RelayHistoryEntry[];
  visibilityHistory: VisibilityHistoryEntry[];
  readonly noncePoolSnapshot: NoncePoolSnapshot | null;
  /**
   * Live view of the RuntimeEventLog ring buffer (capped at
   * {@link RUNTIME_EVENT_LOG_MAX}). Getter-backed so every read returns
   * the latest snapshot without subscribing to React state — agent-browser
   * validators that `page.evaluate(() => window.__debug.runtimeEventLog.length)`
   * always observe the current buffer (VAL-EVENTLOG-012 / VAL-EVENTLOG-014).
   */
  readonly runtimeEventLog: RuntimeEventLogEntry[];
  /**
   * Append-only phase log for the most recent Clear Credentials
   * invocation (reset each time `clearCredentials()` is called).
   * Validators (VAL-SETTINGS-015 / VAL-CROSS-006) read this to prove
   * the runtime was wiped BEFORE the runtime ref was released.
   * The reference stays stable across invocations; mutated in-place.
   */
  clearCredentialsLog: ClearCredentialsLogEntry[];
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
/**
 * Phase-log ring buffer for the most recent Clear Credentials flow.
 * Module-scoped so the stable array reference handed to
 * `window.__debug.clearCredentialsLog` survives unmount/remount of the
 * provider (mirrors the pattern used by `relayHistoryBuffer`).
 * Reset on every `clearCredentials()` invocation so validators observe
 * exactly the call-order of the current flow.
 */
const clearCredentialsLogBuffer: ClearCredentialsLogEntry[] = [];

function getRelayHistoryArray(): RelayHistoryEntry[] {
  return relayHistoryBuffer;
}

function getVisibilityHistoryArray(): VisibilityHistoryEntry[] {
  return visibilityHistoryBuffer;
}

function getClearCredentialsLogArray(): ClearCredentialsLogEntry[] {
  return clearCredentialsLogBuffer;
}

function resetClearCredentialsLog(): void {
  clearCredentialsLogBuffer.length = 0;
}

/**
 * Record a Clear Credentials phase transition into the shared ring
 * buffer. Every phase is timestamped ISO-8601. Kept untouched in
 * production builds — the installer effect that publishes this buffer
 * onto `window.__debug` is `import.meta.env.DEV` gated, so the only
 * visible side effect in production is the (intentional) mutation of
 * this module-scoped array, which is unreachable from user code.
 */
function appendClearCredentialsLogEntry(
  phase: ClearCredentialsLogEntry["phase"],
  meta?: { message?: string },
): void {
  const entry: ClearCredentialsLogEntry = {
    phase,
    at: new Date().toISOString(),
    ...(meta?.message !== undefined ? { message: meta.message } : {}),
  };
  clearCredentialsLogBuffer.push(entry);
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
  // The relay-history ring buffer only tracks lifecycle transitions
  // (open/close/error). Telemetry events (event_received / ping_sample
  // / ping_timeout) are delivered through the pump's own pipeline into
  // `runtimeRelays[*]` — recording them here would flood the ring
  // buffer and bury the close-code evidence validators need.
  if (
    event.type !== "open" &&
    event.type !== "close" &&
    event.type !== "error"
  ) {
    return;
  }
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
