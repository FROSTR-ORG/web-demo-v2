import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";
import { memberPubkeyXOnly } from "../../lib/bifrost/format";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import type {
  CompletedOperation,
  GroupPackageWire,
  OperationFailure,
  SharePackageWire,
} from "../../lib/bifrost/types";

/**
 * fix-followup-distribute-per-share-onboard-dispatch-and-echo-wire —
 * behaviour contract for the per-share onboard-dispatch + echo
 * correlation wired into `encodeDistributionPackage(idx, password)`
 * and `AppStateProvider.absorbDrains`.
 *
 * Coverage:
 *   1. `encodeDistributionPackage` atomically (a) encrypts the
 *      bfonboard package with the typed password, (b) dispatches
 *      `handleRuntimeCommand({type: 'onboard', peer_pubkey32_hex})`
 *      exactly once targeting the share's group member, and (c)
 *      stashes the returned requestId on
 *      `onboardingPackages[idx].pendingDispatchRequestId`.
 *   2. Zero onboard dispatches fire before any per-share click
 *      (`createProfile` no longer eager-dispatches onboards).
 *   3. `absorbDrains` correlates `CompletedOperation::Onboard { request_id }`
 *      against every active share's `pendingDispatchRequestId`; the
 *      matching share's `peerOnline` flips to true (so
 *      `packageDistributed(pkg)` auto-advances the Distribute-screen
 *      chip to "Distributed" without a manual click).
 *   4. `absorbDrains` correlates
 *      `OperationFailure { request_id, op_type: "onboard" }` to the
 *      matching share and surfaces the canonical inline retry copy
 *      on `adoptionError`.
 *   5. Non-onboard completions / failures (Sign / Ecdh / Ping) do
 *      NOT mutate any share's `peerOnline` / `adoptionError`.
 *
 * The suite talks to the real {@link AppStateProvider}; it uses the
 * DEV-only `__iglooTestAbsorbDrains` hook so drain batches can be
 * simulated without standing up a full RuntimeRelayPump.
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

function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

async function renderProvider() {
  let latest!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latest = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latest).toBeTruthy());
  return () => latest;
}

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  cleanup();
  storage.clear();
});

async function prepareActiveCreateSession(
  getState: () => AppStateValue,
  opts: { groupName?: string; threshold?: number; count?: number } = {},
): Promise<{
  group: GroupPackageWire;
  localShare: SharePackageWire;
  remoteShares: SharePackageWire[];
}> {
  await act(async () => {
    await getState().createKeyset({
      groupName: opts.groupName ?? "Onboard Dispatch Test Key",
      threshold: opts.threshold ?? 2,
      count: opts.count ?? 2,
    });
  });
  await waitFor(() =>
    expect(getState().createSession?.keyset?.group.group_name).toBeTruthy(),
  );
  const session = getState().createSession!;
  const group = session.keyset!.group;
  const localShare = session.localShare!;
  const remoteShares = session.keyset!.shares.filter(
    (share) => share.idx !== localShare.idx,
  );

  await act(async () => {
    await getState().createProfile({
      deviceName: "Onboard Dispatch Device",
      password: "profile-password-1234",
      confirmPassword: "profile-password-1234",
      relays: ["wss://relay.example.test"],
    });
  });
  await waitFor(() => expect(getState().runtimeStatus).toBeTruthy());
  await waitFor(() =>
    expect(
      getState().createSession?.onboardingPackages?.length ?? 0,
    ).toBeGreaterThan(0),
  );
  return {
    group,
    localShare: { idx: localShare.idx, seckey: localShare.seckey },
    remoteShares: remoteShares.map((share) => ({
      idx: share.idx,
      seckey: share.seckey,
    })),
  };
}

type AbsorbDrainsHook = (drains: {
  completions: CompletedOperation[];
  failures: OperationFailure[];
  events: [];
}) => void;

function useAbsorbDrainsHook(): AbsorbDrainsHook {
  const hook = (
    window as typeof window & {
      __iglooTestAbsorbDrains?: AbsorbDrainsHook;
    }
  ).__iglooTestAbsorbDrains;
  if (typeof hook !== "function") {
    throw new Error(
      "__iglooTestAbsorbDrains hook is not installed — AppStateProvider DEV hook missing.",
    );
  }
  return hook;
}

describe("encodeDistributionPackage — onboard dispatch (fix-followup-distribute-per-share-onboard-dispatch-and-echo-wire)", () => {
  it(
    "dispatches handleRuntimeCommand({type:'onboard', peer_pubkey32_hex}) exactly once per click and stashes the returned requestId on the share (VAL-FOLLOWUP)",
    async () => {
      const getState = await renderProvider();
      const { group, remoteShares } = await prepareActiveCreateSession(
        getState,
      );
      expect(remoteShares.length).toBeGreaterThan(0);

      const dispatchSpy = vi.fn(getState().handleRuntimeCommand);
      // Swap in the spy on the value object AND on the provider-held
      // reference so the internal `dispatchRuntimeCommandRef.current`
      // (re-assigned each render) routes through the spy. The spy
      // delegates to the real implementation so the underlying runtime
      // still registers a pending_operation.
      const originalHandle = getState().handleRuntimeCommand;
      const wrapped: AppStateValue["handleRuntimeCommand"] = async (cmd) =>
        originalHandle(cmd);
      const spy = vi.fn(wrapped);
      // Install as the primary dispatcher via value surface replacement:
      // tests that need to observe the dispatched command spy on the
      // underlying runtime.handleCommand instead. Here we verify the
      // observable outcomes on `runtimeStatus.pending_operations` +
      // the session's `pendingDispatchRequestId`.
      void dispatchSpy;
      void spy;

      // Zero onboard pending ops before any per-share click.
      const preClickOnboardOps =
        getState().runtimeStatus!.pending_operations.filter(
          (op) => op.op_type === "Onboard",
        );
      expect(preClickOnboardOps).toHaveLength(0);

      const shareIdx = remoteShares[0].idx;
      const expectedPeerPubkey32 = memberPubkeyXOnly(
        group.members.find((member) => member.idx === shareIdx)!,
      );

      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });

      const pkg = getState().createSession!.onboardingPackages.find(
        (candidate) => candidate.idx === shareIdx,
      );
      expect(pkg).toBeTruthy();
      expect(pkg!.packageCreated).toBe(true);
      expect(pkg!.packageText.startsWith("bfonboard1")).toBe(true);
      expect(pkg!.password).toBe("[redacted]");
      // The onboard dispatch requestId is stashed on the share view.
      expect(pkg!.pendingDispatchRequestId).toBeTruthy();
      expect(typeof pkg!.pendingDispatchRequestId).toBe("string");

      // The runtime's pending_operations gained exactly one Onboard
      // entry whose request_id matches the stash and whose target
      // peers contain the share's member x-only pubkey.
      const onboardOps =
        getState().runtimeStatus!.pending_operations.filter(
          (op) => op.op_type === "Onboard",
        );
      expect(onboardOps).toHaveLength(1);
      expect(onboardOps[0].request_id).toBe(pkg!.pendingDispatchRequestId);
      expect(onboardOps[0].target_peers.map((peer) => peer.toLowerCase())).toContain(
        expectedPeerPubkey32.toLowerCase(),
      );
    },
    30_000,
  );

  it(
    "two per-share clicks produce two distinct pending Onboard requestIds",
    async () => {
      const getState = await renderProvider();
      const { remoteShares } = await prepareActiveCreateSession(
        getState,
        { count: 3 },
      );
      expect(remoteShares.length).toBeGreaterThanOrEqual(2);

      await act(async () => {
        await getState().encodeDistributionPackage(
          remoteShares[0].idx,
          "per-share-password-aaa",
        );
      });
      await act(async () => {
        await getState().encodeDistributionPackage(
          remoteShares[1].idx,
          "per-share-password-bbb",
        );
      });

      const packages = getState().createSession!.onboardingPackages;
      const first = packages.find((p) => p.idx === remoteShares[0].idx)!;
      const second = packages.find((p) => p.idx === remoteShares[1].idx)!;
      expect(first.pendingDispatchRequestId).toBeTruthy();
      expect(second.pendingDispatchRequestId).toBeTruthy();
      expect(first.pendingDispatchRequestId).not.toBe(
        second.pendingDispatchRequestId,
      );

      const onboardOps =
        getState().runtimeStatus!.pending_operations.filter(
          (op) => op.op_type === "Onboard",
        );
      expect(onboardOps).toHaveLength(2);
      const ids = onboardOps.map((op) => op.request_id);
      expect(new Set(ids).size).toBe(2);
      expect(ids).toContain(first.pendingDispatchRequestId);
      expect(ids).toContain(second.pendingDispatchRequestId);
    },
    30_000,
  );

  it(
    "no onboard dispatch fires during createProfile — only per-share encodeDistributionPackage clicks dispatch",
    async () => {
      const getState = await renderProvider();
      await prepareActiveCreateSession(getState);
      const onboardOps =
        getState().runtimeStatus!.pending_operations.filter(
          (op) => op.op_type === "Onboard",
        );
      expect(onboardOps).toHaveLength(0);
      const packages = getState().createSession!.onboardingPackages;
      for (const pkg of packages) {
        expect(pkg.pendingDispatchRequestId).toBeUndefined();
      }
    },
    30_000,
  );

  // fix-scrutiny-r1-onboard-dispatch-requestid-hygiene-and-real-onboard-e2e
  // — requestId hygiene (scrutiny r1 blocker #2). A retry click whose
  // dispatch throws must (a) clear any prior
  // `pendingDispatchRequestId` so subsequent
  // `CompletedOperation::Onboard` drains correlated to the OLD id
  // cannot falsely flip `peerOnline`, and (b) leave the share's
  // `pendingDispatchRequestId` explicitly `undefined` (not a stale
  // fallback), while surfacing the dispatch error inline as
  // `adoptionError`.
  it(
    "clears stale pendingDispatchRequestId on retry click and does not store a requestId when the dispatch itself throws",
    async () => {
      const getState = await renderProvider();
      const { remoteShares } = await prepareActiveCreateSession(getState);
      const shareIdx = remoteShares[0].idx;

      // First click — successful dispatch stashes a real requestId.
      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });
      const firstRequestId = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!.pendingDispatchRequestId;
      expect(typeof firstRequestId).toBe("string");
      expect(firstRequestId!.length).toBeGreaterThan(0);

      // `handleRuntimeCommand` debounces identical commands within a
      // 300ms window (shared debounce across all onboard dispatches).
      // Wait past the debounce before the retry so the simulated
      // throw reliably reaches the underlying `runtime.handleCommand`.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });

      // Retry click — force `RuntimeClient.handleCommand` to throw so
      // that `handleRuntimeCommand` propagates the error out of the
      // inner dispatch call. `encodeDistributionPackage` must catch
      // the throw, leave `pendingDispatchRequestId` explicitly
      // undefined (no stale fallback to the prior id), and surface
      // the dispatch error inline via `adoptionError`.
      const dispatchThrowMessage = "simulated runtime dispatch failure";
      const handleCommandSpy = vi
        .spyOn(RuntimeClient.prototype, "handleCommand")
        .mockImplementationOnce(() => {
          throw new Error(dispatchThrowMessage);
        });
      try {
        await act(async () => {
          // encodeDistributionPackage itself must NOT throw — the
          // mutator catches the dispatch error and surfaces it inline.
          await getState().encodeDistributionPackage(
            shareIdx,
            "per-share-password-retry",
          );
        });
      } finally {
        handleCommandSpy.mockRestore();
      }

      const pkgAfter = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      // Package text was still encoded and the chip still flipped to
      // `packageCreated: true` so the user can still hand the package
      // off manually.
      expect(pkgAfter.packageCreated).toBe(true);
      expect(pkgAfter.packageText.startsWith("bfonboard1")).toBe(true);
      // pendingDispatchRequestId is explicitly undefined — NOT a
      // stale fallback to `firstRequestId`. This prevents a drained
      // CompletedOperation::Onboard for the old id from falsely
      // flipping peerOnline on a retry whose dispatch failed.
      expect(pkgAfter.pendingDispatchRequestId).toBeUndefined();
      expect(pkgAfter.pendingDispatchRequestId).not.toBe(firstRequestId);
      // adoptionError surfaces the dispatch-throw message so the user
      // sees the failure inline on the Distribute card.
      expect(pkgAfter.adoptionError).toBeTruthy();
      expect(pkgAfter.adoptionError).toContain(dispatchThrowMessage);
      // peerOnline stays false — a stale echo for the first dispatch
      // must not flip it, and in-flight `runtimeStatus.pending_operations`
      // for the first requestId (if any) can no longer correlate
      // through the share (pendingDispatchRequestId is cleared).
      expect(pkgAfter.peerOnline).toBe(false);
    },
    30_000,
  );
});

describe("absorbDrains — onboard echo correlation (fix-followup-distribute-per-share-onboard-dispatch-and-echo-wire)", () => {
  it(
    "flips peerOnline=true on the matching share when CompletedOperation::Onboard matches pendingDispatchRequestId",
    async () => {
      const getState = await renderProvider();
      const { group, remoteShares } = await prepareActiveCreateSession(
        getState,
      );
      const shareIdx = remoteShares[0].idx;
      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });
      const requestId = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!.pendingDispatchRequestId!;
      expect(requestId).toBeTruthy();

      const absorb = useAbsorbDrainsHook();
      await act(async () => {
        absorb({
          completions: [
            {
              Onboard: {
                request_id: requestId,
                group_member_count: group.members.length,
                group,
                nonces: [],
              },
            } as CompletedOperation,
          ],
          failures: [],
          events: [],
        });
      });

      const pkgAfter = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(pkgAfter.peerOnline).toBe(true);
      expect(pkgAfter.adoptionError).toBeUndefined();
    },
    30_000,
  );

  it(
    "surfaces the canonical inline retry copy on the matching share when OperationFailure { op_type: 'onboard' } matches pendingDispatchRequestId",
    async () => {
      const getState = await renderProvider();
      const { remoteShares } = await prepareActiveCreateSession(getState);
      const shareIdx = remoteShares[0].idx;
      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });
      const requestId = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!.pendingDispatchRequestId!;
      expect(requestId).toBeTruthy();

      const absorb = useAbsorbDrainsHook();
      await act(async () => {
        absorb({
          completions: [],
          failures: [
            {
              request_id: requestId,
              op_type: "onboard",
              code: "peer_rejected",
              message: "requester aborted",
              failed_peer: null,
            },
          ],
          events: [],
        });
      });

      const pkgAfter = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(pkgAfter.adoptionError).toBe(
        "Peer adoption failed — retry or mark distributed manually",
      );
      // peerOnline stays false — the failure did NOT falsely flip it.
      expect(pkgAfter.peerOnline).toBe(false);
      // packageCreated stays true so Mark distributed remains enabled.
      expect(pkgAfter.packageCreated).toBe(true);
    },
    30_000,
  );

  it(
    "retryDistributionPackageAdoption replaces the failed request id without re-encoding package state",
    async () => {
      const getState = await renderProvider();
      const { remoteShares } = await prepareActiveCreateSession(getState);
      const shareIdx = remoteShares[0].idx;
      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });
      const beforeFailure = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      const oldRequestId = beforeFailure.pendingDispatchRequestId!;
      const packagePreview = beforeFailure.packageText;
      expect(oldRequestId).toBeTruthy();

      const absorb = useAbsorbDrainsHook();
      await act(async () => {
        absorb({
          completions: [],
          failures: [
            {
              request_id: oldRequestId,
              op_type: "onboard",
              code: "timeout",
              message: "request timed out",
              failed_peer: null,
            },
          ],
          events: [],
        });
      });
      expect(
        getState().createSession!.onboardingPackages.find(
          (p) => p.idx === shareIdx,
        )!.adoptionError,
      ).toBe("Peer adoption failed — retry or mark distributed manually");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });
      await act(async () => {
        await getState().retryDistributionPackageAdoption(shareIdx);
      });

      const afterRetry = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(afterRetry.packageText).toBe(packagePreview);
      expect(afterRetry.password).toBe("[redacted]");
      expect(afterRetry.pendingDispatchRequestId).toBeTruthy();
      expect(afterRetry.pendingDispatchRequestId).not.toBe(oldRequestId);
      expect(afterRetry.adoptionError).toBeUndefined();

      await act(async () => {
        absorb({
          completions: [
            {
              Onboard: {
                request_id: oldRequestId,
                group_member_count: 2,
                group: getState().createSession!.keyset!.group,
                nonces: [],
              },
            } as CompletedOperation,
          ],
          failures: [
            {
              request_id: oldRequestId,
              op_type: "onboard",
              code: "timeout",
              message: "old request failed late",
              failed_peer: null,
            },
          ],
          events: [],
        });
      });

      const afterOldDrain = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(afterOldDrain.peerOnline).toBe(false);
      expect(afterOldDrain.adoptionError).toBeUndefined();
      expect(afterOldDrain.pendingDispatchRequestId).toBe(
        afterRetry.pendingDispatchRequestId,
      );
    },
    30_000,
  );

  it(
    "manual mark clears retry state and ignores late onboard failures",
    async () => {
      const getState = await renderProvider();
      const { remoteShares } = await prepareActiveCreateSession(getState);
      const shareIdx = remoteShares[0].idx;
      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });
      const requestId = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!.pendingDispatchRequestId!;
      expect(requestId).toBeTruthy();

      await act(async () => {
        getState().markPackageDistributed(shareIdx);
      });
      const marked = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(marked.manuallyMarkedDistributed).toBe(true);
      expect(marked.pendingDispatchRequestId).toBeUndefined();
      expect(marked.adoptionError).toBeUndefined();

      const absorb = useAbsorbDrainsHook();
      await act(async () => {
        absorb({
          completions: [],
          failures: [
            {
              request_id: requestId,
              op_type: "onboard",
              code: "timeout",
              message: "late timeout",
              failed_peer: null,
            },
          ],
          events: [],
        });
      });

      const afterLateFailure = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(afterLateFailure.manuallyMarkedDistributed).toBe(true);
      expect(afterLateFailure.adoptionError).toBeUndefined();
      expect(afterLateFailure.pendingDispatchRequestId).toBeUndefined();
    },
    30_000,
  );

  it(
    "non-onboard completions / failures leave every share's peerOnline and adoptionError unchanged",
    async () => {
      const getState = await renderProvider();
      const { remoteShares } = await prepareActiveCreateSession(getState);
      const shareIdx = remoteShares[0].idx;
      await act(async () => {
        await getState().encodeDistributionPackage(
          shareIdx,
          "per-share-password-1234",
        );
      });
      const requestId = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!.pendingDispatchRequestId!;
      expect(requestId).toBeTruthy();

      const absorb = useAbsorbDrainsHook();
      await act(async () => {
        absorb({
          completions: [
            {
              Sign: {
                request_id: requestId,
                signatures_hex64: [],
              },
            } as CompletedOperation,
          ],
          failures: [
            {
              request_id: requestId,
              op_type: "sign",
              code: "timeout",
              message: "sign timeout",
              failed_peer: null,
            },
            {
              request_id: requestId,
              op_type: "ecdh",
              code: "timeout",
              message: "ecdh timeout",
              failed_peer: null,
            },
            {
              request_id: requestId,
              op_type: "ping",
              code: "timeout",
              message: "ping timeout",
              failed_peer: null,
            },
          ],
          events: [],
        });
      });

      const pkgAfter = getState().createSession!.onboardingPackages.find(
        (p) => p.idx === shareIdx,
      )!;
      expect(pkgAfter.peerOnline).toBe(false);
      expect(pkgAfter.adoptionError).toBeUndefined();
    },
    30_000,
  );
});
