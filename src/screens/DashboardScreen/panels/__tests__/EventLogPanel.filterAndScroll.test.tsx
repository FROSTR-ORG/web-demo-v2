/**
 * EventLogPanel — filter persistence, scroll-anchor preservation, and
 * "Jump to newest" affordance tests for the `m4-event-log-filter-and-scroll`
 * feature.
 *
 * Fulfills:
 *   - VAL-EVENTLOG-015 (no flicker to empty state; list children stable)
 *   - VAL-EVENTLOG-021 (scroll position preserved on prepend)
 *   - VAL-EVENTLOG-023 (filter selection persists across new ingestion)
 *
 * Expected behaviors covered:
 *   - Filter dropdown hides non-matching entries; Select all / Clear all
 *     work (VAL-EVENTLOG-010 regression guard).
 *   - Filter state survives new event ingestion.
 *   - Filter state survives unmount / remount (route navigation).
 *   - Scrolled-away user: new prepends do NOT auto-scroll; visible top
 *     row remains stable.
 *   - "Jump to newest" affordance is visible only when scrolled off top
 *     and scrolls back to top on click.
 *   - `.event-log-list` wrapper renders so MutationObserver validators
 *     can target it.
 *   - 200 synthetic entries injected in one render pass: strict
 *     newest-first ordering and zero duplicates / drops within the
 *     500-entry cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { __resetEventLogFilterPersistenceForTest } from "../EventLogPanel";

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
  __resetEventLogFilterPersistenceForTest();
  currentState.value = {
    runtimeEventLog: [],
    clearRuntimeEventLog: vi.fn(),
  } as unknown as AppStateValue;
});

afterEach(() => {
  cleanup();
});

describe("EventLogPanel — filter persistence", () => {
  it("defaults runtime filters to no active filtering so every badge renders initially", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ECDH" }),
      entry({ seq: 3, badge: "PING" }),
      entry({ seq: 4, badge: "ERROR" }),
      entry({ seq: 5, badge: "INFO" }),
      entry({ seq: 6, badge: "ONBOARD" }),
    ];
    const { container } = render(<EventLogPanel />);
    const rendered = Array.from(
      container.querySelectorAll(".event-log-type"),
    ).map((n) => n.textContent);
    expect(rendered).toEqual([
      "ONBOARD",
      "INFO",
      "ERROR",
      "PING",
      "ECDH",
      "SIGN",
    ]);
    expect(screen.getByText("6 events")).toBeTruthy();

    const trigger = screen.getByRole("button", {
      name: "Filter event log, no filters active, showing all 11 badges",
    });
    expect(within(trigger).getByText("No filters")).toBeTruthy();
    fireEvent.click(trigger);
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "SIGN" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "ERROR" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "ECDH" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "ONBOARD" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "PING" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "INFO" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps the checkbox popover open while toggling filters and updates active count", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "PING" }),
    ];
    render(<EventLogPanel />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter event log, no filters active, showing all 11 badges",
      }),
    );

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "PING" }));

    expect(screen.getByRole("menu", { name: "Event log filters" })).toBeTruthy();
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "PING" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("button", {
        name: "Filter event log, 10 of 11 badges active",
      }),
    ).toBeTruthy();
  });

  it("groups repeated low-signal PING completions while preserving the raw event count and scrubbed detail", () => {
    currentState.value.runtimeEventLog = [
      entry({
        seq: 1,
        at: 1_000,
        badge: "PING",
        source: "completion",
        payload: { Ping: { request_id: "req-ping-1" } },
      }),
      entry({
        seq: 2,
        at: 2_000,
        badge: "PING",
        source: "completion",
        payload: { Ping: { request_id: "req-ping-2" } },
      }),
      entry({
        seq: 3,
        at: 3_000,
        badge: "PING",
        source: "completion",
        payload: {
          Ping: { request_id: "req-ping-3" },
          passphrase: "hunter2",
        },
      }),
    ];

    const { container } = render(<EventLogPanel />);

    expect(screen.getByText("3 events")).toBeTruthy();
    expect(container.querySelectorAll(".event-log-item").length).toBe(1);
    expect(screen.getByText("Ping completed ×3")).toBeTruthy();
    expect(container.querySelector(".event-log-count-badge")?.textContent).toBe(
      "3",
    );

    fireEvent.click(container.querySelector(".event-log-row")!);
    expect(container.querySelectorAll(".event-log-group-entry").length).toBe(3);
    const expanded = container.querySelector(".event-log-group-expanded")
      ?.textContent ?? "";
    expect(expanded).toContain("req-ping-3");
    expect(expanded).toContain("req-ping-2");
    expect(expanded).toContain("req-ping-1");
    expect(expanded).not.toContain("hunter2");
  });

  it("does not group high-signal ERROR or ONBOARD rows even when repeated", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "ERROR" }),
      entry({ seq: 2, badge: "ERROR" }),
      entry({ seq: 3, badge: "ONBOARD" }),
      entry({ seq: 4, badge: "ONBOARD" }),
    ];

    const { container } = render(<EventLogPanel />);

    expect(screen.getByText("4 events")).toBeTruthy();
    expect(container.querySelectorAll(".event-log-item").length).toBe(4);
    expect(container.querySelector(".event-log-count-badge")).toBeNull();
  });

  it("filters before grouping so matching low-signal rows can collapse after other badges are hidden", () => {
    currentState.value.runtimeEventLog = [
      entry({
        seq: 1,
        at: 1_000,
        badge: "PING",
        source: "completion",
        payload: { Ping: { request_id: "req-ping-1" } },
      }),
      entry({ seq: 2, at: 2_000, badge: "SIGN" }),
      entry({
        seq: 3,
        at: 3_000,
        badge: "PING",
        source: "completion",
        payload: { Ping: { request_id: "req-ping-3" } },
      }),
    ];

    const { container } = render(<EventLogPanel />);
    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByText("Clear all"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "PING" }));

    expect(screen.getByText("2 events")).toBeTruthy();
    expect(container.querySelectorAll(".event-log-item").length).toBe(1);
    expect(screen.getByText("Ping completed ×2")).toBeTruthy();
  });

  it("closes the filter popover from Escape and outside click while preserving trigger focus", async () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ERROR" }),
    ];
    render(<EventLogPanel />);
    const trigger = screen.getByRole("button", {
      name: "Filter event log, no filters active, showing all 11 badges",
    });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Event log filters" });
    await waitFor(() =>
      expect(screen.getByRole("menuitemcheckbox", { name: "SYNC" })).toHaveFocus(),
    );

    fireEvent.keyDown(menu, { key: "End" });
    expect(
      screen.getByRole("menuitemcheckbox", { name: "ONBOARD" }),
    ).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Event log filters" })).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Event log filters" })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Event log filters" })).toBeNull();
  });

  it("Select all / Clear all actions toggle every badge in the dropdown", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ECDH" }),
      entry({ seq: 3, badge: "PING" }),
    ];
    const { container } = render(<EventLogPanel />);
    fireEvent.click(screen.getByText("Filter"));
    // Clear all: every badge toggle is aria-checked=false.
    fireEvent.click(screen.getByText("Clear all"));
    const menuButtons = Array.from(
      container.querySelectorAll(
        ".event-log-filter-menu [role=menuitemcheckbox]",
      ),
    );
    expect(menuButtons.length).toBeGreaterThan(0);
    for (const btn of menuButtons) {
      expect(btn.getAttribute("aria-checked")).toBe("false");
    }
    // No rows rendered under the Clear-all filter.
    expect(container.querySelectorAll(".event-log-item").length).toBe(0);
    // Select all: restore every badge.
    fireEvent.click(screen.getByText("Select all"));
    for (const btn of menuButtons) {
      expect(btn.getAttribute("aria-checked")).toBe("true");
    }
    expect(container.querySelectorAll(".event-log-item").length).toBe(3);
  });

  it("selecting only {SIGN, ECDH} hides PING / INFO rows and count pill reflects filtered count (VAL-EVENTLOG-010 / VAL-EVENTLOG-013)", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ECDH" }),
      entry({ seq: 3, badge: "PING" }),
      entry({ seq: 4, badge: "INFO" }),
    ];
    const { container } = render(<EventLogPanel />);
    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByText("Clear all"));
    // Check only SIGN + ECDH.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "SIGN" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "ECDH" }));
    const rendered = Array.from(
      container.querySelectorAll(".event-log-type"),
    ).map((n) => n.textContent);
    expect(rendered.sort()).toEqual(["ECDH", "SIGN"]);
    // Count pill reflects the filtered count.
    expect(screen.getByText("2 events")).toBeTruthy();
  });

  it("VAL-EVENTLOG-023 — filter persists across new event ingestion (non-matching events do NOT render)", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ECDH" }),
    ];
    const { container, rerender } = render(<EventLogPanel />);
    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByText("Clear all"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "SIGN" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "ECDH" }));
    // Initially {SIGN, ECDH}: 2 rows rendered.
    expect(container.querySelectorAll(".event-log-item").length).toBe(2);

    // Ingest new PING + INFO entries — they're in the buffer but must NOT
    // render because the filter excludes them.
    currentState.value.runtimeEventLog = [
      ...currentState.value.runtimeEventLog,
      entry({ seq: 3, badge: "PING" }),
      entry({ seq: 4, badge: "INFO" }),
    ];
    rerender(<EventLogPanel />);

    const badges = Array.from(
      container.querySelectorAll(".event-log-type"),
    ).map((n) => n.textContent);
    expect(badges.sort()).toEqual(["ECDH", "SIGN"]);
    // Still 2 events (filtered count).
    expect(screen.getByText("2 events")).toBeTruthy();
    // Dropdown still open and checkboxes still set to {SIGN, ECDH} only.
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "SIGN" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "PING" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("filter selection survives unmount / remount (route navigation to Settings and back)", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "PING" }),
    ];
    const { container, unmount } = render(<EventLogPanel />);
    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByText("Clear all"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "SIGN" }));
    // Only SIGN visible.
    expect(container.querySelectorAll(".event-log-item").length).toBe(1);
    // Unmount (simulate leaving the dashboard).
    unmount();
    // Remount (simulate returning).
    const r2 = render(<EventLogPanel />);
    fireEvent.click(r2.getByText("Filter"));
    expect(
      r2
        .getByRole("menuitemcheckbox", { name: "SIGN" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      r2
        .getByRole("menuitemcheckbox", { name: "PING" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    // Still only SIGN renders.
    const rerenderedBadges = Array.from(
      r2.container.querySelectorAll(".event-log-type"),
    ).map((n) => n.textContent);
    expect(rerenderedBadges).toEqual(["SIGN"]);
  });
});

describe("EventLogPanel — scroll anchor & jump to newest", () => {
  it("renders a `.event-log-list` wrapper containing every visible item row (MutationObserver target for VAL-EVENTLOG-015)", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ERROR" }),
    ];
    const { container } = render(<EventLogPanel />);
    const list = container.querySelector(".event-log-list");
    expect(list).toBeTruthy();
    const rows = list!.querySelectorAll(".event-log-item");
    expect(rows.length).toBe(2);
  });

  it("VAL-EVENTLOG-021 — when user is scrolled off-top, prepended events do NOT shift the visible scroll anchor", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ERROR" }),
      entry({ seq: 3, badge: "SIGN" }),
    ];
    const { container, rerender } = render(<EventLogPanel />);
    const listEl = container.querySelector(".event-log-list") as HTMLElement;
    expect(listEl).toBeTruthy();
    // Simulate a scrolled state: jsdom doesn't implement real layout, but
    // scrollTop/scrollHeight are writable numeric properties on HTMLElement
    // mocks. Seed them so the panel's useLayoutEffect can compute a delta.
    Object.defineProperty(listEl, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    listEl.scrollTop = 200;
    // User scroll event — component reads scrollTop to decide whether
    // the Jump-to-newest affordance should appear.
    fireEvent.scroll(listEl);
    expect(screen.getByText(/jump to newest/i)).toBeTruthy();

    // Now ingest an entry: scrollHeight grows by 40 px (one row's height).
    currentState.value.runtimeEventLog = [
      ...currentState.value.runtimeEventLog,
      entry({ seq: 4, badge: "ERROR" }),
    ];
    Object.defineProperty(listEl, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    rerender(<EventLogPanel />);
    // Scroll anchor preserved: previous scrollTop 200 + delta 40 = 240.
    expect(listEl.scrollTop).toBe(240);
  });

  it("'Jump to newest' is hidden when scrolled at top and visible when scrolled down", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ERROR" }),
    ];
    const { container } = render(<EventLogPanel />);
    // Initially at top (scrollTop=0) — affordance hidden.
    expect(screen.queryByText(/jump to newest/i)).toBeNull();
    const listEl = container.querySelector(".event-log-list") as HTMLElement;
    Object.defineProperty(listEl, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    listEl.scrollTop = 150;
    fireEvent.scroll(listEl);
    expect(screen.getByText(/jump to newest/i)).toBeTruthy();
    // Click Jump to newest → scrollTop resets.
    fireEvent.click(screen.getByText(/jump to newest/i));
    expect(listEl.scrollTop).toBe(0);
    fireEvent.scroll(listEl);
    expect(screen.queryByText(/jump to newest/i)).toBeNull();
  });

  it("high-rate ingestion: 200 entries with monotonic seq render strict newest-first with zero drops / duplicates (VAL-EVENTLOG-024)", () => {
    const entries: RuntimeEventLogEntry[] = [];
    for (let i = 1; i <= 200; i += 1) {
      entries.push(
        entry({ seq: i, badge: "SIGN", payload: { seq_id: i } }),
      );
    }
    currentState.value.runtimeEventLog = entries;
    const { container } = render(<EventLogPanel />);
    const items = container.querySelectorAll(".event-log-item");
    expect(items.length).toBe(200);
    // Strict newest-first: first DOM row should be the highest seq.
    // Expand every row and scan the JSON for the encoded seq_id.
    const payloadSeqs: number[] = [];
    items.forEach((item) => {
      // `event-log-row` is the button toggle; click to expand.
      const row = item.querySelector(".event-log-row");
      if (row) act(() => fireEvent.click(row));
    });
    container
      .querySelectorAll(".event-log-expanded")
      .forEach((node) => {
        const text = node.textContent ?? "";
        const match = text.match(/"seq_id": (\d+)/);
        if (match) payloadSeqs.push(Number.parseInt(match[1], 10));
      });
    expect(payloadSeqs.length).toBe(200);
    // Strictly descending (200, 199, ..., 1).
    for (let i = 0; i < payloadSeqs.length - 1; i += 1) {
      expect(payloadSeqs[i]).toBe(payloadSeqs[i + 1] + 1);
    }
    // No duplicates.
    expect(new Set(payloadSeqs).size).toBe(payloadSeqs.length);
    // Min and max bracket the expected range.
    expect(Math.min(...payloadSeqs)).toBe(1);
    expect(Math.max(...payloadSeqs)).toBe(200);
  }, 10_000);

  it("no-flicker-to-empty on intra-session remount (VAL-EVENTLOG-015): buffer-backed rows are visible on first paint", () => {
    currentState.value.runtimeEventLog = [
      entry({ seq: 1, badge: "SIGN" }),
      entry({ seq: 2, badge: "ERROR" }),
      entry({ seq: 3, badge: "SIGN" }),
    ];
    const { container, unmount } = render(<EventLogPanel />);
    const initialCount = container.querySelectorAll(".event-log-item").length;
    expect(initialCount).toBe(3);
    unmount();
    // Re-mount (simulate dashboard route returning to view). Buffer is
    // still non-empty in AppState so on first paint the list must show
    // rows — never "No events yet".
    const r2 = render(<EventLogPanel />);
    expect(r2.queryByText("No events yet")).toBeNull();
    expect(
      r2.container.querySelectorAll(".event-log-item").length,
    ).toBe(initialCount);
  });

  it("does not use a scrollable list when the panel is in Paper-fixture mode", () => {
    const rows = [
      {
        id: "fixture-1",
        time: "2:34:15p",
        type: "Sync" as const,
        copy: "Pool sync",
        details: {},
      },
    ];
    currentState.value = null as unknown as AppStateValue;
    const { container } = render(<EventLogPanel rows={rows} />);
    // Paper-fixture mode preserves its original DOM shape — no
    // `.event-log-list` wrapper injected.
    expect(container.querySelector(".event-log-list")).toBeNull();
    expect(within(container).getByText(/Pool sync/)).toBeTruthy();
  });
});
