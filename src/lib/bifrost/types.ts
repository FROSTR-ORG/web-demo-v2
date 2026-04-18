import { z } from "zod";

export type Hex = string;

export const MemberPackageWireSchema = z.object({
  idx: z.number().int().nonnegative(),
  pubkey: z.string()
});

export const GroupPackageWireSchema = z.object({
  group_name: z.string().min(1),
  group_pk: z.string(),
  threshold: z.number().int().positive(),
  members: z.array(MemberPackageWireSchema).min(1)
});

export const SharePackageWireSchema = z.object({
  idx: z.number().int().nonnegative(),
  seckey: z.string().length(64)
});

export const DerivedPublicNonceWireSchema = z.object({
  binder_pn: z.string(),
  hidden_pn: z.string(),
  code: z.string()
});

export type MemberPackageWire = z.infer<typeof MemberPackageWireSchema>;
export type GroupPackageWire = z.infer<typeof GroupPackageWireSchema>;
export type SharePackageWire = z.infer<typeof SharePackageWireSchema>;
export type DerivedPublicNonceWire = z.infer<typeof DerivedPublicNonceWireSchema>;

export const KeysetBundleSchema = z.object({
  group: GroupPackageWireSchema,
  shares: z.array(SharePackageWireSchema).min(1)
});

export type KeysetBundle = z.infer<typeof KeysetBundleSchema>;

export interface BfManualPeerPolicyOverride {
  pubkey: string;
  policy: unknown;
}

export interface BfProfilePayload {
  profile_id: string;
  version: number;
  device: {
    name: string;
    share_secret: string;
    manual_peer_policy_overrides: BfManualPeerPolicyOverride[];
    relays: string[];
  };
  group_package: GroupPackageWire;
}

export interface BfOnboardPayload {
  share_secret: string;
  relays: string[];
  peer_pk: string;
}

export interface ProfilePackagePair {
  profile_string: string;
  share_string: string;
}

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
  | { Onboard: { request_id: string; group_member_count: number; group: GroupPackageWire; nonces: DerivedPublicNonceWire[] } };

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
  createdAt: number;
  lastUsedAt: number;
}

export interface StoredProfileRecord {
  summary: StoredProfileSummary;
  encryptedProfilePackage: string;
}

export interface OnboardingPackageView {
  idx: number;
  memberPubkey: string;
  packageText: string;
  password: string;
  copied: boolean;
  qrShown: boolean;
}

