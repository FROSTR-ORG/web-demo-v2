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
});
