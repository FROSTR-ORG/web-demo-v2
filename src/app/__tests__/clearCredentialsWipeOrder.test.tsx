/**
 * VAL-SETTINGS-015 / VAL-SETTINGS-016 / VAL-SETTINGS-017 / VAL-CROSS-006
 *
 * Clear Credentials must invoke `runtime.wipe_state()` on the live WASM
 * runtime BEFORE releasing the runtime reference. This test boots a
 * real AppStateProvider, creates a keyset + profile so a real
 * `RuntimeClient` is attached, and then confirms via a spy on
 * `RuntimeClient.prototype.wipeState` and the dev-only
 * `window.__debug.clearCredentialsLog` phase log that the call order
 * is:
 *
 *   wipe_state.invoked → wipe_state.resolved → runtime.dispose
 *
 * The spy also asserts the wipe call occurs while `runtimeRef.current`
 * is still populated — not after it has already been set to `null`.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";

const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";
const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";

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

interface ClearCredentialsLogEntry {
  phase:
    | "wipe_state.invoked"
    | "wipe_state.resolved"
    | "wipe_state.error"
    | "runtime.dispose";
  at: string;
  message?: string;
}

interface DebugWindow extends Window {
  __debug?: {
    clearCredentialsLog?: ClearCredentialsLogEntry[];
  };
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
  const debugWindow = window as DebugWindow;
  if (debugWindow.__debug?.clearCredentialsLog) {
    debugWindow.__debug.clearCredentialsLog.length = 0;
  }
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.restoreAllMocks();
});

describe("clearCredentials — wipe_state call order (VAL-SETTINGS-015 / VAL-CROSS-006)", () => {
  it(
    "invokes runtime.wipeState BEFORE dropping the runtime ref, logs the phase order, removes the profile, and empties state",
    async () => {
      // Capture the RuntimeClient reference on creation so we can
      // interrogate the live handle from inside the wipe spy.
      const runtimeInstances: RuntimeClient[] = [];
      const originalInit = RuntimeClient.prototype.init;
      vi.spyOn(RuntimeClient.prototype, "init").mockImplementation(
        async function (this: RuntimeClient, ...args) {
          runtimeInstances.push(this);
          return originalInit.apply(this, args as Parameters<typeof originalInit>);
        },
      );

      let latestRef!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latestRef = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latestRef).toBeTruthy());

      await act(async () => {
        await latestRef.createKeyset({
          groupName: "Clear Credentials Wipe Order",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latestRef.createSession?.keyset).toBeTruthy(),
      );

      const profilePassword = "profile-password";
      await act(async () => {
        await latestRef.createProfile({
          deviceName: "Wipe Order Test",
          password: profilePassword,
          confirmPassword: profilePassword,
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latestRef.runtimeStatus).toBeTruthy());

      const profileId = latestRef.activeProfile!.id;
      expect(
        storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`),
      ).toBeDefined();

      // Spy on `wipeState` and, at invocation time, capture the
      // provider-side debug log so we can assert the call is bracketed
      // by `wipe_state.invoked` (already appended) and that
      // `runtime.dispose` has NOT yet been appended — i.e. the runtime
      // ref is still live.
      const wipeStateSpy = vi
        .spyOn(RuntimeClient.prototype, "wipeState")
        .mockImplementation(function (this: RuntimeClient) {
          const debugWindow = window as DebugWindow;
          const logAtInvoke =
            debugWindow.__debug?.clearCredentialsLog?.map(
              (entry) => entry.phase,
            ) ?? [];
          (wipeStateSpy as unknown as { capturedLog: string[][] }).capturedLog =
            (wipeStateSpy as unknown as { capturedLog?: string[][] })
              .capturedLog ?? [];
          (wipeStateSpy as unknown as { capturedLog: string[][] }).capturedLog.push(
            [...logAtInvoke],
          );
        });

      await act(async () => {
        await latestRef.clearCredentials();
      });
      await waitFor(() => expect(latestRef.activeProfile).toBeNull());

      // RuntimeClient.wipeState was called exactly once.
      expect(wipeStateSpy).toHaveBeenCalledTimes(1);

      // At the moment wipeState ran, the log already contained
      // `wipe_state.invoked` but NOT `runtime.dispose` — i.e. the
      // runtime ref was still live.
      const captured =
        (wipeStateSpy as unknown as { capturedLog?: string[][] }).capturedLog ??
        [];
      expect(captured.length).toBe(1);
      expect(captured[0]).toContain("wipe_state.invoked");
      expect(captured[0]).not.toContain("runtime.dispose");

      // After clearCredentials resolves the dev-only debug log records
      // the full sequence in order.
      const debugWindow = window as DebugWindow;
      const phases =
        debugWindow.__debug?.clearCredentialsLog?.map((entry) => entry.phase) ??
        [];
      expect(phases).toEqual([
        "wipe_state.invoked",
        "wipe_state.resolved",
        "runtime.dispose",
      ]);

      // Profile record + index entry are gone from storage
      // (VAL-SETTINGS-016).
      expect(
        storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`),
      ).toBeUndefined();
      const remainingIds = (storage.get(PROFILE_INDEX_KEY) ?? []) as string[];
      expect(remainingIds).not.toContain(profileId);

      // Provider state reflects the clear: no active profile, no
      // runtime status, empty profiles list (VAL-SETTINGS-017).
      await waitFor(() => expect(latestRef.profiles.length).toBe(0));
      expect(latestRef.activeProfile).toBeNull();
      expect(latestRef.runtimeStatus).toBeNull();
      expect(latestRef.runtimeEventLog).toEqual([]);
      expect(latestRef.policyOverrides).toEqual([]);
    },
    60_000,
  );

  it(
    "is resilient to a runtime.wipeState throw: still records wipe_state.error, disposes the ref, and clears the profile",
    async () => {
      let latestRef!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latestRef = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latestRef).toBeTruthy());

      await act(async () => {
        await latestRef.createKeyset({
          groupName: "Clear Credentials Wipe Throw",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latestRef.createSession?.keyset).toBeTruthy(),
      );

      const profilePassword = "profile-password";
      await act(async () => {
        await latestRef.createProfile({
          deviceName: "Wipe Throw Test",
          password: profilePassword,
          confirmPassword: profilePassword,
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latestRef.runtimeStatus).toBeTruthy());

      const profileId = latestRef.activeProfile!.id;

      vi.spyOn(RuntimeClient.prototype, "wipeState").mockImplementation(
        () => {
          throw new Error("simulated wipe failure");
        },
      );

      await act(async () => {
        await latestRef.clearCredentials();
      });
      await waitFor(() => expect(latestRef.activeProfile).toBeNull());

      const debugWindow = window as DebugWindow;
      const phases =
        debugWindow.__debug?.clearCredentialsLog?.map((entry) => entry.phase) ??
        [];
      // Order remains: invoked → error → dispose. We did NOT reach
      // `resolved` because wipe threw. The dispose still runs so the
      // app can recover from a broken WASM runtime.
      expect(phases).toEqual([
        "wipe_state.invoked",
        "wipe_state.error",
        "runtime.dispose",
      ]);

      // Profile is still removed from storage — credential wipe is
      // best-effort but the stored profile removal is unconditional.
      expect(
        storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`),
      ).toBeUndefined();
    },
    60_000,
  );
});
