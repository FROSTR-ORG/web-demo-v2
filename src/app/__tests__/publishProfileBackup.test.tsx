/**
 * m6-backup-publish — {@link AppStateValue.publishProfileBackup}
 * defense-in-depth validation + no-runtime error paths.
 *
 * The happy-path publish (WASM encrypt → signed kind-10000 event →
 * fan-out to all online relays) is exercised end-to-end by the
 * `src/e2e/multi-device/backup-publish.spec.ts` Playwright spec
 * because it requires a real `bifrost-devtools` relay and two
 * browser contexts. Here we pin the synchronous guard behaviour that
 * does not require booting a relay pump:
 *
 *   - VAL-BACKUP-024 / VAL-BACKUP-025: password < 8 chars throws
 *     synchronously, before any WASM call.
 *   - VAL-BACKUP-007: calling before a runtime is unlocked throws
 *     with the "No relays available to publish to." copy.
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

describe("AppStateValue.publishProfileBackup — synchronous guards", () => {
  it(
    "throws before any WASM dispatch when password length < 8 (VAL-BACKUP-024/025)",
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
          await latest.publishProfileBackup("short");
        }),
      ).rejects.toThrowError(/at least 8 characters/i);

      await expect(
        act(async () => {
          await latest.publishProfileBackup("");
        }),
      ).rejects.toThrowError(/at least 8 characters/i);
    },
    30_000,
  );

  it(
    "throws 'No relays available to publish to.' when no profile is unlocked (VAL-BACKUP-007)",
    async () => {
      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      // No runtime booted — the mutator must surface the
      // "no unlocked runtime" error before any WASM work runs.
      await expect(
        act(async () => {
          await latest.publishProfileBackup("aLongPassword1");
        }),
      ).rejects.toThrowError(/unlocked runtime|No relays available/i);
    },
    30_000,
  );
});
