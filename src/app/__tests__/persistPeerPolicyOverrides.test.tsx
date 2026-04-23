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
} from "../../lib/bifrost/packageService";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import type { StoredProfileRecord } from "../../lib/bifrost/types";

/**
 * m3-policy-denial-and-persistence — dedicated coverage for peer-policy
 * override persistence: VAL-POLICIES-015 (page reload), VAL-POLICIES-016
 * (lock/unlock), and VAL-POLICIES-017 (clear credentials).
 *
 * These assertions collectively require that a peer policy override set
 * through the AppState bridge — via `resolvePeerDenial("allow-always")`,
 * the "Always allow" decision in the `PolicyPromptModal` — be:
 *
 *   * Case 1 (VAL-POLICIES-016): preserved across `lockProfile()` →
 *     `unlockProfile(id, password)`. After unlock, the profile decodes
 *     the same `manual_peer_policy_overrides` payload AND the freshly
 *     initialised runtime receives an explicit `setPolicyOverride`
 *     dispatch restoring the `allow` cell.
 *   * Case 2 (VAL-POLICIES-015): preserved across a full profile
 *     encrypt/decrypt round-trip, simulating a page reload. Between
 *     the override write and the unlock we unmount the provider
 *     entirely and mount a FRESH provider — the only shared state is
 *     the mocked idb-keyval store, mirroring what survives a hard
 *     browser refresh. After unlock, the new provider's runtime and
 *     stored profile reflect the persistent `allow`.
 *   * Case 3 (VAL-POLICIES-017): `clearCredentials()` wipes the profile
 *     from IndexedDB. A subsequent fresh create/onboard onto the same
 *     device would start with the default "allow-all" seeded overrides
 *     (from `defaultManualPeerPolicyOverrides`), with no lingering
 *     custom entries from the previous profile.
 */

const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

// idb-keyval shim shared by every test in the file. Mirrors the pattern
// used in sibling AppState persistence tests (alwaysAllowPersistence,
// peerPoliciesRemoveOverride) so createKeyset / createProfile / lock +
// unlock / clearCredentials all exercise a deterministic in-memory
// mutation path without touching a real IndexedDB.
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

/**
 * Decode the currently-stored profile record and return its
 * `manual_peer_policy_overrides` list. Throws if the record is missing.
 */
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

/**
 * Boot a fresh `AppStateProvider`, walk create-keyset → create-profile →
 * trigger a `peer_denied` event, resolve with `allow-always`, and return
 * the resulting handles. Mirrors the helper from
 * `alwaysAllowPersistence.test.tsx` so each case below starts from a
 * realistic post-Always-allow state without duplicating the setup.
 *
 * The peer policy slot targeted is `respond.sign` for the first remote
 * peer — the same path exercised by the `SigningFailedModal → Always
 * allow` decision in the Paper UX.
 */
async function bootWithPersistentAllow(groupName: string): Promise<{
  latest: () => AppStateValue;
  peerPubkey: string;
  profileId: string;
  profilePassword: string;
}> {
  const keyset = await createKeysetBundle({
    groupName,
    threshold: 2,
    count: 2,
  });
  expect(keyset.shares.length).toBeGreaterThanOrEqual(2);

  let latestRef!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latestRef = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latestRef).toBeTruthy());

  await act(async () => {
    await latestRef.createKeyset({ groupName, threshold: 2, count: 2 });
  });
  await waitFor(() =>
    expect(latestRef.createSession?.keyset).toBeTruthy(),
  );

  const profilePassword = "profile-password";
  await act(async () => {
    await latestRef.createProfile({
      deviceName: "Igloo Web",
      password: profilePassword,
      confirmPassword: profilePassword,
      relays: ["wss://relay.local"],
    });
  });
  await waitFor(() => expect(latestRef.runtimeStatus).toBeTruthy());

  const remotePeer = latestRef.runtimeStatus!.peers[0];
  expect(remotePeer?.pubkey).toBeTruthy();
  const peerPubkey = remotePeer!.pubkey;
  const profileId = latestRef.activeProfile!.id;

  act(() => {
    latestRef.enqueuePeerDenial({
      id: `denial-allow-always-${profileId}`,
      peer_pubkey: peerPubkey,
      verb: "sign",
      denied_at: Date.now(),
    });
  });
  await waitFor(() => expect(latestRef.peerDenialQueue.length).toBe(1));

  await act(async () => {
    await latestRef.resolvePeerDenial(
      `denial-allow-always-${profileId}`,
      { action: "allow-always" },
    );
  });
  await waitFor(() => expect(latestRef.peerDenialQueue.length).toBe(0));

  return {
    latest: () => latestRef,
    peerPubkey,
    profileId,
    profilePassword,
  };
}

describe("persistPeerPolicyOverrides — peer-policy override persistence matrix", () => {
  it(
    "VAL-POLICIES-016: allow-always override survives lockProfile → unlockProfile (profile persists; runtime re-applied on unlock)",
    async () => {
      const { latest, peerPubkey, profileId, profilePassword } =
        await bootWithPersistentAllow("VAL-POLICIES-016 Key");

      // Encrypted profile shows respond.sign="allow" for this peer.
      const preLock = await readStoredOverrides(profileId, profilePassword);
      const preLockEntry = preLock.find((e) => e.pubkey === peerPubkey);
      expect(preLockEntry?.policy.respond.sign).toBe("allow");

      const setOverrideSpy = vi.spyOn(
        RuntimeClient.prototype,
        "setPolicyOverride",
      );

      act(() => {
        latest().lockProfile();
      });
      await waitFor(() => expect(latest().activeProfile).toBeNull());

      // Only inspect calls made AFTER lock — the unlock re-apply loop
      // is what VAL-POLICIES-016 asserts.
      setOverrideSpy.mockClear();

      await act(async () => {
        await latest().unlockProfile(profileId, profilePassword);
      });
      await waitFor(() => expect(latest().activeProfile).toBeTruthy());

      // The stored profile still carries the persistent allow after
      // unlock (the decryption path does not mutate it).
      const postUnlock = await readStoredOverrides(
        profileId,
        profilePassword,
      );
      const postUnlockEntry = postUnlock.find(
        (e) => e.pubkey === peerPubkey,
      );
      expect(postUnlockEntry?.policy.respond.sign).toBe("allow");

      // The runtime received an explicit re-apply dispatch restoring
      // the allow cell — proof that the fresh runtime inherited the
      // persistent override rather than the bifrost-rs default.
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
    "VAL-POLICIES-015: allow-always override survives a full provider unmount + remount (simulates page reload)",
    async () => {
      const { latest, peerPubkey, profileId, profilePassword } =
        await bootWithPersistentAllow("VAL-POLICIES-015 Key");

      // Stored profile has the persisted allow before the "reload".
      const preReload = await readStoredOverrides(
        profileId,
        profilePassword,
      );
      const preEntry = preReload.find((e) => e.pubkey === peerPubkey);
      expect(preEntry?.policy.respond.sign).toBe("allow");

      // Simulate a page reload: lock the current provider, unmount it,
      // then mount a brand new AppStateProvider instance. The only
      // shared state is the mocked idb-keyval store — the same
      // contract a real browser refresh would obey against IndexedDB.
      act(() => {
        latest().lockProfile();
      });
      cleanup();

      let reloadedRef!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (reloadedRef = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(reloadedRef).toBeTruthy());

      // The new provider must surface the previously-stored profile in
      // its profile list (proving it decoded the encrypted record from
      // persistent storage, not from stale in-memory state).
      await waitFor(() => expect(reloadedRef.profiles.length).toBe(1));
      expect(reloadedRef.profiles[0]?.id).toBe(profileId);

      const setOverrideSpy = vi.spyOn(
        RuntimeClient.prototype,
        "setPolicyOverride",
      );
      setOverrideSpy.mockClear();

      await act(async () => {
        await reloadedRef.unlockProfile(profileId, profilePassword);
      });
      await waitFor(() =>
        expect(reloadedRef.activeProfile?.id).toBe(profileId),
      );

      // The encrypted profile still reports the allow after the
      // simulated reload.
      const postReload = await readStoredOverrides(
        profileId,
        profilePassword,
      );
      const postEntry = postReload.find((e) => e.pubkey === peerPubkey);
      expect(postEntry?.policy.respond.sign).toBe("allow");

      // And the fresh runtime instance inherited the allow via an
      // explicit setPolicyOverride dispatch during unlock.
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
    "VAL-POLICIES-017: clearCredentials wipes the profile from storage so no manual_peer_policy_overrides bleed into a replacement",
    async () => {
      const { latest, peerPubkey, profileId, profilePassword } =
        await bootWithPersistentAllow("VAL-POLICIES-017 Key");

      // Sanity: the persisted override exists before clearCredentials.
      const preClear = await readStoredOverrides(
        profileId,
        profilePassword,
      );
      expect(
        preClear.find((e) => e.pubkey === peerPubkey)?.policy.respond.sign,
      ).toBe("allow");
      expect(
        storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`),
      ).toBeDefined();

      await act(async () => {
        await latest().clearCredentials();
      });
      await waitFor(() => expect(latest().activeProfile).toBeNull());

      // Profile record + index entry are removed so no re-import path
      // can resurrect the old override.
      expect(
        storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`),
      ).toBeUndefined();
      await waitFor(() => expect(latest().profiles.length).toBe(0));

      // Create a fresh keyset + profile on the same provider. Because
      // the previous profile was wiped, the replacement's encrypted
      // payload must carry ONLY the default (seeded, allow-all)
      // manual_peer_policy_overrides — with no residue referencing the
      // old peer pubkey from the wiped profile.
      await act(async () => {
        await latest().createKeyset({
          groupName: "VAL-POLICIES-017 Replacement Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latest().createSession?.keyset).toBeTruthy(),
      );

      await act(async () => {
        await latest().createProfile({
          deviceName: "Igloo Web (replacement)",
          password: "fresh-password",
          confirmPassword: "fresh-password",
          relays: ["wss://relay.local"],
        });
      });
      await waitFor(() => expect(latest().runtimeStatus).toBeTruthy());

      const replacementProfileId = latest().activeProfile?.id;
      expect(replacementProfileId).toBeTruthy();
      expect(replacementProfileId).not.toBe(profileId);

      const replacementOverrides = await readStoredOverrides(
        replacementProfileId!,
        "fresh-password",
      );

      // Zero entries reference the wiped profile's peer pubkey.
      expect(
        replacementOverrides.some((entry) => entry.pubkey === peerPubkey),
      ).toBe(false);

      // Any seeded entries carry only the default "allow" cell matrix
      // (no residual "deny" or custom cells from the wiped profile) —
      // that is, there are no non-default respond.<verb> values for
      // any peer.
      for (const entry of replacementOverrides) {
        for (const verb of ["sign", "ecdh", "ping", "onboard"] as const) {
          expect([
            // "allow" is the seeded default; "unset" could also legally
            // appear for future seed changes but indicates no custom
            // mutation; only "deny" would be a leak.
            "allow",
            "unset",
          ]).toContain(entry.policy.respond[verb]);
        }
      }
    },
    60_000,
  );
});
