/**
 * Tests for dev-only test-observability hooks installed by
 * {@link AppStateProvider}. Covers the five surfaces described by
 * `fix-m1-ops-test-observability-hooks`:
 *   1. per-relay WS telemetry + `window.__debug.relayHistory`
 *   2. `window.__debug.visibilityHistory`
 *   3. `window.__debug.noncePoolSnapshot`
 *   4. `window.__iglooTestDropRelays()` / `__iglooTestRestoreRelays()`
 *   5. `window.__iglooTestSimulateNonceDepletion()` / `__iglooTestRestoreNonce()`
 *
 * plus the nonce-prepopulate hooks added by
 * `fix-m3-nonce-prepopulate-test-hook`:
 *   6. `window.__iglooTestCreatePeerNonces()`
 *   7. `window.__iglooTestPrePopulateNonces()`
 *   8. the extended `__iglooTestSeedRuntime({initial_peer_nonces})` path
 *
 * All assertions target the DEV code path (vitest sets `import.meta.env.DEV`
 * to `true`). A complementary `dist/` grep in the build verification step
 * guards the production strip-out contract.
 */
import { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider } from "../AppStateProvider";
import { useAppState } from "../AppState";
import type { AppStateValue } from "../AppStateTypes";

// Mirror the idb-keyval mock used by sibling real-provider tests so the
// AppStateProvider's initial listProfiles() call doesn't explode in jsdom.
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

interface IglooDerivedPublicNonceWire {
  binder_pn: string;
  hidden_pn: string;
  code: string;
}

interface IglooTestWindow extends Window {
  __debug?: {
    relayHistory: Array<{ type: string; url: string; at: string; code?: number | null }>;
    visibilityHistory: Array<{ state: "visible" | "hidden"; at: string }>;
    noncePoolSnapshot: { nonce_pool_size: number; nonce_pool_threshold: number } | null;
  };
  __iglooTestDropRelays?: (code?: number) => void;
  __iglooTestRestoreRelays?: () => Promise<void>;
  __iglooTestSimulateNonceDepletion?: (input?: {
    nonce_pool_size?: number;
    nonce_pool_threshold?: number;
    reason?: string;
  }) => void;
  __iglooTestRestoreNonce?: () => void;
  __iglooTestCreatePeerNonces?: (input: {
    share_secret_hex: string;
    peer_pubkey32_hex: string;
    event_kind?: number;
  }) => Promise<IglooDerivedPublicNonceWire[]>;
  __iglooTestPrePopulateNonces?: (input: {
    peer_pubkey32_hex: string;
    peer_share_secret_hex: string;
    count?: number;
  }) => Promise<void>;
  __iglooTestSeedRuntime?: (input: unknown) => Promise<void>;
}

function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

beforeEach(() => {
  // Wipe any residue from a previous test so buffer assertions are
  // deterministic. The module-level rings are re-used across mounts.
  const iglooWindow = window as IglooTestWindow;
  if (iglooWindow.__debug) {
    iglooWindow.__debug.relayHistory.length = 0;
    iglooWindow.__debug.visibilityHistory.length = 0;
  }
});

afterEach(() => {
  cleanup();
  const iglooWindow = window as IglooTestWindow;
  iglooWindow.__iglooTestRestoreNonce?.();
});

describe("AppStateProvider — dev-only test-observability hooks", () => {
  it("exposes window.__debug with relayHistory, visibilityHistory, and noncePoolSnapshot getter", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    const iglooWindow = window as IglooTestWindow;
    expect(iglooWindow.__debug).toBeTruthy();
    expect(Array.isArray(iglooWindow.__debug?.relayHistory)).toBe(true);
    expect(Array.isArray(iglooWindow.__debug?.visibilityHistory)).toBe(true);
    // noncePoolSnapshot is a getter that returns null when no runtime is
    // attached yet. The key MUST exist regardless.
    expect("noncePoolSnapshot" in (iglooWindow.__debug ?? {})).toBe(true);
    expect(iglooWindow.__debug?.noncePoolSnapshot).toBeNull();
  });

  it("installs all __iglooTest* helpers on window", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    const iglooWindow = window as IglooTestWindow;
    expect(typeof iglooWindow.__iglooTestDropRelays).toBe("function");
    expect(typeof iglooWindow.__iglooTestRestoreRelays).toBe("function");
    expect(typeof iglooWindow.__iglooTestSimulateNonceDepletion).toBe(
      "function",
    );
    expect(typeof iglooWindow.__iglooTestRestoreNonce).toBe("function");
    // fix-m3-nonce-prepopulate-test-hook: new dev-only hooks for
    // deterministic nonce seeding.
    expect(typeof iglooWindow.__iglooTestCreatePeerNonces).toBe("function");
    expect(typeof iglooWindow.__iglooTestPrePopulateNonces).toBe("function");
    expect(typeof iglooWindow.__iglooTestSeedRuntime).toBe("function");
  });

  it("visibilityHistory is seeded with the initial state and appended on transitions", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    const iglooWindow = window as IglooTestWindow;
    // The initial mount seeds a single entry.
    expect(iglooWindow.__debug?.visibilityHistory.length).toBeGreaterThanOrEqual(
      1,
    );

    // Simulate a visibilitychange to `hidden`.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenEntries = iglooWindow.__debug?.visibilityHistory.filter(
      (entry) => entry.state === "hidden",
    );
    expect(hiddenEntries?.length).toBeGreaterThanOrEqual(1);

    // Flip back to visible and assert a matching entry.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const visibleEntries = iglooWindow.__debug?.visibilityHistory.filter(
      (entry) => entry.state === "visible",
    );
    expect(visibleEntries?.length).toBeGreaterThanOrEqual(1);
  });

  it("__iglooTestSimulateNonceDepletion pushes a nonce degraded_reason and drops sign_ready; restore clears", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    const iglooWindow = window as IglooTestWindow;
    expect(iglooWindow.__debug?.noncePoolSnapshot).toBeNull();

    iglooWindow.__iglooTestSimulateNonceDepletion?.({
      nonce_pool_size: 0,
      nonce_pool_threshold: 4,
    });

    // The getter now reports the overridden values.
    const snapshot = iglooWindow.__debug?.noncePoolSnapshot;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.nonce_pool_size).toBe(0);
    expect(snapshot?.nonce_pool_threshold).toBe(4);

    iglooWindow.__iglooTestRestoreNonce?.();
    expect(iglooWindow.__debug?.noncePoolSnapshot).toBeNull();
  });

  it("__iglooTestDropRelays is callable even when no relay pump is attached (no-op safe)", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    const iglooWindow = window as IglooTestWindow;
    // No runtime attached yet — hook must not throw.
    expect(() => iglooWindow.__iglooTestDropRelays?.(1006)).not.toThrow();
    await expect(
      iglooWindow.__iglooTestRestoreRelays?.(),
    ).resolves.toBeUndefined();
  });

  it("__iglooTestPrePopulateNonces rejects when no runtime is attached", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    const iglooWindow = window as IglooTestWindow;
    await expect(
      iglooWindow.__iglooTestPrePopulateNonces?.({
        peer_pubkey32_hex: "a".repeat(64),
        peer_share_secret_hex: "b".repeat(64),
      }),
    ).rejects.toThrow(/no active runtime/);
  });
});

describe("Production build guard — nonce-prepopulate hooks are gated on import.meta.env.DEV", () => {
  it("all __iglooTest* installer paths for prepopulate hooks are wrapped in `if (!import.meta.env.DEV) return`", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const repoRoot = process.cwd();
    const providerSrc = await fs.readFile(
      path.join(repoRoot, "src/app/AppStateProvider.tsx"),
      "utf8",
    );

    // All new hooks must live inside a useEffect that bails out in
    // non-DEV. The installer block's sole `if (!import.meta.env.DEV)
    // return;` guard sits above every `globalWindow.__iglooTest*`
    // assignment; Vite's dead-code elimination drops the entire effect
    // body (and thus every symbol it references) from production
    // bundles.
    const guardIdx = providerSrc.indexOf(
      "if (!import.meta.env.DEV) return;",
    );
    expect(guardIdx).toBeGreaterThan(-1);

    // Each installer assignment must appear AFTER the guard — i.e. in
    // the same useEffect. This catches the accidental case of someone
    // moving an installer above the guard or into an ungated effect.
    const afterGuard = providerSrc.slice(guardIdx);
    expect(afterGuard).toMatch(
      /globalWindow\.__iglooTestSeedRuntime\s*=/,
    );
    expect(afterGuard).toMatch(
      /globalWindow\.__iglooTestCreatePeerNonces\s*=/,
    );
    expect(afterGuard).toMatch(
      /globalWindow\.__iglooTestPrePopulateNonces\s*=/,
    );

    // Source-level sanity: every reference to the new hook identifier
    // in the provider must sit AFTER the `import.meta.env.DEV` guard
    // line, i.e. inside the gated installer effect. Anything before
    // the guard would leak the symbol into the production bundle via
    // a non-gated code path.
    const hookRegex = /__iglooTestPrePopulateNonces/g;
    let match: RegExpExecArray | null;
    while ((match = hookRegex.exec(providerSrc)) !== null) {
      expect(
        match.index,
        `reference to __iglooTestPrePopulateNonces at index ${match.index} ` +
          `appears before the import.meta.env.DEV guard at ${guardIdx}`,
      ).toBeGreaterThan(guardIdx);
    }

    const generateHookRegex = /__iglooTestCreatePeerNonces/g;
    while ((match = generateHookRegex.exec(providerSrc)) !== null) {
      expect(
        match.index,
        `reference to __iglooTestCreatePeerNonces at index ${match.index} ` +
          `appears before the import.meta.env.DEV guard at ${guardIdx}`,
      ).toBeGreaterThan(guardIdx);
    }
  });
});
