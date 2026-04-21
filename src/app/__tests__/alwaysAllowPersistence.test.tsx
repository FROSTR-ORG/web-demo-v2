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
  createKeysetBundle,
  decodeProfilePackage,
  defaultManualPeerPolicyOverrides,
  profilePayloadForShare,
} from "../../lib/bifrost/packageService";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import type { StoredProfileRecord } from "../../lib/bifrost/types";

/**
 * fix-m2-persist-always-allow-to-profile — "always-allow" overrides must
 * be written through the existing profile persistence path so the
 * override survives a lock+unlock cycle. "allow-once" must remain
 * session-only and MUST NOT be persisted to the stored profile.
 *
 * Coverage:
 *  - (a) always-allow → stored profile's manual_peer_policy_overrides now
 *        records `respond.<verb> = "allow"` for the target peer, AND after
 *        lock+unlock the runtime receives an explicit `setPolicyOverride`
 *        call restoring that override.
 *  - (b) allow-once → stored profile's manual_peer_policy_overrides is
 *        unchanged (no extra entry, no mutation of the seeded entry's
 *        respond methods). The in-memory runtime still gets the allow,
 *        but no write hits the encrypted profile.
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

async function readStoredOverrides(
  profileId: string,
  password: string,
): Promise<
  Array<{
    pubkey: string;
    policy: {
      request: Record<string, string>;
      respond: Record<string, string>;
    };
  }>
> {
  const record = storage.get(
    `${PROFILE_RECORD_PREFIX}${profileId}`,
  ) as StoredProfileRecord | undefined;
  if (!record) throw new Error("profile record missing from storage");
  const decoded = await decodeProfilePackage(
    record.encryptedProfilePackage,
    password,
  );
  return decoded.device.manual_peer_policy_overrides as Array<{
    pubkey: string;
    policy: {
      request: Record<string, string>;
      respond: Record<string, string>;
    };
  }>;
}

describe("fix-m2-persist-always-allow-to-profile — always-allow persists", () => {
  it(
    "resolvePeerDenial('allow-always') writes respond.<verb>='allow' for the peer through to the encrypted profile, survives lock+unlock",
    async () => {
      const groupName = "Always Allow Persistence Key";
      const profileId = "prof_always_allow_persistence";
      const keyset = await createKeysetBundle({
        groupName,
        threshold: 2,
        count: 2,
      });
      const localShare = keyset.shares[0];
      const fixturePayload = profilePayloadForShare({
        profileId,
        deviceName: "Igloo Web",
        share: localShare,
        group: keyset.group,
        relays: [],
        manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
          keyset.group,
          localShare.idx,
        ),
      });
      expect(fixturePayload).toBeTruthy();

      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.createKeyset({
          groupName,
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

      const profilePassword = "profile-password";
      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: profilePassword,
          confirmPassword: profilePassword,
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      const remotePeer = latest.runtimeStatus!.peers[0];
      expect(remotePeer?.pubkey).toBeTruthy();
      const peerPubkey = remotePeer!.pubkey;
      const activeProfileId = latest.activeProfile?.id;
      expect(activeProfileId).toBeTruthy();

      // Baseline: the stored profile seeded by createProfile carries
      // the default "allow-all" overrides (defaultManualPeerPolicyOverrides).
      const baselineOverrides = await readStoredOverrides(
        activeProfileId!,
        profilePassword,
      );
      const baselineEntry = baselineOverrides.find(
        (entry) => entry.pubkey === peerPubkey,
      );
      expect(baselineEntry).toBeTruthy();
      expect(baselineEntry?.policy.respond.sign).toBe("allow");

      // Step 1: run a deny-always first so the persisted override state
      // is DIFFERENT from the default seed — this gives a meaningful
      // differential for the subsequent allow-always assertion. Without
      // this mutation, the default-seeded "allow" would pass the
      // post-allow-always assertion vacuously.
      act(() => {
        latest.enqueuePeerDenial({
          id: "denial-deny-always-priming",
          peer_pubkey: peerPubkey,
          verb: "sign",
          denied_at: Date.now(),
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(1));
      await act(async () => {
        await latest.resolvePeerDenial("denial-deny-always-priming", {
          action: "deny-always",
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(0));

      const denyPersistedOverrides = await readStoredOverrides(
        activeProfileId!,
        profilePassword,
      );
      const denyPersistedEntry = denyPersistedOverrides.find(
        (entry) => entry.pubkey === peerPubkey,
      );
      expect(denyPersistedEntry).toBeTruthy();
      expect(denyPersistedEntry!.policy.respond.sign).toBe("deny");

      // Step 2: flip back via allow-always.
      act(() => {
        latest.enqueuePeerDenial({
          id: "denial-always-allow",
          peer_pubkey: peerPubkey,
          verb: "sign",
          denied_at: Date.now(),
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(1));

      await act(async () => {
        await latest.resolvePeerDenial("denial-always-allow", {
          action: "allow-always",
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(0));

      // The stored profile must now have respond.sign == "allow" for
      // the peer (persisted through the encrypted-payload path). This
      // is a meaningful assertion because the previous deny-always
      // wrote "deny" to disk — the allow-always must overwrite it.
      const persistedOverrides = await readStoredOverrides(
        activeProfileId!,
        profilePassword,
      );
      const persistedEntry = persistedOverrides.find(
        (entry) => entry.pubkey === peerPubkey,
      );
      expect(persistedEntry).toBeTruthy();
      expect(persistedEntry!.policy.respond.sign).toBe("allow");

      // Lock then unlock. After unlock the runtime must receive an
      // explicit setPolicyOverride dispatch restoring the persisted allow
      // override (proving the profile state was re-applied to the new
      // runtime on unlock).
      const setOverrideSpy = vi.spyOn(
        RuntimeClient.prototype,
        "setPolicyOverride",
      );

      act(() => {
        latest.lockProfile();
      });
      await waitFor(() => expect(latest.activeProfile).toBeNull());

      setOverrideSpy.mockClear();

      await act(async () => {
        await latest.unlockProfile(activeProfileId!, profilePassword);
      });
      await waitFor(() => expect(latest.activeProfile).toBeTruthy());

      const reapplyCall = setOverrideSpy.mock.calls.find(
        (call) =>
          (call[0] as { peer?: string }).peer === peerPubkey &&
          (call[0] as { direction?: string }).direction === "respond" &&
          (call[0] as { method?: string }).method === "sign" &&
          (call[0] as { value?: string }).value === "allow",
      );
      expect(reapplyCall).toBeTruthy();
    },
    60_000,
  );

  it(
    "resolvePeerDenial('allow-once') does NOT write the override to the encrypted profile",
    async () => {
      const groupName = "Allow Once No Persist Key";
      const profileId = "prof_allow_once_no_persist";
      const keyset = await createKeysetBundle({
        groupName,
        threshold: 2,
        count: 2,
      });
      const localShare = keyset.shares[0];
      const fixturePayload = profilePayloadForShare({
        profileId,
        deviceName: "Igloo Web",
        share: localShare,
        group: keyset.group,
        relays: [],
        manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
          keyset.group,
          localShare.idx,
        ),
      });
      expect(fixturePayload).toBeTruthy();

      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.createKeyset({
          groupName,
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

      const profilePassword = "profile-password";
      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: profilePassword,
          confirmPassword: profilePassword,
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      const peerPubkey = latest.runtimeStatus!.peers[0].pubkey;
      const activeProfileId = latest.activeProfile?.id;
      expect(activeProfileId).toBeTruthy();

      const baselineOverrides = await readStoredOverrides(
        activeProfileId!,
        profilePassword,
      );

      act(() => {
        latest.enqueuePeerDenial({
          id: "denial-allow-once-no-persist",
          peer_pubkey: peerPubkey,
          verb: "sign",
          denied_at: Date.now(),
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(1));

      await act(async () => {
        await latest.resolvePeerDenial("denial-allow-once-no-persist", {
          action: "allow-once",
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(0));

      // The stored profile's manual_peer_policy_overrides must be
      // UNCHANGED after an allow-once decision — the override only lives
      // in-memory for the current session.
      const afterOverrides = await readStoredOverrides(
        activeProfileId!,
        profilePassword,
      );
      expect(afterOverrides).toEqual(baselineOverrides);
    },
    60_000,
  );
});
