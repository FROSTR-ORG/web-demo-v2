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
import type { ShareAllocationEntry } from "../lib/storage/unadoptedSharesPool";
import { RELAY_EMPTY_ERROR } from "./AppStateTypes";
import { ONBOARD_RUNTIME_CONFIG } from "./onboardingTiming";

export async function createRuntimeFromProfilePayload(payload: BfProfilePayload, localShareIdx: number): Promise<RuntimeClient> {
  const runtime = new RuntimeClient();
  await runtime.init(
    ONBOARD_RUNTIME_CONFIG,
    runtimeBootstrapFromParts(payload.group_package, {
      idx: localShareIdx,
      seckey: payload.device.share_secret
    })
  );
  return runtime;
}

export async function createRuntimeFromSnapshot(snapshot: RuntimeSnapshotInput): Promise<RuntimeClient> {
  const runtime = new RuntimeClient();
  await runtime.restore(ONBOARD_RUNTIME_CONFIG, snapshot);
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
  options: {
    createdAt?: number;
    lastUsedAt?: number;
    updatedAt?: number;
    label?: string;
    /**
     * fix-m7-onboard-distinct-share-allocation — pass through the
     * encrypted unadopted shares pool envelope and its allocation
     * ledger when rebuilding the record. Callers that are only
     * rotating the profile password / relays / name leave these fields
     * at their prior values so the pool is not silently wiped on
     * unrelated mutations.
     */
    unadoptedSharesCiphertext?: string;
    shareAllocations?: ShareAllocationEntry[];
  } = {}
): Promise<{ record: StoredProfileRecord; normalizedPayload: BfProfilePayload; localShareIdx: number }> {
  const { profileId, localShareIdx, normalizedPayload } = await normalizeProfilePayload(payload);
  if (normalizedPayload.device.relays.length === 0) {
    throw new Error(RELAY_EMPTY_ERROR);
  }
  const pair = await createProfilePackagePair(normalizedPayload, password);
  const now = Date.now();
  const createdAt = options.createdAt ?? now;
  const lastUsedAt = options.lastUsedAt ?? now;
  // Default `updatedAt` to NOW because every call through this helper
  // re-encrypts the profile and mutates on-disk state (share secret,
  // relays, name, password, or peer policy cell). Callers that want to
  // preserve a previous `updatedAt` (e.g. `touchProfile`'s last-used
  // refresh) must opt in by passing it explicitly. See VAL-SETTINGS-008
  // for the rendered "Updated" field sourced from this timestamp.
  const updatedAt = options.updatedAt ?? now;
  const record: StoredProfileRecord = {
    summary: {
      id: profileId,
      label: options.label ?? normalizedPayload.device.name,
      deviceName: normalizedPayload.device.name,
      groupName: normalizedPayload.group_package.group_name,
      threshold: normalizedPayload.group_package.threshold,
      memberCount: normalizedPayload.group_package.members.length,
      localShareIdx,
      groupPublicKey: normalizedPayload.group_package.group_pk,
      relays: normalizedPayload.device.relays,
      createdAt,
      updatedAt,
      lastUsedAt
    },
    encryptedProfilePackage: pair.profile_string,
    ...(options.unadoptedSharesCiphertext
      ? { unadoptedSharesCiphertext: options.unadoptedSharesCiphertext }
      : {}),
    ...(options.shareAllocations && options.shareAllocations.length > 0
      ? { shareAllocations: options.shareAllocations }
      : {})
  };
  return { record, normalizedPayload, localShareIdx };
}
