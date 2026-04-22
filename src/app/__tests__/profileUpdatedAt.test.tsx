import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";
import type { StoredProfileRecord } from "../../lib/bifrost/types";

/**
 * m5-group-profile-metadata — every save through
 * `buildStoredProfileRecord` bumps `summary.updatedAt` to the current
 * epoch-ms timestamp, while `summary.createdAt` is preserved across
 * mutations. The Settings sidebar's "Updated" cell (VAL-SETTINGS-008)
 * reads this value from IndexedDB, so the assertion here is that the
 * on-disk record and the in-memory `activeProfile` both reflect a
 * monotonically advancing `updatedAt` after each mutator call while
 * `createdAt` remains stable.
 */

const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

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

function readStoredSummary(profileId: string) {
  const record = storage.get(
    `${PROFILE_RECORD_PREFIX}${profileId}`,
  ) as StoredProfileRecord | undefined;
  if (!record) throw new Error("profile record missing from storage");
  return record.summary;
}

async function seedProfile(): Promise<{
  latest: () => AppStateValue;
  activeProfileId: string;
  profilePassword: string;
}> {
  const profilePassword = "profile-password";

  let latestRef!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture
        onState={(state) => {
          latestRef = state;
        }}
      />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latestRef).toBeTruthy());

  await act(async () => {
    await latestRef.createKeyset({
      groupName: "UpdatedAt Persist Key",
      threshold: 2,
      count: 2,
    });
  });
  await waitFor(() => expect(latestRef.createSession?.keyset).toBeTruthy());

  await act(async () => {
    await latestRef.createProfile({
      deviceName: "Igloo Web",
      password: profilePassword,
      confirmPassword: profilePassword,
      relays: ["wss://relay.local"],
      distributionPassword: "distro-password",
      confirmDistributionPassword: "distro-password",
    });
  });
  await waitFor(() => expect(latestRef.activeProfile).toBeTruthy());
  const activeProfileId = latestRef.activeProfile!.id;

  return {
    latest: () => latestRef,
    activeProfileId,
    profilePassword,
  };
}

describe("StoredProfileSummary.updatedAt — bumps on mutation, stable on read", () => {
  it(
    "initial save sets updatedAt ≈ createdAt on a freshly-created profile",
    async () => {
      const { activeProfileId } = await seedProfile();
      const summary = readStoredSummary(activeProfileId);
      expect(typeof summary.createdAt).toBe("number");
      expect(typeof summary.updatedAt).toBe("number");
      // Created and updated are set in the same call so they differ by at
      // most a millisecond on a clean clock.
      expect(Math.abs((summary.updatedAt ?? 0) - summary.createdAt)).toBeLessThan(
        50,
      );
    },
    60_000,
  );

  it(
    "updateProfileName advances updatedAt while keeping createdAt stable (VAL-SETTINGS-008)",
    async () => {
      const { latest, activeProfileId } = await seedProfile();
      const before = readStoredSummary(activeProfileId);
      // A tiny wait so Date.now() can strictly advance inside the mutator.
      await new Promise((resolve) => setTimeout(resolve, 5));

      await act(async () => {
        await latest().updateProfileName("Alice Laptop");
      });

      await waitFor(() => {
        const after = readStoredSummary(activeProfileId);
        expect(after.createdAt).toBe(before.createdAt);
        expect(after.updatedAt).toBeGreaterThan(before.updatedAt ?? 0);
      });
      expect(latest().activeProfile?.createdAt).toBe(before.createdAt);
      expect((latest().activeProfile?.updatedAt ?? 0)).toBeGreaterThan(
        before.updatedAt ?? 0,
      );
    },
    60_000,
  );

  it(
    "updateRelays advances updatedAt while keeping createdAt stable (VAL-SETTINGS-008)",
    async () => {
      const { latest, activeProfileId } = await seedProfile();
      const before = readStoredSummary(activeProfileId);
      await new Promise((resolve) => setTimeout(resolve, 5));

      await act(async () => {
        await latest().updateRelays([
          "wss://relay.local",
          "wss://relay.secondary",
        ]);
      });

      await waitFor(() => {
        const after = readStoredSummary(activeProfileId);
        expect(after.createdAt).toBe(before.createdAt);
        expect(after.updatedAt).toBeGreaterThan(before.updatedAt ?? 0);
        expect(after.relays).toEqual([
          "wss://relay.local",
          "wss://relay.secondary",
        ]);
      });
    },
    60_000,
  );
});
