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
  defaultManualPeerPolicyOverrides,
  profilePayloadForShare,
} from "../../lib/bifrost/packageService";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";

/**
 * VAL-APPROVALS-009 — rollback target for "Allow once" on lockProfile.
 *
 * Coverage: when a user selects "Allow once" and later locks the profile,
 * the AppStateProvider MUST roll each tracked override back via
 * `setPolicyOverride({ value: "deny" })` (NOT `"unset"`).
 *
 * Rationale: the underlying `MethodPolicy::default()` in
 * `bifrost-rs/crates/bifrost-core/src/types.rs` is permissive (every method
 * defaults to `true`). Resetting the override to `"unset"` therefore does
 * NOT reliably re-deny the next peer request — on unlock the same request
 * would be silently auto-allowed by the default policy and the user would
 * never see a fresh `peer_denied` event. Rolling back to an explicit
 * `"deny"` guarantees the rollback matches the pre-Allow-once state (the
 * signer had denied the request before the user chose Allow once) and
 * satisfies the VAL-APPROVALS-009 requirement that lock + unlock + re-emit
 * produces a fresh `peer_denied` event.
 *
 * The test uses the real `RuntimeClient` (via createKeyset + createProfile
 * bootstrap, same pattern as `broadcastPolicyDecision.test.tsx`) and spies
 * on `RuntimeClient.prototype.setPolicyOverride` to assert the rollback
 * dispatch shape.
 */

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

describe("lockProfile rolls back 'Allow once' overrides to explicit 'deny' (VAL-APPROVALS-009)", () => {
  it(
    "after resolvePeerDenial(allow-once) + lockProfile, setPolicyOverride is called with value: 'deny' for the tracked peer/verb",
    async () => {
      const setOverrideSpy = vi.spyOn(
        RuntimeClient.prototype,
        "setPolicyOverride",
      );

      const keyset = await createKeysetBundle({
        groupName: "Allow Once Rollback Key",
        threshold: 2,
        count: 2,
      });
      const localShare = keyset.shares[0];
      // Pre-warm payload binding (matches sibling tests).
      const payload = profilePayloadForShare({
        profileId: "prof_allow_once_rollback",
        deviceName: "Igloo Web",
        share: localShare,
        group: keyset.group,
        relays: [],
        manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
          keyset.group,
          localShare.idx,
        ),
      });
      expect(payload).toBeTruthy();

      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.createKeyset({
          groupName: "Allow Once Rollback Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latest.createSession?.keyset).toBeTruthy(),
      );

      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: "profile-password",
          confirmPassword: "profile-password",
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      const remotePeer = latest.runtimeStatus!.peers[0];
      expect(remotePeer?.pubkey).toBeTruthy();
      const peerPubkey = remotePeer!.pubkey;

      // Enqueue a synthetic peer_denied event and resolve with allow-once.
      act(() => {
        latest.enqueuePeerDenial({
          id: "denial-allow-once-rollback",
          peer_pubkey: peerPubkey,
          verb: "sign",
          denied_at: Date.now(),
        });
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(1));

      await act(async () => {
        await latest.resolvePeerDenial(
          "denial-allow-once-rollback",
          { action: "allow-once" },
        );
      });
      await waitFor(() => expect(latest.peerDenialQueue.length).toBe(0));

      // Sanity: the allow-once dispatch set value=allow.
      const allowCall = setOverrideSpy.mock.calls.find(
        (call) =>
          (call[0] as { peer?: string }).peer === peerPubkey &&
          (call[0] as { method?: string }).method === "sign" &&
          (call[0] as { value?: string }).value === "allow",
      );
      expect(allowCall).toBeTruthy();

      // Now lock the profile — this MUST roll the allow-once override
      // back to explicit 'deny' so the underlying default-permissive
      // policy doesn't auto-allow on unlock.
      setOverrideSpy.mockClear();
      act(() => {
        latest.lockProfile();
      });

      // Exactly one rollback setPolicyOverride call for the tracked
      // peer/verb, and its value MUST be 'deny' (not 'unset').
      const rollbackCall = setOverrideSpy.mock.calls.find(
        (call) =>
          (call[0] as { peer?: string }).peer === peerPubkey &&
          (call[0] as { direction?: string }).direction === "respond" &&
          (call[0] as { method?: string }).method === "sign",
      );
      expect(rollbackCall).toBeTruthy();
      expect(rollbackCall![0]).toEqual({
        peer: peerPubkey,
        direction: "respond",
        method: "sign",
        value: "deny",
      });
    },
    30_000,
  );
});
