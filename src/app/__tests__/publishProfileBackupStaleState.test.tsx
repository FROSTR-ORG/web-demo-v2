/**
 * m6-backup-publish — stale-state guard on setActiveProfile during
 * `publishProfileBackup`. Scrutiny m6 r2 flagged that the async
 * persistence path unconditionally called `setActiveProfile(nextSummary)`
 * after `pump.publishEvent` resolved, even when the user had locked
 * (or switched) profiles mid-flight. The fix: read the CURRENT active
 * profile id right before `setActiveProfile` and only apply `nextSummary`
 * when it still matches the in-flight profile AND a runtime is still
 * attached. The IndexedDB write (`saveProfile`) is keyed by profile.id
 * and MUST happen regardless of the active-profile change — it will be
 * picked up on the next `reloadProfiles()` / unlock.
 *
 * Tests in this file exercise the async guard behaviour which requires
 * a mocked runtime + relay pump so the publish can be suspended
 * mid-await. Synchronous guard tests (password < 8, no-runtime) live in
 * `publishProfileBackup.test.tsx` and are intentionally kept in that
 * file to preserve their lean, mock-free setup.
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
 * provider construction records one entry here; tests control the
 * timing of `publishEvent` resolution via the `publishDeferreds` FIFO.
 */
const relayPumpMock = vi.hoisted(() => ({
  instances: [] as Array<{
    relays: string[];
    publishDeferreds: Array<{
      resolve: (value: { reached: string[]; failed: string[] }) => void;
      reject: (error: unknown) => void;
    }>;
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
    private alive = true;
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
      this.alive = false;
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
    publishDeferreds: Array<{
      resolve: (value: { reached: string[]; failed: string[] }) => void;
      reject: (error: unknown) => void;
    }> = [];

    constructor(options: { relays: string[] }) {
      this.relays = options.relays;
      relayPumpMock.instances.push(this);
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

    publishEvent(
      _event: unknown,
    ): Promise<{ reached: string[]; failed: string[] }> {
      return new Promise((resolve, reject) => {
        this.publishDeferreds.push({ resolve, reject });
      });
    }
  },
}));

/* ---------- bifrost package + format helpers ---------- */

vi.mock("../../lib/bifrost/packageService", () => ({
  // Used by unlockProfile → decodes stored profile package. The shape
  // just needs enough fields for `runtimeBootstrapFromParts` (which is
  // itself mocked) and for `saveProfile` to run without tripping
  // `assertNoRawShareMaterial`.
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
    id: "prof_publish_stale_test",
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

describe("publishProfileBackup — stale-state guard on setActiveProfile", () => {
  it(
    "does NOT set nextSummary on activeProfile when the profile is locked mid-publish",
    async () => {
      const profile = seedStoredProfile(
        makeProfile({ id: "prof_lock_mid_publish" }),
      );
      let latest!: AppStateValue;

      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      // Unlock so runtime + relay pump are attached.
      await act(async () => {
        await latest.unlockProfile(profile.id, "pw");
      });
      await waitFor(() => {
        expect(latest.activeProfile?.id).toBe(profile.id);
      });

      expect(relayPumpMock.instances).toHaveLength(1);
      const pump = relayPumpMock.instances[0];

      // Start the publish WITHOUT awaiting — we need to interleave a
      // lock() call between `pump.publishEvent(...)` and the
      // `setActiveProfile(nextSummary)` that follows once the publish
      // promise resolves.
      let publishPromise!: Promise<unknown>;
      await act(async () => {
        publishPromise = latest.publishProfileBackup("aLongPassword1");
        // Yield once so the provider runs through the await chain up to
        // `pump.publishEvent`.
        await Promise.resolve();
      });

      // Wait for the publish to have reached the pump (so the provider
      // is currently suspended on the publish await).
      await waitFor(() => {
        expect(pump.publishDeferreds.length).toBeGreaterThan(0);
      });

      // Capture whether setActiveProfile has been called post-publish
      // by snapshotting activeProfile state AFTER lockProfile() below.
      // Simulate the user locking the profile mid-flight.
      act(() => {
        latest.lockProfile();
      });
      await waitFor(() => {
        expect(latest.activeProfile).toBeNull();
      });

      // Now resolve the publish — the provider wakes up, runs its
      // persistence path, and (pre-fix) would call
      // `setActiveProfile(nextSummary)` even though the user has locked.
      // After the fix, the guard skips the setActiveProfile call.
      act(() => {
        pump.publishDeferreds[0].resolve({
          reached: ["wss://relay.primal.net"],
          failed: [],
        });
      });
      await act(async () => {
        await publishPromise;
      });

      // Assertion 1: activeProfile remains null — setActiveProfile was
      // NOT called with nextSummary.
      expect(latest.activeProfile).toBeNull();

      // Assertion 2: the IndexedDB record WAS updated with the
      // lastBackupPublishedAt marker — `saveProfile` is keyed by
      // profile.id and must run regardless of active-profile change.
      const storedAfter = storage.get(
        `igloo.web-demo-v2.profile.${profile.id}`,
      ) as StoredProfileRecord | undefined;
      expect(storedAfter).toBeTruthy();
      expect(typeof storedAfter?.summary.lastBackupPublishedAt).toBe("number");
      expect(storedAfter?.summary.lastBackupReachedRelayCount).toBe(1);
    },
    30_000,
  );

  it(
    "happy path: publish with profile still active DOES update activeProfile with lastBackupPublishedAt",
    async () => {
      const profile = seedStoredProfile(
        makeProfile({ id: "prof_happy_publish" }),
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

      const pump = relayPumpMock.instances[0];

      let publishPromise!: Promise<unknown>;
      await act(async () => {
        publishPromise = latest.publishProfileBackup("aLongPassword1");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(pump.publishDeferreds.length).toBeGreaterThan(0);
      });

      // Resolve WITHOUT locking — the guard should pass through.
      act(() => {
        pump.publishDeferreds[0].resolve({
          reached: ["wss://relay.primal.net"],
          failed: [],
        });
      });
      await act(async () => {
        await publishPromise;
      });

      expect(latest.activeProfile?.id).toBe(profile.id);
      expect(typeof latest.activeProfile?.lastBackupPublishedAt).toBe(
        "number",
      );
      expect(latest.activeProfile?.lastBackupReachedRelayCount).toBe(1);
    },
    30_000,
  );
});
