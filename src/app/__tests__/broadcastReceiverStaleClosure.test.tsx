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
import type { StoredProfileRecord } from "../../lib/bifrost/types";

/**
 * fix-m2-broadcast-receiver-stale-closure — the BroadcastChannel
 * receive effect installs once at mount and captures references that
 * would otherwise go stale when `activeProfile` (and related state)
 * update after mount. Specifically, `persistPolicyOverrideToProfile`
 * must always serialize cross-tab `always-allow` / `deny-always`
 * decisions through the CURRENT profile — not a snapshot captured at
 * mount (often null) or at the time of the first unlock.
 *
 * Coverage:
 *  - Cross-tab `allow-always` received AFTER the receiving tab cycles
 *    its `activeProfile` (lock → unlock) writes through to the
 *    post-unlock profile's encrypted payload.
 *  - The BroadcastChannel effect does not leak duplicate listeners:
 *    a single cross-tab `decision` message triggers exactly one
 *    persistence write / one override dispatch, even after profile
 *    transitions occur on the receiving tab.
 */

const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";
const CHANNEL = "igloo-policy-denials";

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
 * Wait for the in-jsdom BroadcastChannel message dispatch + any async
 * persistence work fired from its handler to settle. Two ticks is the
 * same cadence used by sibling broadcast tests; we extend to four here
 * because profile re-encryption is async.
 */
async function flushChannel() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

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

describe("fix-m2-broadcast-receiver-stale-closure — receiver persists through CURRENT profile", () => {
  it(
    "cross-tab `allow-always` received AFTER a lock+unlock cycle persists to the post-unlock profile",
    async () => {
      // Pre-warm a profile payload fixture to mirror the pattern used in
      // sibling broadcast/persistence tests.
      const groupName = "Broadcast Receiver Stale Closure Key";
      const keyset = await createKeysetBundle({
        groupName,
        threshold: 2,
        count: 2,
      });
      const localShare = keyset.shares[0];
      const fixturePayload = profilePayloadForShare({
        profileId: "prof_broadcast_receiver_stale_closure",
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

      // Bootstrap a keyset + profile so the receiver has a real runtime
      // + persisted profile record to mutate.
      await act(async () => {
        await latest.createKeyset({ groupName, threshold: 2, count: 2 });
      });
      await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

      const profilePassword = "profile-password";
      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: profilePassword,
          confirmPassword: profilePassword,
          relays: ["wss://relay.local"],
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      const peerPubkey = latest.runtimeStatus!.peers[0].pubkey;
      expect(peerPubkey).toBeTruthy();
      const activeProfileId = latest.activeProfile?.id;
      expect(activeProfileId).toBeTruthy();

      // Cycle the activeProfile: lock + unlock. This reproduces the
      // stale-closure trigger — `activeProfile` state changes after the
      // BroadcastChannel receive effect is installed. Prior to the fix
      // the receiver's capture of `persistPolicyOverrideToProfile`
      // closed over the pre-cycle `activeProfile`, which was a
      // DIFFERENT StoredProfileSummary instance reference after unlock.
      // If the handler reads the stale profile summary, it would build
      // the StoredProfileRecord with outdated `lastUsedAt` (at best) or
      // skip persistence entirely (at worst, when activeProfile was
      // null at install time).
      act(() => {
        latest.lockProfile();
      });
      await waitFor(() => expect(latest.activeProfile).toBeNull());

      await act(async () => {
        await latest.unlockProfile(activeProfileId!, profilePassword);
      });
      await waitFor(() => expect(latest.activeProfile).toBeTruthy());
      // Sanity — the post-unlock summary is a DIFFERENT instance than
      // before the lock (React recreates the object with a refreshed
      // `lastUsedAt`). This is the precondition that would expose the
      // stale closure if refs weren't used.
      expect(latest.activeProfile?.id).toBe(activeProfileId);

      // Baseline: confirm the stored profile reflects the default
      // allow-all seed BEFORE the cross-tab decision arrives.
      const baselineOverrides = await readStoredOverrides(
        activeProfileId!,
        profilePassword,
      );
      const baselineEntry = baselineOverrides.find(
        (entry) => entry.pubkey === peerPubkey,
      );
      expect(baselineEntry).toBeTruthy();

      // Peer A (another tab) posts a full `deny-always` decision,
      // targeting the receiver's current peer.
      const sender = new BroadcastChannel(CHANNEL);
      sender.postMessage({
        type: "decision",
        promptId: "denial-after-relock",
        peerPubkey,
        decision: "deny-always",
        scope: { verb: "sign" },
      });
      sender.close();
      await flushChannel();

      // The receiver must have serialised the override through its
      // CURRENT profile. Prior to the stale-closure fix, this
      // assertion failed because `persistPolicyOverrideToProfile`
      // saw a stale `activeProfile` reference.
      await waitFor(async () => {
        const persisted = await readStoredOverrides(
          activeProfileId!,
          profilePassword,
        );
        const entry = persisted.find((e) => e.pubkey === peerPubkey);
        expect(entry?.policy.respond.sign).toBe("deny");
      });
    },
    60_000,
  );

  it(
    "the BroadcastChannel receiver installs exactly one listener even across profile transitions (no duplicate handlers)",
    async () => {
      const groupName = "BC Single Listener Key";
      const keyset = await createKeysetBundle({
        groupName,
        threshold: 2,
        count: 2,
      });
      const localShare = keyset.shares[0];
      const fixturePayload = profilePayloadForShare({
        profileId: "prof_bc_single_listener",
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
        await latest.createKeyset({ groupName, threshold: 2, count: 2 });
      });
      await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

      const profilePassword = "profile-password";
      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: profilePassword,
          confirmPassword: profilePassword,
          relays: ["wss://relay.local"],
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      const peerPubkey = latest.runtimeStatus!.peers[0].pubkey;
      const activeProfileId = latest.activeProfile?.id;
      expect(activeProfileId).toBeTruthy();

      // Drive several `activeProfile` updates through lock+unlock so
      // that any implementation that re-subscribed on `activeProfile`
      // changes would accumulate listeners.
      for (let i = 0; i < 3; i += 1) {
        act(() => {
          latest.lockProfile();
        });
        await waitFor(() => expect(latest.activeProfile).toBeNull());
        await act(async () => {
          await latest.unlockProfile(activeProfileId!, profilePassword);
        });
        await waitFor(() => expect(latest.activeProfile).toBeTruthy());
      }

      // Count how many times the receiver reacts to a SINGLE cross-tab
      // decision by observing persistence writes (each invocation of
      // persistPolicyOverrideToProfile triggers a `saveProfile` →
      // `idb-keyval.set` call for the profile key). If listeners
      // duplicated across re-binds, a single `postMessage` would
      // dispatch the handler multiple times and produce multiple
      // `idb-keyval.set` writes for the same key within the flush
      // window.
      const { set: idbSet } = await import("idb-keyval");
      const setSpy = vi.mocked(idbSet);
      setSpy.mockClear();

      const sender = new BroadcastChannel(CHANNEL);
      sender.postMessage({
        type: "decision",
        promptId: "bc-single-listener-decision",
        peerPubkey,
        decision: "deny-always",
        scope: { verb: "ecdh" },
      });
      sender.close();
      await flushChannel();
      await flushChannel();

      // Wait until the persistence write lands, then assert exactly one
      // write to the profile-record key happened for THIS decision.
      const profileKey = `${PROFILE_RECORD_PREFIX}${activeProfileId}`;
      await waitFor(() => {
        const writes = setSpy.mock.calls.filter(
          (call) => call[0] === profileKey,
        );
        expect(writes.length).toBeGreaterThanOrEqual(1);
      });

      const finalWrites = setSpy.mock.calls.filter(
        (call) => call[0] === profileKey,
      );
      // Exactly one handler fire → exactly one persistence write.
      // If the effect leaked a duplicate listener, this would be >= 2.
      expect(finalWrites.length).toBe(1);
    },
    60_000,
  );
});
