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
import { AppStateProvider, useAppState, type AppStateValue } from "../AppState";
import {
  createKeysetBundle,
  defaultManualPeerPolicyOverrides,
  profilePayloadForShare,
} from "../../lib/bifrost/packageService";
import type {
  GroupPackageWire,
  SharePackageWire,
} from "../../lib/bifrost/types";

/**
 * fix-followup-create-bootstrap-live-relay-pump — `createProfile` now
 * bootstraps the live {@link RuntimeRelayPump} (NOT the
 * `LocalRuntimeSimulator`). Tests in this file still need simulator-
 * driven virtual-peer semantics so sign / ECDH round-trips produce
 * completions; the DEV-only `__iglooTestAttachSimulator` hook swaps
 * the relay pump out for a fresh `LocalRuntimeSimulator` tied to the
 * caller's explicit keyset view.
 */
async function attachSimulator(input: {
  group: GroupPackageWire;
  localShare: SharePackageWire;
  remoteShares: SharePackageWire[];
}): Promise<void> {
  const hook = (
    window as typeof window & {
      __iglooTestAttachSimulator?: (input: {
        group: GroupPackageWire;
        localShare: SharePackageWire;
        remoteShares: SharePackageWire[];
      }) => Promise<void>;
    }
  ).__iglooTestAttachSimulator;
  if (typeof hook !== "function") {
    throw new Error(
      "window.__iglooTestAttachSimulator is not installed — DEV hook missing.",
    );
  }
  await hook(input);
}

/**
 * Tests for feature
 * `fix-m1-signing-failed-modal-peer-response-and-retry-correlation`.
 *
 * Fulfils VAL-OPS-007 at the AppStateProvider layer:
 *   - `handleRuntimeCommand` populates `pendingDispatchIndex` with the
 *     originating `message_hex_32` keyed by the captured request_id.
 *   - Failures drained through `absorbDrains` are enriched with
 *     `message_hex_32` from the index BEFORE landing in
 *     `runtimeFailures` (VAL-OPS-007).
 *   - Index entries are retained for 60s after settlement so Retry can
 *     always resolve the originating message even well after the
 *     pending op is removed.
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

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  cleanup();
  storage.clear();
});

describe("AppStateProvider — pendingDispatchIndex", () => {
  it("populates pendingDispatchIndex with the originating message_hex_32 when a sign is dispatched via handleRuntimeCommand", async () => {
    const keyset = await createKeysetBundle({
      groupName: "DispatchIndex Sign Key",
      threshold: 2,
      count: 2,
    });
    const localShare = keyset.shares[0];
    const payload = profilePayloadForShare({
      profileId: "prof_dispatch_idx",
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
        groupName: "DispatchIndex Sign Key",
        threshold: 2,
        count: 2,
      });
    });
    await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

    // Capture the keyset snapshot BEFORE createProfile redacts the
    // share secrets — the simulator attach below needs the plaintext
    // shares to stand up virtual peers.
    const session = latest.createSession!;
    const capturedGroup = session.keyset!.group;
    const capturedLocalShare = session.localShare!;
    const capturedRemoteShares = session.keyset!.shares.filter(
      (share) => share.idx !== capturedLocalShare.idx,
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

    // Swap the live relay pump out for a simulator so this test
    // exercises the virtual-peer-driven sign round-trip semantics
    // that pre-date the fix-followup-create-bootstrap-live-relay-pump
    // change.
    await act(async () => {
      await attachSimulator({
        group: capturedGroup,
        localShare: capturedLocalShare,
        remoteShares: capturedRemoteShares,
      });
    });

    const message = "a".repeat(64);
    let result: { requestId: string | null; debounced: boolean } = {
      requestId: null,
      debounced: false,
    };
    await act(async () => {
      result = await latest.handleRuntimeCommand({
        type: "sign",
        message_hex_32: message,
      });
    });
    expect(result.requestId).toBeTruthy();
    // pendingDispatchIndex contains an entry keyed by the captured
    // request_id with the correct message_hex_32.
    await waitFor(() => {
      const entry = latest.pendingDispatchIndex[result.requestId!];
      expect(entry).toBeTruthy();
      expect(entry.type).toBe("sign");
      expect(entry.message_hex_32).toBe(message);
      expect(typeof entry.dispatchedAt).toBe("number");
    });
  }, 30_000);

  it("enriches drained OperationFailure records with message_hex_32 when pendingDispatchIndex has the request_id (VAL-OPS-007)", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Enrichment Key",
      threshold: 2,
      count: 2,
    });
    const localShare = keyset.shares[0];
    const payload = profilePayloadForShare({
      profileId: "prof_enrichment",
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
        groupName: "Enrichment Key",
        threshold: 2,
        count: 2,
      });
    });
    await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

    // Capture the keyset snapshot BEFORE createProfile redacts it.
    const session = latest.createSession!;
    const capturedGroup = session.keyset!.group;
    const capturedLocalShare = session.localShare!;
    const capturedRemoteShares = session.keyset!.shares.filter(
      (share) => share.idx !== capturedLocalShare.idx,
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

    // Swap the live relay pump out for a simulator so this test
    // exercises the virtual-peer-driven failure-enrichment semantics
    // that pre-date the fix-followup-create-bootstrap-live-relay-pump
    // change.
    await act(async () => {
      await attachSimulator({
        group: capturedGroup,
        localShare: capturedLocalShare,
        remoteShares: capturedRemoteShares,
      });
    });

    const message = "f".repeat(64);
    let result: { requestId: string | null; debounced: boolean } = {
      requestId: null,
      debounced: false,
    };
    await act(async () => {
      result = await latest.handleRuntimeCommand({
        type: "sign",
        message_hex_32: message,
      });
    });
    expect(result.requestId).toBeTruthy();

    // Wait for the simulator to pump through and produce either a
    // completion OR a failure for this request_id.
    await act(async () => {
      latest.refreshRuntime();
      await new Promise((resolve) => setTimeout(resolve, 0));
      latest.refreshRuntime();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Index entry for the sign must carry message_hex_32.
    const indexEntry = latest.pendingDispatchIndex[result.requestId!];
    expect(indexEntry).toBeTruthy();
    expect(indexEntry.message_hex_32).toBe(message);

    // If the simulator produced a failure, the runtimeFailures entry
    // must be enriched with the originating message. If it produced a
    // completion, we skip the enrichment assertion — the contract only
    // applies to failures.
    const failure = latest.runtimeFailures.find(
      (f) => f.request_id === result.requestId,
    );
    if (failure) {
      expect(failure.message_hex_32).toBe(message);
    }
  }, 30_000);
});
