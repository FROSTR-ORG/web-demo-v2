import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateProfileRecord } from "./profileMigration";
import type { StoredProfileRecord } from "../bifrost/types";

/**
 * m5-idb-migration — forward-only IndexedDB schema migration for the
 * `StoredProfileRecord` shape. Prior-mission records may be missing
 * fields that the current UI expects (notably `updatedAt`, but also
 * — in the most conservative "simulated legacy" fixture — `createdAt`,
 * `relays`, `deviceName`, etc.). The migration must:
 *
 *   1. Preserve every field that IS present (no data loss).
 *   2. Fill in sensible defaults for absent fields so downstream code
 *      (SettingsSidebar, AppStateProvider.activeProfile mapping) can
 *      render name + relays + timestamps without throwing.
 *   3. Return `null` for records that are obviously malformed (missing
 *      `encryptedProfilePackage` or `summary.id`) so orphan index
 *      entries can be swept by `listProfiles`.
 *
 * This test file doubles as a RED check for the feature: the imports
 * below do not resolve until `profileMigration.ts` exists.
 */

describe("migrateProfileRecord — legacy profile shape → current shape", () => {
  const FROZEN_NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a completely empty / unknown value", () => {
    expect(migrateProfileRecord(null)).toBeNull();
    expect(migrateProfileRecord(undefined)).toBeNull();
    expect(migrateProfileRecord("")).toBeNull();
    expect(migrateProfileRecord(42)).toBeNull();
    expect(migrateProfileRecord({})).toBeNull();
  });

  it("returns null when summary.id is missing", () => {
    expect(
      migrateProfileRecord({
        summary: { deviceName: "Alice Laptop" },
        encryptedProfilePackage: "bfprofile1xyz",
      }),
    ).toBeNull();
  });

  it("returns null when encryptedProfilePackage is missing", () => {
    expect(
      migrateProfileRecord({
        summary: { id: "profile-1", deviceName: "Alice Laptop" },
      }),
    ).toBeNull();
  });

  it("passes a current-shape record through unchanged", () => {
    const current: StoredProfileRecord = {
      summary: {
        id: "profile-1",
        label: "Alice Group",
        deviceName: "Alice Laptop",
        groupName: "Alice Group",
        threshold: 2,
        memberCount: 3,
        localShareIdx: 1,
        groupPublicKey: "02abcd",
        relays: ["wss://relay.primal.net"],
        createdAt: 1_690_000_000_000,
        updatedAt: 1_695_000_000_000,
        lastUsedAt: 1_699_000_000_000,
      },
      encryptedProfilePackage: "bfprofile1xyz",
    };
    const migrated = migrateProfileRecord(current);
    expect(migrated).toEqual(current);
  });

  it(
    "backfills missing updatedAt from createdAt (the common pre-m5-metadata case)",
    () => {
      const legacy = {
        summary: {
          id: "profile-2",
          label: "Legacy Group",
          deviceName: "Old Laptop",
          groupName: "Legacy Group",
          threshold: 2,
          memberCount: 3,
          localShareIdx: 2,
          groupPublicKey: "02abcd",
          relays: ["wss://relay.primal.net"],
          createdAt: 1_680_000_000_000,
          lastUsedAt: 1_685_000_000_000,
          // NOTE: no updatedAt
        },
        encryptedProfilePackage: "bfprofile1legacy",
      };
      const migrated = migrateProfileRecord(legacy);
      expect(migrated).not.toBeNull();
      expect(migrated!.summary.updatedAt).toBe(1_680_000_000_000);
      // Non-timestamp fields are preserved verbatim.
      expect(migrated!.summary.deviceName).toBe("Old Laptop");
      expect(migrated!.summary.relays).toEqual(["wss://relay.primal.net"]);
      expect(migrated!.summary.groupName).toBe("Legacy Group");
      expect(migrated!.summary.threshold).toBe(2);
      expect(migrated!.summary.memberCount).toBe(3);
      expect(migrated!.summary.localShareIdx).toBe(2);
      expect(migrated!.summary.groupPublicKey).toBe("02abcd");
      expect(migrated!.summary.lastUsedAt).toBe(1_685_000_000_000);
      expect(migrated!.encryptedProfilePackage).toBe("bfprofile1legacy");
    },
  );

  it(
    "fills in missing createdAt from lastUsedAt, and missing updatedAt from the same",
    () => {
      const legacy = {
        summary: {
          id: "profile-3",
          label: "No Timestamps",
          deviceName: "Ancient Laptop",
          groupName: "No Timestamps",
          threshold: 2,
          memberCount: 2,
          localShareIdx: 1,
          groupPublicKey: "02ffff",
          relays: ["wss://relay.damus.io"],
          lastUsedAt: 1_670_000_000_000,
          // NOTE: no createdAt, no updatedAt
        },
        encryptedProfilePackage: "bfprofile1ancient",
      };
      const migrated = migrateProfileRecord(legacy);
      expect(migrated).not.toBeNull();
      expect(migrated!.summary.createdAt).toBe(1_670_000_000_000);
      expect(migrated!.summary.updatedAt).toBe(1_670_000_000_000);
      expect(migrated!.summary.lastUsedAt).toBe(1_670_000_000_000);
    },
  );

  it(
    "falls back to Date.now() for all timestamps when every timestamp field is absent",
    () => {
      const legacy = {
        summary: {
          id: "profile-4",
          label: "Pristine",
          deviceName: "Clean Slate",
          groupName: "Pristine",
          threshold: 2,
          memberCount: 3,
          localShareIdx: 1,
          groupPublicKey: "02deed",
          relays: ["wss://relay.local"],
          // NOTE: NO createdAt, NO updatedAt, NO lastUsedAt
        },
        encryptedProfilePackage: "bfprofile1pristine",
      };
      const migrated = migrateProfileRecord(legacy);
      expect(migrated).not.toBeNull();
      expect(migrated!.summary.createdAt).toBe(FROZEN_NOW);
      expect(migrated!.summary.updatedAt).toBe(FROZEN_NOW);
      expect(migrated!.summary.lastUsedAt).toBe(FROZEN_NOW);
    },
  );

  it("coerces missing deviceName to an empty string (no crash in Settings render)", () => {
    const legacy = {
      summary: {
        id: "profile-5",
        label: "Unnamed",
        groupName: "Unnamed",
        threshold: 2,
        memberCount: 3,
        localShareIdx: 1,
        groupPublicKey: "02abab",
        relays: ["wss://relay.primal.net"],
        createdAt: 1_680_000_000_000,
        lastUsedAt: 1_685_000_000_000,
        // NOTE: no deviceName
      },
      encryptedProfilePackage: "bfprofile1unnamed",
    };
    const migrated = migrateProfileRecord(legacy);
    expect(migrated!.summary.deviceName).toBe("");
  });

  it("coerces missing relays to an empty array", () => {
    const legacy = {
      summary: {
        id: "profile-6",
        label: "No Relays",
        deviceName: "NR",
        groupName: "No Relays",
        threshold: 2,
        memberCount: 2,
        localShareIdx: 1,
        groupPublicKey: "02abab",
        createdAt: 1_680_000_000_000,
        lastUsedAt: 1_685_000_000_000,
        // NOTE: no relays
      },
      encryptedProfilePackage: "bfprofile1no-relays",
    };
    const migrated = migrateProfileRecord(legacy);
    expect(Array.isArray(migrated!.summary.relays)).toBe(true);
    expect(migrated!.summary.relays).toEqual([]);
  });

  it("defaults optional structural fields to safe values without dropping id/package", () => {
    const legacy = {
      summary: {
        id: "profile-7",
        // Nothing else.
      },
      encryptedProfilePackage: "bfprofile1minimal",
    };
    const migrated = migrateProfileRecord(legacy);
    expect(migrated).not.toBeNull();
    expect(migrated!.summary.id).toBe("profile-7");
    expect(migrated!.summary.label).toBe("");
    expect(migrated!.summary.deviceName).toBe("");
    expect(migrated!.summary.groupName).toBe("");
    expect(migrated!.summary.threshold).toBe(0);
    expect(migrated!.summary.memberCount).toBe(0);
    expect(migrated!.summary.localShareIdx).toBe(0);
    expect(migrated!.summary.groupPublicKey).toBe("");
    expect(migrated!.summary.relays).toEqual([]);
    expect(migrated!.summary.createdAt).toBe(FROZEN_NOW);
    expect(migrated!.summary.updatedAt).toBe(FROZEN_NOW);
    expect(migrated!.summary.lastUsedAt).toBe(FROZEN_NOW);
    expect(migrated!.encryptedProfilePackage).toBe("bfprofile1minimal");
  });

  it("does not mutate the input value", () => {
    const legacy = {
      summary: {
        id: "profile-8",
        deviceName: "Immutable",
        groupName: "G",
        threshold: 2,
        memberCount: 2,
        localShareIdx: 1,
        groupPublicKey: "02ffff",
        relays: ["wss://relay.primal.net"],
        label: "G",
        lastUsedAt: 1_680_000_000_000,
        createdAt: 1_680_000_000_000,
      },
      encryptedProfilePackage: "bfprofile1immutable",
    };
    const frozenInput = JSON.parse(JSON.stringify(legacy));
    migrateProfileRecord(legacy);
    expect(legacy).toEqual(frozenInput);
  });

  it(
    "preserves forward-compat unknown summary fields through migration (scrutiny m5 r1)",
    () => {
      // A record written by a NEWER build than the current one may
      // include summary keys we don't know about yet. The migration
      // must preserve them verbatim so a subsequent save round-trips
      // the data rather than silently discarding it.
      const legacyWithFutureField = {
        summary: {
          id: "profile-forward",
          label: "Forward Compat",
          deviceName: "Future Laptop",
          groupName: "Forward Compat",
          threshold: 2,
          memberCount: 3,
          localShareIdx: 1,
          groupPublicKey: "02ffff",
          relays: ["wss://relay.primal.net"],
          createdAt: 1_680_000_000_000,
          updatedAt: 1_685_000_000_000,
          lastUsedAt: 1_685_000_000_000,
          // Unknown forward-compat fields:
          foo: "bar",
          featureFlags: { signAnimations: true },
        },
        encryptedProfilePackage: "bfprofile1forward",
      };
      const migrated = migrateProfileRecord(legacyWithFutureField);
      expect(migrated).not.toBeNull();
      // Unknown fields survived the round-trip.
      const migratedSummary = migrated!.summary as unknown as Record<string, unknown>;
      expect(migratedSummary.foo).toBe("bar");
      expect(migratedSummary.featureFlags).toEqual({ signAnimations: true });
      // Canonical / required fields still populated with their
      // coerced / defaulted values.
      expect(migrated!.summary.id).toBe("profile-forward");
      expect(migrated!.summary.deviceName).toBe("Future Laptop");
      expect(migrated!.summary.createdAt).toBe(1_680_000_000_000);
      expect(migrated!.summary.updatedAt).toBe(1_685_000_000_000);
      expect(migrated!.encryptedProfilePackage).toBe("bfprofile1forward");
    },
  );

  it("is idempotent: migrating an already-migrated record is a no-op", () => {
    const legacy = {
      summary: {
        id: "profile-9",
        label: "Idem",
        deviceName: "Idem",
        groupName: "Idem",
        threshold: 2,
        memberCount: 2,
        localShareIdx: 1,
        groupPublicKey: "02ffff",
        relays: ["wss://relay.local"],
        createdAt: 1_680_000_000_000,
        lastUsedAt: 1_685_000_000_000,
      },
      encryptedProfilePackage: "bfprofile1idem",
    };
    const first = migrateProfileRecord(legacy);
    const second = migrateProfileRecord(first);
    expect(second).toEqual(first);
  });
});
