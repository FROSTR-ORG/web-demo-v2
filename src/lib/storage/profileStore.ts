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

export async function listProfiles(): Promise<StoredProfileSummary[]> {
  const ids = await profileIds();
  const records = await Promise.all(ids.map((id) => getProfile(id)));
  return records
    .filter((record): record is StoredProfileRecord => Boolean(record))
    .map((record) => record.summary)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function getProfile(id: string): Promise<StoredProfileRecord | null> {
  return (await get<StoredProfileRecord>(`${PROFILE_RECORD_PREFIX}${id}`)) ?? null;
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

