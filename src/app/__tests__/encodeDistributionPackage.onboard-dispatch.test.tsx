import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";
import type {
  CompletedOperation,
  OperationFailure,
  RuntimeEvent,
  RuntimeStatusSummary,
} from "../../lib/bifrost/types";

/**
 * Device onboarding is recipient-initiated: the new device imports
 * bfonboard and sends the relay request to the provisioning signer.
 * The create/distribute screen should therefore only create the
 * package and let the live source runtime answer inbound requests.
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
  opts: { threshold?: number; count?: number } = {},
) {
  await act(async () => {
    await getState().createKeyset({
      groupName: "Onboard Package Test Key",
      threshold: opts.threshold ?? 2,
      count: opts.count ?? 2,
    });
  });
  await waitFor(() =>
    expect(getState().createSession?.keyset?.group.group_name).toBeTruthy(),
  );
  const session = getState().createSession!;
  const localShare = session.localShare!;
  const remoteShares = session.keyset!.shares.filter(
    (share) => share.idx !== localShare.idx,
  );

  await act(async () => {
    await getState().createProfile({
      deviceName: "Onboard Package Device",
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
  return { remoteShares };
}

type AbsorbDrainsHook = (drains: {
  completions: CompletedOperation[];
  failures: OperationFailure[];
  events: RuntimeEvent[];
}) => void;

function useAbsorbDrainsHook(): AbsorbDrainsHook {
  const hook = (
    window as typeof window & {
      __iglooTestAbsorbDrains?: AbsorbDrainsHook;
    }
  ).__iglooTestAbsorbDrains;
  if (typeof hook !== "function") {
    throw new Error("__iglooTestAbsorbDrains hook is not installed.");
  }
  return hook;
}

function statusWithOnlinePeers(
  status: RuntimeStatusSummary,
  onlinePubkeys: string[],
): RuntimeStatusSummary {
  const online = new Set(onlinePubkeys.map((pubkey) => pubkey.toLowerCase()));
  const now = Math.floor(Date.now() / 1000);
  return {
    ...status,
    peers: status.peers.map((peer) => ({
      ...peer,
      online: online.has(peer.pubkey.toLowerCase()),
      last_seen: online.has(peer.pubkey.toLowerCase()) ? now : peer.last_seen,
    })),
  };
}

function statusChangedEvent(status: RuntimeStatusSummary): RuntimeEvent {
  return {
    kind: "StatusChanged",
    status,
  };
}

describe("encodeDistributionPackage — recipient-initiated onboarding", () => {
  it("creates a redacted bfonboard package without starting a source-side onboard op", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState);
    const shareIdx = remoteShares[0].idx;

    expect(
      getState().runtimeStatus!.pending_operations.filter(
        (op) => op.op_type === "Onboard",
      ),
    ).toHaveLength(0);

    await act(async () => {
      await getState().encodeDistributionPackage(
        shareIdx,
        "per-share-password-1234",
      );
    });

    const pkg = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(pkg.packageCreated).toBe(true);
    expect(pkg.packageText.startsWith("bfonboard1")).toBe(true);
    expect(pkg.password).toBe("[redacted]");
    expect(pkg.pendingDispatchRequestId).toBeUndefined();
    expect(pkg.adoptionError).toBeUndefined();
    expect(pkg.peerOnline).toBe(false);
    expect(
      getState().runtimeStatus!.pending_operations.filter(
        (op) => op.op_type === "Onboard",
      ),
    ).toHaveLength(0);
  }, 30_000);

  it("does not dispatch onboard during createProfile", async () => {
    const getState = await renderProvider();
    await prepareActiveCreateSession(getState, { count: 3 });

    expect(
      getState().runtimeStatus!.pending_operations.filter(
        (op) => op.op_type === "Onboard",
      ),
    ).toHaveLength(0);
    for (const pkg of getState().createSession!.onboardingPackages) {
      expect(pkg.pendingDispatchRequestId).toBeUndefined();
      expect(pkg.peerOnline).toBe(false);
    }
  }, 30_000);

  it("manual mark remains the create/distribute accounting path", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState);
    const shareIdx = remoteShares[0].idx;

    await act(async () => {
      await getState().encodeDistributionPackage(
        shareIdx,
        "per-share-password-1234",
      );
      getState().markPackageDistributed(shareIdx);
    });

    const pkg = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(pkg.manuallyMarkedDistributed).toBe(true);
    expect(pkg.pendingDispatchRequestId).toBeUndefined();
    expect(pkg.adoptionError).toBeUndefined();
  }, 30_000);

  it("uncorrelated onboard drains do not falsely flip package distribution state", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState);
    const shareIdx = remoteShares[0].idx;

    await act(async () => {
      await getState().encodeDistributionPackage(
        shareIdx,
        "per-share-password-1234",
      );
    });

    const absorb = useAbsorbDrainsHook();
    await act(async () => {
      absorb({
        completions: [
          {
            Onboard: {
              request_id: "untracked-onboard",
              group_member_count: 2,
              group: getState().createSession!.keyset!.group,
              nonces: [],
            },
          } as CompletedOperation,
        ],
        failures: [
          {
            request_id: "untracked-onboard",
            op_type: "onboard",
            code: "timeout",
            message: "late timeout",
            failed_peer: null,
          },
        ],
        events: [],
      });
    });

    const pkg = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(pkg.peerOnline).toBe(false);
    expect(pkg.adoptionError).toBeUndefined();
    expect(pkg.pendingDispatchRequestId).toBeUndefined();
  }, 30_000);

  it("marks a created package distributed when runtime status reports its member online", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState);
    const shareIdx = remoteShares[0].idx;

    await act(async () => {
      await getState().encodeDistributionPackage(
        shareIdx,
        "per-share-password-1234",
      );
    });

    const targetPackage = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    const absorb = useAbsorbDrainsHook();
    await act(async () => {
      absorb({
        completions: [],
        failures: [],
        events: [
          statusChangedEvent(
            statusWithOnlinePeers(getState().runtimeStatus!, [
              targetPackage.memberPubkey,
            ]),
          ),
        ],
      });
    });

    const pkg = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(pkg.peerOnline).toBe(true);
    expect(pkg.manuallyMarkedDistributed).toBe(false);
    expect(pkg.pendingDispatchRequestId).toBeUndefined();
    expect(pkg.adoptionError).toBeUndefined();
  }, 30_000);

  it("promotes a request-seen package to joined when the source sends an onboard response", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState);
    const shareIdx = remoteShares[0].idx;

    await act(async () => {
      await getState().encodeDistributionPackage(
        shareIdx,
        "per-share-password-1234",
      );
      getState().updatePackageState(shareIdx, {
        peerOnline: true,
        manuallyMarkedDistributed: false,
      });
    });

    const seenPackage = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(seenPackage.peerOnline).toBe(true);
    expect(seenPackage.manuallyMarkedDistributed).toBe(false);

    const absorb = useAbsorbDrainsHook();
    await act(async () => {
      absorb({
        completions: [],
        failures: [],
        events: [
          {
            kind: "peer_activity",
            status: getState().runtimeStatus!,
            activity: {
              request_id: "source-onboard-response",
              op_type: "onboard",
              peer: seenPackage.memberPubkey,
              action: "response_sent",
            },
          },
        ],
      });
    });

    const completedPackage = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(completedPackage.peerOnline).toBe(true);
    expect(completedPackage.manuallyMarkedDistributed).toBe(true);
    expect(completedPackage.pendingDispatchRequestId).toBeUndefined();
    expect(completedPackage.adoptionError).toBeUndefined();
  }, 30_000);

  it("marks multiple created packages independently from one runtime status snapshot", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState, {
      threshold: 2,
      count: 4,
    });

    await act(async () => {
      await getState().encodeDistributionPackage(
        remoteShares[0].idx,
        "per-share-password-1234",
      );
      await getState().encodeDistributionPackage(
        remoteShares[1].idx,
        "per-share-password-5678",
      );
    });

    const packages = getState().createSession!.onboardingPackages;
    const first = packages.find((entry) => entry.idx === remoteShares[0].idx)!;
    const second = packages.find((entry) => entry.idx === remoteShares[1].idx)!;
    const third = packages.find((entry) => entry.idx === remoteShares[2].idx)!;
    const absorb = useAbsorbDrainsHook();
    await act(async () => {
      absorb({
        completions: [],
        failures: [],
        events: [
          statusChangedEvent(
            statusWithOnlinePeers(getState().runtimeStatus!, [
              first.memberPubkey,
              second.memberPubkey,
              third.memberPubkey,
            ]),
          ),
        ],
      });
    });

    const nextPackages = getState().createSession!.onboardingPackages;
    expect(
      nextPackages.find((entry) => entry.idx === first.idx)!.peerOnline,
    ).toBe(true);
    expect(
      nextPackages.find((entry) => entry.idx === second.idx)!.peerOnline,
    ).toBe(true);
    expect(
      nextPackages.find((entry) => entry.idx === third.idx)!.peerOnline,
    ).toBe(false);
  }, 30_000);

  it("does not mark offline or nonmatching peers distributed", async () => {
    const getState = await renderProvider();
    const { remoteShares } = await prepareActiveCreateSession(getState);
    const shareIdx = remoteShares[0].idx;

    await act(async () => {
      await getState().encodeDistributionPackage(
        shareIdx,
        "per-share-password-1234",
      );
    });

    const absorb = useAbsorbDrainsHook();
    await act(async () => {
      absorb({
        completions: [],
        failures: [],
        events: [
          statusChangedEvent(statusWithOnlinePeers(getState().runtimeStatus!, [])),
        ],
      });
    });

    const pkg = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === shareIdx,
    )!;
    expect(pkg.peerOnline).toBe(false);
  }, 30_000);

  it("does not auto-complete a package that has not been created yet", async () => {
    const getState = await renderProvider();
    await prepareActiveCreateSession(getState);

    const pkgBefore = getState().createSession!.onboardingPackages[0];
    expect(pkgBefore.packageCreated).toBe(false);
    const absorb = useAbsorbDrainsHook();
    await act(async () => {
      absorb({
        completions: [],
        failures: [],
        events: [
          statusChangedEvent(
            statusWithOnlinePeers(getState().runtimeStatus!, [
              pkgBefore.memberPubkey,
            ]),
          ),
        ],
      });
    });

    const pkg = getState().createSession!.onboardingPackages.find(
      (candidate) => candidate.idx === pkgBefore.idx,
    )!;
    expect(pkg.peerOnline).toBe(false);
  }, 30_000);
});
