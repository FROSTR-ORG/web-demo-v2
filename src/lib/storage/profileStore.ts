import { del, get, set } from "idb-keyval";
import { assertNoRawShareMaterial } from "../bifrost/format";
import type { StoredProfileRecord, StoredProfileSummary } from "../bifrost/types";
import { migrateProfileRecord } from "./profileMigration";

const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";
const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

async function profileIds(): Promise<string[]> {
  return (await get<string[]>(PROFILE_INDEX_KEY)) ?? [];
}

async function setProfileIds(ids: string[]): Promise<void> {
  await set(PROFILE_INDEX_KEY, Array.from(new Set(ids)));
}

export async function listProfiles(): Promise<StoredProfileSummary[]> {
  const ids = await profileIds();
  const records = await Promise.all(ids.map((id) => getProfile(id)));
  // m5-idb-migration: any index entry whose record is missing or
  // unreadable (orphan) is filtered out here AND swept from the index
  // so `listProfiles` → welcome UI never surfaces a phantom profile.
  // Scrutiny m5 r1: ALSO delete the backing record key via idb-keyval's
  // `del` for each orphan (malformed body OR index entry whose body was
  // never stored). Previously only the index was rebuilt, leaving stale
  // rows behind in IndexedDB.
  const liveRecords: StoredProfileRecord[] = [];
  const liveIds: string[] = [];
  const orphanIds: string[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const record = records[i];
    const id = ids[i]!;
    if (record) {
      liveRecords.push(record);
      liveIds.push(id);
    } else {
      orphanIds.push(id);
    }
  }
  if (orphanIds.length > 0) {
    // `del` is a no-op when the key is already absent (i.e. a pure
    // index-only orphan) so this is safe for both malformed backing
    // rows and index entries pointing to a nonexistent key.
    await Promise.all(
      orphanIds.map((id) => del(`${PROFILE_RECORD_PREFIX}${id}`)),
    );
    await setProfileIds(liveIds);
  }
  return liveRecords
    .map((record) => record.summary)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function getProfile(id: string): Promise<StoredProfileRecord | null> {
  const record = await get<unknown>(`${PROFILE_RECORD_PREFIX}${id}`);
  if (!record) return null;
  // m5-idb-migration: legacy records (pre-createdAt/updatedAt, partial
  // device/relay shape) are upgraded to the current shape on read. See
  // `./profileMigration.ts` for the migration contract.
  return migrateProfileRecord(record);
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

