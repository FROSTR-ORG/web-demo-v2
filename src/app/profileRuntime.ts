import { runtimeBootstrapFromParts } from "../lib/bifrost/format";
import {
  createProfilePackagePair,
  deriveProfileIdFromShareSecret,
  resolveShareIndex
} from "../lib/bifrost/packageService";
import { RuntimeClient } from "../lib/bifrost/runtimeClient";
import type {
  BfProfilePayload,
  RuntimeSnapshotInput,
  StoredProfileRecord
} from "../lib/bifrost/types";

export async function createRuntimeFromProfilePayload(payload: BfProfilePayload, localShareIdx: number): Promise<RuntimeClient> {
  const runtime = new RuntimeClient();
  await runtime.init(
    {},
    runtimeBootstrapFromParts(payload.group_package, {
      idx: localShareIdx,
      seckey: payload.device.share_secret
    })
  );
  return runtime;
}

export async function createRuntimeFromSnapshot(snapshot: RuntimeSnapshotInput): Promise<RuntimeClient> {
  const runtime = new RuntimeClient();
  await runtime.restore({}, snapshot);
  return runtime;
}

export async function normalizeProfilePayload(payload: BfProfilePayload): Promise<{
  profileId: string;
  localShareIdx: number;
  normalizedPayload: BfProfilePayload;
}> {
  const localShareIdx = await resolveShareIndex(payload.group_package, payload.device.share_secret);
  const profileId = payload.profile_id || (await deriveProfileIdFromShareSecret(payload.device.share_secret));
  const normalizedPayload: BfProfilePayload = {
    ...payload,
    profile_id: profileId,
    version: payload.version || 1,
    device: {
      ...payload.device,
      name: payload.device.name.trim() || "Igloo Web",
      manual_peer_policy_overrides: payload.device.manual_peer_policy_overrides ?? [],
      relays: payload.device.relays.map((relay) => relay.trim()).filter(Boolean)
    }
  };
  return { profileId, localShareIdx, normalizedPayload };
}

export async function buildStoredProfileRecord(
  payload: BfProfilePayload,
  password: string,
  options: { createdAt?: number; lastUsedAt?: number; label?: string } = {}
): Promise<{ record: StoredProfileRecord; normalizedPayload: BfProfilePayload; localShareIdx: number }> {
  const { profileId, localShareIdx, normalizedPayload } = await normalizeProfilePayload(payload);
  if (normalizedPayload.device.relays.length === 0) {
    throw new Error("At least one relay is required.");
  }
  const pair = await createProfilePackagePair(normalizedPayload, password);
  const createdAt = options.createdAt ?? Date.now();
  const lastUsedAt = options.lastUsedAt ?? Date.now();
  const record: StoredProfileRecord = {
    summary: {
      id: profileId,
      label: options.label ?? normalizedPayload.group_package.group_name,
      deviceName: normalizedPayload.device.name,
      groupName: normalizedPayload.group_package.group_name,
      threshold: normalizedPayload.group_package.threshold,
      memberCount: normalizedPayload.group_package.members.length,
      localShareIdx,
      groupPublicKey: normalizedPayload.group_package.group_pk,
      relays: normalizedPayload.device.relays,
      createdAt,
      lastUsedAt
    },
    encryptedProfilePackage: pair.profile_string
  };
  return { record, normalizedPayload, localShareIdx };
}
