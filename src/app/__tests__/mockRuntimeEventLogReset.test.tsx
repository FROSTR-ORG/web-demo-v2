/**
 * Regression test for scrutiny m4 r1 finding:
 *
 *   `MockAppStateProvider.lockProfile` and
 *   `MockAppStateProvider.clearCredentials` must flush the
 *   `runtimeEventLog` slice so stale dashboard event-log rows do NOT
 *   bleed across reset flows in demo / mock-backed scenarios.
 *
 * Mirrors the real AppStateProvider semantics covered by
 * `runtimeEventLog.test.tsx`'s VAL-EVENTLOG-016 assertions; the mock
 * provider was previously resetting every other runtime slice
 * (`runtimeCompletions`, `runtimeFailures`, `lifecycleEvents`,
 * `signDispatchLog`, `signLifecycleLog`, `pendingDispatchIndex`) but
 * forgot `runtimeEventLog`. See feature
 * `fix-m4-mock-runtime-event-log-reset-on-lock-clear`.
 */
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MockAppStateProvider, useAppState } from "../AppState";
import type { AppStateValue, RuntimeEventLogEntry } from "../AppStateTypes";
import { createDemoAppState, demoProfile, demoRuntimeStatus } from "../../demo/fixtures";

function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function makeEntry(seq: number): RuntimeEventLogEntry {
  return {
    seq,
    at: 1_700_000_000_000 + seq,
    badge: "INFO",
    source: "runtime_event",
    payload: { n: seq },
  };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("MockAppStateProvider — runtimeEventLog reset on lock / clearCredentials", () => {
  it("lockProfile empties runtimeEventLog on the mock provider (parity with AppStateProvider)", async () => {
    const seed = createDemoAppState({
      profiles: [demoProfile],
      activeProfile: demoProfile,
      runtimeStatus: demoRuntimeStatus,
      runtimeEventLog: [makeEntry(1), makeEntry(2), makeEntry(3)],
    });

    let latest!: AppStateValue;
    render(
      <MockAppStateProvider value={seed} bridge={false}>
        <Capture onState={(state) => (latest = state)} />
      </MockAppStateProvider>,
    );

    await waitFor(() => expect(latest).toBeTruthy());
    expect(latest.runtimeEventLog).toHaveLength(3);

    await act(async () => {
      latest.lockProfile();
    });

    await waitFor(() => expect(latest.runtimeEventLog).toHaveLength(0));
  });

  it("clearCredentials empties runtimeEventLog on the mock provider (parity with AppStateProvider)", async () => {
    const seed = createDemoAppState({
      profiles: [demoProfile],
      activeProfile: demoProfile,
      runtimeStatus: demoRuntimeStatus,
      runtimeEventLog: [makeEntry(1), makeEntry(2)],
    });

    let latest!: AppStateValue;
    render(
      <MockAppStateProvider value={seed} bridge={false}>
        <Capture onState={(state) => (latest = state)} />
      </MockAppStateProvider>,
    );

    await waitFor(() => expect(latest).toBeTruthy());
    expect(latest.runtimeEventLog).toHaveLength(2);

    await act(async () => {
      await latest.clearCredentials();
    });

    await waitFor(() => expect(latest.runtimeEventLog).toHaveLength(0));
  });
});
