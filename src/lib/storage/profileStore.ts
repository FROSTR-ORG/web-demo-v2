import { del, get, set } from "idb-keyval";
import { assertNoRawShareMaterial } from "../bifrost/format";
import type { StoredProfileRecord, StoredProfileSummary } from "../bifrost/types";

const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";
const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

async function profileIds(): Promise<string[]> {
  return (await get<string[]>(PROFILE_INDEX_KEY)) ?? [];
}

async function setProfileIds(ids: string[]): Promise<void> {
  await set(PROFILE_INDEX_KEY, Array.from(new Set(ids)));
}

/**
 * Backfill `summary.updatedAt` from `summary.createdAt` when a record
 * was written before the field existed. Pure function — safe to call
 * every read. See VAL-SETTINGS-008 for the rendered "Updated" field
 * that sources this timestamp.
 */
function withUpdatedAt(record: StoredProfileRecord): StoredProfileRecord {
  if (typeof record.summary.updatedAt === "number") {
    return record;
  }
  return {
    ...record,
    summary: {
      ...record.summary,
      updatedAt: record.summary.createdAt
    }
  };
}

export async function listProfiles(): Promise<StoredProfileSummary[]> {
  const ids = await profileIds();
  const records = await Promise.all(ids.map((id) => getProfile(id)));
  return records
    .filter((record): record is StoredProfileRecord => Boolean(record))
    .map((record) => record.summary)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function getProfile(id: string): Promise<StoredProfileRecord | null> {
  const record = await get<StoredProfileRecord>(`${PROFILE_RECORD_PREFIX}${id}`);
  if (!record) return null;
  return withUpdatedAt(record);
}

export async function saveProfile(record: StoredProfileRecord): Promise<void> {
  assertNoRawShareMaterial(record.summary);
  await set(`${PROFILE_RECORD_PREFIX}${record.summary.id}`, record);
  await setProfileIds([record.summary.id, ...(await profileIds())]);
}

export async function touchProfile(id: string): Promise<void> {
  const record = await getProfile(id);
  if (!record) {
    return;
  }
  // NOTE: Only `lastUsedAt` changes on touch — `updatedAt` tracks
  // persisted-field mutations (name, relays, password, peer policies),
  // NOT unlocks. Preserve the existing `updatedAt` untouched so the
  // "Updated" cell in the Settings sidebar does not tick forward every
  // time the user unlocks the profile.
  await saveProfile({
    ...record,
    summary: {
      ...record.summary,
      lastUsedAt: Date.now()
    }
  });
}

export async function removeProfile(id: string): Promise<void> {
  await del(`${PROFILE_RECORD_PREFIX}${id}`);
  await setProfileIds((await profileIds()).filter((entry) => entry !== id));
}

export async function clearAllProfiles(): Promise<void> {
  const ids = await profileIds();
  await Promise.all(ids.map((id) => del(`${PROFILE_RECORD_PREFIX}${id}`)));
  await setProfileIds([]);
}

