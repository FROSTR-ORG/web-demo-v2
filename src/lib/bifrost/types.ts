import { z } from "zod";

export type Hex = string;

export const MemberPackageWireSchema = z.object({
  idx: z.number().int().nonnegative(),
  pubkey: z.string(),
});

export const GroupPackageWireSchema = z.object({
  group_name: z.string().min(1),
  group_pk: z.string(),
  threshold: z.number().int().positive(),
  members: z.array(MemberPackageWireSchema).min(1),
});

export const SharePackageWireSchema = z.object({
  idx: z.number().int().nonnegative(),
  seckey: z.string().length(64),
});

export const DerivedPublicNonceWireSchema = z.object({
  binder_pn: z.string(),
  hidden_pn: z.string(),
  code: z.string(),
});

export type MemberPackageWire = z.infer<typeof MemberPackageWireSchema>;
export type GroupPackageWire = z.infer<typeof GroupPackageWireSchema>;
export type SharePackageWire = z.infer<typeof SharePackageWireSchema>;
export type DerivedPublicNonceWire = z.infer<
  typeof DerivedPublicNonceWireSchema
>;

export const KeysetBundleSchema = z.object({
  group: GroupPackageWireSchema,
  shares: z.array(SharePackageWireSchema).min(1),
});

export type KeysetBundle = z.infer<typeof KeysetBundleSchema>;

export const BfPolicyOverrideValueSchema = z.enum(["unset", "allow", "deny"]);

export const BfMethodPolicyOverrideSchema = z.object({
  echo: BfPolicyOverrideValueSchema,
  ping: BfPolicyOverrideValueSchema,
  onboard: BfPolicyOverrideValueSchema,
  sign: BfPolicyOverrideValueSchema,
  ecdh: BfPolicyOverrideValueSchema,
});

export const BfPeerPolicyOverrideSchema = z.object({
  request: BfMethodPolicyOverrideSchema,
  respond: BfMethodPolicyOverrideSchema,
});

export const BfManualPeerPolicyOverrideSchema = z.object({
  pubkey: z.string().min(1),
  policy: BfPeerPolicyOverrideSchema,
});

const BfProfileDevicePayloadSchema = z.object({
  name: z.string().nullable().optional(),
  share_secret: z.string().optional(),
  manual_peer_policy_overrides: z
    .array(BfManualPeerPolicyOverrideSchema)
    .optional(),
  relays: z.array(z.string().min(1)).optional(),
});

export const BfProfilePayloadSchema = z
  .object({
    profile_id: z.string().nullable().optional(),
    version: z.number().int().nonnegative().optional(),
    device: BfProfileDevicePayloadSchema,
    group_package: GroupPackageWireSchema,
  })
  .transform((payload) => ({
    profile_id: payload.profile_id ?? "",
    version: payload.version ?? 1,
    device: {
      name: payload.device.name ?? "",
      share_secret: payload.device.share_secret ?? "",
      manual_peer_policy_overrides:
        payload.device.manual_peer_policy_overrides ?? [],
      relays: payload.device.relays ?? [],
    },
    group_package: payload.group_package,
  }));

export const BfOnboardPayloadSchema = z.object({
  share_secret: z.string().length(64),
  relays: z.array(z.string().min(1)),
  peer_pk: z.string().min(1),
});

export const BfSharePayloadSchema = z.object({
  share_secret: z.string().length(64),
  relays: z.array(z.string().min(1)),
});

export const ProfilePackagePairSchema = z.object({
  profile_string: z.string().startsWith("bfprofile1"),
  share_string: z.string().startsWith("bfshare1"),
});

export type BfPolicyOverrideValue = z.infer<typeof BfPolicyOverrideValueSchema>;
export type BfMethodPolicyOverride = z.infer<
  typeof BfMethodPolicyOverrideSchema
>;
export type BfPeerPolicyOverride = z.infer<typeof BfPeerPolicyOverrideSchema>;
export type BfManualPeerPolicyOverride = z.infer<
  typeof BfManualPeerPolicyOverrideSchema
>;
export type BfProfilePayload = z.infer<typeof BfProfilePayloadSchema>;
export type BfOnboardPayload = z.infer<typeof BfOnboardPayloadSchema>;
export type BfSharePayload = z.infer<typeof BfSharePayloadSchema>;
export type ProfilePackagePair = z.infer<typeof ProfilePackagePairSchema>;

/**
 * Decrypted profile-backup payload as returned by the WASM bridge
 * helper `create_encrypted_profile_backup` (and as consumed by
 * `build_profile_backup_event` / `encrypt_profile_backup_content` /
 * `parse_profile_backup_event`). This is the plaintext shape of the
 * backup — the WASM bridge internally encrypts it and wraps it in a
 * signed kind-10000 Nostr event, so this type is never transmitted
 * over the wire in plaintext. Fields are `snake_case` to match the
 * bifrost-bridge-wasm serde serialization (no `rename_all`).
 */
export interface EncryptedProfileBackup {
  version: number;
  device: {
    name: string;
    share_public_key: string;
    manual_peer_policy_overrides: BfManualPeerPolicyOverride[];
    relays: string[];
  };
  group_package: {
    group_name: string;
    group_pk: string;
    threshold: number;
    members: { idx: number; pubkey: string }[];
  };
}

export const EncryptedProfileBackupSchema = z.object({
  version: z.number(),
  device: z.object({
    name: z.string(),
    share_public_key: z.string(),
    manual_peer_policy_overrides: z
      .array(BfManualPeerPolicyOverrideSchema)
      .default([]),
    relays: z.array(z.string()),
  }),
  group_package: z.object({
    group_name: z.string(),
    group_pk: z.string(),
    threshold: z.number(),
    members: z.array(
      z.object({ idx: z.number(), pubkey: z.string() }),
    ),
  }),
});

export interface ProfileBackupEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export const ProfileBackupEventSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  created_at: z.number(),
  kind: z.number(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string(),
});

export interface RotateKeysetBundleResult {
  previous_group_id: string;
  next_group_id: string;
  next: KeysetBundle;
}

export const RecoveredNsecResultSchema = z.object({
  nsec: z.string().startsWith("nsec1"),
  signing_key_hex: z.string().length(64),
});

export const GeneratedNsecResultSchema = z.object({
  nsec: z.string().startsWith("nsec1"),
  signing_key_hex: z.string().length(64),
});

export type RecoveredNsecResult = z.infer<typeof RecoveredNsecResultSchema>;
export type GeneratedNsecResult = z.infer<typeof GeneratedNsecResultSchema>;

export const BifrostPackageErrorCodeSchema = z.enum([
  "wrong_password",
  "malformed_package",
  "wrong_package_mode",
  "unsupported_package",
  "invalid_payload",
  "verification_failed",
  "crypto_failed",
]);

export const BifrostPackageErrorResultSchema = z.object({
  code: BifrostPackageErrorCodeSchema,
  message: z.string(),
});

export const StructuredBridgeResultSchema = z.object({
  ok: z.boolean(),
  value: z.unknown().optional().nullable(),
  error: BifrostPackageErrorResultSchema.optional().nullable(),
});

export const OnboardingRequestBundleSchema = z.object({
  request_id: z.string().min(1),
  local_pubkey32: z.string().length(64),
  request_nonces: z.array(DerivedPublicNonceWireSchema),
  bootstrap_state_hex: z.string().min(1),
  event_json: z.string().min(1),
});

export const OnboardingResponseSchema = z.object({
  group: GroupPackageWireSchema,
  nonces: z.array(DerivedPublicNonceWireSchema),
});

export type BifrostPackageErrorCode = z.infer<
  typeof BifrostPackageErrorCodeSchema
>;
export type BifrostPackageErrorResult = z.infer<
  typeof BifrostPackageErrorResultSchema
>;
export type OnboardingRequestBundle = z.infer<
  typeof OnboardingRequestBundleSchema
>;
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

export interface RuntimeConfigInput {
  device?: Record<string, unknown>;
  bridge?: Record<string, unknown>;
}

export interface RuntimeBootstrapInput {
  group: GroupPackageWire;
  share: SharePackageWire;
  peers: string[];
  initial_peer_nonces?: Array<{
    peer: string;
    nonces: DerivedPublicNonceWire[];
  }>;
}

export interface DeviceStateSnapshotJson {
  version: number;
  last_active: number;
  request_seq: number;
  replay_cache_size: number;
  ecdh_cache_size: number;
  sig_cache_size: number;
  nonce_pool: {
    peers: Array<{
      idx: number;
      pubkey: string;
      incoming_available: number;
      outgoing_available: number;
      outgoing_spent: number;
      can_sign: boolean;
      should_send_nonces: boolean;
    }>;
  };
}

export interface RuntimeSnapshotExport {
  bootstrap: RuntimeBootstrapInput;
  state_hex: string;
  status: DeviceStatus;
  state: DeviceStateSnapshotJson;
}

export interface RuntimeSnapshotInput {
  bootstrap: RuntimeBootstrapInput;
  state_hex: string;
}

export interface DeviceStatus {
  device_id: string;
  pending_ops: number;
  last_active: number;
  known_peers: number;
  request_seq: number;
}

export interface RuntimeMetadata {
  device_id: string;
  member_idx: number;
  share_public_key: string;
  group_public_key: string;
  peers: string[];
}

export interface PeerStatus {
  idx: number;
  pubkey: string;
  known: boolean;
  last_seen: number | null;
  online: boolean;
  incoming_available: number;
  outgoing_available: number;
  outgoing_spent: number;
  can_sign: boolean;
  should_send_nonces: boolean;
}

export type RuntimeDegradedReason =
  | "pending_operations_recovered"
  | "insufficient_signing_peers"
  | "insufficient_ecdh_peers";

export interface RuntimeReadiness {
  runtime_ready: boolean;
  restore_complete: boolean;
  sign_ready: boolean;
  ecdh_ready: boolean;
  threshold: number;
  signing_peer_count: number;
  ecdh_peer_count: number;
  last_refresh_at: number | null;
  degraded_reasons: RuntimeDegradedReason[];
}

export interface PeerPermissionState {
  pubkey: string;
  manual_override: unknown;
  remote_observation: unknown | null;
  effective_policy: unknown;
}

export interface PendingOperation {
  op_type: "Sign" | "Ecdh" | "Ping" | "Onboard";
  request_id: string;
  started_at: number;
  timeout_at: number;
  target_peers: string[];
  threshold: number;
  collected_responses: unknown[];
  context: unknown;
}

export interface RuntimeStatusSummary {
  status: DeviceStatus;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peers: PeerStatus[];
  peer_permission_states: PeerPermissionState[];
  pending_operations: PendingOperation[];
}

export type RuntimeEventKind =
  | "Initialized"
  | "StatusChanged"
  | "CommandQueued"
  | "InboundAccepted"
  | "ConfigUpdated"
  | "PolicyUpdated"
  | "StateWiped"
  | "initialized"
  | "status_changed"
  | "command_queued"
  | "inbound_accepted"
  | "config_updated"
  | "policy_updated"
  | "state_wiped";

export interface RuntimeEvent {
  kind: RuntimeEventKind;
  status: RuntimeStatusSummary;
}

export type CompletedOperation =
  | { Sign: { request_id: string; signatures_hex64: string[] } }
  | { Ecdh: { request_id: string; shared_secret_hex32: string } }
  | { Ping: { request_id: string; peer: string } }
  | {
      Onboard: {
        request_id: string;
        group_member_count: number;
        group: GroupPackageWire;
        nonces: DerivedPublicNonceWire[];
      };
    };

export interface OperationFailure {
  request_id: string;
  op_type: "sign" | "ecdh" | "ping" | "onboard";
  code: "timeout" | "invalid_locked_peer_response" | "peer_rejected";
  message: string;
  failed_peer: string | null;
}

export interface StoredProfileSummary {
  id: string;
  label: string;
  deviceName: string;
  groupName: string;
  threshold: number;
  memberCount: number;
  localShareIdx: number;
  groupPublicKey: string;
  relays: string[];
  /** Epoch-ms creation timestamp. Set once when the profile is first saved. */
  createdAt: number;
  /**
   * Epoch-ms "last mutated" timestamp. Refreshed every time a persisted
   * profile field is edited (name, relays, password, persistent peer
   * policies). Optional for backward compatibility with records written
   * before this field existed; callers rendering "Updated" should fall
   * back to `createdAt` when this is absent (VAL-SETTINGS-008). Fresh
   * saves via `buildStoredProfileRecord` always populate it.
   */
  updatedAt?: number;
  lastUsedAt: number;
  /**
   * m6-backup-publish — unix-seconds timestamp of the most recent
   * successful `publishProfileBackup` from this profile. Written to
   * the stored record after each publish so the SettingsSidebar can
   * render a "Last published" indicator that survives lock/unlock
   * (VAL-BACKUP-005 / VAL-BACKUP-031). `undefined` until the first
   * successful publish; the SettingsSidebar renders nothing when
   * absent.
   */
  lastBackupPublishedAt?: number;
  /**
   * m6-backup-publish — number of relays that acknowledged the most
   * recent successful `publishProfileBackup` (the length of
   * `PublishEventOutcome.reached`). Mirrored into the rendered "Last
   * published" row as `reached N/M relays`. `undefined` until the
   * first successful publish.
   */
  lastBackupReachedRelayCount?: number;
}

export interface StoredProfileRecord {
  summary: StoredProfileSummary;
  encryptedProfilePackage: string;
  /**
   * fix-m7-onboard-distinct-share-allocation — canonical JSON envelope
   * produced by
   * {@link import("../storage/unadoptedSharesPool").encryptUnadoptedSharesPool}
   * containing the profile's NON-SELF share secrets encrypted under
   * the profile password.
   *
   * Populated by the Create flow after keyset generation; written
   * again each time the pool allocation ledger changes (allocation,
   * completion, cancellation). Absent on legacy records (migration
   * leaves them un-populated; the sponsor flow will refuse to
   * onboard when the pool is missing or exhausted).
   *
   * SECURITY: decrypted only inside
   * `AppStateValue.createOnboardSponsorPackage`; the decrypted pool
   * is never written to React state, `sessionStorage`,
   * `localStorage`, `window.__debug`, or any non-envelope IndexedDB
   * store. See `docs/runtime-deviations-from-paper.md > M7 onboard
   * unadopted share pool` for the full design + security rationale.
   */
  unadoptedSharesCiphertext?: string;
  /**
   * fix-m7-onboard-distinct-share-allocation — unencrypted ledger of
   * pool-share allocations issued by the Dashboard "Onboard a Device"
   * flow. One entry per sponsor-initiated onboard ceremony, keyed by
   * the runtime-assigned `request_id`.
   *
   * Only share indices + allocation metadata (request_id, device
   * label, timestamps, status, optional failure reason) live here —
   * NO share secrets, NO passwords, NO ciphertext. The ledger is
   * therefore safe to store unencrypted alongside the record. Shape
   * is validated on read via
   * {@link import("../storage/unadoptedSharesPool").ShareAllocationEntrySchema}.
   *
   * On successful onboard completion the entry's `status` transitions
   * to `"completed"` and the underlying share is permanently removed
   * from the available pool. On failure or cancel the entry's
   * `status` transitions to `"failed"` / `"cancelled"` and the share
   * RETURNS to the available pool for a subsequent sponsor attempt.
   */
  shareAllocations?: import("../storage/unadoptedSharesPool").ShareAllocationEntry[];
}

export interface OnboardingPackageView {
  idx: number;
  memberPubkey: string;
  packageText: string;
  password: string;
  packageCopied: boolean;
  passwordCopied: boolean;
  qrShown: boolean;
  copied?: boolean;
}
