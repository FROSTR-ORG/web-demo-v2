import { memberForShare, memberPubkeyXOnly } from "./format";
import {
  GroupPackageWireSchema,
  KeysetBundleSchema,
  type BfOnboardPayload,
  type BfProfilePayload,
  type GroupPackageWire,
  type KeysetBundle,
  type ProfilePackagePair,
  type SharePackageWire
} from "./types";
import { loadBridge, normalizeBifrostError, parseJsonResult } from "../wasm/loadBridge";

export interface CreateKeysetInput {
  groupName: string;
  threshold: number;
  count: number;
}

export async function createKeysetBundle(input: CreateKeysetInput): Promise<KeysetBundle> {
  try {
    const bridge = await loadBridge();
    const json = bridge.create_keyset_bundle(
      JSON.stringify({
        group_name: input.groupName.trim(),
        threshold: input.threshold,
        count: input.count
      })
    );
    return KeysetBundleSchema.parse(parseJsonResult(json));
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function deriveProfileIdFromShareSecret(shareSecret: string): Promise<string> {
  try {
    const bridge = await loadBridge();
    return bridge.derive_profile_id_from_share_secret(shareSecret);
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function createProfilePackagePair(
  payload: BfProfilePayload,
  password: string
): Promise<ProfilePackagePair> {
  try {
    const bridge = await loadBridge();
    const json = bridge.create_profile_package_pair(JSON.stringify(payload), password);
    return parseJsonResult<ProfilePackagePair>(json);
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function decodeProfilePackage(
  packageText: string,
  password: string
): Promise<BfProfilePayload> {
  try {
    const bridge = await loadBridge();
    return parseJsonResult<BfProfilePayload>(bridge.decode_bfprofile_package(packageText, password));
  } catch (error) {
    throw normalizeBifrostError(error);
  }
}

export async function encodeOnboardPackage(
  payload: BfOnboardPayload,
  password: string
): Promise<string> {
  try {
    const bridge = await loadBridge();
    return bridge.encode_bfonboard_package(JSON.stringify(payload), password);
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
}): BfProfilePayload {
  GroupPackageWireSchema.parse(params.group);
  return {
    profile_id: params.profileId,
    version: 1,
    device: {
      name: params.deviceName.trim(),
      share_secret: params.share.seckey,
      manual_peer_policy_overrides: [],
      relays: params.relays
    },
    group_package: params.group
  };
}

export function onboardPayloadForRemoteShare(params: {
  remoteShare: SharePackageWire;
  localShare: SharePackageWire;
  group: GroupPackageWire;
  relays: string[];
}): BfOnboardPayload {
  const localMember = memberForShare(params.group, params.localShare);
  return {
    share_secret: params.remoteShare.seckey,
    relays: params.relays,
    peer_pk: memberPubkeyXOnly(localMember)
  };
}

