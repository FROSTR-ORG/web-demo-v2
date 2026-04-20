import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProfileRecord, StoredProfileSummary } from "../../lib/bifrost/types";

/* ---------- IndexedDB mock ---------- */

const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key);
  })
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
  }
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
  }
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
      members: [{ idx: 0, pubkey: "0".repeat(66) }]
    },
    device: { share_secret: "0".repeat(64) }
  })),
  createKeysetBundle: vi.fn(),
  createProfilePackagePair: vi.fn(),
  deriveProfileIdFromShareSecret: vi.fn(),
  encodeOnboardPackage: vi.fn(),
  onboardPayloadForRemoteShare: vi.fn(),
  profilePayloadForShare: vi.fn()
}));

vi.mock("../../lib/bifrost/format", () => ({
  assertNoRawShareMaterial: vi.fn(),
  memberForShare: vi.fn(),
  memberPubkeyXOnly: vi.fn(),
  packagePasswordForShare: vi.fn(),
  runtimeBootstrapFromParts: vi.fn(() => ({})),
  shortHex: (hex: string) => hex
}));

/* Import AFTER mocks are registered */
import { AppStateProvider, MockAppStateProvider, useAppState, type AppStateValue } from "../AppState";
import { BRIDGE_EVENT, BRIDGE_STORAGE_KEY, consumeBridgeSnapshot, snapshotFromAppState, writeBridgeSnapshot, type AppStateBridgeSnapshot } from "../appStateBridge";

/* ---------- Test helpers ---------- */

function makeProfile(overrides: Partial<StoredProfileSummary> = {}): StoredProfileSummary {
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
    ...overrides
  };
}

function makeSnapshot(overrides: Partial<AppStateBridgeSnapshot> = {}): AppStateBridgeSnapshot {
  return {
    profiles: [makeProfile()],
    activeProfile: makeProfile(),
    runtimeStatus: null,
    signerPaused: false,
    createSession: null,
    ...overrides
  };
}

function CapturedState({ onState }: { onState: (value: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return (
    <>
      <div data-testid="profile-count">{state.profiles.length}</div>
      <div data-testid="active-profile-id">{state.activeProfile?.id ?? ""}</div>
      <div data-testid="active-profile-label">{state.activeProfile?.label ?? ""}</div>
    </>
  );
}

beforeEach(() => {
  storage.clear();
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
      createSession: null,
      reloadProfiles: vi.fn(),
      extraThing: "ignored"
    } as unknown as AppStateValue;

    const snapshot = snapshotFromAppState(fake);

    expect(Object.keys(snapshot).sort()).toEqual([
      "activeProfile",
      "createSession",
      "profiles",
      "runtimeStatus",
      "signerPaused"
    ]);
    expect(snapshot.signerPaused).toBe(true);
  });
});

/* ============================================================================ */
/* AppStateProvider hydration behaviour                                         */
/* ============================================================================ */

describe("AppStateProvider bridge integration", () => {
  it("with empty sessionStorage and empty IndexedDB it starts with empty state", async () => {
    const states: AppStateValue[] = [];
    render(
      <AppStateProvider>
        <CapturedState onState={(value) => states.push(value)} />
      </AppStateProvider>
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
      encryptedProfilePackage: "bfprofile1fake"
    };
    storage.set("igloo.web-demo-v2.profile-index", [existing.id]);
    storage.set(`igloo.web-demo-v2.profile.${existing.id}`, record);

    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("1");
    });
    // Because no sessionStorage bridge was present we do NOT set an activeProfile.
    expect(screen.getByTestId("active-profile-id").textContent).toBe("");
  });

  it("hydrates from sessionStorage when the bridge key is present on mount", async () => {
    const bridged = makeProfile({ id: "prof_demo_123", label: "My Signing Key" });
    const snapshot = makeSnapshot({
      profiles: [bridged],
      activeProfile: bridged
    });
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-profile-id").textContent).toBe("prof_demo_123");
    });
    expect(screen.getByTestId("active-profile-label").textContent).toBe("My Signing Key");
    expect(screen.getByTestId("profile-count").textContent).toBe("1");
  });

  it("removes the bridge key from sessionStorage after the first read", async () => {
    const snapshot = makeSnapshot();
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

    render(
      <AppStateProvider>
        <CapturedState onState={() => undefined} />
      </AppStateProvider>
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
      </AppStateProvider>
    );

    // Initially empty state (no bridge, no IndexedDB profiles).
    await waitFor(() => {
      expect(screen.getByTestId("profile-count").textContent).toBe("0");
    });

    const bridged = makeProfile({ id: "prof_late_bridge", label: "Late Bridge" });
    const snapshot = makeSnapshot({
      profiles: [bridged],
      activeProfile: bridged
    });

    act(() => {
      writeBridgeSnapshot(snapshot);
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-profile-id").textContent).toBe("prof_late_bridge");
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
    signerPaused: false,
    createSession: null,
    reloadProfiles: async () => undefined,
    createKeyset: async () => undefined,
    createProfile: async () => "prof_mock",
    updatePackageState: () => undefined,
    finishDistribution: async () => "prof_mock",
    unlockProfile: async () => undefined,
    lockProfile: () => undefined,
    clearCredentials: async () => undefined,
    setSignerPaused: () => undefined,
    refreshRuntime: () => undefined
  };

  it("writes a snapshot of its value to sessionStorage on mount", async () => {
    render(
      <MockAppStateProvider value={mockValue}>
        <span>child</span>
      </MockAppStateProvider>
    );

    await waitFor(() => {
      expect(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)).not.toBeNull();
    });
    const parsed = JSON.parse(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)!);
    expect(parsed.activeProfile.id).toBe("prof_mock");
  });

  it("does not write a snapshot when bridge={false}", async () => {
    render(
      <MockAppStateProvider value={mockValue} bridge={false}>
        <span>child</span>
      </MockAppStateProvider>
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
      return <div data-testid="real-active-id">{state.activeProfile?.id ?? ""}</div>;
    }

    render(
      <AppStateProvider>
        <RealStateProbe />
        <MockAppStateProvider value={mockValue}>
          {/* Children don't need to read state for this test */}
          <span>demo-tree</span>
        </MockAppStateProvider>
      </AppStateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("real-active-id").textContent).toBe("prof_mock");
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
          <div data-testid="mock-active-id">{state.activeProfile?.id ?? ""}</div>
        </>
      );
    }

    render(
      <MockAppStateProvider value={mockValue}>
        <Probe />
      </MockAppStateProvider>
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
    const parsed = JSON.parse(window.sessionStorage.getItem(BRIDGE_STORAGE_KEY)!);
    expect(parsed.profiles).toEqual([]);
    expect(parsed.activeProfile).toBeNull();
    expect(parsed.runtimeStatus).toBeNull();
  });

  it("MockAppStateProvider.lockProfile clears runtimeStatus and activeProfile", async () => {
    const seeded: AppStateValue = {
      ...mockValue,
      runtimeStatus: { pretend: true } as unknown as AppStateValue["runtimeStatus"]
    };

    let captured!: AppStateValue;
    function Probe() {
      const state = useAppState();
      captured = state;
      return (
        <>
          <div data-testid="mock-active-id">{state.activeProfile?.id ?? ""}</div>
          <div data-testid="mock-has-runtime">{state.runtimeStatus ? "yes" : "no"}</div>
        </>
      );
    }

    render(
      <MockAppStateProvider value={seeded}>
        <Probe />
      </MockAppStateProvider>
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
      const bridged = makeProfile({ id: "prof_bridge_pause", label: "Bridged" });
      const snapshot = makeSnapshot({
        profiles: [bridged],
        activeProfile: bridged,
        runtimeStatus: { pretend: true } as unknown as AppStateBridgeSnapshot["runtimeStatus"]
      });
      window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

      render(
        <AppStateProvider>
          <CapturedState onState={() => undefined} />
        </AppStateProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("active-profile-id").textContent).toBe("prof_bridge_pause");
      });

      const pollCallsAtPause = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 2500).length;
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
      const pollCallsAfter = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 2500).length;
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
      const bridged = makeProfile({ id: "prof_bridge_resume", label: "Bridged" });
      const snapshot = makeSnapshot({
        profiles: [bridged],
        activeProfile: bridged,
        runtimeStatus: { pretend: true } as unknown as AppStateBridgeSnapshot["runtimeStatus"]
      });
      // Pre-seed the IndexedDB-mock-backed profile record so unlockProfile can
      // resolve it. The mocked RuntimeClient is inert (see mocks at the top
      // of this file), so the unlock only needs a decryptable package — we
      // short-circuit that via a local `decodeProfilePackage` mock below.
      const record: StoredProfileRecord = {
        summary: bridged,
        encryptedProfilePackage: "bfprofile1fake"
      };
      storage.set("igloo.web-demo-v2.profile-index", [bridged.id]);
      storage.set(`igloo.web-demo-v2.profile.${bridged.id}`, record);

      window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));

      let captured!: AppStateValue;
      function Probe() {
        const state = useAppState();
        captured = state;
        return <div data-testid="active-id">{state.activeProfile?.id ?? ""}</div>;
      }

      render(
        <AppStateProvider>
          <Probe />
        </AppStateProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("active-id").textContent).toBe("prof_bridge_resume");
      });

      // After bridge hydration, the polling effect should be paused. Count
      // the pre-unlock polling schedules so the follow-up assertion is
      // agnostic to the initial pre-hydration schedule.
      const pollCallsBefore = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 2500).length;

      await act(async () => {
        await captured.unlockProfile(bridged.id, "pw");
      });

      // After unlock → setRuntime → setBridgeHydrated(false), the polling
      // effect re-runs and schedules a NEW 2500ms interval. Compare the call
      // count before vs after the unlock to assert the polling loop resumed.
      const pollCallsAfter = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 2500).length;
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
