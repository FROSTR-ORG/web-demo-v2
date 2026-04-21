import { memberForShare, memberPubkeyXOnly } from "./format";
import {
  GroupPackageWireSchema,
  BfOnboardPayloadSchema,
  BfProfilePayloadSchema,
  BfSharePayloadSchema,
  OnboardingRequestBundleSchema,
  OnboardingResponseSchema,
  GeneratedNsecResultSchema,
  KeysetBundleSchema,
  ProfilePackagePairSchema,
  RecoveredNsecResultSchema,
  SharePackageWireSchema,
  StructuredBridgeResultSchema,
  EncryptedProfileBackupSchema,
  ProfileBackupEventSchema,
  type BifrostPackageErrorCode,
  type BfManualPeerPolicyOverride,
  type BfMethodPolicyOverride,
  type BfSharePayload,
  type BfOnboardPayload,
  type BfProfilePayload,
  type EncryptedProfileBackup,
  type GeneratedNsecResult,
  type GroupPackageWire,
  type KeysetBundle,
  type OnboardingRequestBundle,
  type OnboardingResponse,
  type ProfileBackupEvent,
  type ProfilePackagePair,
  type RecoveredNsecResult,
  type RotateKeysetBundleResult,
  type RuntimeSnapshotInput,
  type SharePackageWire,
} from "./types";
import {
  loadBridge,
  normalizeBifrostError,
  parseJsonResult,
} from "../wasm/loadBridge";
import type { z } from "zod";

export interface CreateKeysetInput {
  groupName: string;
  threshold: number;
  count: number;
}

export class BifrostPackageError extends Error {
  constructor(
    public readonly code: BifrostPackageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BifrostPackageError";
  }
}

function parseStructuredResult<TSchema extends z.ZodTypeAny>(
  json: string,
  schema: TSchema,
): z.output<TSchema> {
  const result = StructuredBridgeResultSchema.parse(parseJsonResult(json));
  if (!result.ok) {
    const error = result.error;
    throw new BifrostPackageError(
      error?.code ?? "invalid_payload",
      error?.message ?? "Bifrost package operation failed.",
    );
  }
  return schema.parse(result.value);
}

export async function createKeysetBundle(
  input: CreateKeysetInput,
): Promise<KeysetBundle> {
  try {
    const bridge = await loadBridge();
    const json = bridge.create_keyset_bundle(
      JSON.stringify({
        group_name: input.groupName.trim(),
        threshold: input.threshold,
        count: input.count,
      }),
    );
    return KeysetBundleSchema.parse(parseJsonResult(json));
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function generateNsec(): Promise<GeneratedNsecResult> {
  try {
    const bridge = await loadBridge();
    return GeneratedNsecResultSchema.parse(
      parseJsonResult(bridge.generate_nsec()),
    );
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function createKeysetBundleFromNsec(
  input: CreateKeysetInput & { nsec: string },
): Promise<KeysetBundle> {
  try {
    const bridge = await loadBridge();
    const json = bridge.create_keyset_bundle_from_nsec(
      JSON.stringify({
        nsec: input.nsec,
        group_name: input.groupName.trim(),
        threshold: input.threshold,
        count: input.count,
      }),
    );
    return KeysetBundleSchema.parse(parseJsonResult(json));
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function deriveProfileIdFromShareSecret(
  shareSecret: string,
): Promise<string> {
  try {
    const bridge = await loadBridge();
    return bridge.derive_profile_id_from_share_secret(shareSecret);
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function createProfilePackagePair(
  payload: BfProfilePayload,
  password: string,
): Promise<ProfilePackagePair> {
  try {
    const bridge = await loadBridge();
    const json = bridge.create_profile_package_pair(
      JSON.stringify(payload),
      password,
    );
    return ProfilePackagePairSchema.parse(parseJsonResult(json));
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function encodeBfsharePackage(
  payload: BfSharePayload,
  password: string,
): Promise<string> {
  try {
    BfSharePayloadSchema.parse(payload);
    const bridge = await loadBridge();
    return bridge.encode_bfshare_package(JSON.stringify(payload), password);
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function decodeBfsharePackage(
  packageText: string,
  password: string,
): Promise<BfSharePayload> {
  try {
    const bridge = await loadBridge();
    return parseStructuredResult(
      bridge.decode_bfshare_package_result(packageText, password),
      BfSharePayloadSchema,
    );
  } catch (error) {
    if (error instanceof BifrostPackageError) {
      throw error;
    }
    throw normalizeBifrostError(error);
  }
}

export async function decodeProfilePackage(
  packageText: string,
  password: string,
): Promise<BfProfilePayload> {
  try {
    const bridge = await loadBridge();
    return parseStructuredResult(
      bridge.decode_bfprofile_package_result(packageText, password),
      BfProfilePayloadSchema,
    );
  } catch (error) {
    if (error instanceof BifrostPackageError) {
      throw error;
    }
    throw normalizeBifrostError(error);
  }
}

export async function decodeBfonboardPackage(
  packageText: string,
  password: string,
): Promise<BfOnboardPayload> {
  try {
    const bridge = await loadBridge();
    return parseStructuredResult(
      bridge.decode_bfonboard_package_result(packageText, password),
      BfOnboardPayloadSchema,
    );
  } catch (error) {
    if (error instanceof BifrostPackageError) {
      throw error;
    }
    throw normalizeBifrostError(error);
  }
}

export async function defaultBifrostEventKind(): Promise<number> {
  try {
    const bridge = await loadBridge();
    return Number(bridge.default_event_kind());
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function createOnboardingRequestBundle(input: {
  shareSecret: string;
  peerPubkey32Hex: string;
  eventKind: number;
  sentAtSeconds?: number;
}): Promise<OnboardingRequestBundle> {
  try {
    const bridge = await loadBridge();
    return OnboardingRequestBundleSchema.parse(
      parseJsonResult(
        bridge.create_onboarding_request_bundle(
          input.shareSecret,
          input.peerPubkey32Hex,
          BigInt(input.eventKind),
          input.sentAtSeconds,
        ),
      ),
    );
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function decodeOnboardingResponseEvent(input: {
  event: unknown;
  shareSecret: string;
  expectedPeerPubkey32Hex: string;
  expectedLocalPubkey32Hex: string;
  requestId: string;
}): Promise<OnboardingResponse | null> {
  try {
    const bridge = await loadBridge();
    return parseStructuredResult(
      bridge.decode_onboarding_response_event_result(
        typeof input.event === "string"
          ? input.event
          : JSON.stringify(input.event),
        input.shareSecret,
        input.expectedPeerPubkey32Hex,
        input.expectedLocalPubkey32Hex,
        input.requestId,
      ),
      OnboardingResponseSchema.nullable(),
    );
  } catch (error) {
    if (error instanceof BifrostPackageError) {
      throw error;
    }
    throw normalizeBifrostError(error);
  }
}

export async function buildOnboardingRuntimeSnapshot(input: {
  group: GroupPackageWire;
  shareSecret: string;
  peerPubkey32Hex: string;
  responseNonces: OnboardingResponse["nonces"];
  bootstrapStateHex: string;
}): Promise<RuntimeSnapshotInput> {
  try {
    GroupPackageWireSchema.parse(input.group);
    const bridge = await loadBridge();
    return parseJsonResult(
      bridge.build_onboarding_runtime_snapshot(
        JSON.stringify(input.group),
        input.shareSecret,
        input.peerPubkey32Hex,
        JSON.stringify(input.responseNonces),
        input.bootstrapStateHex,
      ),
    );
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function encodeOnboardPackage(
  payload: BfOnboardPayload,
  password: string,
): Promise<string> {
  try {
    BfOnboardPayloadSchema.parse(payload);
    const bridge = await loadBridge();
    return bridge.encode_bfonboard_package(JSON.stringify(payload), password);
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function rotateKeysetBundle(input: {
  group: GroupPackageWire;
  shares: SharePackageWire[];
  threshold: number;
  count: number;
}): Promise<RotateKeysetBundleResult> {
  try {
    GroupPackageWireSchema.parse(input.group);
    input.shares.forEach((share) => SharePackageWireSchema.parse(share));
    const bridge = await loadBridge();
    const json = bridge.rotate_keyset_bundle(
      JSON.stringify({
        group: input.group,
        shares: input.shares,
        threshold: input.threshold,
        count: input.count,
      }),
    );
    const result = parseJsonResult<RotateKeysetBundleResult>(json);
    return {
      ...result,
      next: KeysetBundleSchema.parse(result.next),
    };
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function recoverNsecFromShares(input: {
  group: GroupPackageWire;
  shares: SharePackageWire[];
}): Promise<RecoveredNsecResult> {
  try {
    GroupPackageWireSchema.parse(input.group);
    input.shares.forEach((share) => SharePackageWireSchema.parse(share));
    const bridge = await loadBridge();
    return RecoveredNsecResultSchema.parse(
      parseJsonResult(
        bridge.recover_nsec_from_shares(
          JSON.stringify({
            group: input.group,
            shares: input.shares,
          }),
        ),
      ),
    );
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function resolveShareIndex(
  group: GroupPackageWire,
  shareSecret: string,
): Promise<number> {
  try {
    GroupPackageWireSchema.parse(group);
    const bridge = await loadBridge();
    return bridge.resolve_share_index(JSON.stringify(group), shareSecret);
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export function profilePayloadForShare(params: {
  profileId: string;
  deviceName: string;
  share: SharePackageWire;
  group: GroupPackageWire;
  relays: string[];
  manualPeerPolicyOverrides?: BfManualPeerPolicyOverride[];
}): BfProfilePayload {
  GroupPackageWireSchema.parse(params.group);
  return BfProfilePayloadSchema.parse({
    profile_id: params.profileId,
    version: 1,
    device: {
      name: params.deviceName.trim(),
      share_secret: params.share.seckey,
      manual_peer_policy_overrides: params.manualPeerPolicyOverrides ?? [],
      relays: params.relays,
    },
    group_package: params.group,
  });
}

export function defaultManualPeerPolicyOverrides(
  group: GroupPackageWire,
  localShareIdx: number,
): BfManualPeerPolicyOverride[] {
  GroupPackageWireSchema.parse(group);
  const allowAll: BfMethodPolicyOverride = {
    echo: "allow",
    ping: "allow",
    onboard: "allow",
    sign: "allow",
    ecdh: "allow",
  };
  return group.members
    .filter((member) => member.idx !== localShareIdx)
    .map((member) => ({
      pubkey: memberPubkeyXOnly(member),
      policy: {
        request: { ...allowAll },
        respond: { ...allowAll },
      },
    }));
}

export function onboardPayloadForRemoteShare(params: {
  remoteShare: SharePackageWire;
  localShare: SharePackageWire;
  group: GroupPackageWire;
  relays: string[];
}): BfOnboardPayload {
  const localMember = memberForShare(params.group, params.localShare);
  return BfOnboardPayloadSchema.parse({
    share_secret: params.remoteShare.seckey,
    relays: params.relays,
    peer_pk: memberPubkeyXOnly(localMember),
  });
}

export async function createEncryptedProfileBackup(
  profile: BfProfilePayload,
): Promise<EncryptedProfileBackup> {
  const bridge = await loadBridge();
  const json = bridge.create_encrypted_profile_backup(
    JSON.stringify(BfProfilePayloadSchema.parse(profile)),
  );
  return EncryptedProfileBackupSchema.parse(parseJsonResult(json));
}

export async function buildProfileBackupEvent(params: {
  shareSecret: string;
  backup: EncryptedProfileBackup;
  createdAtSeconds?: number;
}): Promise<ProfileBackupEvent> {
  const bridge = await loadBridge();
  const json = bridge.build_profile_backup_event(
    params.shareSecret,
    JSON.stringify(params.backup),
    params.createdAtSeconds ?? Math.floor(Date.now() / 1000),
  );
  return ProfileBackupEventSchema.parse(parseJsonResult(json));
}

export async function parseProfileBackupEvent(params: {
  eventJson: string;
  shareSecret: string;
}): Promise<EncryptedProfileBackup> {
  const bridge = await loadBridge();
  const json = bridge.parse_profile_backup_event(
    params.eventJson,
    params.shareSecret,
  );
  return EncryptedProfileBackupSchema.parse(parseJsonResult(json));
}

export async function profileBackupEventKind(): Promise<number> {
  const bridge = await loadBridge();
  return bridge.profile_backup_event_kind();
}

export async function profileBackupKeyDomain(): Promise<string> {
  const bridge = await loadBridge();
  return bridge.profile_backup_key_domain();
}
