/**
 * Tests for `AppStateValue.clearRuntimeEventLog` — the mutator backing
 * the Event Log panel's Clear button. Clearing must:
 *  - empty the in-memory `runtimeEventLog` slice
 *  - reset the seq counter so the next ingested entry starts at seq 1
 *  - mirror into `window.__debug.runtimeEventLog` so validators see the
 *    zero state
 *
 * Separate from the VAL-EVENTLOG-016 Lock / Clear-Credentials resets:
 * this mutator ONLY touches the event log buffer, leaving the rest of
 * the unlocked profile state intact (covers VAL-EVENTLOG-012).
 */
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { AppStateProvider } from "../AppStateProvider";
import { useAppState } from "../AppState";
import type {
  AppStateValue,
  RuntimeEventLogBadge,
  RuntimeEventLogEntry,
} from "../AppStateTypes";

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

interface TestWindow extends Window {
  __debug?: {
    runtimeEventLog: RuntimeEventLogEntry[];
  };
  __iglooTestInjectEventLogEntries?: (
    entries: Array<{
      badge: RuntimeEventLogBadge;
      payload?: unknown;
      at?: number;
    }>,
  ) => void;
}

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

describe("AppStateValue.clearRuntimeEventLog", () => {
  it("empties the buffer and resets the seq counter (VAL-EVENTLOG-012)", async () => {
    let latest!: AppStateValue;
    render(
      <AppStateProvider>
        <Capture onState={(state) => (latest = state)} />
      </AppStateProvider>,
    );
    await waitFor(() => expect(latest).toBeTruthy());
    const testWindow = window as TestWindow;

    // Inject 5 entries.
    await act(async () => {
      testWindow.__iglooTestInjectEventLogEntries?.([
        { badge: "SIGN", payload: { n: 1 } },
        { badge: "ECDH", payload: { n: 2 } },
        { badge: "PING", payload: { n: 3 } },
        { badge: "INFO", payload: { n: 4 } },
        { badge: "ERROR", payload: { n: 5 } },
      ]);
    });
    await waitFor(() => expect(latest.runtimeEventLog.length).toBe(5));

    // Clear.
    await act(async () => {
      expect(typeof latest.clearRuntimeEventLog).toBe("function");
      latest.clearRuntimeEventLog();
    });
    await waitFor(() => expect(latest.runtimeEventLog.length).toBe(0));
    expect(testWindow.__debug?.runtimeEventLog.length).toBe(0);

    // After clear, the next ingested entry starts at seq 1.
    await act(async () => {
      testWindow.__iglooTestInjectEventLogEntries?.([
        { badge: "INFO", payload: { n: 6 } },
      ]);
    });
    await waitFor(() => expect(latest.runtimeEventLog.length).toBe(1));
    expect(latest.runtimeEventLog[0].seq).toBe(1);
  });
});
