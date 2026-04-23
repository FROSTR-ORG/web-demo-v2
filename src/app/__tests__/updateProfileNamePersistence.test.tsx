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
import {
  decodeProfilePackage,
} from "../../lib/bifrost/packageService";
import type { StoredProfileRecord } from "../../lib/bifrost/types";

/**
 * m5-device-name-persist — {@link AppStateValue.updateProfileName} persists
 * the Device Profile name through the encrypted profile store, so the name
 * edit survives Lock/Unlock/reload (VAL-SETTINGS-001, VAL-SETTINGS-024,
 * VAL-SETTINGS-025, VAL-CROSS-004). Empty/whitespace/oversize inputs are
 * rejected at the mutator layer and do NOT reach IndexedDB.
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

async function readStoredDeviceName(
  profileId: string,
  password: string,
): Promise<string> {
  const record = storage.get(
    `${PROFILE_RECORD_PREFIX}${profileId}`,
  ) as StoredProfileRecord | undefined;
  if (!record) throw new Error("profile record missing from storage");
  const decoded = await decodeProfilePackage(
    record.encryptedProfilePackage,
    password,
  );
  return decoded.device.name;
}

async function seedProfile(
  onState: (state: AppStateValue) => void,
  opts: {
    groupName?: string;
    initialDeviceName?: string;
    password?: string;
  } = {},
): Promise<{
  latest: () => AppStateValue;
  activeProfileId: string;
  profilePassword: string;
}> {
  const groupName = opts.groupName ?? "Name Persist Key";
  const initialDeviceName = opts.initialDeviceName ?? "Igloo Web";
  const profilePassword = opts.password ?? "profile-password";

  let latestRef!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture
        onState={(state) => {
          latestRef = state;
          onState(state);
        }}
      />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latestRef).toBeTruthy());

  await act(async () => {
    await latestRef.createKeyset({ groupName, threshold: 2, count: 2 });
  });
  await waitFor(() =>
    expect(latestRef.createSession?.keyset).toBeTruthy(),
  );

  await act(async () => {
    await latestRef.createProfile({
      deviceName: initialDeviceName,
      password: profilePassword,
      confirmPassword: profilePassword,
      relays: ["wss://relay.local"],
      distributionPassword: "distro-password",
      confirmDistributionPassword: "distro-password",
    });
  });
  await waitFor(() => expect(latestRef.activeProfile).toBeTruthy());
  const activeProfileId = latestRef.activeProfile!.id;

  // Sanity: ensure createKeyset prevents the test from silently running
  // against a stale runtime.
  expect(await readStoredDeviceName(activeProfileId, profilePassword)).toBe(
    initialDeviceName,
  );

  return {
    latest: () => latestRef,
    activeProfileId,
    profilePassword,
  };
}

describe("AppStateProvider.updateProfileName — persistence and validation", () => {
  it(
    "persists a trimmed device name through the encrypted profile and updates activeProfile (VAL-SETTINGS-001 / VAL-CROSS-004)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile(
        () => undefined,
      );

      await act(async () => {
        await latest().updateProfileName("  Alice Laptop  ");
      });

      // On-disk encrypted profile reflects the trimmed new name
      await waitFor(async () => {
        expect(
          await readStoredDeviceName(activeProfileId, profilePassword),
        ).toBe("Alice Laptop");
      });
      // Active profile summary in memory also reflects the trimmed name
      expect(latest().activeProfile?.deviceName).toBe("Alice Laptop");
    },
    60_000,
  );

  it(
    "stores unicode/emoji/RTL names verbatim (VAL-SETTINGS-024)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile(
        () => undefined,
      );
      const exotic = "🧊 José مرحبا 中文";

      await act(async () => {
        await latest().updateProfileName(exotic);
      });

      await waitFor(async () => {
        expect(
          await readStoredDeviceName(activeProfileId, profilePassword),
        ).toBe(exotic);
      });
      expect(latest().activeProfile?.deviceName).toBe(exotic);
    },
    60_000,
  );

  it(
    "rejects empty / whitespace-only names without touching storage (VAL-SETTINGS-002)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile(
        () => undefined,
      );
      const originalName = latest().activeProfile!.deviceName;

      await expect(
        act(async () => {
          await latest().updateProfileName("");
        }),
      ).rejects.toThrow();

      await expect(
        act(async () => {
          await latest().updateProfileName("   ");
        }),
      ).rejects.toThrow();

      // Stored profile and active profile untouched
      expect(
        await readStoredDeviceName(activeProfileId, profilePassword),
      ).toBe(originalName);
      expect(latest().activeProfile?.deviceName).toBe(originalName);
    },
    60_000,
  );

  it(
    "rejects names exceeding the documented max length (VAL-SETTINGS-025)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile(
        () => undefined,
      );
      const originalName = latest().activeProfile!.deviceName;

      await expect(
        act(async () => {
          await latest().updateProfileName("z".repeat(200));
        }),
      ).rejects.toThrow();

      expect(
        await readStoredDeviceName(activeProfileId, profilePassword),
      ).toBe(originalName);
      expect(latest().activeProfile?.deviceName).toBe(originalName);
    },
    60_000,
  );

  it(
    "survives a lock+unlock cycle (VAL-CROSS-004)",
    async () => {
      const { latest, activeProfileId, profilePassword } = await seedProfile(
        () => undefined,
      );

      await act(async () => {
        await latest().updateProfileName("Persistent Name");
      });

      // Lock -> unlock
      await act(() => {
        latest().lockProfile();
      });
      await waitFor(() => expect(latest().activeProfile).toBeNull());

      await act(async () => {
        await latest().unlockProfile(activeProfileId, profilePassword);
      });
      await waitFor(() =>
        expect(latest().activeProfile?.deviceName).toBe("Persistent Name"),
      );
      expect(
        await readStoredDeviceName(activeProfileId, profilePassword),
      ).toBe("Persistent Name");
    },
    60_000,
  );
});
