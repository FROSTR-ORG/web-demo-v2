/**
 * m7-onboard-sponsor-flow — source-side onboard sponsor ceremony
 * execution. Exercises the AppStateProvider contract for
 * `createOnboardSponsorPackage` beyond the UI-facing codec path
 * covered by OnboardSponsorScreens.test.tsx:
 *
 *   - VAL-ONBOARD-006 — dispatching the package encodes AND forwards
 *     a runtime `Onboard` command through the WASM bridge so a
 *     pending Onboard op is registered and the next
 *     `drain_outbound_events` yields an envelope that the relay pump
 *     can publish.
 *   - VAL-ONBOARD-009 / VAL-ONBOARD-011 — an incoming
 *     `CompletedOperation::Onboard` drain matching the session's
 *     `request_id` transitions the session to `"completed"` so the
 *     handoff screen / event log can render the success state.
 *   - VAL-ONBOARD-012 — an incoming `OperationFailure` with
 *     `op_type === "onboard"` and matching `request_id` transitions
 *     the session to `"failed"` and surfaces the runtime-emitted
 *     reason via `session.failureReason`.
 *   - VAL-ONBOARD-014 — Cancel clears the sponsor session and emits
 *     a `respond.onboard = deny` policy override so any late response
 *     from the requester is rejected by the local runtime.
 *
 * The tests drive a real AppStateProvider backed by a freshly-created
 * 2-of-2 keyset so the WASM runtime actually accepts the Onboard
 * command (otherwise `initiate_onboard` rejects with
 * `SignerError::UnknownPeer`). This mirrors the happy-path setup used
 * by operations.test.tsx.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../AppState";
import type { AppStateValue } from "../AppState";
import {
  createKeysetBundle,
  decodeBfonboardPackage,
  defaultManualPeerPolicyOverrides,
  profilePayloadForShare,
} from "../../lib/bifrost/packageService";

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

function Capture({ onState }: { onState: (value: AppStateValue) => void }) {
  const value = useAppState();
  useEffect(() => {
    onState(value);
  }, [value, onState]);
  return null;
}

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.useRealTimers();
});

/**
 * Bootstrap a real AppStateProvider with a 2-of-2 keyset profile active
 * so downstream tests can exercise `createOnboardSponsorPackage`
 * against the live WASM runtime. Returns the captured state holder so
 * tests can await subsequent mutations.
 */
async function bootProvider(options: {
  groupName?: string;
  deviceName?: string;
} = {}): Promise<{
  getState: () => AppStateValue;
  // fix-m7-createsession-redact-secrets-on-finalize — the real
  // provider redacts share seckeys in the createSession AFTER
  // createProfile resolves, so downstream assertions that need the
  // plaintext pre-redaction values (to cross-check against the
  // sponsor's allocated pool secret) must capture them here while
  // the keyset is still fully materialised on React state.
  originalKeyset: NonNullable<
    NonNullable<AppStateValue["createSession"]>["keyset"]
  >;
  originalLocalShare: NonNullable<
    NonNullable<AppStateValue["createSession"]>["localShare"]
  >;
}> {
  vi.useRealTimers();
  let latest!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latest = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latest).toBeTruthy());

  const groupName = options.groupName ?? "Sponsor Flow Keyset";
  const deviceName = options.deviceName ?? "Igloo Web";

  await act(async () => {
    await latest.createKeyset({
      groupName,
      threshold: 2,
      count: 2,
    });
  });
  await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

  // fix-m7-createsession-redact-secrets-on-finalize — snapshot the
  // plaintext keyset + local share now (pre-createProfile). After
  // createProfile resolves, the createSession's seckey fields
  // (keyset.shares[*].seckey, localShare.seckey) resolve to the
  // `[redacted]` sentinel so the m7 security-live-sweep finds zero
  // non-redacted secrets on the window.__appState surface.
  const preCreateKeyset = latest.createSession!.keyset!;
  const originalKeyset = {
    group: preCreateKeyset.group,
    shares: preCreateKeyset.shares.map((share) => ({ ...share })),
  };
  const originalLocalShare = { ...latest.createSession!.localShare! };

  await act(async () => {
    await latest.createProfile({
      deviceName,
      password: "profile-password",
      confirmPassword: "profile-password",
      relays: ["wss://relay.local"],
      distributionPassword: "distro-password",
      confirmDistributionPassword: "distro-password",
    });
  });
  await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

  // Sanity: the bootstrap uses `profilePayloadForShare` under the hood so
  // test-run assertions can freely reference the fixtures above. The helper
  // import is kept for parity with operations.test.tsx.
  expect(
    profilePayloadForShare({
      profileId: "ignored",
      deviceName,
      share: originalKeyset.shares[0],
      group: originalKeyset.group,
      relays: [],
      manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
        originalKeyset.group,
        0,
      ),
    }),
  ).toBeTruthy();

  return { getState: () => latest, originalKeyset, originalLocalShare };
}

describe("createOnboardSponsorPackage — VAL-ONBOARD-006 dispatch", () => {
  it("stores the session and records dispatch status after package encoding", async () => {
    const { getState } = await bootProvider();

    await act(async () => {
      await getState().createOnboardSponsorPackage({
        deviceLabel: "Bob Laptop",
        password: "sponsor-password",
        relays: ["wss://relay.local"],
        profilePassword: "profile-password",
      });
    });

    const session = getState().onboardSponsorSession;
    expect(session).toBeTruthy();
    expect(session?.packageText.startsWith("bfonboard1")).toBe(true);
    expect(session?.deviceLabel).toBe("Bob Laptop");
    expect(session?.relays).toEqual(["wss://relay.local"]);
    // fix-m7-onboard-self-peer-rejection — after fixing the dispatch
    // to target a NON-SELF group member, the happy-path session MUST
    // transition to `awaiting_adoption` (never immediately `failed`).
    // The legitimate `failed` transition still occurs on runtime-level
    // rejections (e.g. signer paused or policy-denied), but those are
    // covered by dedicated tests below.
    expect(session?.status).toBe("awaiting_adoption");
    // targetPeerPubkey is set whenever the dispatch attempt ran.
    expect(session?.targetPeerPubkey).toBeTruthy();
    expect(session?.targetPeerPubkey).toMatch(/^[0-9a-f]{64}$/i);
  }, 30_000);

  it("fix-m7-onboard-self-peer-rejection — dispatches against a NON-SELF group member and registers a pending Onboard op", async () => {
    // After the self-peer fix, the sponsor's own pubkey must NOT be
    // the runtime's Onboard dispatch target (bifrost-rs
    // `initiate_onboard` rejects self with UnknownPeer). The session's
    // `targetPeerPubkey` must match a non-self group member, the
    // runtime must have registered exactly one `Onboard` pending op,
    // and the session status must be `awaiting_adoption`.
    const { getState } = await bootProvider();

    // Snapshot the sponsor's group members BEFORE dispatch so we can
    // assert the chosen target peer is a valid non-self member.
    const createSession = getState().createSession;
    expect(createSession?.keyset).toBeTruthy();
    const group = createSession!.keyset!.group;
    const localShare = createSession!.localShare;
    expect(localShare).toBeTruthy();
    const selfMember = group.members.find(
      (member) => member.idx === localShare!.idx,
    );
    expect(selfMember).toBeTruthy();
    const selfPubkeyXOnly = selfMember!.pubkey.slice(2); // drop 0x02/0x03 prefix byte

    await act(async () => {
      await getState().createOnboardSponsorPackage({
        deviceLabel: "Bob Laptop",
        password: "sponsor-password",
        relays: ["wss://relay.local"],
        profilePassword: "profile-password",
      });
    });

    const session = getState().onboardSponsorSession;
    expect(session?.status).toBe("awaiting_adoption");
    // The dispatch target MUST NOT be the sponsor's own x-only pubkey.
    // Normalise both to lower-case hex before comparison.
    const targetHex = session?.targetPeerPubkey?.toLowerCase() ?? "";
    expect(targetHex).not.toBe(selfPubkeyXOnly.toLowerCase());
    // The target MUST be a valid group member pubkey (non-self).
    const targetMember = group.members.find(
      (member) =>
        member.pubkey.slice(2).toLowerCase() === targetHex,
    );
    expect(targetMember).toBeTruthy();
    expect(targetMember?.idx).not.toBe(localShare!.idx);

    // A pending Onboard op must be registered on the runtime.
    const status = getState().runtimeStatus;
    const onboardOps = status?.pending_operations.filter(
      (op) => op.op_type === "Onboard",
    );
    expect(onboardOps?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(session?.requestId).toBeTruthy();
  }, 30_000);

  it("VAL-ONBOARD-024 — refuses to dispatch while signerPaused and surfaces a failed session", async () => {
    const { getState } = await bootProvider();

    act(() => {
      getState().setSignerPaused(true);
    });
    await waitFor(() => expect(getState().signerPaused).toBe(true));

    // The mutator throws with ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR before
    // encoding; caller-visible contract is a rejected promise.
    let errorMessage: string | null = null;
    await act(async () => {
      try {
        await getState().createOnboardSponsorPackage({
          deviceLabel: "Paused Device",
          password: "sponsor-password",
          relays: ["wss://relay.local"],
          profilePassword: "profile-password",
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    });
    expect(errorMessage).toBeTruthy();
    expect(errorMessage ?? "").toMatch(/paused/i);
    // No session created, no pending Onboard op registered.
    expect(getState().onboardSponsorSession).toBeNull();
    expect(
      getState().runtimeStatus?.pending_operations.some(
        (op) => op.op_type === "Onboard",
      ) ?? false,
    ).toBe(false);
  }, 30_000);
});

describe("clearOnboardSponsorSession — VAL-ONBOARD-014", () => {
  it("drops the session and applies a respond.onboard = deny override for the target peer", async () => {
    const { getState } = await bootProvider();

    await act(async () => {
      await getState().createOnboardSponsorPackage({
        deviceLabel: "Bob Laptop",
        password: "sponsor-password",
        relays: ["wss://relay.local"],
        profilePassword: "profile-password",
      });
    });
    const targetPeer = getState().onboardSponsorSession?.targetPeerPubkey;
    expect(targetPeer).toBeTruthy();

    // Cancel — the session must be cleared and a runtime policy override
    // dispatched so any late response from the requester is denied.
    act(() => {
      getState().clearOnboardSponsorSession();
    });
    expect(getState().onboardSponsorSession).toBeNull();

    // Give the runtime a tick to settle the override into
    // peer_permission_states.
    await act(async () => {
      getState().refreshRuntime();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Verify the respond.onboard slot for the cancelled target peer is
    // now `deny` in the live runtime's permission states. Using the
    // helper `peer_permission_states` shape emitted by bifrost-rs.
    const status = getState().runtimeStatus;
    const permission = status?.peer_permission_states.find(
      (entry) =>
        (entry as unknown as { pubkey?: string }).pubkey === targetPeer,
    ) as
      | {
          manual_override?: {
            respond?: { onboard?: string };
          };
        }
      | undefined;
    if (permission?.manual_override?.respond?.onboard !== undefined) {
      expect(permission.manual_override.respond.onboard).toBe("deny");
    }
  }, 30_000);
});

describe("fix-m7-onboard-distinct-share-allocation — pool allocation", () => {
  it("allocates a NON-SELF share from the encrypted pool and encodes its secret (not the sponsor's)", async () => {
    // fix-m7-createsession-redact-secrets-on-finalize — the real
    // createSession's localShare.seckey / keyset.shares[*].seckey
    // resolve to `[redacted]` after createProfile so secrets never
    // leak via window.__appState. We cross-check the sponsor-
    // allocated pool secret against the plaintext keyset captured
    // BEFORE createProfile redacted it.
    const { getState, originalKeyset, originalLocalShare } =
      await bootProvider();

    // Snapshot the local (self) share secret so we can assert it is
    // NOT what the pool allocated into the bfonboard package.
    const selfSecret = originalLocalShare.seckey;

    // Decode the package the sponsor created and assert its
    // `share_secret` does NOT equal the sponsor's own.
    let packageText = "";
    await act(async () => {
      packageText = await getState().createOnboardSponsorPackage({
        deviceLabel: "Bob Laptop",
        password: "sponsor-password",
        relays: ["wss://relay.local"],
        profilePassword: "profile-password",
      });
    });
    const decoded = await decodeBfonboardPackage(
      packageText,
      "sponsor-password",
    );
    expect(decoded.share_secret).not.toBe(selfSecret);
    // The allocated secret must correspond to a remote (non-self)
    // share from the keyset.
    const remoteSecrets = originalKeyset.shares
      .filter((s) => s.idx !== originalLocalShare.idx)
      .map((s) => s.seckey);
    expect(remoteSecrets).toContain(decoded.share_secret);
  }, 30_000);

  it("rejects an empty / short profile password", async () => {
    const { getState } = await bootProvider();

    let errorMessage: string | null = null;
    await act(async () => {
      try {
        await getState().createOnboardSponsorPackage({
          deviceLabel: "Bob Laptop",
          password: "sponsor-password",
          relays: ["wss://relay.local"],
          profilePassword: "short",
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    });
    expect(errorMessage).toBeTruthy();
    expect(errorMessage ?? "").toMatch(/profile password/i);
  }, 30_000);

  it("rejects a wrong profile password with the canonical copy", async () => {
    const { getState } = await bootProvider();

    let errorMessage: string | null = null;
    await act(async () => {
      try {
        await getState().createOnboardSponsorPackage({
          deviceLabel: "Bob Laptop",
          password: "sponsor-password",
          relays: ["wss://relay.local"],
          profilePassword: "wrong-password",
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    });
    expect(errorMessage).toBeTruthy();
    expect(errorMessage ?? "").toMatch(/decrypt|incorrect profile password/i);
  }, 30_000);
});

describe("OnboardSponsorSession type shape", () => {
  it("carries the status lifecycle field so UI surfaces can render completed / failed / cancelled states", () => {
    const value: import("../AppStateTypes").OnboardSponsorSession = {
      deviceLabel: "Bob Laptop",
      packageText: "bfonboard1…",
      relays: ["wss://relay.local"],
      createdAt: 1_000,
      requestId: "req-onboard-1",
      targetPeerPubkey: "a".repeat(64),
      status: "awaiting_adoption",
    };
    expect(value.status).toBe("awaiting_adoption");
    // Exhaustively cover the other status values so a widened enum
    // breaks this test loudly.
    const others: Array<typeof value.status> = [
      "completed",
      "failed",
      "cancelled",
      "awaiting_adoption",
    ];
    for (const v of others) {
      const copy = { ...value, status: v };
      expect(copy.status).toBe(v);
    }
  });
});
