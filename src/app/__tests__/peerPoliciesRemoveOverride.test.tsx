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
 * fix-m2-peer-policies-view-persistence-and-remove — the Peer Policies
 * view must surface persistent "Always allow" / "Always deny" overrides
 * with a persistence indicator and a Remove control. Clicking Remove
 * must (a) clear the in-memory runtime override by dispatching
 * setPolicyOverride({..., value: "unset"}) AND (b) clear the
 * corresponding entry from the stored profile's
 * `manual_peer_policy_overrides` through the existing persistence
 * helper, atomically.
 *
 * Coverage:
 *  - After resolvePeerDenial('allow-always'), AppState exposes a
 *    persistent policyOverrides entry for (peer, respond, <verb>) →
 *    used by the Peer Policies view to render a "Persistent" chip +
 *    Remove action.
 *  - removePolicyOverride({peer, direction, method}) clears the
 *    corresponding cell from the stored profile's
 *    manual_peer_policy_overrides (cell value becomes "unset").
 *  - removePolicyOverride dispatches setPolicyOverride(value: "unset")
 *    against the live RuntimeClient.
 *  - After remove the in-memory policyOverrides list no longer contains
 *    the entry.
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

async function bootProfileAndTriggerAllowAlways(): Promise<{
  latest: () => AppStateValue;
  peerPubkey: string;
  profileId: string;
  profilePassword: string;
}> {
  const groupName = "Peer Policies Remove Key";
  const keyset = await createKeysetBundle({
    groupName,
    threshold: 2,
    count: 2,
  });
  const localShare = keyset.shares[0];
  // Baseline sanity check that the seeded payload can be built.
  const fixturePayload = profilePayloadForShare({
    profileId: "prof_peer_policies_remove",
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

  let latestRef!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latestRef = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latestRef).toBeTruthy());

  await act(async () => {
    await latestRef.createKeyset({
      groupName,
      threshold: 2,
      count: 2,
    });
  });
  await waitFor(() => expect(latestRef.createSession?.keyset).toBeTruthy());

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

  const peer = latestRef.runtimeStatus!.peers[0];
  expect(peer?.pubkey).toBeTruthy();
  const peerPubkey = peer!.pubkey;
  const profileId = latestRef.activeProfile!.id;

  // Trigger a peer_denied event and resolve with allow-always so the
  // persistent override is written to the profile AND reflected in the
  // provider's in-memory policyOverrides slice.
  act(() => {
    latestRef.enqueuePeerDenial({
      id: "denial-peer-policies-remove",
      peer_pubkey: peerPubkey,
      verb: "sign",
      denied_at: Date.now(),
    });
  });
  await waitFor(() => expect(latestRef.peerDenialQueue.length).toBe(1));
  await act(async () => {
    await latestRef.resolvePeerDenial("denial-peer-policies-remove", {
      action: "allow-always",
    });
  });
  await waitFor(() => expect(latestRef.peerDenialQueue.length).toBe(0));

  return {
    latest: () => latestRef,
    peerPubkey,
    profileId,
    profilePassword,
  };
}

describe("fix-m2-peer-policies-view-persistence-and-remove — Peer Policies view", () => {
  it(
    "exposes the persistent override as policyOverrides after allow-always so Peer Policies can render a Persistent row",
    async () => {
      const { latest, peerPubkey } =
        await bootProfileAndTriggerAllowAlways();
      const state = latest();
      const entry = state.policyOverrides.find(
        (e) =>
          e.peer === peerPubkey &&
          e.direction === "respond" &&
          e.method === "sign",
      );
      expect(entry).toBeTruthy();
      expect(entry!.source).toBe("persistent");
      expect(entry!.value).toBe("allow");
    },
    60_000,
  );

  it(
    "removePolicyOverride clears the corresponding entry from the stored profile's manual_peer_policy_overrides (cell becomes 'unset')",
    async () => {
      const { latest, peerPubkey, profileId, profilePassword } =
        await bootProfileAndTriggerAllowAlways();

      // Sanity: pre-remove, the stored profile reports respond.sign="allow"
      // (written by persistPolicyOverrideToProfile).
      const preRemove = await readStoredOverrides(profileId, profilePassword);
      const preEntry = preRemove.find((e) => e.pubkey === peerPubkey);
      expect(preEntry?.policy.respond.sign).toBe("allow");

      await act(async () => {
        await latest().removePolicyOverride({
          peer: peerPubkey,
          direction: "respond",
          method: "sign",
        });
      });

      // Post-remove: the stored cell is re-serialised as "unset" —
      // distinguishable from the seeded default "allow" AND from the
      // pre-remove "allow"-by-user-choice.
      const postRemove = await readStoredOverrides(
        profileId,
        profilePassword,
      );
      const postEntry = postRemove.find((e) => e.pubkey === peerPubkey);
      expect(postEntry?.policy.respond.sign).toBe("unset");
    },
    60_000,
  );

  it(
    "removePolicyOverride dispatches setPolicyOverride({value: 'unset'}) against the live runtime",
    async () => {
      const { latest, peerPubkey } =
        await bootProfileAndTriggerAllowAlways();

      const setOverrideSpy = vi.spyOn(
        RuntimeClient.prototype,
        "setPolicyOverride",
      );
      setOverrideSpy.mockClear();

      await act(async () => {
        await latest().removePolicyOverride({
          peer: peerPubkey,
          direction: "respond",
          method: "sign",
        });
      });

      const unsetCall = setOverrideSpy.mock.calls.find(
        (call) =>
          (call[0] as { peer?: string }).peer === peerPubkey &&
          (call[0] as { direction?: string }).direction === "respond" &&
          (call[0] as { method?: string }).method === "sign" &&
          (call[0] as { value?: string }).value === "unset",
      );
      expect(unsetCall).toBeTruthy();
    },
    60_000,
  );

  it(
    "removing the override drops the entry from AppState.policyOverrides so the Peer Policies row disappears",
    async () => {
      const { latest, peerPubkey } =
        await bootProfileAndTriggerAllowAlways();

      expect(
        latest().policyOverrides.some(
          (e) =>
            e.peer === peerPubkey &&
            e.direction === "respond" &&
            e.method === "sign",
        ),
      ).toBe(true);

      await act(async () => {
        await latest().removePolicyOverride({
          peer: peerPubkey,
          direction: "respond",
          method: "sign",
        });
      });

      await waitFor(() => {
        expect(
          latest().policyOverrides.some(
            (e) =>
              e.peer === peerPubkey &&
              e.direction === "respond" &&
              e.method === "sign",
          ),
        ).toBe(false);
      });
    },
    60_000,
  );
});
