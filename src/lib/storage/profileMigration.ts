import type { StoredProfileRecord, StoredProfileSummary } from "../bifrost/types";
import { ShareAllocationEntrySchema } from "./unadoptedSharesPool";
import type { ShareAllocationEntry } from "./unadoptedSharesPool";

/**
 * m5-idb-migration — forward-only IndexedDB schema migration.
 *
 * Records written by prior-mission builds may be missing fields that the
 * current UI expects (notably `createdAt` / `updatedAt`, which were
 * introduced in m5-group-profile-metadata; and in the most defensive
 * case, other structural fields). This module centralises a pure
 * migration function `migrateProfileRecord` that:
 *
 *   1. Preserves every field present on the legacy record.
 *   2. Fills in sensible defaults for absent fields so SettingsSidebar
 *      and `AppStateProvider.activeProfile` can render name, relays,
 *      and timestamps without throwing or leaking hardcoded fallbacks
 *      (see VAL-SETTINGS-008 for the rendered "Updated" field).
 *   3. Returns `null` for records missing the structural spine
 *      (`summary.id` or `encryptedProfilePackage`), allowing
 *      `listProfiles` to sweep orphan index entries that no longer
 *      have a loadable body.
 *
 * The migration is deliberately lossless for known fields and
 * idempotent — migrating an already-migrated record is a no-op.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function migrateSummary(
  raw: Record<string, unknown>,
  now: number,
): StoredProfileSummary | null {
  const id = asString(raw.id, "");
  if (id.length === 0) {
    return null;
  }

  // Timestamp chain: prefer explicit fields; if one is missing, fall
  // back to the nearest sibling so the "Updated" cell doesn't flip to
  // Date.now() on every read of a legacy record. `Date.now()` is the
  // absolute fallback for a truly pristine pre-timestamps record.
  const explicitCreatedAt = asNumber(raw.createdAt, Number.NaN);
  const explicitUpdatedAt = asNumber(raw.updatedAt, Number.NaN);
  const explicitLastUsedAt = asNumber(raw.lastUsedAt, Number.NaN);

  const createdAt = Number.isFinite(explicitCreatedAt)
    ? explicitCreatedAt
    : Number.isFinite(explicitLastUsedAt)
      ? explicitLastUsedAt
      : Number.isFinite(explicitUpdatedAt)
        ? explicitUpdatedAt
        : now;

  const updatedAt = Number.isFinite(explicitUpdatedAt)
    ? explicitUpdatedAt
    : createdAt;

  const lastUsedAt = Number.isFinite(explicitLastUsedAt)
    ? explicitLastUsedAt
    : createdAt;

  // Spread the raw summary FIRST so any forward-compat unknown fields
  // (written by a newer build) survive the migration. Canonical fields
  // are then overwritten with their validated / coerced values so the
  // defaults-on-missing semantics still hold. Scrutiny m5 r1 flagged
  // the previous whitelist-only reconstruction as silently dropping
  // these unknown keys.
  return {
    ...raw,
    id,
    label: asString(raw.label, ""),
    deviceName: asString(raw.deviceName, ""),
    groupName: asString(raw.groupName, ""),
    threshold: asNumber(raw.threshold, 0),
    memberCount: asNumber(raw.memberCount, 0),
    localShareIdx: asNumber(raw.localShareIdx, 0),
    groupPublicKey: asString(raw.groupPublicKey, ""),
    relays: asStringArray(raw.relays),
    createdAt,
    updatedAt,
    lastUsedAt,
  };
}

/**
 * Migrate a raw IDB value into the current `StoredProfileRecord` shape.
 * Returns `null` if the value cannot be coerced into a loadable record
 * (missing id or encrypted package) — callers should treat `null` as an
 * orphan and skip it.
 */
export function migrateProfileRecord(raw: unknown): StoredProfileRecord | null {
  if (!isPlainObject(raw)) return null;

  const rawSummary = raw.summary;
  if (!isPlainObject(rawSummary)) return null;

  const encryptedProfilePackage = raw.encryptedProfilePackage;
  if (typeof encryptedProfilePackage !== "string" || encryptedProfilePackage.length === 0) {
    return null;
  }

  const now = Date.now();
  const summary = migrateSummary(rawSummary, now);
  if (!summary) return null;

  // fix-m7-onboard-distinct-share-allocation — forward-only migration
  // of the new pool fields. Both are optional on legacy records; we
  // preserve them byte-for-byte when present and pass them through
  // unchanged when absent. A future schema bump can re-validate the
  // ledger shape here; for now we trust the write path to enforce the
  // schema and only drop obviously-invalid structures.
  const rawUnadoptedCiphertext = (raw as { unadoptedSharesCiphertext?: unknown })
    .unadoptedSharesCiphertext;
  const unadoptedSharesCiphertext =
    typeof rawUnadoptedCiphertext === "string" && rawUnadoptedCiphertext.length > 0
      ? rawUnadoptedCiphertext
      : undefined;
  const rawShareAllocations = (raw as { shareAllocations?: unknown })
    .shareAllocations;
  let shareAllocations: ShareAllocationEntry[] | undefined;
  if (Array.isArray(rawShareAllocations)) {
    const validated: ShareAllocationEntry[] = [];
    for (const entry of rawShareAllocations) {
      const parsed = ShareAllocationEntrySchema.safeParse(entry);
      if (parsed.success) validated.push(parsed.data);
    }
    shareAllocations = validated.length > 0 ? validated : undefined;
  }

  return {
    summary,
    encryptedProfilePackage,
    ...(unadoptedSharesCiphertext ? { unadoptedSharesCiphertext } : {}),
    ...(shareAllocations ? { shareAllocations } : {}),
  };
}
