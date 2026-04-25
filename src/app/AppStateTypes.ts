import type {
  BfOnboardPayload,
  BfProfilePayload,
  CompletedOperation,
  EncryptedProfileBackup,
  KeysetBundle,
  OnboardingPackageView,
  OnboardingResponse,
  OperationFailure,
  RecoveredNsecResult,
  RotateKeysetBundleResult,
  RuntimeEvent,
  RuntimeSnapshotInput,
  RuntimeStatusSummary,
  SharePackageWire,
  StoredProfileSummary,
} from "../lib/bifrost/types";
import type { RuntimeCommand } from "../lib/bifrost/runtimeClient";
import type { NostrTextNoteEvent } from "../lib/nostr/testNote";
import type { RuntimeRelayStatus } from "../lib/relay/runtimeRelayPump";
import type { RuntimeExportPackages } from "./runtimeExports";

/** Web-demo-only password minimum. Production can keep a stricter policy. */
export const DEMO_PASSWORD_MIN_LENGTH = 4;
export const PROFILE_PASSWORD_TOO_SHORT_ERROR =
  `Profile password must be at least ${DEMO_PASSWORD_MIN_LENGTH} characters.`;
export const PACKAGE_PASSWORD_TOO_SHORT_ERROR =
  `Package password must be at least ${DEMO_PASSWORD_MIN_LENGTH} characters.`;

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
  // fix-followup-distribute-2a — the former `distributionPassword` /
  // `confirmDistributionPassword` fields were removed. Distribution
  // passwords are now collected PER-SHARE on the DistributeSharesScreen
  // (via the `encodeDistributionPackage(idx, password)` mutator), not
  // as part of the Create Profile form. Stored drafts from prior
  // releases that still include these keys are silently dropped on
  // load (see `defaultCreateProfileDraft` + the profile-drafts
  // migration comment in `src/app/profileDrafts.ts`).
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
  progress?: {
    relays: "pending" | "connecting" | "connected" | "failed";
    request: "pending" | "published" | "failed";
    response: "pending" | "candidate" | "received" | "failed";
    snapshot: "pending" | "built" | "failed";
    connectedRelays?: string[];
    publishedRelays?: string[];
    activeRequestCount?: number;
    responseCandidateCount?: number;
    lastResponseRelay?: string;
    lastRequestPublishFailure?: {
      relay: string;
      message: string;
      attempt: number;
    };
    lastEventAt?: number;
    responseDecodedAt?: number;
    snapshotBuiltAt?: number;
    requestAttempts?: number;
    retryDelayMs?: number;
  };
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
  requestBundles?: Array<{
    request_id: string;
    local_pubkey32: string;
    bootstrap_state_hex: string;
    event_json: string;
  }>;
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

/**
 * m7-onboard-sponsor — transient state captured between the
 * OnboardSponsorConfigScreen (form) and OnboardSponsorHandoffScreen
 * (Copy / QR / Cancel hand-off). Populated by
 * {@link AppStateValue.createOnboardSponsorPackage} after a successful
 * `encode_bfonboard_package` round-trip and cleared by
 * {@link AppStateValue.clearOnboardSponsorSession} (on Cancel / after
 * the sponsor completes).
 *
 * The package text is a `bfonboard1…` string suitable for hand-off to
 * the requester device; it round-trips through `decode_bfonboard_package`
 * with the same password the user supplied. The password itself is
 * NEVER stored on this session (mirrors the Create/Distribute flow
 * invariant) — the caller must re-prompt if it is needed again.
 */
export interface OnboardSponsorSession {
  deviceLabel: string;
  packageText: string;
  relays: string[];
  /**
   * Epoch-ms timestamp of when this package was generated. Used by the
   * hand-off screen to surface a lightweight "generated just now"
   * indicator and by future flow features to enforce TTL.
   */
  createdAt: number;
  /**
   * m7-onboard-sponsor-flow — captured runtime `request_id` of the
   * outbound `Onboard` command dispatched immediately after the
   * package was encoded (VAL-ONBOARD-006). Used by `absorbDrains` to
   * match the corresponding `CompletedOperation::Onboard` drain and by
   * `clearOnboardSponsorSession` to track cancellation. Null when the
   * runtime was unable to register a pending op (e.g. signer paused).
   */
  requestId?: string | null;
  /**
   * m7-onboard-sponsor-flow — target peer pubkey (32-byte x-only hex)
   * the Onboard command was dispatched toward. For the current sponsor
   * UI (which packages the sponsor's own share) this is the sponsor's
   * own member pubkey. Surfaced here so the handoff screen can render
   * a stable identity and so cancel/idempotency checks can compare
   * across sessions without rebuilding from the payload.
   */
  targetPeerPubkey?: string;
  /**
   * m7-onboard-sponsor-flow — lifecycle status of the in-flight
   * Onboard ceremony:
   *   - `"awaiting_adoption"` — command dispatched, waiting for the
   *                              requester to complete the handshake.
   *   - `"completed"` — `CompletedOperationJson::Onboard` drained for
   *                     this request_id; peer list has been refreshed.
   *   - `"failed"` — `OperationFailure` drained for this request_id
   *                  (wrong/expired password on requester, timeout,
   *                  protocol rejection). The handoff screen renders
   *                  an error tone in the event log (VAL-ONBOARD-012).
   *   - `"cancelled"` — user clicked Cancel on the handoff screen; a
   *                     deny-override was applied so any late response
   *                     is rejected and no ghost peer is added
   *                     (VAL-ONBOARD-014).
   * Defaults to `"awaiting_adoption"` when the session is first
   * populated by `createOnboardSponsorPackage`.
   */
  status?:
    | "awaiting_adoption"
    | "completed"
    | "failed"
    | "cancelled";
  /**
   * m7-onboard-sponsor-flow — human-readable failure reason surfaced
   * when `status === "failed"`. Populated from the drained
   * `OperationFailure.code` + `.message`.
   */
  failureReason?: string;
}

/**
 * m7-onboard-sponsor — inline-validation copy surfaced by the
 * OnboardSponsorConfigScreen. Re-exported so component tests can assert
 * on the exact strings without re-hardcoding them. The copy matches the
 * conventions used by the Settings sidebar relay-list editor and
 * Change Password flow.
 */
export const ONBOARD_SPONSOR_LABEL_EMPTY_ERROR =
  "Device label cannot be empty.";
export const ONBOARD_SPONSOR_PASSWORD_TOO_SHORT_ERROR =
  `Password must be at least ${DEMO_PASSWORD_MIN_LENGTH} characters.`;
export const ONBOARD_SPONSOR_PASSWORD_MISMATCH_ERROR =
  "Passwords do not match.";
/**
 * Canonical inline-validation copy surfaced whenever a user-supplied
 * relay list is empty after trim. Shared across: Settings sidebar
 * relay-list editor, AppStateProvider.updateRelays, createProfile,
 * createOnboardSponsorPackage, createRotatedProfile,
 * profileRuntime, and MockAppStateProvider.
 *
 * Any UI surface that renders this copy should import this constant
 * rather than re-hardcoding the string literal so copy changes remain
 * a single-touch edit.
 */
export const RELAY_EMPTY_ERROR = "At least one relay is required.";

/**
 * Back-compat alias retained so existing OnboardSponsor surfaces that
 * imported the sponsor-flow-specific name continue to compile. New
 * call sites should import {@link RELAY_EMPTY_ERROR} directly.
 */
export const ONBOARD_SPONSOR_RELAY_EMPTY_ERROR = RELAY_EMPTY_ERROR;
export const ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR =
  "Signer is paused. Resume the signer to sponsor a new device.";
export const ONBOARD_SPONSOR_THRESHOLD_INVALID_ERROR =
  "Invalid threshold — cannot sponsor from this keyset.";
export const ONBOARD_SPONSOR_DUPLICATE_LABEL_WARNING =
  "A device with this label already exists. Sponsoring will create a second device with the same name.";

/** fix-m7-onboard-distinct-share-allocation — inline copy surfaced
 *  when the supplied profile password cannot decrypt the unadopted
 *  share pool (wrong / empty / too short). Mirrors VAL-ONBOARD-020's
 *  canonical expectation and the change-password / unlock flows'
 *  "Current password is incorrect" pattern. */
export const ONBOARD_SPONSOR_PROFILE_PASSWORD_ERROR =
  "Profile password is required to unlock the share pool.";

/** Minimum password length for onboard-sponsor hand-off in the web demo. */
export const ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH = DEMO_PASSWORD_MIN_LENGTH;

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

/**
 * Status of a {@link SignLifecycleEntry}. Advances monotonically through
 * `dispatched -> pending -> completed|failed`. Entries that have reached a
 * terminal state (`completed` or `failed`) are kept in
 * `AppStateValue.signLifecycleLog` for at least 30 s after their terminal
 * timestamp so validators polling between ticks can observe the
 * transition — the UI row is retained for the same window so users get a
 * brief confirmation of success / failure.
 */
export type SignLifecycleStatus =
  | "dispatched"
  | "pending"
  | "completed"
  | "failed";

/**
 * A single dispatched runtime operation tracked end-to-end. One entry is
 * appended per invocation of {@link AppStateValue.handleRuntimeCommand}
 * that produces a `request_id` for a sign / ecdh / ping op (refresh_peer
 * is folded into `ping`). The provider advances the entry through its
 * lifecycle as pending / completion / failure drains arrive from the
 * runtime.
 *
 * Independent of the on-disk `pending_operations` snapshot — entries are
 * retained through terminal state, giving validators (and the UI) a
 * stable view of the transition sequence even when the runtime turns a
 * sign around faster than the poll loop can observe.
 */
export interface SignLifecycleEntry {
  request_id: string;
  op_type: "sign" | "ecdh" | "ping";
  /**
   * First 10 hex characters of the sign message (for `sign`) or the peer
   * pubkey (for `ecdh` / `ping`). Null when the source payload is not
   * surfaced (refresh_peer without an originating key).
   */
  message_preview: string | null;
  status: SignLifecycleStatus;
  /** ms since epoch. Always set on append. */
  dispatched_at: number;
  /**
   * ms since epoch when the entry was first observed in the pending
   * state. Set to `dispatched_at` synthetically on append so the
   * transition is always recorded, even if the runtime completes before
   * any poll tick can observe the request_id in `pending_operations`.
   */
  pending_at: number | null;
  /** ms since epoch when a matching completion was drained. */
  completed_at: number | null;
  /** ms since epoch when a matching failure was drained. */
  failed_at: number | null;
  /** Human-readable failure code/message when `status === 'failed'`. */
  failure_reason: string | null;
}

/**
 * An {@link OperationFailure} optionally enriched with the originating
 * command's metadata at drain-time via {@link PendingDispatchEntry} lookup.
 *
 * `message_hex_32` / `peer_pubkey` are present when the failure's
 * `request_id` had a correlating entry in
 * `AppStateValue.pendingDispatchIndex` at the moment the failure was
 * drained. Downstream consumers (notably the `SigningFailedModal` Retry
 * handler) prefer these enriched fields to the legacy `signDispatchLog`
 * mapping, falling back only when both paths fail to resolve a message.
 *
 * Future runtime-emitted fields for peer-response reporting
 * (`peers_responded` / `total_peers`) are declared here as optional so the
 * UI can surface them when the bridge begins emitting them without
 * another type migration — see
 * `docs/runtime-deviations-from-paper.md` entry for
 * `SigningFailedModal — no peers_responded / round_id peer-response
 * ratio`.
 */
export type EnrichedOperationFailure = OperationFailure & {
  message_hex_32?: string;
  peer_pubkey?: string;
  peers_responded?: number;
  total_peers?: number;
};

/**
 * Single entry in {@link AppStateValue.pendingDispatchIndex}. `type`
 * mirrors the {@link RuntimeCommand} verb (minus `refresh_all_peers`
 * which has no single correlatable request_id).
 *
 * `settledAt` is set when the corresponding completion or failure has
 * been drained; entries whose `settledAt` is older than 60s are pruned
 * by a provider-side GC sweep so the index never grows without bound.
 *
 * `probeSource` distinguishes user/dev Ping dispatches from background
 * refresh probes. Drain filtering must use this explicit tag rather than
 * treating a missing correlation as proof of background traffic.
 */
export interface PendingDispatchEntry {
  type: "sign" | "ecdh" | "ping" | "onboard";
  message_hex_32?: string;
  peer_pubkey?: string;
  probeSource?: "refresh" | "user";
  dispatchedAt: number;
  settledAt?: number;
}

/**
 * Most recent app-observed peer Ping RTT sample. This is UI telemetry,
 * not a persisted runtime contract: `latencyMs` measures elapsed time
 * from local dispatch/correlation to drained `CompletedOperation::Ping`.
 */
export interface PeerLatencySample {
  latencyMs: number;
  measuredAt: number;
  requestId: string;
  source: "refresh" | "user";
}

/**
 * Return value of {@link AppStateValue.handleRuntimeCommand}. When the
 * dispatched command produces a new entry in `runtime_status.pending_operations`
 * (sign / ecdh / ping / onboard), the correlating `request_id` captured from
 * that snapshot is returned here. For commands that never register a pending
 * op (e.g. `refresh_all_peers`) or for dedup'd rapid-fire duplicates, the
 * `requestId` is `null` and `debounced` is `true`.
 */
export interface HandleRuntimeCommandResult {
  requestId: string | null;
  debounced: boolean;
}

/**
 * A single reactive peer-denial prompt. Queued via
 * {@link AppStateValue.enqueuePeerDenial} and consumed by
 * `PolicyPromptModal` in the Dashboard.
 *
 * The shape is client-defined (the upstream bifrost-rs runtime does not
 * currently surface denial notifications as `RuntimeEvent`s — see the
 * `PolicyPromptModal — reactive denial surface via synthetic peer_denied
 * events` entry in `docs/runtime-deviations-from-paper.md`). Tests and
 * future runtime hooks populate the event from whichever channel is
 * available (direct enqueue in integration tests; a future
 * `drain_runtime_events` `peer_denied` kind in production).
 */
export interface PeerDeniedEvent {
  /** Unique id per denial event — used for dedupe and queue membership. */
  id: string;
  /** Full 64-hex x-only peer pubkey (used to dispatch set_policy_override). */
  peer_pubkey: string;
  /** Optional display label (e.g. "Peer #2"). If absent the modal uses a shortHex of `peer_pubkey`. */
  peer_label?: string;
  /** The verb the peer request was denied on. */
  verb: "sign" | "ecdh" | "ping" | "onboard";
  /** Wall-clock ms at which the denial was surfaced locally. */
  denied_at: number;
  /**
   * Optional upstream-provided TTL in milliseconds. When absent the
   * modal applies a client-side 60 s timer that dismisses the prompt
   * without a state change (VAL-APPROVALS-014). Expose the origin via
   * `ttl_source` so validators can distinguish event-provided vs
   * client-synthesized TTLs.
   */
  ttl_ms?: number;
  ttl_source?: "event" | "session";
  /** Decoded event kind text ("kind:1 Short Text Note"). Sign-denial context. */
  event_kind?: string;
  /** Decoded event content preview. May be arbitrarily long — the modal clamps to 10 000 chars. */
  content?: string;
  /** Domain / relay-host for the request origin (sign-denial context). */
  domain?: string;
  /** Relay the inbound request arrived on (ECDH denial context). */
  relay?: string;
  /** Target pubkey for ECDH denial context. */
  target_pubkey?: string;
}

/**
 * Decision returned from the {@link PolicyPromptModal} when the user
 * actions a queued {@link PeerDeniedEvent}.
 *
 *  - `allow-once`   — session-scoped override; dispatched as an `allow`
 *                     and cleared on the next `lockProfile()`.
 *  - `allow-always` — persistent allow override.
 *  - `deny`         — no-op close; queue advances, no policy mutation.
 *  - `deny-always`  — persistent deny override.
 */
export interface PolicyPromptDecision {
  action: "allow-once" | "allow-always" | "deny" | "deny-always";
}

/**
 * A single peer-policy override currently in effect for the unlocked
 * profile — surfaced to the Peer Policies view so it can render a row
 * with peer label, verb, effect (Allow/Deny), a persistence indicator
 * (Persistent vs Session), and a Remove control. Populated by
 * {@link AppStateValue.resolvePeerDenial} when the user commits to an
 * "Allow once" / "Always allow" / "Always deny" decision from the
 * reactive {@link AppStateValue.peerDenialQueue} prompt.
 *
 * Contract:
 *  - `allow-once`  → `{source: "session", value: "allow"}`
 *  - `allow-always` → `{source: "persistent", value: "allow"}`
 *  - `deny-always`  → `{source: "persistent", value: "deny"}`
 *
 * Entries are keyed on `(peer, direction, method)`; a subsequent
 * decision for the same triple REPLACES the prior entry so the view
 * never shows two rows for the same override slot. Persistent entries
 * are also serialised through the existing profile-save path so they
 * survive a lock/unlock cycle (see
 * `fix-m2-persist-always-allow-to-profile`). Session entries are
 * cleared on `lockProfile()` / `clearCredentials()`.
 *
 * Removed atomically via {@link AppStateValue.removePolicyOverride}.
 */
export interface PolicyOverrideEntry {
  peer: string;
  direction: "request" | "respond";
  method: "sign" | "ecdh" | "ping" | "onboard";
  value: "allow" | "deny";
  source: "persistent" | "session";
  createdAt: number;
}

/**
 * Nonce-pool telemetry surfaced through the AppState. The WASM runtime
 * does NOT expose `nonce_pool_size` / `nonce_pool_threshold` on its
 * `runtime_status` snapshot directly (see the
 * `nonce-pool shim (VAL-OPS-024)` entry in
 * `docs/runtime-deviations-from-paper.md`), so we derive them at the JS
 * layer from `RuntimeSnapshotExport.state.nonce_pool` and surface the
 * result here for validators.
 */
export interface NoncePoolSnapshot {
  /**
   * Total outgoing-nonce allotment currently available across all peers
   * (`sum(nonce_pool.peers[*].outgoing_available)`), a proxy for whether
   * we can still initiate signs. `null` when the runtime has not yet
   * produced a snapshot.
   */
  nonce_pool_size: number;
  /**
   * Minimum number of outgoing nonces per peer we want to maintain before
   * triggering a refill / sync. The shim pegs this to
   * `readiness.threshold` (one nonce per remaining sign); adjust as the
   * runtime's refill strategy is firmed up.
   */
  nonce_pool_threshold: number;
}

/**
 * Typed badge classifying a {@link RuntimeEventLogEntry}. One of the ten
 * canonical Paper badges:
 *   - `SYNC`         — pool-sync / status_changed runtime events
 *   - `SIGN`         — sign completion (successful partial signature or
 *                       full aggregation)
 *   - `ECDH`         — ecdh completion (shared secret derived)
 *   - `ECHO`         — semantic peer confirmation rows from Paper/demo
 *                       fixtures; raw runtime `inbound_accepted` plumbing
 *                       remains lifecycle telemetry, not a visible log row
 *   - `PING`         — ping completion (peer round-trip measured)
 *   - `SIGNER_POLICY` — a change to the local signer's policy state
 *                       (`policy_updated` runtime event)
 *   - `PEER_POLICY`  — a change to a specific peer's effective policy
 *                       (reserved; emitted by higher-level deriver)
 *   - `READY`        — runtime finished initialising and is ready to
 *                       dispatch operations (`initialized`)
 *   - `INFO`         — any other lifecycle edge that doesn't merit a
 *                       dedicated colour (command_queued, config_updated,
 *                       state_wiped, Onboard completion)
 *   - `ERROR`        — drained user-facing `OperationFailure`s
 *                       (background refresh Ping probes are quiet)
 *   - `ONBOARD`      — onboarding lifecycle entries emitted by local
 *                       sponsor/requester handoff flows.
 */
export type RuntimeEventLogBadge =
  | "SYNC"
  | "SIGN"
  | "ECDH"
  | "ECHO"
  | "PING"
  | "SIGNER_POLICY"
  | "PEER_POLICY"
  | "READY"
  | "INFO"
  | "ERROR"
  | "ONBOARD";

/**
 * Origin of a {@link RuntimeEventLogEntry}: which of the runtime
 * drain channels (or local mutator) produced the entry.
 *
 *  - `runtime_event` — drained from `RuntimeClient.drainRuntimeEvents()`
 *  - `completion`    — drained from `RuntimeClient.drainCompletions()`
 *  - `failure`       — drained from `RuntimeClient.drainFailures()`
 *  - `local_mutation` — synthesised by an AppStateProvider mutator to
 *                       record a notable local action that has no
 *                       direct WASM drain correlate, such as onboarding
 *                       lifecycle markers.
 */
export type RuntimeEventLogSource =
  | "runtime_event"
  | "completion"
  | "failure"
  | "local_mutation";

/**
 * One entry in the {@link AppStateValue.runtimeEventLog} ring buffer. Each
 * entry represents a single drained runtime event, completion, or failure
 * — tagged with its origin channel and a typed UI badge. Downstream
 * consumers (notably `EventLogPanel`) use `badge` for the colored chip
 * and `payload` for the expanded JSON body.
 */
export interface RuntimeEventLogEntry {
  /**
   * Monotonically increasing sequence id assigned at ingest time. Used
   * for FIFO/reorder detection in high-rate ingestion tests
   * (VAL-EVENTLOG-024) and for stable React list keys. Resets to zero
   * on `lockProfile()` / `clearCredentials()` alongside the buffer
   * itself, so seq values are only unique within a single unlocked
   * session.
   */
  seq: number;
  /** ms since epoch when the entry was ingested. */
  at: number;
  /** Typed badge for UI rendering. */
  badge: RuntimeEventLogBadge;
  /** Which runtime drain channel produced the entry. */
  source: RuntimeEventLogSource;
  /**
   * Raw payload drained from the runtime. Shape depends on `source`:
   *  - `runtime_event`   → {@link RuntimeEvent}
   *  - `completion`      → {@link CompletedOperation}
   *  - `failure`         → {@link EnrichedOperationFailure}
   *  - `local_mutation`  → a minimal, scrub-safe record describing the
   *                        local action. By construction this path NEVER
   *                        includes passwords, share secrets, or other
   *                        credential-bearing material.
   *
   * Kept as `unknown` at this layer to avoid coupling consumers to the
   * discriminated shape — `EventLogPanel` narrows by `source`.
   */
  payload: unknown;
}

/**
 * Maximum number of entries retained in the
 * {@link AppStateValue.runtimeEventLog} ring buffer. Exceeding entries
 * are FIFO-evicted so the oldest is dropped first. Documented contract
 * in VAL-EVENTLOG-014.
 */
export const RUNTIME_EVENT_LOG_MAX = 500;

/**
 * Maximum accepted length (in UTF-16 code units, as exposed by the DOM
 * `HTMLInputElement.maxLength` attribute) for the Device Profile name
 * edited from the Settings sidebar. Enforced at both the UI layer
 * (HTML `maxLength` + inline validation) and the AppStateProvider
 * mutator {@link AppStateValue.updateProfileName} so a caller that
 * bypasses the UI cannot persist an oversize name. Documented contract
 * in VAL-SETTINGS-025.
 */
export const PROFILE_NAME_MAX_LENGTH = 64;

export interface TestNotePublishResult {
  requestId: string;
  eventId: string;
  nevent: string;
  event: NostrTextNoteEvent;
  reached: string[];
  failed: string[];
}

export interface AppStateValue {
  profiles: StoredProfileSummary[];
  activeProfile: StoredProfileSummary | null;
  runtimeStatus: RuntimeStatusSummary | null;
  runtimeRelays: RuntimeRelayStatus[];
  /**
   * Runtime-only peer ping RTT samples keyed by peer pubkey. Cleared on
   * profile/runtime boundaries and ignored by Paper/demo fixture panels.
   * The provider prunes/flushed samples at runtime/profile boundaries, not
   * on every active-peer-set change, so consumers must tolerate stale keys
   * that are not present in the current peer list.
   */
  peerLatencyByPubkey: Record<string, PeerLatencySample>;
  signerPaused: boolean;
  createSession: CreateSession | null;
  importSession: ImportSession | null;
  onboardSession: OnboardSession | null;
  rotateKeysetSession: RotateKeysetSession | null;
  replaceShareSession: ReplaceShareSession | null;
  recoverSession: RecoverSession | null;
  /**
   * m7-onboard-sponsor — see {@link OnboardSponsorSession}. Non-null
   * only while the sponsor hand-off screen is active. Cleared by
   * {@link clearOnboardSponsorSession}.
   *
   * Derived convenience field that surfaces
   * {@link onboardSponsorSessions}[{@link activeOnboardSponsorRequestId}]
   * — the session the UI should focus on (last-dispatched wins). Use
   * {@link onboardSponsorSessions} when iterating all in-flight
   * sponsorships (fix-m7-scrutiny-r1-sponsor-concurrency-and-badge,
   * VAL-ONBOARD-013).
   */
  onboardSponsorSession: OnboardSponsorSession | null;
  /**
   * fix-m7-scrutiny-r1-sponsor-concurrency-and-badge — all in-flight
   * onboarding sponsor sessions keyed by the runtime-assigned
   * `request_id` captured from the outbound `Onboard` command. Two
   * concurrent {@link createOnboardSponsorPackage} invocations produce
   * two distinct entries in this map so the second dispatch does NOT
   * overwrite the first's session state (VAL-ONBOARD-013).
   *
   * When the runtime fails to assign a request_id synchronously (e.g.
   * dispatch rejected because the signer was paused mid-call), the
   * session is stored under a local-only sentinel key
   * (`local-failure-<timestamp>`) so the handoff screen can still
   * render the failure tone to the user.
   */
  onboardSponsorSessions: Record<string, OnboardSponsorSession>;
  /**
   * fix-m7-scrutiny-r1-sponsor-concurrency-and-badge — key into
   * {@link onboardSponsorSessions} for the session the UI should
   * render on the handoff screen. Last-dispatched wins for UI focus.
   * `null` when no active sponsorship is in flight OR when the only
   * entries have been cleared via
   * {@link clearOnboardSponsorSession}.
   */
  activeOnboardSponsorRequestId: string | null;
  /**
   * Successful operation completions drained from the runtime, ordered by
   * ascending `request_id`. Populated each refresh tick by AppStateProvider
   * reading `RuntimeClient.drainCompletions()`.
   */
  runtimeCompletions: CompletedOperation[];
  /**
   * User-facing operation failures drained from the runtime, ordered by
   * ascending `request_id`. Populated each refresh tick by
   * AppStateProvider reading `RuntimeClient.drainFailures()`. Background
   * refresh-all Ping probe failures are intentionally filtered before they
   * reach this slice so an optional offline future share does not look like
   * an actionable dashboard error.
   *
   * Each entry is enriched via {@link AppStateValue.pendingDispatchIndex}
   * before landing here — sign-type failures carry their originating
   * `message_hex_32` so the SigningFailedModal's Retry can re-dispatch
   * the same command without depending on `signDispatchLog`
   * (VAL-OPS-007).
   */
  runtimeFailures: EnrichedOperationFailure[];
  /**
   * Bounded ring buffer of dashboard-oriented event log entries derived from
   * all three runtime drain channels (`drainRuntimeEvents`,
   * `drainCompletions`, `drainFailures`). Background refresh-all Ping
   * probe completions/failures are treated as quiet liveness telemetry and
   * filtered out before display. Each retained entry is tagged with a
   * {@link RuntimeEventLogBadge} and retained in insertion order up to
   * {@link RUNTIME_EVENT_LOG_MAX} (500) entries — once exceeded, the
   * oldest is FIFO-evicted. Survives tick cycles and relay reconnects;
   * cleared on `lockProfile()` / `clearCredentials()` so no stale
   * events bleed between profiles (VAL-EVENTLOG-014 / VAL-EVENTLOG-016).
   *
   * Consumed by `EventLogPanel` for rendering; validators inspect
   * `window.__debug.runtimeEventLog` directly.
   */
  runtimeEventLog: RuntimeEventLogEntry[];
  /**
   * Lifecycle events drained from the runtime via
   * `RuntimeClient.drainRuntimeEvents()`. Not consumed by UI in this feature
   * (reserved for M4 event log). Order matches drain order (insertion).
   */
  lifecycleEvents: RuntimeEvent[];
  /**
   * Mapping of dispatched sign `request_id` → `message_hex_32`.
   *
   * Populated by `handleRuntimeCommand` whenever a `sign` command is
   * successfully forwarded to the runtime and a fresh `request_id` is
   * captured from the next `pending_operations` snapshot. Callers (e.g. the
   * `SigningFailedModal`) use this to correlate an `OperationFailure`
   * back to the original message so Retry can re-dispatch the identical
   * sign command (VAL-OPS-007).
   *
   * Reset to `{}` on `lockProfile()` and `clearCredentials()` so sign
   * metadata never bleeds across profiles.
   */
  signDispatchLog: Record<string, string>;
  /**
   * Ordered lifecycle log of dispatched runtime operations
   * (`sign` / `ecdh` / `ping`). Each entry records monotonically-increasing
   * transition timestamps so validators that inspect
   * `window.__appState.signLifecycleLog` can always observe the
   * `dispatched -> pending -> completed|failed` sequence — even when the
   * on-disk `pending_operations` snapshot has already moved past pending
   * by the time they poll.
   *
   * Reset on `lockProfile()` and `clearCredentials()` together with the
   * other drain slices so lifecycle metadata never bleeds across profiles.
   *
   * See the "fix-m1-sign-completion-ui-feedback-and-pending-trace" feature
   * description for full behavior (VAL-OPS-002 / VAL-OPS-004 / VAL-OPS-013).
   */
  signLifecycleLog: SignLifecycleEntry[];
  /**
   * Map of `request_id → {type, message_hex_32?, peer_pubkey?, dispatchedAt,
   * settledAt?}` for every runtime operation whose origin we can correlate.
   *
   * Populated in two paths:
   *  1. Synchronously by {@link AppStateValue.handleRuntimeCommand} when the
   *     `request_id` is captured from the next `pending_operations` snapshot
   *     after dispatch.
   *  2. Asynchronously on each `pending_operations` observation tick — new
   *     pending ops that still lack an entry are matched against the FIFO
   *     queue of dispatched-but-unmatched commands so the index is filled
   *     before the op is removed (and before its failure is drained).
   *
   * When an `OperationFailure` / `CompletedOperation` is drained, the
   * corresponding entry is marked with `settledAt`. Entries remain in the
   * index for 60s after settlement so callers (notably the
   * SigningFailedModal Retry handler) can still resolve the originating
   * `message_hex_32` long after the pending op has been removed.
   *
   * Reset to `{}` on `lockProfile()` and `clearCredentials()` together
   * with the other drain slices so dispatch metadata never bleeds across
   * profiles.
   */
  pendingDispatchIndex: Record<string, PendingDispatchEntry>;
  /**
   * FIFO queue of reactive peer-denial prompts that the PolicyPromptModal
   * renders one-at-a-time. Each entry is a {@link PeerDeniedEvent} derived
   * from a `peer_denied` lifecycle event the local signer emitted when a
   * peer request was denied by local policy.
   *
   * The queue is populated by {@link AppStateValue.enqueuePeerDenial} and
   * drained by {@link AppStateValue.resolvePeerDenial}. Resolving the
   * head entry automatically focuses the next queued prompt (if any) —
   * the UI treats this as "advance the queue FIFO" (VAL-APPROVALS-015).
   *
   * Reset on `lockProfile()` and `clearCredentials()` so stale denials
   * never bleed across profiles.
   */
  peerDenialQueue: PeerDeniedEvent[];
  /**
   * Append a new peer-denial request to {@link peerDenialQueue}. If an
   * entry with the same `id` is already present the call is a no-op so
   * duplicate drains / re-entrant injection don't balloon the queue
   * (VAL-APPROVALS-015).
   */
  enqueuePeerDenial: (event: PeerDeniedEvent) => void;
  /**
   * Resolve the peer-denial entry with `id` by dispatching the appropriate
   * `set_policy_override` call (or no-op for "deny") and removing the
   * entry from the queue. Returns the head entry of the queue after
   * resolution (null when empty) so callers can chain focus management.
   *
   *  - `allow-once`  → set_policy_override(peer, respond, verb, allow).
   *                    The override is treated as session-scoped: on the
   *                    next `lockProfile()` / `clearCredentials()` all
   *                    once-overrides are cleared.
   *  - `allow-always` → set_policy_override(peer, respond, verb, allow).
   *                     Persisted across the current unlocked session
   *                     (the runtime retains the override internally).
   *                     After lock/unlock persistence is a best-effort
   *                     deviation documented in
   *                     `docs/runtime-deviations-from-paper.md`.
   *  - `deny`        → no set_policy_override call; queue advances.
   *  - `deny-always` → set_policy_override(peer, respond, verb, deny).
   */
  resolvePeerDenial: (
    id: string,
    decision: PolicyPromptDecision,
  ) => Promise<void>;
  /**
   * Active peer-policy overrides driven by the user's decisions on the
   * reactive `PolicyPromptModal` (allow-once / allow-always / deny-always).
   * The Peer Policies view (`PoliciesState`) renders one row per entry
   * with the peer label, verb, effect (Allow/Deny), a persistence chip
   * ("Persistent" vs "Session"), and a Remove action that calls
   * {@link AppStateValue.removePolicyOverride}.
   *
   * See `fix-m2-peer-policies-view-persistence-and-remove` for full
   * behavior (VAL-APPROVALS-017). Entries are keyed on
   * `(peer, direction, method)` and cleared on
   * `lockProfile()` / `clearCredentials()`.
   */
  policyOverrides: PolicyOverrideEntry[];
  /**
   * Remove a peer-policy override previously set via the reactive
   * denial surface. Atomically:
   *   1. Drops the in-memory entry from {@link policyOverrides}.
   *   2. For persistent entries, re-serialises the stored profile's
   *      `manual_peer_policy_overrides` with the targeted cell set to
   *      `"unset"` (same persistence path as
   *      `fix-m2-persist-always-allow-to-profile`).
   *   3. Dispatches `setPolicyOverride({..., value: "unset"})` against
   *      the live runtime so the next matching inbound peer request
   *      produces a fresh `peer_denied` event.
   *
   * No-op when no entry exists for the triple.
   */
  removePolicyOverride: (input: {
    peer: string;
    direction: "request" | "respond";
    method: "sign" | "ecdh" | "ping" | "onboard";
  }) => Promise<void>;
  /**
   * Set (or clear) a single cell of a peer's manual policy override —
   * one dispatch per invocation. Powers the Peer Policies card's
   * tri-state chip cycle (unset → allow → deny → unset). Contract:
   *
   *   - `value: "allow" | "deny"` → the runtime's
   *      `set_policy_override({peer, direction, method, value})` is
   *      dispatched exactly once.
   *   - `value: "unset"`          → the runtime's
   *      `set_policy_override({peer, direction, method, value: "unset"})`
   *      is dispatched exactly once, clearing just this cell (the
   *      runtime's `clear_policy_overrides()` would reset every cell,
   *      so we scope the "clear" to the targeted (peer, direction,
   *      method) triple by using `value: "unset"`). Surfaces the same
   *      "clear this override" semantic described by VAL-POLICIES-008.
   *
   * Rejects if the runtime dispatch throws so the caller can roll back
   * optimistic UI state (VAL-POLICIES-026). No optimistic mirroring
   * happens inside the mutator — the chip owns its optimistic state and
   * reconciles with the next `peer_permission_states` snapshot.
   */
  setPeerPolicyOverride: (input: {
    peer: string;
    direction: "request" | "respond";
    method: "sign" | "ecdh" | "ping" | "onboard";
    value: "unset" | "allow" | "deny";
  }) => Promise<void>;
  /**
   * Reset every manual policy override cell across every peer and every
   * direction/method in one dispatch. Thin passthrough to the runtime's
   * `WasmBridgeRuntime.clear_policy_overrides()` bridge — the fresh
   * `runtime_status.peer_permission_states` emitted after the call
   * reports `manual_override` as empty/unset for every (peer, direction,
   * method) cell, and each peer's `effective_policy` resolves to the
   * default-derived values only. Also drops the in-memory
   * `policyOverrides` slice and the session "Allow once" tracking ref
   * so surfaces consuming those stay consistent with the runtime.
   * Profile persistence is intentionally NOT touched by this helper:
   * callers that want to wipe persisted overrides must combine this
   * with the profile-save path (or use `clearCredentials`).
   * Surface assertion: VAL-POLICIES-009.
   */
  clearPolicyOverrides: () => Promise<void>;
  /**
   * Empty the {@link runtimeEventLog} buffer without touching any other
   * unlocked-profile state. Backs the Event Log panel's Clear button
   * (VAL-EVENTLOG-012) — display and underlying buffer are flushed
   * together so navigating away and back does not resurrect cleared
   * rows, while the rest of the AppState (active profile, pending ops,
   * signLifecycleLog, policy overrides, …) is unaffected.
   *
   * Also resets the internal seq counter so the next ingested entry
   * starts at seq 1. Idempotent — calling it on an already-empty buffer
   * is a no-op.
   */
  clearRuntimeEventLog: () => void;
  reloadProfiles: () => Promise<void>;
  createKeyset: (draft: CreateKeysetDraft) => Promise<void>;
  createProfile: (draft: CreateProfileDraft) => Promise<string>;
  updatePackageState: (idx: number, patch: OnboardingPackageStatePatch) => void;
  /**
   * Update the optional human-readable device label for a single
   * remote create-session package. Pure UI/session metadata only:
   * does not participate in package generation, runtime dispatch, or
   * completion gating.
   */
  setPackageDeviceLabel: (idx: number, deviceLabel: string) => void;
  /**
   * fix-followup-distribute-2a — encode the bfonboard package for a
   * single remote share at {@link idx} using a user-supplied
   * per-share {@link password}.
   *
   * Responsibilities:
   *   - Validates `password.length >= DEMO_PASSWORD_MIN_LENGTH` and throws a readable Error
   *     when the invariant is violated.
   *   - Looks up the plaintext share secrets from the provider's
   *     per-create-session stash (populated by `createProfile`).
   *   - Invokes `buildRemoteOnboardingPackages` /
   *     `encodeOnboardPackage` for that single share and stashes the
   *     resulting `{packageText, password}` in the per-share secret
   *     ref (addressable via `getCreateSessionPackageSecret(idx)`).
   *   - Flips `onboardingPackages[idx].packageCreated = true` on the
   *     current createSession and populates a REDACTED preview
   *     (first 24 chars of the bfonboard1… string) into
   *     `onboardingPackages[idx].packageText`.
   *
   * The source-side row turns green later when runtime status reports
   * this member pubkey online after the recipient-initiated onboarding
   * request is accepted. This mutator does not start the bootstrap
   * Onboard command.
   */
  encodeDistributionPackage: (idx: number, password: string) => Promise<void>;
  /**
   * Retry the legacy source-side confirmation probe for an
   * already-created remote package. Normal onboarding stays
   * recipient-initiated; this only refreshes
   * `pendingDispatchRequestId` / `adoptionError` retry state and
   * resolves to the new runtime request id when a dispatch registers a
   * correlatable pending operation.
   */
  retryDistributionPackageAdoption: (idx: number) => Promise<string | undefined>;
  /**
   * fix-followup-distribute-2a — unconditionally mark the remote
   * share at {@link idx} as "Distributed" by flipping
   * `onboardingPackages[idx].manuallyMarkedDistributed = true` on
   * the current create session. Offline fallback for QR / manual
   * handoff; independent of relay state or onboard completion
   * (VAL-FOLLOWUP-005).
   */
  markPackageDistributed: (idx: number) => void;
  finishDistribution: () => Promise<string>;
  clearCreateSession: () => void;
  /**
   * fix-m7-createsession-redact-secrets-on-finalize — read the
   * plaintext `bfonboard1…` package text and the distribution
   * password for the remote share at {@link idx} from the unlocked
   * provider's in-memory stash.
   *
   * After {@link createProfile} completes, `createSession.onboardingPackages`
   * surfaces only redacted sentinels for `packageText` / `password`
   * (so `window.__appState`, IndexedDB, and console transcripts never
   * carry the plaintext secrets past the mutator boundary — see the
   * m7 security-live-sweep contract). The UI distribution screen must
   * still be able to copy the real package text to the clipboard or
   * render it in a QR code; it does so exclusively through this
   * accessor, which reads from a ref that is NOT exposed on the
   * serialised AppState value.
   *
   * Returns `null` when the stash is empty (no active create session
   * / already cleared) or when `idx` does not match a sponsored
   * remote share. The caller is responsible for not logging or
   * persisting the returned values — they are the same raw secrets
   * the mutator intentionally moved off the React state.
   */
  getCreateSessionPackageSecret: (
    idx: number,
  ) => { packageText: string; password: string } | null;
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
  generateRotatedKeyset: () => Promise<void>;
  createRotatedProfile: (draft: ProfileDraft) => Promise<string>;
  encodeRotateDistributionPackage: (
    idx: number,
    password: string,
  ) => Promise<void>;
  markRotatePackageDistributed: (idx: number) => void;
  updateRotatePackageState: (
    idx: number,
    patch: OnboardingPackageStatePatch,
  ) => void;
  finishRotateDistribution: () => Promise<string>;
  clearRotateKeysetSession: () => void;
  getRotateSessionPackageSecret: (
    idx: number,
  ) => { packageText: string; password: string } | null;
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
  /**
   * Persist a new Device Profile name to the encrypted profile record
   * in IndexedDB (via `saveProfile`) and update `activeProfile` in
   * memory so every surface reading it (Dashboard header, Settings
   * sidebar, clear-credentials badge, Export / Export-Share modal)
   * reflects the new value immediately.
   *
   * Rules (surface contracts: VAL-SETTINGS-001 / 002 / 024 / 025 and
   * VAL-CROSS-004):
   *   - The input is trimmed of leading/trailing whitespace before
   *     validation and persistence.
   *   - Empty / whitespace-only names are rejected with an Error so
   *     the UI can surface an inline validation message; NOTHING is
   *     written to storage.
   *   - Names whose trimmed length exceeds
   *     {@link PROFILE_NAME_MAX_LENGTH} are rejected for the same
   *     reason. The UI additionally enforces the limit via the
   *     `<input maxLength>` attribute for normal typing.
   *   - Unicode / emoji / RTL / angle-bracket payloads are accepted
   *     verbatim and stored exactly as provided; React's escaping keeps
   *     them safe when rendered.
   *   - Requires an unlocked profile (valid `activeProfile` and the
   *     cached payload/password captured at unlock time). If the
   *     profile is locked the mutator rejects without writing anything.
   *
   * Throws on validation / persistence failures so callers can display
   * the error inline.
   */
  updateProfileName: (name: string) => Promise<void>;
  /**
   * Persist a new relay list to the encrypted profile record in
   * IndexedDB, update `activeProfile.relays` in memory, and hot-reload
   * the live `RuntimeRelayPump` so removed sockets close cleanly and
   * newly-added sockets open — all without tearing down the runtime
   * itself.
   *
   * Rules (surface contracts: VAL-SETTINGS-003 / 004 / 005 / 006 / 007 /
   * 022 / 023 / VAL-CROSS-005):
   *   - Each URL is trimmed before validation. Empty strings are
   *     dropped silently (convenience for the Settings sidebar inline
   *     input path).
   *   - Every remaining entry must be a syntactically valid
   *     `wss://` URL; malformed entries reject with an Error carrying
   *     the canonical inline message (see
   *     {@link RelayValidationError}). Nothing is written when the
   *     input is invalid.
   *   - Duplicates are rejected via case-insensitive, trailing-slash-
   *     normalised comparison — matching the contract for both Add and
   *     Edit paths in the sidebar.
   *   - After validation, the encrypted stored profile record is
   *     rebuilt with the new relay list via
   *     `buildStoredProfileRecord` (so normalisation stays in lock-
   *     step with the unlock path) and saved to IndexedDB via
   *     `saveProfile`.
   *   - The live relay pump is hot-reloaded via
   *     `RuntimeRelayPump.updateRelays` — removed sockets close
   *     cleanly with code 1000, added sockets acquire fresh
   *     subscriptions, untouched sockets preserve their counters /
   *     subscription identity (so validators detecting "no duplicate
   *     REQ on edit" stay green).
   *   - Requires an unlocked profile (valid `activeProfile` and the
   *     cached payload/password captured at unlock time). If the
   *     profile is locked the mutator rejects without writing.
   *
   * Throws on validation or persistence failures so callers can display
   * the error inline; the in-memory `activeProfile.relays` is updated
   * only after a successful persistence round-trip.
   */
  updateRelays: (relays: string[]) => Promise<void>;
  changeProfilePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  lockProfile: () => void;
  clearCredentials: () => Promise<void>;
  exportRuntimePackages: (password: string) => Promise<RuntimeExportPackages>;
  createProfileBackup: () => Promise<{
    backup: EncryptedProfileBackup;
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
  publishTestNote: (input: { content: string }) => Promise<TestNotePublishResult>;
  setSignerPaused: (paused: boolean) => void;
  refreshRuntime: () => void;
  restartRuntimeConnections: () => Promise<void>;
  /**
   * m7-onboard-sponsor — generate a `bfonboard1…` hand-off package for
   * a new device and stash it in
   * {@link AppStateValue.onboardSponsorSession} so the handoff screen
   * can render it.
   *
   * Flow:
   *   1. Validate inputs (label non-empty after trim,
   *      password.length >= ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH,
   *      every relay a syntactically valid `wss://` URL with no dupes).
   *   2. Reject when the signer is paused (VAL-ONBOARD-024).
   *   3. Reject when the active profile's threshold is misconfigured
   *      (t=0 or t>n) (VAL-ONBOARD-021).
   *   4. Encode via `encode_bfonboard_package` using the active share's
   *      secret + sponsor's own pubkey.
   *   5. Store the package text + label + relays in the session.
   *   6. Return the generated package text so callers can navigate to
   *      the hand-off screen.
   *
   * The password itself is NEVER stored on the session (mirrors the
   * Create/Distribute flow invariant).
   */
  createOnboardSponsorPackage: (input: {
    deviceLabel: string;
    password: string;
    relays: string[];
    /**
     * fix-m7-onboard-distinct-share-allocation — profile password
     * used to decrypt the encrypted `unadoptedSharesCiphertext` stored
     * on the profile record. Required to allocate a share from the
     * pool; the decrypted pool is discarded immediately after one
     * share is picked (security invariant — see
     * `src/lib/storage/unadoptedSharesPool.ts`).
     */
    profilePassword: string;
  }) => Promise<string>;
  /**
   * m7-onboard-sponsor — clear an onboard sponsor session.
   *
   * fix-m7-scrutiny-r1-sponsor-concurrency-and-badge — the optional
   * `requestId` argument targets a specific entry in
   * {@link onboardSponsorSessions}. When omitted, the currently
   * active session (the one matching
   * {@link activeOnboardSponsorRequestId}) is cleared. Either
   * variant applies a `respond.onboard = deny` policy override for
   * the cleared session's target peer so any late response from the
   * requester is rejected by the local runtime (VAL-ONBOARD-014).
   * Called by Cancel on the hand-off screen and on profile lock /
   * clear.
   */
  clearOnboardSponsorSession: (requestId?: string) => void;
  /**
   * Dispatches a runtime command to the underlying
   * `RuntimeClient.handleCommand`. The call is synchronous on the bridge but
   * the captured `request_id` is read from the *next* `pending_operations`
   * snapshot, so callers must await the returned promise.
   *
   * Identical command dispatches arriving within a short debounce window
   * (<=300ms) are coalesced — the returned `debounced: true` indicates the
   * underlying command was NOT forwarded to the runtime a second time.
   */
  handleRuntimeCommand: (
    cmd: RuntimeCommand,
  ) => Promise<HandleRuntimeCommandResult>;
}

export type { RuntimeExportPackages, RuntimeExportMetadata } from "./runtimeExports";
export type {
  CompletedOperation,
  OperationFailure,
  RuntimeEvent,
} from "../lib/bifrost/types";
export type { RuntimeCommand } from "../lib/bifrost/runtimeClient";
