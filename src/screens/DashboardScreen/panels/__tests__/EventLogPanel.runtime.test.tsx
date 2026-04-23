/**
 * EventLogPanel — consumer tests for the runtime-wired variant.
 *
 * The panel now reads from `AppState.runtimeEventLog` (when no `rows`
 * prop is supplied) and renders:
 *   - `HH:MM:SS` monospace timestamps
 *   - Typed badges: SYNC / SIGN / ECDH / ECHO / PING / SIGNER_POLICY /
 *     PEER_POLICY / READY / INFO / ERROR
 *   - Newest-first ordering
 *   - Expand/collapse per row with pretty (2-space-indented) JSON
 *   - Clear button that invokes `AppState.clearRuntimeEventLog`
 *   - Payload scrubbing (VAL-EVENTLOG-019)
 *   - Request-id correlation support for VAL-CROSS-015 (the expanded
 *     JSON exposes the same `request_id` as the dispatch that produced
 *     the event)
 *
 * Fulfills the m4-event-log-panel feature expected-behavior clauses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  AppStateValue,
  RuntimeEventLogEntry,
} from "../../../../app/AppStateTypes";

const currentState: { value: AppStateValue } = {
  value: {} as AppStateValue,
};

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => currentState.value,
}));

import { EventLogPanel } from "../EventLogPanel";

function entry(
  overrides: Partial<RuntimeEventLogEntry> & {
    seq: number;
    badge: RuntimeEventLogEntry["badge"];
  },
): RuntimeEventLogEntry {
  return {
    seq: overrides.seq,
    at: overrides.at ?? 0,
    badge: overrides.badge,
    source: overrides.source ?? "runtime_event",
    payload: overrides.payload ?? { request_id: `req-${overrides.seq}` },
  };
}

beforeEach(() => {
  currentState.value = {
    runtimeEventLog: [],
    clearRuntimeEventLog: vi.fn(),
  } as unknown as AppStateValue;
});

afterEach(() => {
  cleanup();
});

describe("EventLogPanel — runtime wiring", () => {
  it("shows empty state when the runtime buffer is empty", () => {
    render(<EventLogPanel />);
    expect(screen.getByText("No events yet")).toBeTruthy();
    expect(screen.getByText("0 events")).toBeTruthy();
  });

  it("renders entries newest-first with HH:MM:SS timestamps and badges", () => {
    // Build three entries with distinct timestamps and badges.
    const t1 = new Date("2026-04-22T09:01:02Z").getTime();
    const t2 = new Date("2026-04-22T09:02:03Z").getTime();
    const t3 = new Date("2026-04-22T09:03:04Z").getTime();
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN", at: t1, payload: { request_id: "req-alpha" } }),
      entry({ seq: 2, badge: "ECDH", at: t2, payload: { request_id: "req-beta" } }),
      entry({ seq: 3, badge: "PING", at: t3, payload: { request_id: "req-gamma" } }),
    ];
    const { container } = render(<EventLogPanel />);
    // Count pill reflects total.
    expect(screen.getByText("3 events")).toBeTruthy();

    const items = container.querySelectorAll(".event-log-item");
    expect(items.length).toBe(3);
    // Newest-first: seq 3 (PING) first, seq 1 (SIGN) last.
    const badges = Array.from(items).map(
      (row) => row.querySelector(".event-log-type")?.textContent,
    );
    expect(badges).toEqual(["PING", "ECDH", "SIGN"]);

    // Every timestamp matches HH:MM:SS.
    const times = Array.from(items).map(
      (row) => row.querySelector(".event-log-time")?.textContent ?? "",
    );
    for (const time of times) {
      expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
  });

  it("applies typed-badge CSS classes matching the Paper taxonomy", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SYNC" }),
      entry({ seq: 2, badge: "SIGN" }),
      entry({ seq: 3, badge: "ECDH" }),
      entry({ seq: 4, badge: "PING" }),
      entry({ seq: 5, badge: "ECHO" }),
      entry({ seq: 6, badge: "SIGNER_POLICY" }),
      entry({ seq: 7, badge: "PEER_POLICY" }),
      entry({ seq: 8, badge: "READY" }),
      entry({ seq: 9, badge: "INFO" }),
      entry({ seq: 10, badge: "ERROR" }),
    ];
    const { container } = render(<EventLogPanel />);
    const badgeClasses = Array.from(
      container.querySelectorAll(".event-log-type"),
    ).map((node) => node.className);
    // Rendered newest-first, so ERROR (seq 10) is first.
    expect(badgeClasses[0]).toContain("error");
    expect(badgeClasses[1]).toContain("info");
    expect(badgeClasses[2]).toContain("ready");
    expect(badgeClasses[3]).toContain("peer-policy");
    expect(badgeClasses[4]).toContain("signer-policy");
    expect(badgeClasses[5]).toContain("echo");
    expect(badgeClasses[6]).toContain("ping");
    expect(badgeClasses[7]).toContain("ecdh");
    expect(badgeClasses[8]).toContain("sign");
    expect(badgeClasses[9]).toContain("sync");
  });

  it("expands a row to render 2-space-indented JSON of the payload", () => {
    currentState.value.runtimeEventLog = [
      entry({
        seq: 1,
        badge: "SIGN",
        payload: { request_id: "req-sign-1", message: "deadbeef" },
      }),
    ];
    const { container } = render(<EventLogPanel />);
    const row = container.querySelector(".event-log-row");
    if (!row) throw new Error("expected a row");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    const expanded = container.querySelector(".event-log-expanded");
    expect(expanded).toBeTruthy();
    const text = expanded?.textContent ?? "";
    // Pretty-printed JSON: there is a newline after the opening brace
    // and two-space indentation on nested keys.
    expect(text).toMatch(/\{\n  "request_id": "req-sign-1"/);
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("scrubs sensitive fields (partial_signature, share_secret, nonce_secret, passphrase, bfprofile) from the expanded JSON", () => {
    const bfprofileToken =
      "bfprofile1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4q9xgclkz4f5e0r8p2d7y6m3n0";
    currentState.value.runtimeEventLog = [
      entry({
        seq: 1,
        badge: "SIGN",
        payload: {
          request_id: "req-sign-1",
          partial_signature: "DEADBEEF".repeat(8),
          share_secret: "0123456789abcdef".repeat(4),
          nonce_secret: "aa".repeat(32),
          passphrase: "hunter2",
          backup_string: bfprofileToken,
        },
      }),
    ];
    const { container } = render(<EventLogPanel />);
    fireEvent.click(container.querySelector(".event-log-row")!);
    const text = container.querySelector(".event-log-expanded")?.textContent ?? "";
    expect(text).not.toContain("DEADBEEFDEADBEEF");
    expect(text).not.toContain("0123456789abcdef");
    expect(text).not.toContain("aaaaaaaa");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("bfprofile1q");
    expect(text).toContain("request_id");
    expect(text).toContain("req-sign-1");
  });

  it("Clear button empties display AND calls AppState.clearRuntimeEventLog", () => {
    // The real AppStateProvider.clearRuntimeEventLog empties the buffer
    // synchronously (see src/app/AppStateProvider.tsx — setRuntimeEventLog([])
    // AND runtimeEventLogSeqRef.current = 0). Simulate that faithfully so
    // the test verifies the panel's Clear semantics end-to-end rather than
    // relying on a local seq-threshold fallback that hid the post-clear
    // "seq resets to 0" bug flagged in scrutiny m4 r1.
    const clearRuntimeEventLog = vi.fn(() => {
      currentState.value.runtimeEventLog = [];
    });
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ECDH" }),
    ];
    currentState.value.clearRuntimeEventLog = clearRuntimeEventLog;
    const { rerender } = render(<EventLogPanel />);
    fireEvent.click(screen.getByText("Clear"));
    expect(clearRuntimeEventLog).toHaveBeenCalledTimes(1);
    // The mutator emptied the buffer; rerender reflects the new AppState.
    rerender(<EventLogPanel />);
    expect(screen.getByText("No events yet")).toBeTruthy();
    expect(screen.getByText("0 events")).toBeTruthy();
  });

  it("post-clear events with reset seq (1, 2, …) render immediately — no seq-threshold gating (scrutiny m4 r1 fix)", () => {
    // Mirrors the real AppStateProvider.clearRuntimeEventLog contract:
    // clearing empties the buffer AND resets runtimeEventLogSeqRef to 0,
    // so subsequent ingestion starts at seq 1 again. The previous local
    // `clearedBaselineSeq` fallback hid these post-clear entries because
    // they failed the `entry.seq > baseline` check (baseline was the
    // pre-clear max seq). This test locks in the new behavior: as soon
    // as the buffer is non-empty after clear, the new rows render.
    const clearRuntimeEventLog = vi.fn(() => {
      currentState.value.runtimeEventLog = [];
    });
    // (a) Seed 3 entries (seqs 1..3) and render.
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN", payload: { request_id: "req-pre-1" } }),
      entry({ seq: 2, badge: "ECDH", payload: { request_id: "req-pre-2" } }),
      entry({ seq: 3, badge: "PING", payload: { request_id: "req-pre-3" } }),
    ];
    currentState.value.clearRuntimeEventLog = clearRuntimeEventLog;
    const { container, rerender } = render(<EventLogPanel />);
    expect(container.querySelectorAll(".event-log-item").length).toBe(3);

    // (b) Click Clear → mutator empties the buffer.
    fireEvent.click(screen.getByText("Clear"));
    rerender(<EventLogPanel />);
    expect(screen.getByText("No events yet")).toBeTruthy();

    // (c) Seed 2 new entries AFTER clear with seq restarting at 1 — the
    // realistic post-clear state (runtimeEventLogSeqRef was reset to 0).
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "INFO", payload: { request_id: "req-post-1" } }),
      entry({ seq: 2, badge: "SYNC", payload: { request_id: "req-post-2" } }),
    ];
    rerender(<EventLogPanel />);

    // (d) Both post-clear entries render immediately without any
    //     additional seq advancement past the pre-clear maximum.
    const items = container.querySelectorAll(".event-log-item");
    expect(items.length).toBe(2);
    const badges = Array.from(items).map(
      (row) => row.querySelector(".event-log-type")?.textContent,
    );
    // Newest-first ordering preserved.
    expect(badges).toEqual(["SYNC", "INFO"]);
    expect(screen.getByText("2 events")).toBeTruthy();
    // No residual "No events yet" empty state.
    expect(screen.queryByText("No events yet")).toBeNull();
  });

  it("correlation: the expanded JSON exposes the same request_id as the source payload (VAL-CROSS-015)", () => {
    // Two rows derived from the same sign dispatch: the runtime_event
    // announcing the sign request, and the completion. Both carry the
    // same `request_id` so the UI (and an inspecting user) can
    // correlate the Pending Approval row to the Event Log entries.
    const requestId = "req-sign-correlation";
    currentState.value.runtimeEventLog = [
      entry({
        seq: 1,
        badge: "INFO",
        source: "runtime_event",
        payload: { kind: "command_queued", request_id: requestId },
      }),
      entry({
        seq: 2,
        badge: "SIGN",
        source: "completion",
        payload: { Sign: { request_id: requestId, signatures_hex64: [] } },
      }),
    ];
    const { container } = render(<EventLogPanel />);
    const rows = container.querySelectorAll(".event-log-row");
    for (const row of rows) {
      fireEvent.click(row);
    }
    const payloads = Array.from(
      container.querySelectorAll(".event-log-expanded"),
    ).map((node) => node.textContent ?? "");
    expect(payloads.length).toBe(2);
    for (const text of payloads) {
      expect(text).toContain(requestId);
    }
  });

  it("accepts an explicit `rows` prop (Paper fixture mode) without reading AppState", () => {
    const rows = [
      {
        id: "fixture-1",
        time: "2:34:15p",
        type: "Sync" as const,
        copy: "Pool sync with peer #0",
        details: { peer: "peer#0" },
      },
    ];
    // When rows are supplied, the runtime buffer is ignored — so even
    // an intentionally broken AppState reference doesn't break the
    // render path.
    currentState.value = null as unknown as AppStateValue;
    const { container } = render(<EventLogPanel rows={rows} />);
    expect(within(container).getByText(/Pool sync with peer #0/)).toBeTruthy();
  });
});
