/**
 * m6-backup-publish — VAL-BACKUP-007 event-log capture.
 *
 * The validation contract for VAL-BACKUP-007 requires that "with zero
 * reachable relays, Publish surfaces an inline error ('No relays
 * available to publish to.') and does not advance to success; the
 * failure is captured in the runtime event log."
 *
 * This file pins three cases that the happy-path + stale-state tests
 * do not cover:
 *
 *  1. `publishProfileBackup` with a profile whose `summary.relays` is
 *     empty throws the canonical inline error AND appends exactly one
 *     `runtime_event_log` entry tagged `BACKUP_PUBLISH` with
 *     `source === "local_mutation"` and
 *     `payload === { kind: "backup_publish_failed", reason: "no-relays",
 *                    attemptedRelayCount: 0 }`.
 *
 *  2. `publishProfileBackup` where the relay pump reports every relay
 *     failed (`reached: []`, `failed: ['wss://…']`) throws the same
 *     canonical inline error AND appends exactly one event-log entry
 *     with `reason === "all-offline"` and `attemptedRelayCount` equal
 *     to the configured relay count.
 *
 *  3. Happy-path publish (relay reaches a relay) does NOT add a
 *     BACKUP_PUBLISH failure entry — success remains implicit via
 *     `activeProfile.lastBackupPublishedAt` and is not duplicated into
 *     the event log.
 *
 * SECURITY INVARIANT (VAL-BACKUP-007 contract clause):
 *   The emitted payload MUST NOT include the encrypted backup
 *   ciphertext or the user's password. Case (1) and (2) both assert
 *   that the payload keys are exactly
 *   `{kind, reason, attemptedRelayCount}` so future drift into the
 *   payload shape is caught by this test and cannot silently exfiltrate
 *   credential material.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoredProfileRecord,
  StoredProfileSummary,
} from "../../lib/bifrost/types";

/* ---------- IndexedDB mock ---------- */

const storage = new Map<string, unknown>();

/**
 * Mocked {@link RuntimeRelayPump} instance observers. Each real
 * provider construction records one entry here; `publishEvent` can be
 * programmed via `setPublishResult` so tests can distinguish the
 * all-offline branch (`reached: []`, `failed: [...]`) from a real
 * success.
 */
const relayPumpMock = vi.hoisted(() => ({
  instances: [] as Array<{
    relays: string[];
    publishEvent: (
      event: unknown,
    ) => Promise<{ reached: string[]; failed: string[] }>;
    setPublishResult: (
      result: { reached: string[]; failed: string[] },
    ) => void;
  }>,
  status: {
    status: {
      device_id: "device",
      pending_ops: 0,
      last_active: 1,
      known_peers: 2,
      request_seq: 1,
    },
    metadata: {
      device_id: "device",
      member_idx: 0,
      share_public_key: "share",
      group_public_key: "group",
      peers: ["peer-a", "peer-b"],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 1,
      signing_peer_count: 1,
      ecdh_peer_count: 1,
      last_refresh_at: 1,
      degraded_reasons: [],
    },
    peers: [],
    peer_permission_states: [],
    pending_operations: [],
  },
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));

/* ---------- Runtime / relay mocks ---------- */

vi.mock("../../lib/bifrost/runtimeClient", () => ({
  RuntimeClient: class {
    runtimeStatus() {
      return relayPumpMock.status;
    }
    snapshot() {
      return {
        bootstrap: {
          share: {
            idx: 0,
            seckey: "0".repeat(64),
          },
          group: {
            group_name: "My Signing Key",
            threshold: 2,
            group_pk: "0".repeat(64),
            members: [{ idx: 0, pubkey: "0".repeat(66) }],
          },
        },
      };
    }
    tick() {
      /* no-op */
    }
    async init() {
      /* no-op */
    }
    drainCompletions() {
      return [];
    }
    drainFailures() {
      return [];
    }
    drainRuntimeEvents() {
      return [];
    }
    drainOutboundEvents() {
      return [];
    }
    setPolicyOverride() {
      /* no-op */
    }
    clearPolicyOverrides() {
      /* no-op */
    }
    wipeState() {
      /* no-op */
    }
  },
}));

vi.mock("../../lib/relay/localSimulator", () => ({
  LocalRuntimeSimulator: class {
    start() {
      /* no-op */
    }
    stop() {
      /* no-op */
    }
    refreshAll() {
      /* no-op */
    }
    pump() {
      return null;
    }
    async attachVirtualPeers() {
      /* no-op */
    }
    setOnDrains() {
      /* no-op */
    }
  },
}));

vi.mock("../../lib/relay/runtimeRelayPump", () => ({
  RuntimeRelayPump: class {
    relays: string[];
    private publishResult: { reached: string[]; failed: string[] } = {
      reached: [],
      failed: [],
    };

    constructor(options: { relays: string[] }) {
      this.relays = options.relays;
      // Default: every configured relay reached (happy path). Tests
      // call `setPublishResult` to override per-case (all-offline,
      // partial, etc.).
      this.publishResult = {
        reached: options.relays.slice(),
        failed: [],
      };
      relayPumpMock.instances.push({
        relays: options.relays,
        publishEvent: (event) => this.publishEvent(event),
        setPublishResult: (result) => {
          this.publishResult = result;
        },
      });
    }

    relayStatuses() {
      return this.relays.map((url) => ({ url, state: "connecting" as const }));
    }

    async start() {
      return relayPumpMock.status;
    }

    async refreshAll() {
      return relayPumpMock.status;
    }

    stop() {
      /* no-op */
    }

    closeCleanly() {
      /* no-op */
    }

    async publishEvent(
      _event: unknown,
    ): Promise<{ reached: string[]; failed: string[] }> {
      return this.publishResult;
    }
  },
}));

/* ---------- bifrost package + format helpers ---------- */

vi.mock("../../lib/bifrost/packageService", () => ({
  decodeProfilePackage: vi.fn(async () => ({
    version: 1,
    group_package: {
      group_name: "My Signing Key",
      threshold: 2,
      group_pk: "0".repeat(64),
      members: [{ idx: 0, pubkey: "0".repeat(66) }],
    },
    device: {
      name: "Igloo Web",
      share_secret: "0".repeat(64),
      share_public_key: "0".repeat(64),
      manual_peer_policy_overrides: [],
      // The decoded payload carries a default relay so the
      // RuntimeRelayPump mock always has a non-empty list to operate
      // on, but the provider's publish guard reads `profile.relays`
      // from the stored **summary** (not the decoded payload), so tests
      // can still exercise the zero-relay branch by seeding an empty
      // `summary.relays` array.
      relays: ["wss://relay.primal.net"],
    },
  })),
  profilePayloadForShare: vi.fn(() => ({
    version: 1,
    device: {
      name: "Igloo Web",
      share_secret: "0".repeat(64),
      share_public_key: "0".repeat(64),
      manual_peer_policy_overrides: [],
      relays: ["wss://relay.primal.net"],
    },
    group_package: {
      group_name: "My Signing Key",
      threshold: 2,
      group_pk: "0".repeat(64),
      members: [{ idx: 0, pubkey: "0".repeat(66) }],
    },
  })),
  defaultManualPeerPolicyOverrides: vi.fn(() => []),
  createEncryptedProfileBackup: vi.fn(async () => ({
    version: 1,
    encrypted_blob: "mock-ciphertext",
  })),
  buildProfileBackupEvent: vi.fn(
    async ({ createdAtSeconds }: { createdAtSeconds: number }) => ({
      id: "event-id",
      pubkey: "0".repeat(64),
      created_at: createdAtSeconds,
      kind: 10000,
      tags: [],
      content: "mock",
      sig: "sig",
    }),
  ),
  resolveShareIndex: vi.fn(async () => 0),
  deriveProfileIdFromShareSecret: vi.fn(),
  createKeysetBundle: vi.fn(),
  createKeysetBundleFromNsec: vi.fn(),
  generateNsec: vi.fn(),
  createProfilePackagePair: vi.fn(),
  decodeBfonboardPackage: vi.fn(),
  decodeBfsharePackage: vi.fn(),
  encodeOnboardPackage: vi.fn(),
  onboardPayloadForRemoteShare: vi.fn(),
  recoverNsecFromShares: vi.fn(),
  rotateKeysetBundle: vi.fn(),
  encodeBfsharePackage: vi.fn(),
  decodeOnboardingResponseEvent: vi.fn(),
  buildOnboardingRuntimeSnapshot: vi.fn(),
  createOnboardingRequestBundle: vi.fn(),
  parseProfileBackupEvent: vi.fn(),
  profileBackupEventKind: 10000,
  defaultBifrostEventKind: 30078,
  BifrostPackageError: class extends Error {},
}));

vi.mock("../../lib/bifrost/format", () => ({
  assertNoRawShareMaterial: vi.fn(),
  memberForShare: vi.fn(),
  memberPubkeyXOnly: vi.fn(),
  packagePasswordForShare: vi.fn(),
  runtimeBootstrapFromParts: vi.fn(() => ({})),
  shortHex: (hex: string) => hex,
}));

/* Import AFTER mocks are registered */
import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";

/* ---------- Test helpers ---------- */

function makeProfile(
  overrides: Partial<StoredProfileSummary> = {},
): StoredProfileSummary {
  return {
    id: "prof_publish_event_log_test",
    label: "My Signing Key",
    deviceName: "Igloo Web",
    groupName: "My Signing Key",
    threshold: 2,
    memberCount: 3,
    localShareIdx: 0,
    groupPublicKey: "npub1qe3abcdefghijklmnopqrstuvwx7k4m",
    relays: ["wss://relay.primal.net"],
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function seedStoredProfile(
  summary: StoredProfileSummary = makeProfile(),
): StoredProfileSummary {
  const record: StoredProfileRecord = {
    summary,
    encryptedProfilePackage: "bfprofile1fake",
  };
  storage.set("igloo.web-demo-v2.profile-index", [summary.id]);
  storage.set(`igloo.web-demo-v2.profile.${summary.id}`, record);
  return summary;
}

function Capture({
  onState,
}: {
  onState: (state: AppStateValue) => void;
}) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

beforeEach(() => {
  storage.clear();
  relayPumpMock.instances = [];
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.restoreAllMocks();
});

describe("publishProfileBackup — VAL-BACKUP-007 event-log capture", () => {
  it(
    "appends BACKUP_PUBLISH entry with reason=no-relays when summary.relays is empty",
    async () => {
      const profile = seedStoredProfile(
        makeProfile({
          id: "prof_no_relays",
          // Zero-relay branch: the provider's pre-flight guard reads
          // `profile.relays` and must synthesise a BACKUP_PUBLISH
          // event-log entry before throwing.
          relays: [],
        }),
      );
      let latest!: AppStateValue;

      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.unlockProfile(profile.id, "pw");
      });
      await waitFor(() => {
        expect(latest.activeProfile?.id).toBe(profile.id);
      });
      // Sanity: the unlocked activeProfile summary carries the empty
      // relay list so the publish guard trips on the summary read.
      expect(latest.activeProfile?.relays).toEqual([]);

      // Snapshot the runtime event log pre-publish so we can assert
      // that EXACTLY one new entry was added (not two, not zero, not a
      // duplicate on retry, etc).
      const preLogLength = latest.runtimeEventLog.length;

      // We intentionally wrap the rejecting promise in a manual
      // try/catch inside `act(async () => ...)` rather than
      // `await expect(...).rejects.toThrowError(...)`. With React 19,
      // when an `async` function awaited inside `act()` throws after
      // scheduling a state update via `setRuntimeEventLog`, using
      // `rejects.toThrowError` causes the enclosing Promise to reject
      // BEFORE React gets a chance to commit the pending updater — so
      // the event log update is dropped and the assertion below fails
      // spuriously. Manual try/catch lets `act` observe the setter,
      // schedule the commit, and flush before we read state.
      let publishError: Error | null = null;
      await act(async () => {
        try {
          await latest.publishProfileBackup("aLongPassword1");
        } catch (e) {
          publishError = e as Error;
        }
      });
      expect(publishError).toBeTruthy();
      expect((publishError as unknown as Error).message).toMatch(
        /No relays available to publish to/i,
      );

      await waitFor(() => {
        expect(latest.runtimeEventLog.length).toBe(preLogLength + 1);
      });

      // Assert: exactly one new entry, typed BACKUP_PUBLISH,
      // source=local_mutation, reason=no-relays, attemptedRelayCount=0.
      expect(latest.runtimeEventLog.length).toBe(preLogLength + 1);
      const entry = latest.runtimeEventLog[latest.runtimeEventLog.length - 1];
      expect(entry.badge).toBe("BACKUP_PUBLISH");
      expect(entry.source).toBe("local_mutation");
      expect(entry.payload).toEqual({
        kind: "backup_publish_failed",
        reason: "no-relays",
        attemptedRelayCount: 0,
      });
      // Security invariant — payload MUST NOT leak ciphertext / password /
      // share material. We assert object shape is exactly the three
      // documented keys so any future drift is caught here.
      expect(Object.keys(entry.payload as object).sort()).toEqual([
        "attemptedRelayCount",
        "kind",
        "reason",
      ]);
    },
    30_000,
  );

  it(
    "appends BACKUP_PUBLISH entry with reason=all-offline when every relay fails",
    async () => {
      const profile = seedStoredProfile(
        makeProfile({
          id: "prof_all_offline",
          relays: [
            "wss://relay.primal.net",
            "wss://relay.damus.io",
          ],
        }),
      );
      let latest!: AppStateValue;

      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.unlockProfile(profile.id, "pw");
      });
      await waitFor(() => {
        expect(latest.activeProfile?.id).toBe(profile.id);
      });

      // Program the relay pump mock to report every attempted relay
      // failed so we hit the `reached.length === 0` post-fan-out
      // branch. Empty-reach + non-empty-failed is the canonical
      // "all offline" signal.
      expect(relayPumpMock.instances).toHaveLength(1);
      relayPumpMock.instances[0].setPublishResult({
        reached: [],
        failed: [
          "wss://relay.primal.net",
          "wss://relay.damus.io",
        ],
      });

      const preLogLength = latest.runtimeEventLog.length;

      let publishError: Error | null = null;
      await act(async () => {
        try {
          await latest.publishProfileBackup("aLongPassword1");
        } catch (e) {
          publishError = e as Error;
        }
      });
      expect(publishError).toBeTruthy();
      expect((publishError as unknown as Error).message).toMatch(
        /No relays available to publish to/i,
      );

      await waitFor(() => {
        expect(latest.runtimeEventLog.length).toBe(preLogLength + 1);
      });
      const entry = latest.runtimeEventLog[latest.runtimeEventLog.length - 1];
      expect(entry.badge).toBe("BACKUP_PUBLISH");
      expect(entry.source).toBe("local_mutation");
      expect(entry.payload).toEqual({
        kind: "backup_publish_failed",
        reason: "all-offline",
        attemptedRelayCount: 2,
      });
      // Security invariant — same strict key-set assertion as the
      // no-relays branch. Any drift that adds a ciphertext/password
      // key fails this assertion.
      expect(Object.keys(entry.payload as object).sort()).toEqual([
        "attemptedRelayCount",
        "kind",
        "reason",
      ]);
    },
    30_000,
  );

  it(
    "happy path: a successful publish does NOT append a BACKUP_PUBLISH entry",
    async () => {
      const profile = seedStoredProfile(
        makeProfile({
          id: "prof_happy_event_log",
          relays: ["wss://relay.primal.net"],
        }),
      );
      let latest!: AppStateValue;

      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.unlockProfile(profile.id, "pw");
      });
      await waitFor(() => {
        expect(latest.activeProfile?.id).toBe(profile.id);
      });

      // Default pump behaviour is "reached = all configured relays",
      // so no overrides are needed — the publish should simply succeed.
      const preLogLength = latest.runtimeEventLog.length;

      await act(async () => {
        await latest.publishProfileBackup("aLongPassword1");
      });

      // Success is implicit via `activeProfile.lastBackupPublishedAt`
      // being set. The event-log must NOT gain a BACKUP_PUBLISH entry
      // because success is not a failure — duplicating it would
      // pollute the operator view.
      expect(typeof latest.activeProfile?.lastBackupPublishedAt).toBe(
        "number",
      );
      const newBackupEntries = latest.runtimeEventLog
        .slice(preLogLength)
        .filter((entry) => entry.badge === "BACKUP_PUBLISH");
      expect(newBackupEntries).toHaveLength(0);
    },
    30_000,
  );
});
