/**
 * Feature: fix-followup-create-bootstrap-live-relay-pump
 *
 * Verifies the createProfile boundary now bootstraps the live
 * `RuntimeRelayPump` (NOT `LocalRuntimeSimulator`) whenever the
 * submitted draft's `relayUrls` contains at least one valid entry.
 *
 * Assertions covered:
 *   - VAL-FOLLOWUP-001 — after a successful createProfile with a
 *     `wss://` relay, `window.__iglooTestGetRuntimeSource()` returns
 *     `'relay_pump'` and `LocalRuntimeSimulator` is never instantiated.
 *   - VAL-FOLLOWUP-010 — relay validation at the createProfile
 *     boundary rejects non-wss:// URLs with the canonical inline error
 *     ("Relay URL must start with wss://") and does NOT fall back to
 *     the simulator; the DEV-only
 *     `__iglooTestAllowInsecureRelayForRestore` opt-in whitelists
 *     `ws://127.0.0.1:*` for local multi-device e2e.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { AppStateProvider, useAppState, type AppStateValue } from "../AppState";

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

function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

async function renderProvider() {
  let latest!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latest = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latest).toBeTruthy());
  return () => latest;
}

function readRuntimeSource(): "relay_pump" | "simulator" | null {
  const hook = (
    window as typeof window & {
      __iglooTestGetRuntimeSource?: () =>
        | "relay_pump"
        | "simulator"
        | null;
    }
  ).__iglooTestGetRuntimeSource;
  if (typeof hook !== "function") {
    throw new Error(
      "window.__iglooTestGetRuntimeSource is not installed — DEV hook missing.",
    );
  }
  return hook();
}

beforeEach(() => {
  storage.clear();
  // Ensure no stray DEV escape-hatch from a previous test leaks in.
  delete (
    window as typeof window & {
      __iglooTestAllowInsecureRelayForRestore?: boolean;
    }
  ).__iglooTestAllowInsecureRelayForRestore;
});

afterEach(() => {
  cleanup();
  storage.clear();
  delete (
    window as typeof window & {
      __iglooTestAllowInsecureRelayForRestore?: boolean;
    }
  ).__iglooTestAllowInsecureRelayForRestore;
});

describe("AppStateProvider.createProfile — bootstrap runtime source (VAL-FOLLOWUP-001 / VAL-FOLLOWUP-010)", () => {
  it(
    "installs window.__iglooTestGetRuntimeSource and reports 'relay_pump' after createProfile with a wss:// relay",
    async () => {
      const getState = await renderProvider();

      // DEV hook is installed before any unlock flow runs.
      expect(typeof (window as unknown as { __iglooTestGetRuntimeSource?: unknown })
        .__iglooTestGetRuntimeSource).toBe("function");
      expect(readRuntimeSource()).toBeNull();

      await act(async () => {
        await getState().createKeyset({
          groupName: "Bootstrap Relay Pump Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(getState().createSession?.keyset?.group.group_name).toBe(
          "Bootstrap Relay Pump Key",
        ),
      );

      await act(async () => {
        await getState().createProfile({
          deviceName: "Bootstrap Browser",
          password: "profile-password",
          confirmPassword: "profile-password",
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
          relays: ["wss://relay.example.test"],
        });
      });

      await waitFor(() =>
        expect(getState().createSession?.onboardingPackages?.length ?? 0)
          .toBeGreaterThan(0),
      );
      // Runtime source MUST be the live relay pump — NOT the
      // LocalRuntimeSimulator. This is the core contract for
      // VAL-FOLLOWUP-001.
      expect(readRuntimeSource()).toBe("relay_pump");
      // Subsequent ticks continue to observe `'relay_pump'` (hook is a
      // live getter over `relayPumpRef.current`).
      expect(readRuntimeSource()).toBe("relay_pump");
    },
    45_000,
  );

  it(
    "rejects non-wss:// relays with a readable form-level error and does NOT fall back to the simulator",
    async () => {
      const getState = await renderProvider();

      await act(async () => {
        await getState().createKeyset({
          groupName: "Relay Validation Reject Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(getState().createSession?.keyset?.group.group_name).toBe(
          "Relay Validation Reject Key",
        ),
      );

      await expect(
        getState().createProfile({
          deviceName: "Bootstrap Browser",
          password: "profile-password",
          confirmPassword: "profile-password",
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
          relays: ["ws://example.com"],
        }),
      ).rejects.toThrow("Relay URL must start with wss://");

      // No simulator fallback is permitted on validation failure.
      expect(readRuntimeSource()).toBeNull();
      // `createProfile` bailed out before any onboarding package was
      // built, so the session still has no redacted entries.
      const session = getState().createSession;
      expect(session?.createdProfileId).toBeUndefined();
      expect(session?.onboardingPackages ?? []).toEqual([]);
    },
    45_000,
  );

  it(
    "rejects ws://127.0.0.1 unless the DEV-only __iglooTestAllowInsecureRelayForRestore hook is set; accepts it with the hook",
    async () => {
      const getState = await renderProvider();

      await act(async () => {
        await getState().createKeyset({
          groupName: "Relay Validation Local Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(getState().createSession?.keyset?.group.group_name).toBe(
          "Relay Validation Local Key",
        ),
      );

      // Strict path: no DEV hook set — local ws:// rejected.
      await expect(
        getState().createProfile({
          deviceName: "Bootstrap Browser",
          password: "profile-password",
          confirmPassword: "profile-password",
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
          relays: ["ws://127.0.0.1:8194"],
        }),
      ).rejects.toThrow("Relay URL must start with wss://");
      expect(readRuntimeSource()).toBeNull();

      // DEV opt-in: local ws:// whitelisted for this mutator just like
      // restoreProfileFromRelay. The same flag gates both paths per the
      // feature description.
      (
        window as typeof window & {
          __iglooTestAllowInsecureRelayForRestore?: boolean;
        }
      ).__iglooTestAllowInsecureRelayForRestore = true;

      await act(async () => {
        await getState().createProfile({
          deviceName: "Bootstrap Browser",
          password: "profile-password",
          confirmPassword: "profile-password",
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
          relays: ["ws://127.0.0.1:8194"],
        });
      });

      await waitFor(() =>
        expect(getState().createSession?.onboardingPackages?.length ?? 0)
          .toBeGreaterThan(0),
      );
      expect(readRuntimeSource()).toBe("relay_pump");
    },
    60_000,
  );
});
