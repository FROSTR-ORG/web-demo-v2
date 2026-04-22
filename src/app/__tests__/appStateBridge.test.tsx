import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoredProfileRecord,
  StoredProfileSummary,
} from "../../lib/bifrost/types";

/* ---------- IndexedDB mock ---------- */

const storage = new Map<string, unknown>();
const relayPumpMock = vi.hoisted(() => ({
  instances: [] as Array<{
    relays: string[];
    startCalls: number;
    refreshAllCalls: number;
    stopCalls: number;
    relayStatuses: () => Array<{ url: string; state: "connecting" }>;
    start: () => Promise<unknown>;
    refreshAll: () => Promise<unknown>;
    stop: () => void;
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

/* ---------- Mock heavyweight runtime deps so AppStateProvider imports cleanly ---------- */

vi.mock("../../lib/bifrost/runtimeClient", () => ({
  RuntimeClient: class {
    runtimeStatus() {
      return null;
    }
    tick() {
      /* no-op */
    }
    async init() {
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
  },
}));

vi.mock("../../lib/relay/runtimeRelayPump", () => ({
  RuntimeRelayPump: class {
    relays: string[];
    startCalls = 0;
    refreshAllCalls = 0;
    stopCalls = 0;

    constructor(options: { relays: string[] }) {
      this.relays = options.relays;
      relayPumpMock.instances.push(this);
    }

    relayStatuses() {
      return this.relays.map((url) => ({ url, state: "connecting" as const }));
    }

    async start() {
      this.startCalls += 1;
      return relayPumpMock.status;
    }

    async refreshAll() {
      this.refreshAllCalls += 1;
      return relayPumpMock.status;
    }

    stop() {
      this.stopCalls += 1;
    }
  },
}));

/* ---------- Mock bifrost package + format helpers used by unlockProfile ---------- */

// `decodeProfilePackage` normally performs real scrypt+AEAD decryption. For
// the polling-resume test we only need `unlockProfile` → `setRuntime` to run
// without errors; the shape of the payload just needs enough fields for the
// runtime bootstrap call to succeed. Since `runtimeBootstrapFromParts` is
// also mocked below, the payload shape is immaterial beyond the two property
// accesses (`group_package`, `device.share_secret`).
vi.mock("../../lib/bifrost/packageService", () => ({
  decodeProfilePackage: vi.fn(async () => ({
    group_package: {
      group_name: "My Signing Key",
      threshold: 2,
      group_pk: "0".repeat(64),
      members: [{ idx: 0, pubkey: "0".repeat(66) }],
    },
    device: { share_secret: "0".repeat(64) },
  })),
  createKeysetBundle: vi.fn(),
  createKeysetBundleFromNsec: vi.fn(),
  generateNsec: vi.fn(),
  createProfilePackagePair: vi.fn(),
  decodeBfonboardPackage: vi.fn(),
  decodeBfsharePackage: vi.fn(),
  deriveProfileIdFromShareSecret: vi.fn(),
  encodeOnboardPackage: vi.fn(),
  onboardPayloadForRemoteShare: vi.fn(),
  profilePayloadForShare: vi.fn(),
  recoverNsecFromShares: vi.fn(),
  resolveShareIndex: vi.fn(async () => 0),
  rotateKeysetBundle: vi.fn(),
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
  MockAppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";
import {
  BRIDGE_EVENT,
  BRIDGE_STORAGE_KEY,
  consumeBridgeSnapshot,
  snapshotFromAppState,
  writeBridgeSnapshot,
  type AppStateBridgeSnapshot,
} from "../appStateBridge";

/* ---------- Test helpers ---------- */

function makeProfile(
  overrides: Partial<StoredProfileSummary> = {},
): StoredProfileSummary {
  return {
    id: "prof_bridge_test",
    label: "My Signing Key",
    deviceName: "Igloo Web",
    groupName: "My Signing Key",
    threshold: 2,
    memberCount: 3,
    localShareIdx: 0,
    groupPublicKey: "npub1qe3abcdefghijklmnopqrstuvwx7k4m",
    relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<AppStateBridgeSnapshot> = {},
): AppStateBridgeSnapshot {
  return {
    profiles: [makeProfile()],
    activeProfile: makeProfile(),
    runtimeStatus: null,
    runtimeRelays: [],
    signerPaused: false,
    createSession: null,
    importSession: null,
    onboardSession: null,
    rotateKeysetSession: null,
    replaceShareSession: null,
    recoverSession: null,
    ...overrides,
  };
}

function seedStoredProfile(summary = makeProfile()): StoredProfileSummary {
  const record: StoredProfileRecord = {
    summary,
    encryptedProfilePackage: "bfprofile1fake",
  };
  storage.set("igloo.web-demo-v2.profile-index", [summary.id]);
  storage.set(`igloo.web-demo-v2.profile.${summary.id}`, record);
  return summary;
}

function CapturedState({
  onState,
}: {
  onState: (value: AppStateValue) => void;
}) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return (
    <>
      <div data-testid="profile-count">{state.profiles.length}</div>
      <div data-testid="active-profile-id">{state.activeProfile?.id ?? ""}</div>
      <div data-testid="active-profile-label">
        {state.activeProfile?.label ?? ""}
      </div>
    </>
  );
}

beforeEach(() => {
  storage.clear();
  relayPumpMock.instances = [];
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  storage.clear();
});

/* ============================================================================ */
/* Bridge helper primitives                                                     */
/* ============================================================================ */

describe("appStateBridge helpers", () => {
  it("writeBridgeSnapshot persists JSON and dispatches BRIDGE_EVENT", () => {
    const listener = vi.fn();
    window.addEventListener(BRIDGE_EVENT, listener);
    const snapshot = makeSnapshot();

    writeBridgeSnapshot(snapshot);

    const raw = window.sessionStorage.getItem(BRIDGE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(BRIDGE_EVENT, listener);
  });

  it("consumeBridgeSnapshot returns the stored snapshot and deletes the key", () => {
    const snapshot = makeSnapshot();
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

    const result = consumeBridgeSnapshot();

    expect(result).toEqual(snapshot);
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });

  it("consumeBridgeSnapshot strips setup sessions from stale or injected snapshots", () => {
    const injected = {
      ...makeSnapshot(),
      createSession: { onboardingPackages: [{ password: "secret" }] },
      importSession: { payload: { device: { share_secret: "2".repeat(64) } } },
      onboardSession: { payload: { share_secret: "3".repeat(64) } },
      rotateKeysetSession: { sourceShares: [{ seckey: "4".repeat(64) }] },
      recoverSession: { recovered: { nsec: "nsec1rawsecret" } },
    };
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(injected));

    const result = consumeBridgeSnapshot();

    expect(result).toMatchObject({
      createSession: null,
      importSession: null,
      onboardSession: null,
      rotateKeysetSession: null,
      recoverSession: null,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("nsec1rawsecret");
  });

  it("consumeBridgeSnapshot returns null when no key is present", () => {
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
    expect(consumeBridgeSnapshot()).toBeNull();
  });

  it("consumeBridgeSnapshot returns null and removes the key when the JSON is corrupted", () => {
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, "{not json");
    expect(consumeBridgeSnapshot()).toBeNull();
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });

  it("snapshotFromAppState copies the bridge-serialisable fields only", () => {
    const fake = {
      profiles: [makeProfile()],
      activeProfile: makeProfile(),
      runtimeStatus: null,
      signerPaused: true,
      createSession: { keyset: { shares: [{ seckey: "1".repeat(64) }] } },
      importSession: { payload: { device: { share_secret: "2".repeat(64) } } },
      onboardSession: {
        payload: { share_secret: "3".repeat(64) },
        password: "super-secret",
      },
      rotateKeysetSession: { sourceShares: [{ seckey: "4".repeat(64) }] },
      recoverSession: { recovered: { nsec: "nsec1rawsecret" } },
      reloadProfiles: vi.fn(),
      extraThing: "ignored",
    } as unknown as AppStateValue;

    const snapshot = snapshotFromAppState(fake);

    expect(Object.keys(snapshot).sort()).toEqual([
      "activeProfile",
      "createSession",
      "importSession",
      "onboardSession",
      "profiles",
      "recoverSession",
      "replaceShareSession",
      "rotateKeysetSession",
      "runtimeRelays",
      "runtimeStatus",
      "signerPaused",
    ]);
    expect(snapshot.signerPaused).toBe(true);
    expect(snapshot.runtimeRelays).toEqual([]);
    expect(snapshot.createSession).toBeNull();
    expect(snapshot.importSession).toBeNull();
    expect(snapshot.onboardSession).toBeNull();
    expect(snapshot.rotateKeysetSession).toBeNull();
    expect(snapshot.recoverSession).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("super-secret");
    expect(JSON.stringify(snapshot)).not.toContain("nsec1rawsecret");
    expect(JSON.stringify(snapshot)).not.toContain("11111111");
  });
});

/* ============================================================================ */
/* AppStateProvider hydration behaviour                                         */
/* ============================================================================ */

describe("AppStateProvider bridge integration", () => {
  it("exportRuntimePackages fails cleanly without an unlocked runtime", async () => {
    let captured!: AppStateValue;
    render(
      <AppStateProvider>
        <CapturedState onState={(state) => {
          captured = state;
        }} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(captured).toBeDefined();
    });
    await expect(captured.exportRuntimePackages("export-password")).rejects.toThrow(
      "No unlocked runtime is available to export.",
    );
  });

  it("with empty sessionStorage and empty IndexedDB it starts with empty state", async () => {
    const states: AppStateValue[] = [];
    render(
      <AppStateProvider>
        <CapturedState onState={(value) => states.push(value)} />
      </AppStateProvider>,
    );

    // Wait for the initial reloadProfiles effect to resolve.
    await waitFor(() => expect(states.length).toBeGreaterThan(0));

    const latest = states.at(-1)!;
    expect(latest.profiles).toEqual([]);
    expect(latest.activeProfile).toBeNull();
    expect(latest.runtimeStatus).toBeNull();
    expect(latest.createSession).toBeNull();
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });

  it("when IndexedDB already contains profiles it surfaces them as profiles (baseline path preserved)", async () => {
    const existing = makeProfile({ id: "prof_existing", label: "Existing" });
    const record: StoredProfileRecord = {
      summary: existing,
      encryptedProfilePackage: "bfprofile1fake",
    };
    storage.set("igloo.web-demo-v2.profile-index", [existing.id]);
    storage.set(`igloo.web-demo-v2.profile.${existing.id}`, record);

    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    // Because no sessionStorage bridge was present we do NOT set an activeProfile.
    expect(screen.getByTestId("active-profile-id").textContent).toBe("");
  });

  it("hydrates from sessionStorage when the bridge key is present on mount", async () => {
    const bridged = makeProfile({
      id: "prof_demo_123",
      label: "My Signing Key",
    });
    const snapshot = makeSnapshot({
      profiles: [bridged],
      activeProfile: bridged,
    });
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-profile-id").textContent).toBe(
        "prof_demo_123",
      );
    });
    expect(screen.getByTestId("active-profile-label").textContent).toBe(
      "My Signing Key",
    );
    expect(screen.getByTestId("profile-count").textContent).toBe("1");
  });

  it("removes the bridge key from sessionStorage after the first read", async () => {
    const snapshot = makeSnapshot();
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    // The key MUST be consumed on the first read so it does not leak across
    // page reloads or unrelated navigation cycles (one-shot hand-off).
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });

  it("hydrates when a BRIDGE_EVENT is dispatched after mount (late demo → real hand-off)", async () => {
    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>,
    );

    // Initially empty state (no bridge, no IndexedDB profiles).
    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("0");
    });

    const bridged = makeProfile({
      id: "prof_late_bridge",
      label: "Late Bridge",
    });
    const snapshot = makeSnapshot({
      profiles: [bridged],
      activeProfile: bridged,
    });

    act(() => {
      writeBridgeSnapshot(snapshot);
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-profile-id").textContent).toBe(
        "prof_late_bridge",
      );
    });
    // Key is consumed after the event-triggered read as well.
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });
});

/* ============================================================================ */
/* MockAppStateProvider arms the bridge                                         */
/* ============================================================================ */

describe("MockAppStateProvider bridge arming", () => {
  const mockValue: AppStateValue = {
    profiles: [makeProfile({ id: "prof_mock", label: "Mock Key" })],
    activeProfile: makeProfile({ id: "prof_mock", label: "Mock Key" }),
    runtimeStatus: null,
    runtimeRelays: [],
    signerPaused: false,
    createSession: null,
    importSession: null,
    onboardSession: null,
    rotateKeysetSession: null,
    replaceShareSession: null,
    recoverSession: null,
    reloadProfiles: async () => undefined,
    createKeyset: async () => undefined,
    createProfile: async () => "prof_mock",
    updatePackageState: () => undefined,
    finishDistribution: async () => "prof_mock",
    clearCreateSession: () => undefined,
    beginImport: () => undefined,
    decryptImportBackup: async () => undefined,
    saveImportedProfile: async () => "prof_mock",
    clearImportSession: () => undefined,
    decodeOnboardPackage: async () => undefined,
    startOnboardHandshake: async () => undefined,
    saveOnboardedProfile: async () => "prof_mock",
    clearOnboardSession: () => undefined,
    validateRotateKeysetSources: async () => undefined,
    generateRotatedKeyset: async () => undefined,
    createRotatedProfile: async () => "prof_mock",
    updateRotatePackageState: () => undefined,
    finishRotateDistribution: async () => "prof_mock",
    clearRotateKeysetSession: () => undefined,
    decodeReplaceSharePackage: async () => undefined,
    applyReplaceShareUpdate: async () => undefined,
    clearReplaceShareSession: () => undefined,
    validateRecoverSources: async () => undefined,
    recoverNsec: async () => ({
      nsec: "nsec1mock",
      signing_key_hex: "0".repeat(64),
    }),
    clearRecoverSession: () => undefined,
    expireRecoveredNsec: () => undefined,
    unlockProfile: async () => undefined,
    updateProfileName: async () => undefined,
    updateRelays: async () => undefined,
    changeProfilePassword: async () => undefined,
    lockProfile: () => undefined,
    clearCredentials: async () => undefined,
    exportRuntimePackages: async () => ({
      profilePackage: "bfprofile1mock",
      sharePackage: "bfshare1mock",
      metadata: {
        profileId: "prof_mock",
        groupName: "Mock Key",
        deviceName: "Igloo Web",
        shareIdx: 0,
        relayCount: 0,
        peerCount: 0,
      },
    }),
    createProfileBackup: async () => ({
      backup: { ciphertext: "mock", nonce: "mock", version: 1 },
      event: { id: "mock", pubkey: "mock", created_at: 0, kind: 30078, tags: [], content: "mock", sig: "mock" },
    }),
    setSignerPaused: () => undefined,
    refreshRuntime: () => undefined,
    restartRuntimeConnections: async () => undefined,
    runtimeCompletions: [],
    runtimeFailures: [],
    lifecycleEvents: [],
    runtimeEventLog: [],
    signDispatchLog: {},
    signLifecycleLog: [],
    pendingDispatchIndex: {},
    peerDenialQueue: [],
    enqueuePeerDenial: () => undefined,
    resolvePeerDenial: async () => undefined,
    policyOverrides: [],
    removePolicyOverride: async () => undefined,
    setPeerPolicyOverride: async () => undefined,
    clearPolicyOverrides: async () => undefined,
    clearRuntimeEventLog: () => undefined,
    handleRuntimeCommand: async () => ({ requestId: null, debounced: false }),
  };

  it("writes a snapshot of its value to sessionStorage on mount", async () => {
    render(
      <MockAppStateProvider value={mockValue}>
        <span>child</span>
      </MockAppStateProvider>,
    );

    await waitFor(() => {
      expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).not.toBeNull();
    });
    const parsed = JSON.parse(
      window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)!,
    );
    expect(parsed.activeProfile.id).toBe("prof_mock");
  });

  it("does not write a snapshot when bridge={false}", async () => {
    render(
      <MockAppStateProvider value={mockValue} bridge={false}>
        <span>child</span>
      </MockAppStateProvider>,
    );

    // Give effects a chance to run.
    await Promise.resolve();
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });

  it("a MockAppStateProvider nested inside AppStateProvider hydrates the real provider via the bridge event", async () => {
    // This mirrors the real app: AppStateProvider lives at the root, and a
    // MockAppStateProvider wraps /demo/* routes further down the tree. After
    // the mock mounts, the real provider should have hydrated from the
    // bridge snapshot.
    const states: AppStateValue[] = [];

    function RealStateProbe() {
      const state = useAppState();
      useEffect(() => {
        states.push(state);
      }, [state]);
      return (
        <div data-testid="real-active-id">{state.activeProfile?.id ?? ""}</div>
      );
    }

    render(
      <AppStateProvider>
        <RealStateProbe />
        <MockAppStateProvider value={mockValue}>
          {/* Children don't need to read state for this test */}
          <span>demo-tree</span>
        </MockAppStateProvider>
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("real-active-id").textContent).toBe(
        "prof_mock",
      );
    });
    expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).toBeNull();
  });

  it("MockAppStateProvider.clearCredentials truly empties profiles and rearms the bridge with an empty snapshot", async () => {
    let captured!: AppStateValue;
    function Probe() {
      const state = useAppState();
      captured = state;
      return (
        <>
          <div data-testid="mock-profile-count">{state.profiles.length}</div>
          <div data-testid="mock-active-id">
            {state.activeProfile?.id ?? ""}
          </div>
        </>
      );
    }

    render(
      <MockAppStateProvider value={mockValue}>
        <Probe />
      </MockAppStateProvider>,
    );

    // Starts seeded from the mock value.
    await waitFor(() => {
      expect(screen.getByTestId("mock-profile-count").textContent).toBe("1");
    });
    expect(screen.getByTestId("mock-active-id").textContent).toBe("prof_mock");

    // Invoke the stateful clearCredentials from inside the demo shell.
    await act(async () => {
      await captured.clearCredentials();
    });

    // State flips to empty — no Dashboard-side workaround required.
    await waitFor(() => {
      expect(screen.getByTestId("mock-profile-count").textContent).toBe("0");
    });
    expect(screen.getByTestId("mock-active-id").textContent).toBe("");

    // The bridge snapshot was rearmed with the empty state, so a subsequent
    // hand-off to the real AppStateProvider surfaces the no-profiles variant.
    const parsed = JSON.parse(
      window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)!,
    );
    expect(parsed.profiles).toEqual([]);
    expect(parsed.activeProfile).toBeNull();
    expect(parsed.runtimeStatus).toBeNull();
    expect(parsed.runtimeRelays).toEqual([]);
  });

  it("MockAppStateProvider.lockProfile clears runtimeStatus and activeProfile", async () => {
    const seeded: AppStateValue = {
      ...mockValue,
      runtimeStatus: {
        pretend: true,
      } as unknown as AppStateValue["runtimeStatus"],
    };

    let captured!: AppStateValue;
    function Probe() {
      const state = useAppState();
      captured = state;
      return (
        <>
          <div data-testid="mock-active-id">
            {state.activeProfile?.id ?? ""}
          </div>
          <div data-testid="mock-has-runtime">
            {state.runtimeStatus ? "yes" : "no"}
          </div>
        </>
      );
    }

    render(
      <MockAppStateProvider value={seeded}>
        <Probe />
      </MockAppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-has-runtime").textContent).toBe("yes");
    });

    act(() => {
      captured.lockProfile();
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-has-runtime").textContent).toBe("no");
    });
    expect(screen.getByTestId("mock-active-id").textContent).toBe("");
  });

  it("MockAppStateProvider.updatePackageState mirrors create-session package accounting without bridging secrets", async () => {
    const seeded: AppStateValue = {
      ...mockValue,
      createSession: {
        draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
        localShare: { idx: 0, seckey: "1".repeat(64) },
        onboardingPackages: [
          {
            idx: 1,
            memberPubkey: "02" + "1".repeat(64),
            packageText: "bfonboard1secret",
            password: "package-password",
            packageCopied: false,
            passwordCopied: false,
            copied: false,
            qrShown: false,
          },
        ],
      },
    };

    let captured!: AppStateValue;
    function Probe() {
      const state = useAppState();
      captured = state;
      return (
        <div data-testid="package-copied">
          {state.createSession?.onboardingPackages[0]?.packageCopied
            ? "yes"
            : "no"}
        </div>
      );
    }

    render(
      <MockAppStateProvider value={seeded}>
        <Probe />
      </MockAppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("package-copied").textContent).toBe("no");
    });

    act(() => {
      captured.updatePackageState(1, { copied: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId("package-copied").textContent).toBe("yes");
    });
    const parsed = JSON.parse(
      window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)!,
    );
    expect(parsed.createSession).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("bfonboard1secret");
    expect(JSON.stringify(parsed)).not.toContain("package-password");
  });
});

/* ============================================================================ */
/* Runtime-polling pause + resume (bridgeHydrated reset)                        */
/* ============================================================================ */

describe("AppStateProvider runtime-polling and bridge hydration", () => {
  it("bridge-hydrated path pauses the runtime-refresh interval once hydration completes", async () => {
    // Spy on setInterval/clearInterval so we can observe the polling-effect's
    // schedule/clear lifecycle. On first render the effect runs once before
    // the bridge hydration effect has flipped `bridgeHydrated` to `true` (so
    // the initial `setInterval` call is expected). After hydration the effect
    // re-runs, clears that interval, and early-returns without re-scheduling
    // — that is the pause behavior we assert here.
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    try {
      const bridged = makeProfile({
        id: "prof_bridge_pause",
        label: "Bridged",
      });
      const snapshot = makeSnapshot({
        profiles: [bridged],
        activeProfile: bridged,
        runtimeStatus: {
          pretend: true,
        } as unknown as AppStateBridgeSnapshot["runtimeStatus"],
      });
      window.sessionStorage.setItem(
        BRIDGE_STORAGE_KEY,
        JSON.stringify(snapshot),
      );

      render(
        <AppStateProvider>
          <CapturedState onState={() => undefined} />
        </AppStateProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("active-profile-id").textContent).toBe(
          "prof_bridge_pause",
        );
      });

      const pollCallsAtPause = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 2500,
      ).length;
      const clearedCalls = clearIntervalSpy.mock.calls.length;

      // Snapshot the steady state after hydration.
      const before = { pollCallsAtPause, clearedCalls };

      // Give React any remaining effects a chance to flush.
      await act(async () => {
        await Promise.resolve();
      });

      // No NEW polling intervals should have been scheduled after hydration —
      // the polling count and clearInterval count must be stable (modulo the
      // initial schedule + its cleanup triggered when bridgeHydrated flipped).
      const pollCallsAfter = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 2500,
      ).length;
      const clearedAfter = clearIntervalSpy.mock.calls.length;
      expect(pollCallsAfter).toBe(before.pollCallsAtPause);
      expect(clearedAfter).toBe(before.clearedCalls);

      // And importantly — we must have cleared the initial pre-hydration
      // interval at least once (i.e. the pause was actually applied).
      expect(clearedAfter).toBeGreaterThanOrEqual(1);
      // Initial polling was scheduled exactly once before hydration flipped.
      expect(pollCallsAfter).toBe(1);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("establishing a real RuntimeClient resets bridgeHydrated so the runtime-refresh interval resumes", async () => {
    // This mirrors the real production flow: a demo mounted the bridge with
    // a synthetic `runtimeStatus`, the user then navigated to an Unlock flow
    // which calls `unlockProfile` → `setRuntime`. Our fix resets
    // `bridgeHydrated` inside `setRuntime`; here we verify that the polling
    // interval gets (re)scheduled only after a real runtime is in place.
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    try {
      const bridged = makeProfile({
        id: "prof_bridge_resume",
        label: "Bridged",
      });
      const snapshot = makeSnapshot({
        profiles: [bridged],
        activeProfile: bridged,
        runtimeStatus: {
          pretend: true,
        } as unknown as AppStateBridgeSnapshot["runtimeStatus"],
      });
      // Pre-seed the IndexedDB-mock-backed profile record so unlockProfile can
      // resolve it. The mocked RuntimeClient is inert (see mocks at the top
      // of this file), so the unlock only needs a decryptable package — we
      // short-circuit that via a local `decodeProfilePackage` mock below.
      const record: StoredProfileRecord = {
        summary: bridged,
        encryptedProfilePackage: "bfprofile1fake",
      };
      storage.set("igloo.web-demo-v2.profile-index", [bridged.id]);
      storage.set(`igloo.web-demo-v2.profile.${bridged.id}`, record);

      window.sessionStorage.setItem(
        BRIDGE_STORAGE_KEY,
        JSON.stringify(snapshot),
      );

      let captured!: AppStateValue;
      function Probe() {
        const state = useAppState();
        captured = state;
        return (
          <div data-testid="active-id">{state.activeProfile?.id ?? ""}</div>
        );
      }

      render(
        <AppStateProvider>
          <Probe />
        </AppStateProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("active-id").textContent).toBe(
          "prof_bridge_resume",
        );
      });

      // After bridge hydration, the polling effect should be paused. Count
      // the pre-unlock polling schedules so the follow-up assertion is
      // agnostic to the initial pre-hydration schedule.
      const pollCallsBefore = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 2500,
      ).length;

      await act(async () => {
        await captured.unlockProfile(bridged.id, "pw");
      });

      // After unlock → setRuntime → setBridgeHydrated(false), the polling
      // effect re-runs and schedules a NEW 2500ms interval. Compare the call
      // count before vs after the unlock to assert the polling loop resumed.
      const pollCallsAfter = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 2500,
      ).length;
      expect(pollCallsAfter).toBeGreaterThan(pollCallsBefore);
      // The cleanup side will fire on unmount via clearInterval — this spy is
      // attached to guarantee we don't leak timers in the test runner.
      void clearIntervalSpy;
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});

describe("AppStateProvider runtime relay lifecycle", () => {
  it("unlockProfile starts live relay statuses from the stored profile relays", async () => {
    const profile = seedStoredProfile(
      makeProfile({
        id: "prof_runtime_relays",
        relays: ["wss://one.test", "wss://two.test"],
      }),
    );
    let captured!: AppStateValue;

    render(
      <AppStateProvider>
        <CapturedState onState={(state) => {
          captured = state;
        }} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });

    await act(async () => {
      await captured.unlockProfile(profile.id, "pw");
    });

    await waitFor(() => {
      expect(captured.activeProfile?.id).toBe(profile.id);
      expect(captured.runtimeRelays).toEqual([
        { url: "wss://one.test", state: "connecting" },
        { url: "wss://two.test", state: "connecting" },
      ]);
    });
    expect(relayPumpMock.instances[0].relays).toEqual(profile.relays);
    expect(relayPumpMock.instances[0].startCalls).toBe(1);
  });

  it("Stop Signer stops live relay work but preserves the active profile", async () => {
    const profile = seedStoredProfile(makeProfile({ id: "prof_runtime_stop" }));
    let captured!: AppStateValue;

    render(
      <AppStateProvider>
        <CapturedState onState={(state) => {
          captured = state;
        }} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    await act(async () => {
      await captured.unlockProfile(profile.id, "pw");
    });
    const pump = relayPumpMock.instances[0];

    act(() => {
      captured.setSignerPaused(true);
    });

    await waitFor(() => {
      expect(captured.signerPaused).toBe(true);
      expect(captured.activeProfile?.id).toBe(profile.id);
      expect(captured.runtimeRelays.map((relay) => relay.state)).toEqual([
        "offline",
        "offline",
      ]);
    });
    expect(pump.stopCalls).toBeGreaterThanOrEqual(1);
  });

  it("restartRuntimeConnections reconnects relays and queues a refresh", async () => {
    const profile = seedStoredProfile(makeProfile({ id: "prof_runtime_restart" }));
    let captured!: AppStateValue;

    render(
      <AppStateProvider>
        <CapturedState onState={(state) => {
          captured = state;
        }} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    await act(async () => {
      await captured.unlockProfile(profile.id, "pw");
    });
    act(() => {
      captured.setSignerPaused(true);
    });

    await act(async () => {
      await captured.restartRuntimeConnections();
    });

    await waitFor(() => {
      expect(relayPumpMock.instances.length).toBeGreaterThanOrEqual(2);
    });
    const restarted = relayPumpMock.instances.at(-1)!;
    expect(restarted.relays).toEqual(profile.relays);
    expect(restarted.startCalls).toBe(1);
    expect(restarted.refreshAllCalls).toBe(1);
    expect(captured.signerPaused).toBe(false);
  });

  it("lockProfile and clearCredentials tear down relay resources", async () => {
    const profile = seedStoredProfile(makeProfile({ id: "prof_runtime_teardown" }));
    let captured!: AppStateValue;

    const { unmount } = render(
      <AppStateProvider>
        <CapturedState onState={(state) => {
          captured = state;
        }} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    await act(async () => {
      await captured.unlockProfile(profile.id, "pw");
    });
    const lockedPump = relayPumpMock.instances[0];

    act(() => {
      captured.lockProfile();
    });

    await waitFor(() => {
      expect(captured.activeProfile).toBeNull();
      expect(captured.runtimeRelays).toEqual([]);
    });
    expect(lockedPump.stopCalls).toBeGreaterThanOrEqual(1);
    unmount();

    relayPumpMock.instances = [];
    seedStoredProfile(profile);
    render(
      <AppStateProvider>
        <CapturedState onState={(state) => {
          captured = state;
        }} />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    await act(async () => {
      await captured.unlockProfile(profile.id, "pw");
    });
    const clearedPump = relayPumpMock.instances[0];

    await act(async () => {
      await captured.clearCredentials();
    });

    await waitFor(() => {
      expect(captured.activeProfile).toBeNull();
      expect(captured.runtimeRelays).toEqual([]);
      expect(captured.profiles).toEqual([]);
    });
    expect(clearedPump.stopCalls).toBeGreaterThanOrEqual(1);
  });
});
