import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * m5-idb-migration — end-to-end behavior: `profileStore.getProfile` and
 * `profileStore.listProfiles` read legacy records correctly and sweep
 * orphan index entries. Seeds a simulated pre-mission (pre-timestamps)
 * record and asserts the current-shape record is returned with every
 * preserved field intact.
 */

const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));

const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";
const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

import { getProfile, listProfiles } from "./profileStore";

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  storage.clear();
  vi.restoreAllMocks();
});

describe("profileStore + migrateProfileRecord — legacy records load cleanly", () => {
  it(
    "reads a pre-updatedAt record and surfaces real name, relays, and timestamps",
    async () => {
      const id = "legacy-profile-001";
      // Simulated pre-mission record: no `updatedAt`. Mirrors the shape
      // that would exist on a user's disk after a previous release.
      storage.set(PROFILE_INDEX_KEY, [id]);
      storage.set(`${PROFILE_RECORD_PREFIX}${id}`, {
        summary: {
          id,
          label: "Legacy Group",
          deviceName: "Alice Laptop",
          groupName: "Legacy Group",
          threshold: 2,
          memberCount: 3,
          localShareIdx: 1,
          groupPublicKey: "02deadbeef",
          relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
          createdAt: 1_680_000_000_000,
          lastUsedAt: 1_685_000_000_000,
          // NOTE: no updatedAt (pre-m5-group-profile-metadata).
        },
        encryptedProfilePackage: "bfprofile1legacyencrypted",
      });

      const record = await getProfile(id);
      expect(record).not.toBeNull();
      expect(record!.summary.label).toBe("Alice Laptop");
      expect(record!.summary.deviceName).toBe("Alice Laptop");
      expect(record!.summary.relays).toEqual([
        "wss://relay.primal.net",
        "wss://relay.damus.io",
      ]);
      expect(record!.summary.createdAt).toBe(1_680_000_000_000);
      // updatedAt is backfilled from createdAt so the Settings "Updated"
      // cell does NOT show "now" every time the user re-unlocks.
      expect(record!.summary.updatedAt).toBe(1_680_000_000_000);
      expect(record!.encryptedProfilePackage).toBe("bfprofile1legacyencrypted");

      // Listing still surfaces the legacy record as a current-shape
      // summary.
      const summaries = await listProfiles();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.id).toBe(id);
      expect(summaries[0]!.label).toBe("Alice Laptop");
      expect(summaries[0]!.deviceName).toBe("Alice Laptop");
      expect(summaries[0]!.updatedAt).toBe(1_680_000_000_000);
    },
  );

  it(
    "reads a pre-createdAt record (simulated ancient shape) without losing fields",
    async () => {
      const id = "legacy-profile-002";
      storage.set(PROFILE_INDEX_KEY, [id]);
      storage.set(`${PROFILE_RECORD_PREFIX}${id}`, {
        summary: {
          id,
          label: "Ancient Group",
          deviceName: "Ancient Device",
          groupName: "Ancient Group",
          threshold: 2,
          memberCount: 2,
          localShareIdx: 2,
          groupPublicKey: "02cafebabe",
          relays: ["wss://relay.local"],
          lastUsedAt: 1_670_000_000_000,
          // NOTE: NO createdAt, NO updatedAt.
        },
        encryptedProfilePackage: "bfprofile1ancientencrypted",
      });

      const record = await getProfile(id);
      expect(record).not.toBeNull();
      // Name and relays survived the migration.
      expect(record!.summary.deviceName).toBe("Ancient Device");
      expect(record!.summary.relays).toEqual(["wss://relay.local"]);
      // createdAt falls back to lastUsedAt; updatedAt falls back to
      // createdAt so the Settings "Updated" cell renders a stable value.
      expect(record!.summary.createdAt).toBe(1_670_000_000_000);
      expect(record!.summary.updatedAt).toBe(1_670_000_000_000);
      expect(record!.summary.lastUsedAt).toBe(1_670_000_000_000);
    },
  );

  it(
    "listProfiles drops orphan index entries (no record present) and sweeps them from the index",
    async () => {
      const goodId = "good-profile";
      const orphanId = "orphan-profile";
      storage.set(PROFILE_INDEX_KEY, [goodId, orphanId]);
      storage.set(`${PROFILE_RECORD_PREFIX}${goodId}`, {
        summary: {
          id: goodId,
          label: "Good",
          deviceName: "Good",
          groupName: "Good",
          threshold: 2,
          memberCount: 2,
          localShareIdx: 1,
          groupPublicKey: "02aa",
          relays: ["wss://relay.primal.net"],
          createdAt: 1_690_000_000_000,
          updatedAt: 1_690_000_000_000,
          lastUsedAt: 1_690_000_000_000,
        },
        encryptedProfilePackage: "bfprofile1good",
      });
      // NOTE: no record stored for `orphanId`.

      const summaries = await listProfiles();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.id).toBe(goodId);

      // Orphan is swept from the index (no phantom profile surfaces on
      // future calls or across reload).
      const indexAfter = storage.get(PROFILE_INDEX_KEY) as string[];
      expect(indexAfter).toEqual([goodId]);
    },
  );

  it(
    "listProfiles drops malformed records (no encryptedProfilePackage) without crashing",
    async () => {
      const id = "malformed-profile";
      storage.set(PROFILE_INDEX_KEY, [id]);
      storage.set(`${PROFILE_RECORD_PREFIX}${id}`, {
        summary: { id, deviceName: "No Body" },
        // NOTE: no encryptedProfilePackage.
      });

      const summaries = await listProfiles();
      expect(summaries).toEqual([]);
      const indexAfter = storage.get(PROFILE_INDEX_KEY) as string[];
      expect(indexAfter).toEqual([]);
    },
  );

  it(
    "listProfiles deletes the backing record for orphan/malformed entries (no stale IDB rows)",
    async () => {
      // Scrutiny m5 r1 fix: previously the index was swept but the
      // backing record key was left behind in IndexedDB. Now the
      // backing row must be removed too so a follow-up `del()` is
      // unnecessary and no phantom row survives a reload.
      const malformedId = "malformed-with-stale-row";
      const malformedKey = `${PROFILE_RECORD_PREFIX}${malformedId}`;
      storage.set(PROFILE_INDEX_KEY, [malformedId]);
      storage.set(malformedKey, {
        summary: { id: malformedId, deviceName: "No Body" },
        // NOTE: no encryptedProfilePackage → migrateProfileRecord
        // returns null, so this entry is an orphan body.
      });

      // Sanity: the backing row is present before listProfiles runs.
      expect(storage.has(malformedKey)).toBe(true);

      const summaries = await listProfiles();
      expect(summaries).toEqual([]);

      // Index was swept…
      const indexAfter = storage.get(PROFILE_INDEX_KEY) as string[];
      expect(indexAfter).toEqual([]);
      // …and the orphan backing row was ALSO deleted from idb-keyval.
      expect(storage.has(malformedKey)).toBe(false);
    },
  );

  it(
    "preserves unknown future-mission keys on the record, not silently dropping them",
    async () => {
      // Forward-compat hedge: if a future mission adds a new top-level
      // key on the record, a current-mission read+write round-trip must
      // not erase it. Today's migration strips unknown SUMMARY fields
      // to conform to the type contract, but it should at minimum not
      // throw on encountering them.
      const id = "future-profile";
      storage.set(PROFILE_INDEX_KEY, [id]);
      storage.set(`${PROFILE_RECORD_PREFIX}${id}`, {
        summary: {
          id,
          label: "Future",
          deviceName: "Future Device",
          groupName: "Future",
          threshold: 2,
          memberCount: 2,
          localShareIdx: 1,
          groupPublicKey: "02ff",
          relays: ["wss://relay.primal.net"],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          lastUsedAt: 1_700_000_000_000,
          // Hypothetical future fields:
          experimentalFlag: true,
          somethingElse: { nested: 1 },
        },
        encryptedProfilePackage: "bfprofile1future",
      });

      // The read must succeed and surface the known current fields.
      await expect(getProfile(id)).resolves.toMatchObject({
        summary: {
          id,
          deviceName: "Future Device",
          relays: ["wss://relay.primal.net"],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
        encryptedProfilePackage: "bfprofile1future",
      });
    },
  );
});
