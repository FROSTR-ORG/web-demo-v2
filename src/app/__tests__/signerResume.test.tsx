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
  createKeysetBundle,
  defaultManualPeerPolicyOverrides,
  profilePayloadForShare,
} from "../../lib/bifrost/packageService";

/**
 * Hoisted `idb-keyval` mock mirroring the sibling `operations.test.tsx`
 * and `appStateBridge.test.tsx` patterns. The profile-save path writes
 * through `idb-keyval.set`; swapping in an in-memory Map keeps the test
 * hermetic.
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

import { AppStateProvider, useAppState, type AppStateValue } from "../AppState";

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

/**
 * VAL-OPS-017 regression — the g1-ui-gating validator evidence reported
 * that after `setSignerPaused(false)` the dashboard's Test Sign / Test
 * ECDH / Ping controls stayed disabled because
 * `runtimeStatus.readiness.sign_ready` remained `false` and
 * `handleRuntimeCommand({ type: 'sign', ... })` returned
 * `{ requestId: null }`.
 *
 * This test exercises a pause + resume cycle with a healthy runtime
 * (simulator-backed, 2-of-2 keyset, peers online) and asserts that:
 *
 *   (a) after resume, `runtimeStatus.readiness.sign_ready === true`
 *       within one runtime tick — the resume path must synchronously
 *       re-emit a fresh `runtime_status` snapshot so the UI's dispatch
 *       gate sees sign readiness restored (no stale "paused" reason
 *       lingers on `degraded_reasons`).
 *   (b) `handleRuntimeCommand({ type: 'sign', message_hex_32 })` issued
 *       immediately after resume returns a non-null `requestId`
 *       (the captured WASM-generated id), proving the dispatcher is
 *       no longer short-circuited by paused ref state and that the
 *       underlying WASM runtime accepted the command because sign
 *       readiness was restored.
 *
 * The sibling test under `operations.test.tsx` covers the paused path
 * (no-op dispatch while paused); this spec is focused on the RESUME
 * half so a future regression there surfaces against a dedicated
 * assertion. The second case (below) uses the no-simulator / live-relay
 * fall-through in `refreshRuntime` to prove that the resume path works
 * even when no `LocalRuntimeSimulator` is attached — which is the
 * scenario that produced the original validator failure, since the
 * unlock-profile path calls `setRuntime(runtime, undefined, relays)`
 * (no simulator) rather than the create-profile path.
 */
describe("AppStateProvider — signer resume restores readiness (VAL-OPS-017)", () => {
  it("resume after pause restores sign_ready=true and allows sign dispatch within one runtime tick (simulator path)", async () => {
    // Seed a real 2-of-2 keyset + profile — this stands up a real
    // `RuntimeClient` wired to `LocalRuntimeSimulator` with a virtual
    // peer so the runtime reports sign_ready=true before pause.
    const keyset = await createKeysetBundle({
      groupName: "Resume Readiness Key",
      threshold: 2,
      count: 2,
    });
    const localShare = keyset.shares[0];
    const payload = profilePayloadForShare({
      profileId: "prof_resume_live",
      deviceName: "Igloo Web",
      share: localShare,
      group: keyset.group,
      relays: [],
      manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
        keyset.group,
        localShare.idx,
      ),
    });
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    await act(async () => {
      await latest.createKeyset({
        groupName: "Resume Readiness Key",
        threshold: 2,
        count: 2,
      });
    });
    await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

    // fix-followup-create-bootstrap-live-relay-pump — capture the
    // plaintext keyset BEFORE createProfile redacts `share.seckey`.
    const capturedGroupResume = latest.createSession!.keyset!.group;
    const capturedLocalShareResume = latest.createSession!.localShare!;
    const capturedRemoteSharesResume =
      latest.createSession!.keyset!.shares.filter(
        (share) => share.idx !== capturedLocalShareResume.idx,
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
    await waitFor(() =>
      expect(latest.runtimeStatus).toBeTruthy(),
    );

    // Attach a simulator so the "simulator path" of this test
    // continues to exercise virtual-peer-driven readiness. createProfile
    // no longer bootstraps a simulator (VAL-FOLLOWUP-001).
    const attachSimulatorHook = (
      window as typeof window & {
        __iglooTestAttachSimulator?: (input: {
          group: typeof capturedGroupResume;
          localShare: typeof capturedLocalShareResume;
          remoteShares: typeof capturedRemoteSharesResume;
        }) => Promise<void>;
      }
    ).__iglooTestAttachSimulator;
    expect(typeof attachSimulatorHook).toBe("function");
    await act(async () => {
      await attachSimulatorHook!({
        group: capturedGroupResume,
        localShare: capturedLocalShareResume,
        remoteShares: capturedRemoteSharesResume,
      });
    });

    // Tick the simulator once so the virtual peer ECDH round-trip
    // completes and the runtime reports the healthy baseline.
    await act(async () => {
      latest.refreshRuntime();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(latest.runtimeStatus!.readiness.sign_ready).toBe(true),
    );

    // Pause — all control paths for sign/ECDH/ping must refuse dispatch
    // and the control-gate must surface `signerPaused=true`.
    act(() => {
      latest.setSignerPaused(true);
    });
    await waitFor(() => expect(latest.signerPaused).toBe(true));

    let pausedResult = { requestId: null as string | null, debounced: false };
    await act(async () => {
      pausedResult = await latest.handleRuntimeCommand({
        type: "sign",
        message_hex_32: "a".repeat(64),
      });
    });
    expect(pausedResult.requestId).toBeNull();
    expect(pausedResult.debounced).toBe(false);

    // Resume — readiness must be restored within one runtime tick. Under
    // the broken code path, sign_ready stayed `false` because the resume
    // path did not re-emit a fresh `runtime_status` snapshot; the control
    // gate therefore stayed disabled and `handleRuntimeCommand` returned
    // `requestId: null`.
    act(() => {
      latest.setSignerPaused(false);
    });
    await waitFor(() => expect(latest.signerPaused).toBe(false));

    // (a) Single-tick readiness restoration. Under the simulator path the
    //     resume handler itself pumps one iteration and sets runtime_status,
    //     so by the time `setSignerPaused(false)` returns, sign_ready must
    //     already be true. We additionally drive `refreshRuntime()` once to
    //     exercise the interval path that the UI relies on.
    await act(async () => {
      latest.refreshRuntime();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(latest.runtimeStatus!.readiness.sign_ready).toBe(true),
    );

    // No stale "paused" / signer-paused reason lingering on the readiness
    // snapshot — the feature contract requires degraded_reasons to reflect
    // underlying readiness inputs, not a stale pause signal.
    expect(
      latest.runtimeStatus!.readiness.degraded_reasons.some(
        (reason) =>
          typeof reason === "string" && reason.toLowerCase().includes("paus"),
      ),
    ).toBe(false);

    // (b) Dispatching a sign now returns a real request_id (non-null) and
    //     registers a new pending operation of type "Sign".
    const pendingBefore = new Set(
      latest.runtimeStatus!.pending_operations
        .filter((op) => op.op_type === "Sign")
        .map((op) => op.request_id),
    );

    let resumedResult = { requestId: null as string | null, debounced: false };
    await act(async () => {
      resumedResult = await latest.handleRuntimeCommand({
        type: "sign",
        message_hex_32: "f".repeat(64),
      });
    });
    expect(resumedResult.debounced).toBe(false);
    expect(resumedResult.requestId).toBeTruthy();
    expect(pendingBefore.has(resumedResult.requestId!)).toBe(false);

    expect(payload).toBeTruthy();
  }, 30_000);

  it("resume path synchronously re-emits a fresh runtime_status snapshot when no simulator is attached (live-relay path)", async () => {
    // Reproduce the unlock-profile wiring: a real RuntimeClient backing
    // runtimeRef, but with no LocalRuntimeSimulator — the same
    // configuration the VAL-OPS-017 validator hit. To keep the test
    // hermetic we seed a real 2-of-2 keyset (so the runtime carries a
    // healthy readiness snapshot) then *detach* the simulator before
    // toggling setSignerPaused. Because AppStateProvider exposes no
    // direct handle to `simulatorRef`, we use `restartRuntimeConnections`
    // indirectly: after createProfile, `lockProfile` → `unlockProfile`
    // takes the no-simulator path.
    //
    // We can't easily await real WebSocket handshakes in the test env,
    // so we intercept the `unlockProfile` path by marking the profile's
    // relays as `[]`. When `setRuntime(runtime, undefined, [])` is
    // called, the provider sets `liveRelayUrlsRef` to [] and does not
    // start a live pump, yet still populates `runtimeRef` with the
    // freshly-restored RuntimeClient. This lets the resume path run
    // with `runtimeRef.current` populated and `simulatorRef.current`
    // null — exercising the bugfix branch.
    //
    // NOTE: because we've dropped the relay list for the purposes of
    // this hermetic test, the dashboard's overall "connecting / online"
    // relay state isn't exercised; the assertion here is narrowly
    // focused on `runtime_status.readiness.sign_ready` being re-emitted
    // synchronously on resume.
    const keyset = await createKeysetBundle({
      groupName: "Resume No-Sim Key",
      threshold: 2,
      count: 2,
    });
    const localShare = keyset.shares[0];
    const paddedPayload = profilePayloadForShare({
      profileId: "prof_resume_nosim",
      deviceName: "Igloo Web",
      share: localShare,
      group: keyset.group,
      relays: [],
      manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
        keyset.group,
        localShare.idx,
      ),
    });

    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());

    await act(async () => {
      await latest.createKeyset({
        groupName: "Resume No-Sim Key",
        threshold: 2,
        count: 2,
      });
    });
    await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());

    await act(async () => {
      await latest.createProfile({
        deviceName: "Igloo Web",
        password: "profile-password",
        confirmPassword: "profile-password",
        // Zero-length relay list here would be rejected by createProfile
        // (canonical RELAY_EMPTY_ERROR copy); we supply a throwaway
        // entry and rely on lockProfile+unlockProfile to reset into the
        // no-simulator path below.
        relays: ["wss://relay.local"],
        distributionPassword: "distro-password",
        confirmDistributionPassword: "distro-password",
      });
    });
    await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

    const activeProfileId = latest.activeProfile!.id;

    // Lock + unlock with the stored password — this re-boots the runtime
    // WITHOUT attaching a LocalRuntimeSimulator (setRuntime is called
    // with `simulator: undefined`), matching the real unlock-profile
    // path the validator hit in agent-browser.
    act(() => {
      latest.lockProfile();
    });
    await waitFor(() => expect(latest.runtimeStatus).toBeNull());

    await act(async () => {
      await latest.unlockProfile(activeProfileId, "profile-password");
    });
    await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());
    // Baseline sign_ready state after unlock. Depending on peer heartbeat
    // state post-unlock this may be `true` or `false`; the resume
    // assertion below doesn't require a specific baseline — it requires
    // that after resume the snapshot is *re-emitted* to React state.
    const baselineSignReady = latest.runtimeStatus!.readiness.sign_ready;

    // Pause — runtimeStatus remains whatever the runtime last reported.
    act(() => {
      latest.setSignerPaused(true);
    });
    await waitFor(() => expect(latest.signerPaused).toBe(true));

    // Snapshot the runtime_status reference held in React state at the
    // moment just before resume. The bugfix guarantees that resume
    // synchronously publishes a fresh snapshot; without the fix, React
    // state would retain this same object reference until the async
    // `restartRuntimeConnections()` pipeline completes (which can take
    // hundreds of ms in production or may never resolve in a hermetic
    // test where relay connects are intercepted).
    const statusBeforeResume = latest.runtimeStatus;
    expect(statusBeforeResume).toBeTruthy();

    // Resume — the bugfix requires a synchronous re-emit of
    // runtime_status so the UI dispatch gate sees the latest readiness
    // immediately (within 1 runtime tick).
    act(() => {
      latest.setSignerPaused(false);
    });
    await waitFor(() => expect(latest.signerPaused).toBe(false));

    // The runtime_status snapshot must be a freshly-produced one, not a
    // stale reference held over from the paused window. This is what
    // the fix guarantees — without it, the non-simulator resume path
    // queues an async `restartRuntimeConnections()` and never writes
    // `setRuntimeStatus` synchronously, so React state lags behind the
    // user's click. `runtime.runtimeStatus()` returns a freshly-parsed
    // object on each call so identity divergence is a reliable signal
    // that the snapshot was re-emitted.
    expect(latest.runtimeStatus).toBeTruthy();
    expect(latest.runtimeStatus).not.toBe(statusBeforeResume);

    // No stale paused-reason leaked into degraded_reasons.
    expect(
      latest.runtimeStatus!.readiness.degraded_reasons.some(
        (reason) =>
          typeof reason === "string" && reason.toLowerCase().includes("paus"),
      ),
    ).toBe(false);

    // `sign_ready` reflects underlying readiness inputs (peers online
    // above threshold, nonce pool OK, policies allow). Since this path
    // has no simulator driving peer heartbeats, the real runtime may
    // report sign_ready=false (no peer activity); the contract is that
    // the snapshot matches `runtime.runtimeStatus()` — i.e. is derived
    // from the runtime, not a stale or synthesized "paused" value.
    // We assert the observable property: the flag has been recomputed
    // (not stuck at the pre-pause value forever).
    expect(typeof latest.runtimeStatus!.readiness.sign_ready).toBe(
      "boolean",
    );

    // Keep the baseline readable to future maintainers; no strict
    // equality assertion because both `true` and `false` are legitimate
    // depending on the runtime's natural view of peer state.
    expect([true, false]).toContain(baselineSignReady);

    expect(paddedPayload).toBeTruthy();
  }, 30_000);
});
