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

/**
 * m5-change-password — {@link AppStateValue.changeProfilePassword} rotates
 * the stored profile encryption passphrase using the existing decrypt →
 * re-encrypt path. This suite verifies the mutator-level contract:
 *
 *   - Rejects sub-minimum-length new passwords (VAL-SETTINGS-028).
 *   - Rejects new === current (VAL-SETTINGS-026).
 *   - Rejects wrong current password with the canonical
 *     "Current password is incorrect." message (VAL-SETTINGS-019) and
 *     does NOT rotate the stored record.
 *   - After a successful rotation, the old password is rejected on the
 *     next unlock and the new password succeeds (VAL-SETTINGS-018).
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

async function seedProfile(
  opts: { password?: string } = {},
): Promise<{
  latest: () => AppStateValue;
  activeProfileId: string;
  profilePassword: string;
}> {
  const profilePassword = opts.password ?? "profile-password";
  let latestRef!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latestRef = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latestRef).toBeTruthy());

  await act(async () => {
    await latestRef.createKeyset({
      groupName: "Change Pw Key",
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
    });
  });
  await waitFor(() => expect(latestRef.activeProfile).toBeTruthy());

  return {
    latest: () => latestRef,
    activeProfileId: latestRef.activeProfile!.id,
    profilePassword,
  };
}

function snapshotRecord(profileId: string): unknown {
  return storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`);
}

describe("AppStateProvider.changeProfilePassword — validation & persistence", () => {
  it(
    "rejects sub-minimum-length new password without touching storage (VAL-SETTINGS-028)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile();
      const before = snapshotRecord(activeProfileId);

      await expect(
        act(async () => {
          await latest().changeProfilePassword(profilePassword, "abc");
        }),
      ).rejects.toThrow(/at least 4/i);

      expect(snapshotRecord(activeProfileId)).toBe(before);
    },
    60_000,
  );

  it(
    "rejects new === current (VAL-SETTINGS-026)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile();
      const before = snapshotRecord(activeProfileId);

      await expect(
        act(async () => {
          await latest().changeProfilePassword(
            profilePassword,
            profilePassword,
          );
        }),
      ).rejects.toThrow(/must differ from current/i);

      expect(snapshotRecord(activeProfileId)).toBe(before);
    },
    60_000,
  );

  it(
    "rejects wrong current password with canonical copy and leaves record untouched (VAL-SETTINGS-019)",
    async () => {
      const { latest, activeProfileId } = await seedProfile({
        password: "correct-password",
      });
      const before = snapshotRecord(activeProfileId);

      await expect(
        act(async () => {
          await latest().changeProfilePassword(
            "wrong-password",
            "brand-new-password",
          );
        }),
      ).rejects.toThrow(/current password is incorrect/i);

      // Stored record must be unchanged — no rotation on failed decrypt.
      expect(snapshotRecord(activeProfileId)).toBe(before);
    },
    60_000,
  );

  it(
    "rotates the passphrase so next unlock requires the new password (VAL-SETTINGS-018)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile({
        password: "old-password",
      });
      const newPassword = "brand-new-password";

      await act(async () => {
        await latest().changeProfilePassword(profilePassword, newPassword);
      });

      // Lock, then verify old password is rejected and new password works.
      await act(() => {
        latest().lockProfile();
      });
      await waitFor(() => expect(latest().activeProfile).toBeNull());

      await expect(
        act(async () => {
          await latest().unlockProfile(activeProfileId, profilePassword);
        }),
      ).rejects.toThrow();

      await act(async () => {
        await latest().unlockProfile(activeProfileId, newPassword);
      });
      await waitFor(() =>
        expect(latest().activeProfile?.id).toBe(activeProfileId),
      );
    },
    60_000,
  );
});
