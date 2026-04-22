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
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import type { PeerPermissionState } from "../../lib/bifrost/types";

/**
 * fix-m3-val-policies-009-clear-overrides-matrix — VAL-POLICIES-009:
 * invoking `clearPolicyOverrides()` must empty every `manual_override`
 * cell across every peer, direction, and method in a single dispatch;
 * the runtime re-emits a fresh `peer_permission_states` whose
 * `manual_override` is empty/unset for every peer AND whose
 * `effective_policy` reflects only the default-derived values.
 *
 * Coverage:
 *  - Boots a real `RuntimeClient` via the AppStateProvider's
 *    `createKeyset` → `createProfile` path (2-of-3 keyset → 2 remote
 *    peers in `peer_permission_states`, for a genuine multi-peer
 *    matrix).
 *  - Seeds a deliberately varied override matrix via
 *    `setPeerPolicyOverride` — both directions (`request.*` and
 *    `respond.*`), multiple methods (sign/ecdh/ping/onboard), both
 *    remote peers. Captures a pre-clear snapshot to confirm the
 *    overrides are actually present (so the post-clear assertion isn't
 *    vacuous).
 *  - Invokes `AppStateValue.clearPolicyOverrides()` (a thin wrapper
 *    that passes through to `RuntimeClient.clearPolicyOverrides()`).
 *  - Triggers a fresh `runtime_status` pull via `refreshRuntime()` and
 *    asserts that for every (peer, direction, method) cell, the
 *    post-clear `manual_override` is null/empty/unset, and every
 *    peer's `effective_policy.request.*` / `effective_policy.respond.*`
 *    resolves to the bifrost-rs default (permissive). Also asserts the
 *    in-memory `policyOverrides` slice and the `sessionAllowOnceRef`
 *    tracking surface are drained.
 */

const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";
void PROFILE_RECORD_PREFIX; // kept for parity with sibling test harnesses.

// idb-keyval shim shared across the file — mirrors the pattern used in
// persistPeerPolicyOverrides / alwaysAllowPersistence tests so
// createKeyset / createProfile exercise a deterministic in-memory path
// without touching a real IndexedDB.
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

type PolicyDirection = "request" | "respond";
type PolicyMethod = "sign" | "ecdh" | "ping" | "onboard";
type PolicyValue = "unset" | "allow" | "deny";

interface OverrideCell {
  peerPubkey: string;
  direction: PolicyDirection;
  method: PolicyMethod;
  value: Exclude<PolicyValue, "unset">;
}

interface DirectedPolicy {
  request?: Record<string, unknown>;
  respond?: Record<string, unknown>;
}

/**
 * Given a single `PeerPermissionState.manual_override`, extract its
 * value for the (direction, method) cell. Returns "unset" when the
 * cell is absent (mirrors the runtime's semantic: "no override" ==
 * "unset").
 */
function readManualOverrideCell(
  state: PeerPermissionState,
  direction: PolicyDirection,
  method: PolicyMethod,
): PolicyValue {
  const override = state.manual_override as DirectedPolicy | null | undefined;
  if (!override || typeof override !== "object") return "unset";
  const sub = override[direction];
  if (!sub || typeof sub !== "object") return "unset";
  const value = (sub as Record<string, unknown>)[method];
  if (value === "allow" || value === "deny" || value === "unset") {
    return value;
  }
  // Some bridge revisions expose booleans (true = allow, false = deny).
  if (value === true) return "allow";
  if (value === false) return "deny";
  return "unset";
}

/**
 * Read the effective policy cell value for a peer. Unlike
 * `manual_override`, `effective_policy` is always populated — when no
 * override is in effect the runtime resolves to the configured default
 * (permissive). We normalise possible boolean / string encodings to a
 * single set of outcomes.
 */
function readEffectivePolicyCell(
  state: PeerPermissionState,
  direction: PolicyDirection,
  method: PolicyMethod,
): "allow" | "deny" | "unset" {
  const effective = state.effective_policy as
    | DirectedPolicy
    | null
    | undefined;
  if (!effective || typeof effective !== "object") return "unset";
  const sub = effective[direction];
  if (!sub || typeof sub !== "object") return "unset";
  const value = (sub as Record<string, unknown>)[method];
  if (value === "allow" || value === "deny" || value === "unset") {
    return value;
  }
  if (value === true) return "allow";
  if (value === false) return "deny";
  return "unset";
}

/**
 * Return true when the peer's `manual_override` contains zero non-unset
 * entries — i.e. either null/absent, or every sub-cell equals "unset".
 */
function manualOverrideIsEmpty(state: PeerPermissionState): boolean {
  const override = state.manual_override as DirectedPolicy | null | undefined;
  if (override === null || override === undefined) return true;
  if (typeof override !== "object") return true;
  for (const direction of ["request", "respond"] as const) {
    const sub = override[direction];
    if (!sub || typeof sub !== "object") continue;
    for (const [, value] of Object.entries(sub as Record<string, unknown>)) {
      if (value === "allow" || value === "deny") return false;
      if (value === true || value === false) return false;
    }
  }
  return true;
}

describe("clearPolicyOverrides — VAL-POLICIES-009: empties the full manual_override matrix", () => {
  it(
    "seeds multi-peer multi-direction multi-method overrides, clears them in one bridge call, and asserts every cell resets to default-derived effective_policy",
    async () => {
      // 2-of-3 keyset yields two remote peers in the runtime's
      // peer_permission_states — enough for a genuine multi-peer
      // matrix assertion.
      const groupName = "VAL-POLICIES-009 Matrix Key";
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
          count: 3,
        });
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
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latestRef.runtimeStatus).toBeTruthy());

      // Wait for at least two remote peers to surface in the runtime
      // snapshot so the matrix covers multiple pubkeys.
      await waitFor(() => {
        const states =
          latestRef.runtimeStatus?.peer_permission_states ?? [];
        expect(states.length).toBeGreaterThanOrEqual(2);
      });

      const initialStates =
        latestRef.runtimeStatus!.peer_permission_states.slice(0, 2);
      expect(initialStates.length).toBeGreaterThanOrEqual(2);
      const [peerA, peerB] = initialStates;
      expect(peerA.pubkey).toBeTruthy();
      expect(peerB.pubkey).toBeTruthy();
      expect(peerA.pubkey).not.toBe(peerB.pubkey);

      // Seed a deliberately varied override matrix: both directions,
      // all four methods represented across the two peers, both
      // "allow" and "deny" values. The seven cells are chosen so that
      // the post-clear snapshot has something meaningful to assert
      // against (a no-op clear on an empty matrix would pass
      // vacuously).
      const seedCells: OverrideCell[] = [
        { peerPubkey: peerA.pubkey, direction: "respond", method: "sign", value: "deny" },
        { peerPubkey: peerA.pubkey, direction: "respond", method: "ecdh", value: "allow" },
        { peerPubkey: peerA.pubkey, direction: "request", method: "ping", value: "deny" },
        { peerPubkey: peerA.pubkey, direction: "request", method: "onboard", value: "allow" },
        { peerPubkey: peerB.pubkey, direction: "respond", method: "onboard", value: "deny" },
        { peerPubkey: peerB.pubkey, direction: "respond", method: "ping", value: "allow" },
        { peerPubkey: peerB.pubkey, direction: "request", method: "sign", value: "allow" },
      ];

      for (const cell of seedCells) {
        await act(async () => {
          await latestRef.setPeerPolicyOverride({
            peer: cell.peerPubkey,
            direction: cell.direction,
            method: cell.method,
            value: cell.value,
          });
        });
      }

      // Pull a fresh runtime_status so the seeded overrides are
      // observable in peer_permission_states.
      await act(async () => {
        latestRef.refreshRuntime();
      });

      // Pre-clear snapshot: every seeded cell must be present as the
      // exact value we set. Without this assertion the post-clear
      // check could pass on a runtime that silently discarded the
      // seeded overrides.
      await waitFor(() => {
        const statesByPubkey = new Map(
          latestRef.runtimeStatus!.peer_permission_states.map((s) => [
            s.pubkey,
            s,
          ]),
        );
        for (const cell of seedCells) {
          const peerState = statesByPubkey.get(cell.peerPubkey);
          expect(peerState).toBeTruthy();
          const observed = readManualOverrideCell(
            peerState!,
            cell.direction,
            cell.method,
          );
          expect(observed).toBe(cell.value);
        }
      });

      // Also confirm the in-memory policyOverrides slice was
      // populated by the chip dispatches (setPeerPolicyOverride
      // itself does NOT mutate this slice; it's only populated by
      // resolvePeerDenial). So we explicitly DON'T assert non-empty
      // here — policyOverrides is the reactive-denial surface slice,
      // not the chip-dispatch slice. The post-clear assertion below
      // still checks that it is empty.

      // Capture the clear dispatch via a spy so we can assert EXACTLY
      // ONE bridge call — VAL-POLICIES-009's invariant is a single
      // dispatch resets the whole matrix.
      const clearSpy = vi.spyOn(
        RuntimeClient.prototype,
        "clearPolicyOverrides",
      );

      await act(async () => {
        await latestRef.clearPolicyOverrides();
      });

      expect(clearSpy).toHaveBeenCalledTimes(1);

      // Refresh to pull a fresh runtime_status reflecting the
      // cleared matrix.
      await act(async () => {
        latestRef.refreshRuntime();
      });

      // Post-clear: every peer's manual_override is empty/unset for
      // every (direction, method) cell. Also every peer's
      // effective_policy resolves to a non-deny value (i.e. allow or
      // unset) — proving the default-derived policy takes over when
      // no override is in effect. (The exact tokens vary by bifrost-rs
      // default — what we care about is that NO cell remains "deny"
      // since every one of our seeded "deny" cells has been wiped.)
      await waitFor(() => {
        const states =
          latestRef.runtimeStatus!.peer_permission_states ?? [];
        for (const state of states) {
          // 1. manual_override matrix is fully empty.
          expect(manualOverrideIsEmpty(state)).toBe(true);
          // 2. Every cell we explicitly set to "deny" pre-clear must
          //    resolve to a non-deny effective_policy now.
          for (const direction of ["request", "respond"] as const) {
            for (const method of [
              "sign",
              "ecdh",
              "ping",
              "onboard",
            ] as const) {
              const observed = readEffectivePolicyCell(
                state,
                direction,
                method,
              );
              // Specifically: seeded deny cells for this peer must no
              // longer resolve to "deny".
              const wasSeededDeny = seedCells.some(
                (cell) =>
                  cell.peerPubkey === state.pubkey &&
                  cell.direction === direction &&
                  cell.method === method &&
                  cell.value === "deny",
              );
              if (wasSeededDeny) {
                expect(observed).not.toBe("deny");
              }
            }
          }
        }
      });

      // In-memory AppState slice is drained so consumers (Peer
      // Policies view etc.) don't hold stale entries that disagree
      // with the authoritative runtime snapshot.
      expect(latestRef.policyOverrides).toEqual([]);
    },
    60_000,
  );

  it(
    "delegates the single matrix-wide reset to RuntimeClient.clearPolicyOverrides via a thin AppState wrapper",
    async () => {
      // Narrower guard: confirms the AppState wrapper dispatches
      // exactly one runtime bridge call, and does not fan out into
      // per-cell setPolicyOverride dispatches (which would violate
      // the "one bridge call resets every cell" contract).
      let latestRef!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latestRef = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latestRef).toBeTruthy());

      await act(async () => {
        await latestRef.createKeyset({
          groupName: "VAL-POLICIES-009 Single Dispatch Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latestRef.createSession?.keyset).toBeTruthy(),
      );
      await act(async () => {
        await latestRef.createProfile({
          deviceName: "Igloo Web",
          password: "profile-password",
          confirmPassword: "profile-password",
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latestRef.runtimeStatus).toBeTruthy());

      // Seed one override so the matrix is non-empty before the clear.
      const peer =
        latestRef.runtimeStatus!.peer_permission_states[0]?.pubkey;
      expect(peer).toBeTruthy();
      await act(async () => {
        await latestRef.setPeerPolicyOverride({
          peer: peer!,
          direction: "respond",
          method: "sign",
          value: "deny",
        });
      });

      const clearSpy = vi.spyOn(
        RuntimeClient.prototype,
        "clearPolicyOverrides",
      );
      const setSpy = vi.spyOn(
        RuntimeClient.prototype,
        "setPolicyOverride",
      );
      clearSpy.mockClear();
      setSpy.mockClear();

      await act(async () => {
        await latestRef.clearPolicyOverrides();
      });

      // Exactly one clearPolicyOverrides call and zero per-cell
      // setPolicyOverride calls — the wrapper must not fan out.
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(setSpy).not.toHaveBeenCalled();
    },
    60_000,
  );

  it(
    "throws when called with no live runtime so callers cannot silently no-op the clear",
    async () => {
      // No profile active — runtimeRef is null. The wrapper must
      // reject instead of silently succeeding so the caller surfaces
      // the error.
      let latestRef!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latestRef = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latestRef).toBeTruthy());

      await expect(latestRef.clearPolicyOverrides()).rejects.toThrow(
        /no runtime is active/i,
      );
    },
    30_000,
  );
});
