import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { AppStateProvider, useAppState, type AppStateValue } from "../AppState";
import { runtimeBootstrapFromParts } from "../../lib/bifrost/format";
import {
  createKeysetBundle,
  decodeProfilePackage,
  encodeOnboardPackage,
  onboardPayloadForRemoteShare
} from "../../lib/bifrost/packageService";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import type { StoredProfileRecord } from "../../lib/bifrost/types";

const relayHarness = vi.hoisted(() => ({
  runOnboardingRelayHandshake: vi.fn(),
  handle: null as null | ((input: {
    requestEventJson: string;
    decodeEvent: (event: unknown) => Promise<unknown | null>;
    signal?: AbortSignal;
  }) => Promise<unknown>)
}));

vi.mock("../../lib/relay/browserRelayClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/relay/browserRelayClient")>(
    "../../lib/relay/browserRelayClient"
  );
  return {
    ...actual,
    runOnboardingRelayHandshake: relayHarness.runOnboardingRelayHandshake
  };
});

const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key);
  })
}));

const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";
const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

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
    </AppStateProvider>
  );
  await waitFor(() => expect(latest).toBeTruthy());
  return () => latest;
}

beforeEach(() => {
  storage.clear();
  relayHarness.runOnboardingRelayHandshake.mockReset();
  relayHarness.runOnboardingRelayHandshake.mockImplementation((input) => {
    if (!relayHarness.handle) {
      throw new Error("Relay harness was not configured.");
    }
    return relayHarness.handle(input);
  });
  relayHarness.handle = null;
});

afterEach(() => {
  cleanup();
  storage.clear();
});

describe("AppState live onboard requester flow", () => {
  it("saves an encrypted profile from a real source-runtime onboarding response", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Onboard Live Key",
      threshold: 2,
      count: 2
    });
    const sourceShare = keyset.shares[0];
    const onboardedShare = keyset.shares[1];
    const sourceRuntime = new RuntimeClient();
    await sourceRuntime.init({}, runtimeBootstrapFromParts(keyset.group, sourceShare));

    relayHarness.handle = async (input) => {
      sourceRuntime.handleInboundEvent(JSON.parse(input.requestEventJson));
      sourceRuntime.tick(Date.now());
      const responseEvent = sourceRuntime.drainOutboundEvents()[0];
      expect(responseEvent).toBeTruthy();
      const decoded = await input.decodeEvent(responseEvent);
      expect(decoded).toBeTruthy();
      return decoded;
    };

    const onboardPackage = await encodeOnboardPackage(
      onboardPayloadForRemoteShare({
        remoteShare: onboardedShare,
        localShare: sourceShare,
        group: keyset.group,
        relays: ["wss://relay.example.test"]
      }),
      "package-password"
    );
    const getState = await renderProvider();

    await act(async () => {
      await getState().decodeOnboardPackage(onboardPackage, "package-password");
    });
    await waitFor(() => expect(getState().onboardSession?.phase).toBe("decoded"));

    await act(async () => {
      await getState().startOnboardHandshake();
    });
    await waitFor(() => expect(getState().onboardSession?.phase).toBe("ready_to_save"));
    expect(relayHarness.runOnboardingRelayHandshake).toHaveBeenCalledWith(
      expect.objectContaining({
        relays: ["wss://relay.example.test"],
        sourcePeerPubkey: expect.any(String),
        localPubkey: expect.any(String),
        requestEventJson: expect.any(String),
        signal: expect.any(AbortSignal)
      })
    );

    let profileId = "";
    await act(async () => {
      profileId = await getState().saveOnboardedProfile({
        password: "local-password",
        confirmPassword: "local-password"
      });
    });

    await waitFor(() => expect(getState().onboardSession).toBeNull());
    expect(getState().activeProfile?.id).toBe(profileId);
    expect(storage.get(PROFILE_INDEX_KEY)).toEqual([profileId]);
    const record = storage.get(`${PROFILE_RECORD_PREFIX}${profileId}`) as StoredProfileRecord;
    expect(record.encryptedProfilePackage.startsWith("bfprofile1")).toBe(true);
    expect(JSON.stringify(record)).not.toMatch(/share_secret|seckey|package-password/);

    const decodedProfile = await decodeProfilePackage(record.encryptedProfilePackage, "local-password");
    expect(decodedProfile.group_package.group_pk).toBe(keyset.group.group_pk);
    expect(decodedProfile.device.relays).toEqual(["wss://relay.example.test"]);
    expect(decodedProfile.device.manual_peer_policy_overrides).toHaveLength(1);
  }, 45_000);

  it("aborts an in-flight onboarding handshake when the session is cleared", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Abort Onboard Key",
      threshold: 2,
      count: 2
    });
    const onboardPackage = await encodeOnboardPackage(
      onboardPayloadForRemoteShare({
        remoteShare: keyset.shares[1],
        localShare: keyset.shares[0],
        group: keyset.group,
        relays: ["wss://relay.abort.test"]
      }),
      "package-password"
    );
    let capturedSignal: AbortSignal | undefined;
    relayHarness.handle = async (input: { signal?: AbortSignal }) => {
      capturedSignal = input.signal;
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("Onboarding handshake was cancelled.");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });
    };
    const getState = await renderProvider();

    await act(async () => {
      await getState().decodeOnboardPackage(onboardPackage, "package-password");
    });
    void getState().startOnboardHandshake().catch(() => undefined);
    await waitFor(() => expect(getState().onboardSession?.phase).toBe("handshaking"));

    act(() => {
      getState().clearOnboardSession();
    });

    await waitFor(() => expect(getState().onboardSession).toBeNull());
    expect(capturedSignal?.aborted).toBe(true);
  }, 45_000);
});
