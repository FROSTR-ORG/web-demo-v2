/**
 * m6-backup-restore — `AppStateValue.restoreProfileFromRelay`
 * synchronous-guard unit tests.
 *
 * The happy-path restore (relay REQ → matching EVENT → decrypt →
 * IndexedDB write) is exercised end-to-end by the multi-device
 * Playwright spec `src/e2e/multi-device/backup-restore.spec.ts`
 * because it requires a live `bifrost-devtools` relay. Here we pin
 * the validation surface that runs before any network I/O:
 *
 *   - VAL-BACKUP-032: invalid relay URL rejects with the canonical
 *     "Relay URL must start with wss://" copy.
 *   - VAL-BACKUP-011: password shorter than 8 characters rejects with
 *     the canonical "Invalid password" copy (the UI renders this
 *     verbatim next to the password field).
 *   - At-least-one-relay requirement.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";

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
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.restoreAllMocks();
});

describe("AppStateValue.restoreProfileFromRelay — synchronous guards", () => {
  it(
    "rejects with 'Invalid password' when password is shorter than 8 characters (VAL-BACKUP-011)",
    async () => {
      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await expect(
        act(async () => {
          await latest.restoreProfileFromRelay({
            bfshare: "bfshare1anything",
            bfsharePassword: "short",
            backupPassword: "short",
            relays: ["wss://relay.primal.net"],
          });
        }),
      ).rejects.toThrowError(/Invalid password/i);
    },
    30_000,
  );

  it(
    "rejects with the canonical relay-url error when the relay list contains http:// (VAL-BACKUP-032)",
    async () => {
      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await expect(
        act(async () => {
          await latest.restoreProfileFromRelay({
            bfshare: "bfshare1anything",
            bfsharePassword: "aLongEnoughPassword",
            backupPassword: "aLongEnoughPassword",
            relays: ["http://not-a-wss.example.com"],
          });
        }),
      ).rejects.toThrowError(/Relay URL must start with wss:\/\//i);
    },
    30_000,
  );

  it(
    "rejects when the normalised relay list is empty",
    async () => {
      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await expect(
        act(async () => {
          await latest.restoreProfileFromRelay({
            bfshare: "bfshare1anything",
            bfsharePassword: "aLongEnoughPassword",
            backupPassword: "aLongEnoughPassword",
            relays: ["   ", ""],
          });
        }),
      ).rejects.toThrowError(/At least one relay is required/i);
    },
    30_000,
  );

  // fix-m6-restore-relay-wss-and-parallel: the DEV-only
  // `__iglooTestAllowInsecureRelayForRestore` toggle only relaxes
  // wss:// enforcement when it is explicitly set to `true` on the
  // window. Leaving it unset (the production default) must still
  // reject plain `ws://` URLs with the canonical relay-url error —
  // pinning this guards against the toggle accidentally leaking into
  // non-DEV builds.
  it(
    "rejects ws:// URLs with the canonical relay-url error when the insecure-relay toggle is NOT set",
    async () => {
      const globalWindow = globalThis as unknown as {
        __iglooTestAllowInsecureRelayForRestore?: boolean;
      };
      // Guard: ensure no prior test leaked the toggle into our run.
      delete globalWindow.__iglooTestAllowInsecureRelayForRestore;

      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await expect(
        act(async () => {
          await latest.restoreProfileFromRelay({
            bfshare: "bfshare1anything",
            bfsharePassword: "aLongEnoughPassword",
            backupPassword: "aLongEnoughPassword",
            relays: ["ws://127.0.0.1:8194"],
          });
        }),
      ).rejects.toThrowError(/Relay URL must start with wss:\/\//i);
    },
    30_000,
  );
});
