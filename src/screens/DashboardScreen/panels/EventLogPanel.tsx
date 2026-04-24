import { ChevronDown } from "lucide-react";
import type { KeyboardEvent } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StatusPill } from "../../../components/ui";
import { useAppState } from "../../../app/AppState";
import type {
  RuntimeEventLogBadge,
  RuntimeEventLogEntry,
} from "../../../app/AppStateTypes";
import { scrubEventLogPayload } from "../../../lib/bifrost/eventLogScrub";
import {
  MOCK_EVENT_LOG_ROWS,
  MOCK_EVENT_TOTAL,
  type DashboardEventKind,
  type DashboardEventRow,
} from "../mocks";

/**
 * The canonical badges rendered by the runtime-wired Event Log panel.
 * Order here is the order shown in the Filter dropdown and the order
 * in which colour-class hints are matched in CSS
 * (`.event-log-type.sync`, `.event-log-type.sign`, …).
 */
const RUNTIME_BADGES: RuntimeEventLogBadge[] = [
  "SYNC",
  "SIGN",
  "ECDH",
  "ECHO",
  "PING",
  "SIGNER_POLICY",
  "PEER_POLICY",
  "READY",
  "INFO",
  "ERROR",
  // fix-m7-scrutiny-r1-sponsor-concurrency-and-badge — the
  // VAL-ONBOARD-011 contract requires onboarding lifecycle entries
  // (completion + failure) to carry a distinct ONBOARD badge so
  // Event Log filters can isolate them from the generic INFO /
  // ERROR buckets.
  "ONBOARD",
];

const LOW_SIGNAL_GROUP_BADGES = new Set<RuntimeEventLogBadge>([
  "SYNC",
  "PING",
  "INFO",
  "READY",
]);
const EVENT_LOG_GROUP_WINDOW_MS = 15_000;

type EventLogDisplayRow =
  | {
      kind: "single";
      id: string;
      entry: RuntimeEventLogEntry;
    }
  | {
      kind: "group";
      id: string;
      entries: RuntimeEventLogEntry[];
      summary: string;
    };

function defaultRuntimeFilterBadges(): Set<RuntimeEventLogBadge> {
  return new Set(RUNTIME_BADGES);
}

/**
 * Kebab-case CSS suffix used with `.event-log-type.<suffix>` in
 * `global.css` to colour the typed badge chip. Keep in sync with the
 * taxonomy defined in `src/styles/global.css` (search for
 * `.event-log-type.`).
 */
function runtimeBadgeClassName(badge: RuntimeEventLogBadge): string {
  switch (badge) {
    case "SYNC":
      return "sync";
    case "SIGN":
      return "sign";
    case "ECDH":
      return "ecdh";
    case "PING":
      return "ping";
    case "ECHO":
      return "echo";
    case "SIGNER_POLICY":
      return "signer-policy";
    case "PEER_POLICY":
      return "peer-policy";
    case "READY":
      return "ready";
    case "INFO":
      return "info";
    case "ERROR":
      return "error";
    case "ONBOARD":
      return "onboard";
  }
}

/**
 * Legacy Paper-mode filter options kept for backward-compat when the
 * panel is driven by the `rows` prop (demo gallery fixtures).
 */
const LEGACY_FILTERS: Array<"all" | DashboardEventKind> = [
  "all",
  "Sync",
  "Sign",
  "Ecdh",
  "Signer Policy",
  "Ping",
  "Echo",
  "Error",
];

function labelForLegacyFilter(filter: "all" | DashboardEventKind): string {
  return filter === "all" ? "All" : filter;
}

function legacyEventClassName(type: DashboardEventKind): string {
  return type.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Format a wall-clock ms timestamp as `HH:MM:SS` in the user's local
 * time zone. Always two digits per component. Matches the monospace
 * Paper reference (VAL-EVENTLOG-008).
 */
function formatHhMmSs(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

/**
 * Build a one-line human-readable summary of a runtime event log
 * entry's payload so the collapsed row shows more than the raw badge.
 * Never surfaces secret material — callers expand the row to inspect
 * the fully-scrubbed JSON body. Intentionally terse: everything
 * interesting is in the expanded JSON.
 */
function summarizeEntry(entry: RuntimeEventLogEntry): string {
  if (entry.source === "completion") {
    const payload = entry.payload as Record<string, unknown>;
    if (payload && typeof payload === "object") {
      const key = Object.keys(payload)[0];
      if (key) {
        const inner = payload[key] as { request_id?: string } | undefined;
        const rid = inner?.request_id;
        return rid ? `${key} completed (${rid.slice(0, 10)})` : `${key} completed`;
      }
    }
    return "Operation completed";
  }
  if (entry.source === "failure") {
    const payload = entry.payload as {
      op_type?: string;
      code?: string;
      message?: string;
    };
    const op = payload?.op_type ?? "operation";
    const code = payload?.code ? ` (${payload.code})` : "";
    return `${op} failed${code}${payload?.message ? ` — ${payload.message}` : ""}`;
  }
  if (entry.source === "local_mutation") {
    // fix-m7-scrutiny-r1-sponsor-concurrency-and-badge —
    // VAL-ONBOARD-011 ONBOARD badge summaries. Truncate
    // request_id to 10 chars like the completion-channel copy for
    // consistency.
    const onboardPayload = entry.payload as {
      kind?: string;
      request_id?: string;
      peer_pubkey32?: string | null;
      reason?: string;
    } | null;
    if (onboardPayload?.kind === "onboard_completed") {
      const rid = onboardPayload.request_id ?? "";
      return rid
        ? `Onboard completed (${rid.slice(0, 10)})`
        : "Onboard completed";
    }
    if (onboardPayload?.kind === "onboard_failed") {
      const rid = onboardPayload.request_id ?? "";
      const trail = onboardPayload.reason ? ` — ${onboardPayload.reason}` : "";
      return rid
        ? `Onboard failed (${rid.slice(0, 10)})${trail}`
        : `Onboard failed${trail}`;
    }
    return "Local mutation";
  }
  // runtime_event
  const payload = entry.payload as { kind?: string } | null;
  const kind = payload?.kind ?? "runtime event";
  return String(kind);
}

function runtimeEventKind(entry: RuntimeEventLogEntry): string | null {
  const payload = entry.payload as { kind?: unknown } | null;
  return typeof payload?.kind === "string" && payload.kind.length > 0
    ? payload.kind
    : null;
}

function eventLogGroupKey(entry: RuntimeEventLogEntry): string | null {
  if (!LOW_SIGNAL_GROUP_BADGES.has(entry.badge)) return null;
  if (entry.badge === "PING") {
    return `${entry.badge}:${entry.source}`;
  }
  return `${entry.badge}:${runtimeEventKind(entry) ?? entry.source}`;
}

function groupSummary(entry: RuntimeEventLogEntry): string {
  if (entry.source === "completion") {
    const payload = entry.payload as Record<string, unknown>;
    const key = payload && typeof payload === "object"
      ? Object.keys(payload)[0]
      : "";
    return key ? `${key} completed` : "Operation completed";
  }
  return runtimeEventKind(entry) ?? summarizeEntry(entry);
}

function groupEventLogRows(
  entries: RuntimeEventLogEntry[],
): EventLogDisplayRow[] {
  const rows: EventLogDisplayRow[] = [];
  for (let idx = 0; idx < entries.length; idx += 1) {
    const first = entries[idx];
    const key = eventLogGroupKey(first);
    if (!key) {
      rows.push({ kind: "single", id: `event-${first.seq}`, entry: first });
      continue;
    }

    const group = [first];
    let cursor = idx + 1;
    while (cursor < entries.length) {
      const candidate = entries[cursor];
      if (eventLogGroupKey(candidate) !== key) break;
      if (Math.abs(first.at - candidate.at) > EVENT_LOG_GROUP_WINDOW_MS) break;
      group.push(candidate);
      cursor += 1;
    }

    if (group.length < 2) {
      rows.push({ kind: "single", id: `event-${first.seq}`, entry: first });
      continue;
    }

    rows.push({
      kind: "group",
      id: `group-${key}-${group[0].seq}-${group[group.length - 1].seq}`,
      entries: group,
      summary: `${groupSummary(first)} ×${group.length}`,
    });
    idx = cursor - 1;
  }
  return rows;
}

/**
 * Module-scoped filter selection cache. The `selectedBadges` Set
 * survives unmount/remount cycles so a user that:
 *   1. Selects `{SIGN, ECDH}` in the Filter dropdown,
 *   2. Opens the Settings sidebar (RunningState stays mounted but some
 *      dashboard-state transitions can remount the panel),
 *   3. Navigates to another dashboard route and back,
 * still sees the same filter applied on return. The module cache is
 * NOT part of AppState because the selection is ephemeral UX state —
 * it does not need to survive a full reload or a Lock/Unlock cycle.
 *
 * Reset exposed via `__resetEventLogFilterPersistenceForTest` so
 * unit tests can guarantee a clean initial state.
 */
const eventLogFilterCache: {
  selectedBadges: Set<RuntimeEventLogBadge>;
} = {
  selectedBadges: defaultRuntimeFilterBadges(),
};

/** Test-only helper: reset module-scoped filter cache to the unfiltered default. */
export function __resetEventLogFilterPersistenceForTest(): void {
  eventLogFilterCache.selectedBadges = defaultRuntimeFilterBadges();
}

/**
 * Dashboard Event Log panel.
 *
 * Two driving modes:
 *   1. **Runtime mode (default):** when no `rows` prop is supplied the
 *      panel reads from `AppState.runtimeEventLog` — the bounded ring
 *      buffer populated by `AppStateProvider` from every runtime drain
 *      channel (runtime_event, completion, failure). Rows are rendered
 *      newest-first with `HH:MM:SS` local-time timestamps, typed Paper
 *      badges, and per-row expand/collapse JSON. The Clear button
 *      flushes both the visible display AND the underlying buffer via
 *      {@link AppStateValue.clearRuntimeEventLog}, honouring the
 *      VAL-EVENTLOG-012 "Clear empties buffer AND display" contract.
 *      Payloads are passed through {@link scrubEventLogPayload} before
 *      JSON-stringify so `partial_signature`, `share_secret`,
 *      `nonce_secret`, `passphrase`, and plaintext `bfprofile1…`
 *      tokens never reach the DOM (VAL-EVENTLOG-019).
 *
 *      Filter state (selected badges) is cached at module scope so it
 *      survives unmount/remount (VAL-EVENTLOG-023 + feature
 *      `m4-event-log-filter-and-scroll`). User scroll state is
 *      preserved on new event ingestion: when the user has scrolled
 *      off-top we reposition by `newScrollHeight - prevScrollHeight`
 *      so the previously-visible row stays in the viewport, and a
 *      "Jump to newest" affordance appears (VAL-EVENTLOG-021).
 *
 *   2. **Paper-fixture mode:** when a `rows` prop is supplied the
 *      panel renders those rows verbatim, preserving the legacy Paper
 *      gallery layout. Used by the demo gallery scenarios that were
 *      authored against the Paper reference before the runtime
 *      buffer existed.
 */
export function EventLogPanel({
  rows,
  initialFilter = "all",
  initialExpandedId,
}: {
  /**
   * When supplied, the panel renders these Paper-fixture rows directly
   * and bypasses all `AppState.runtimeEventLog` wiring. Used by the
   * demo gallery to preserve visual-fidelity tests. When omitted the
   * panel wires through to the runtime event-log buffer on AppState.
   */
  rows?: DashboardEventRow[];
  initialFilter?: "all" | DashboardEventKind;
  initialExpandedId?: string;
} = {}) {
  // Paper-fixture path. Keep completely separate from the runtime
  // path so tests/scenarios that pass a fabricated AppState can render
  // without reading through `useAppState`.
  if (rows !== undefined) {
    return (
      <LegacyFixtureEventLog
        rows={rows}
        initialFilter={initialFilter}
        initialExpandedId={initialExpandedId}
      />
    );
  }
  return <RuntimeEventLog />;
}

function RuntimeEventLog() {
  const state = useAppState();
  const runtimeEventLog = state.runtimeEventLog ?? [];
  const clearRuntimeEventLog = state.clearRuntimeEventLog;

  const [filterOpen, setFilterOpen] = useState(false);
  const filterMenuId = useId();
  const filterWrapRef = useRef<HTMLDivElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  // Initialise from the module-level cache so filter selections survive
  // unmount/remount cycles (see `eventLogFilterCache`).
  const [selectedBadges, setSelectedBadgesState] = useState<Set<RuntimeEventLogBadge>>(
    () => new Set(eventLogFilterCache.selectedBadges),
  );
  const setSelectedBadges = useCallback(
    (
      updater: (
        previous: Set<RuntimeEventLogBadge>,
      ) => Set<RuntimeEventLogBadge>,
    ) => {
      setSelectedBadgesState((previous) => {
        const next = updater(previous);
        // Keep the module cache in lock-step with state so a remount
        // later re-hydrates from the same selection.
        eventLogFilterCache.selectedBadges = new Set(next);
        return next;
      });
    },
    [],
  );

  const closeFilterMenu = useCallback((restoreFocus = true) => {
    setFilterOpen(false);
    if (restoreFocus) {
      filterTriggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const wrapper = filterWrapRef.current;
      if (!wrapper) return;
      if (event.target instanceof Node && wrapper.contains(event.target)) {
        return;
      }
      closeFilterMenu(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [closeFilterMenu, filterOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    queueMicrotask(() => {
      const menu = filterMenuRef.current;
      if (!menu) return;
      const selected =
        menu.querySelector<HTMLButtonElement>(
          '[role="menuitemcheckbox"][aria-checked="true"]',
        ) ??
        menu.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
      selected?.focus();
    });
  }, [filterOpen]);

  const handleFilterTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFilterOpen(true);
      }
    },
    [],
  );

  const handleFilterMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFilterMenu();
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const buttons = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      );
      if (buttons.length === 0) return;
      event.preventDefault();
      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : event.key === "ArrowDown"
              ? (safeIndex + 1) % buttons.length
              : (safeIndex - 1 + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    },
    [closeFilterMenu],
  );
  // Multiple rows may be expanded simultaneously — independent per
  // row. Supports VAL-EVENTLOG-020 ("Expand state persists across new
  // event ingestion") and the VAL-CROSS-015 flow of expanding two
  // related rows to compare request_ids.
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleExpanded = useCallback((rowId: string) => {
    setExpandedRowIds((previous) => {
      const next = new Set(previous);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);
  // Rows displayed in the panel: filtered by selected badges and sorted
  // newest-first (descending seq — seq is monotonic per session).
  //
  // We deliberately do NOT maintain a local "cleared baseline seq" here.
  // A prior implementation carried a `clearedBaselineSeq` state and hid
  // every entry whose `seq <= baseline`, intending to keep the display
  // empty until genuinely-new post-clear entries landed. That gating was
  // incompatible with `AppStateProvider.clearRuntimeEventLog`, which not
  // only empties the buffer but ALSO resets `runtimeEventLogSeqRef` to
  // 0 — so post-clear entries restart at `seq = 1` and failed the
  // `entry.seq > baseline` check, hiding legitimate new events until seq
  // climbed past the old maximum (flagged in scrutiny m4 r1).
  //
  // The provider's Clear semantics are "empty the buffer" (NOT "keep
  // rows, just hide them"), so the only gating we need is the empty
  // buffer itself. When `runtimeEventLog` is empty the list renders
  // "No events yet"; when it repopulates, rows appear immediately.
  const visibleEntries = useMemo(() => {
    const filtered =
      selectedBadges.size === RUNTIME_BADGES.length
        ? runtimeEventLog
        : runtimeEventLog.filter((entry) => selectedBadges.has(entry.badge));
    // Reverse into newest-first order without mutating the buffer.
    return filtered.slice().sort((a, b) => b.seq - a.seq);
  }, [runtimeEventLog, selectedBadges]);
  const displayRows = useMemo(
    () => groupEventLogRows(visibleEntries),
    [visibleEntries],
  );

  // --- Scroll-anchor preservation (VAL-EVENTLOG-021) ------------------
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousScrollHeightRef = useRef<number>(0);
  // `atTop === true` when the user has the list scrolled to top — used
  // to gate the "Jump to newest" affordance and to disable anchor
  // correction (scroll at 0 always follows newest ingestion).
  const [atTop, setAtTop] = useState(true);

  // On every change to the rendered list, compare the new `scrollHeight`
  // to what we recorded before React committed the change. If the list
  // grew AND the user wasn't at the top, reposition scrollTop by the
  // delta so the previously-visible row stays anchored where it was.
  // Runs in `useLayoutEffect` so the DOM reposition happens inside the
  // same paint as React's commit — the user never sees a jump frame.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const previousHeight = previousScrollHeightRef.current;
    const newHeight = el.scrollHeight;
    if (
      previousHeight > 0 &&
      newHeight > previousHeight &&
      el.scrollTop > 0
    ) {
      el.scrollTop = el.scrollTop + (newHeight - previousHeight);
    }
    previousScrollHeightRef.current = newHeight;
  }, [displayRows]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 1);
    // Snapshot the current scrollHeight at the moment the user scrolled
    // so the next `useLayoutEffect` pass can compute the correct delta
    // even if list content has already changed between the user's last
    // scroll and the next ingestion. Without this, a scroll event that
    // lands between two re-renders can leave the previous-height ref
    // stale and the anchor correction skipped.
    previousScrollHeightRef.current = el.scrollHeight;
  }, []);

  const handleJumpToNewest = useCallback(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = 0;
      previousScrollHeightRef.current = el.scrollHeight;
    }
    setAtTop(true);
  }, []);

  const handleClear = useCallback(() => {
    // Delegate entirely to the AppState mutator. The real provider
    // empties the ring buffer AND resets the seq counter, so the
    // display flips to "No events yet" on the next render without
    // any local fallback state (see scrutiny m4 r1 fix — previous
    // seq-threshold fallback hid legitimate post-clear events).
    if (typeof clearRuntimeEventLog === "function") {
      clearRuntimeEventLog();
    }
  }, [clearRuntimeEventLog]);

  const toggleBadge = useCallback(
    (badge: RuntimeEventLogBadge) => {
      setSelectedBadges((previous) => {
        const next = new Set(previous);
        if (next.has(badge)) next.delete(badge);
        else next.add(badge);
        return next;
      });
    },
    [setSelectedBadges],
  );

  const selectAll = useCallback(() => {
    setSelectedBadges(() => new Set(RUNTIME_BADGES));
  }, [setSelectedBadges]);

  const clearAll = useCallback(() => {
    setSelectedBadges(() => new Set());
  }, [setSelectedBadges]);

  const countLabel = `${visibleEntries.length} event${
    visibleEntries.length === 1 ? "" : "s"
  }`;
  const activeFilterCount = selectedBadges.size;
  const activeFilterLabel =
    activeFilterCount === RUNTIME_BADGES.length
      ? "No filters"
      : `${activeFilterCount} active`;
  const filterAriaLabel =
    activeFilterCount === RUNTIME_BADGES.length
      ? `Filter event log, no filters active, showing all ${RUNTIME_BADGES.length} badges`
      : `Filter event log, ${activeFilterCount} of ${RUNTIME_BADGES.length} badges active`;

  return (
    <div className="event-log-panel">
      <div className="event-log-header">
        <ChevronDown size={12} color="#93c5fd" />
        <div className="event-log-title">Event Log</div>
        <StatusPill>{countLabel}</StatusPill>
        <span className="event-log-spacer" />
        {!atTop && displayRows.length > 0 ? (
          <button
            type="button"
            className="event-log-link event-log-jump"
            onClick={handleJumpToNewest}
          >
            Jump to newest
          </button>
        ) : null}
        <button
          type="button"
          className="event-log-link"
          onClick={handleClear}
        >
          Clear
        </button>
        <div className="event-log-filter-wrap" ref={filterWrapRef}>
          <button
            ref={filterTriggerRef}
            type="button"
            className="event-log-filter"
            aria-label={filterAriaLabel}
            aria-expanded={filterOpen}
            aria-haspopup="menu"
            aria-controls={filterMenuId}
            onClick={() => setFilterOpen((open) => !open)}
            onKeyDown={handleFilterTriggerKeyDown}
          >
            <span>Filter</span>
            <span className="event-log-filter-count">
              {activeFilterLabel}
            </span>
            <span className="event-log-filter-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {filterOpen ? (
            <div
              ref={filterMenuRef}
              id={filterMenuId}
              className="event-log-filter-menu"
              role="menu"
              aria-label="Event log filters"
              onKeyDown={handleFilterMenuKeyDown}
            >
              <div className="event-log-filter-actions">
                <button
                  type="button"
                  className="event-log-filter-action"
                  onClick={selectAll}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="event-log-filter-action"
                  onClick={clearAll}
                >
                  Clear all
                </button>
              </div>
              {RUNTIME_BADGES.map((badge) => {
                const selected = selectedBadges.has(badge);
                return (
                  <button
                    key={badge}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={selected}
                    className={selected ? "active" : undefined}
                    onClick={() => toggleBadge(badge)}
                  >
                    <span
                      className="event-log-filter-check"
                      aria-hidden="true"
                    />
                    <span
                      className={`event-log-filter-badge ${runtimeBadgeClassName(
                        badge,
                      )}`}
                    >
                      {badge}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      {displayRows.length > 0 ? (
        <div
          className="event-log-list"
          ref={listRef}
          onScroll={handleScroll}
        >
          {displayRows.map((row) => {
            const entry = row.kind === "single" ? row.entry : row.entries[0];
            const expanded = expandedRowIds.has(row.id);
            const scrubbed = scrubEventLogPayload(entry.payload);
            return (
              <div className="event-log-item" key={row.id}>
                <button
                  type="button"
                  className={`event-log-row${row.kind === "group" ? " grouped" : ""}`}
                  aria-expanded={expanded}
                  onClick={() => toggleExpanded(row.id)}
                >
                  <span className="event-log-time">
                    {formatHhMmSs(entry.at)}
                  </span>
                  <span
                    className={`event-log-type ${runtimeBadgeClassName(entry.badge)}`}
                  >
                    {entry.badge}
                  </span>
                  <span className="event-log-copy">
                    {row.kind === "group" ? row.summary : summarizeEntry(entry)}
                  </span>
                  {row.kind === "group" ? (
                    <span className="event-log-count-badge">
                      {row.entries.length}
                    </span>
                  ) : null}
                  <span className="event-log-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                {expanded && row.kind === "single" ? (
                  <pre className="event-log-expanded">
                    {JSON.stringify(scrubbed, null, 2)}
                  </pre>
                ) : null}
                {expanded && row.kind === "group" ? (
                  <div className="event-log-expanded event-log-group-expanded">
                    {row.entries.map((child) => (
                      <div className="event-log-group-entry" key={child.seq}>
                        <div className="event-log-group-entry-head">
                          <span className="event-log-group-time">
                            {formatHhMmSs(child.at)}
                          </span>
                          <span className="event-log-group-summary">
                            {summarizeEntry(child)}
                          </span>
                        </div>
                        <pre className="event-log-group-payload">
                          {JSON.stringify(
                            scrubEventLogPayload(child.payload),
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="event-log-empty">No events yet</div>
      )}
    </div>
  );
}

function LegacyFixtureEventLog({
  rows,
  initialFilter,
  initialExpandedId,
}: {
  rows: DashboardEventRow[];
  initialFilter: "all" | DashboardEventKind;
  initialExpandedId?: string;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | DashboardEventKind>(initialFilter);
  const [expandedId, setExpandedId] = useState<string | null>(
    initialExpandedId ?? null,
  );
  const [cleared, setCleared] = useState(false);

  const visibleRows = useMemo(() => {
    if (cleared) return [];
    if (filter === "all") return rows;
    return rows.filter((row) => row.type === filter);
  }, [cleared, filter, rows]);

  const countLabel = cleared
    ? "0 events"
    : filter === "all" && rows === MOCK_EVENT_LOG_ROWS
      ? `${MOCK_EVENT_TOTAL} events`
      : `${visibleRows.length} events`;

  return (
    <div className="event-log-panel">
      <div className="event-log-header">
        <ChevronDown size={12} color="#93c5fd" />
        <div className="event-log-title">Event Log</div>
        <StatusPill>{countLabel}</StatusPill>
        <span className="event-log-spacer" />
        <button
          type="button"
          className="event-log-link"
          onClick={() => setCleared(true)}
        >
          Clear
        </button>
        <div className="event-log-filter-wrap">
          <button
            type="button"
            className="event-log-filter"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((value) => !value)}
          >
            Filter
          </button>
          {filterOpen ? (
            <div
              className="event-log-filter-menu"
              role="menu"
              aria-label="Event log filters"
            >
              {LEGACY_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === option}
                  className={filter === option ? "active" : undefined}
                  onClick={() => {
                    setFilter(option);
                    setFilterOpen(false);
                    setCleared(false);
                  }}
                >
                  {labelForLegacyFilter(option)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {visibleRows.length > 0 ? (
        visibleRows.map((row) => {
          const expanded = expandedId === row.id;
          return (
            <div className="event-log-item" key={row.id}>
              <button
                type="button"
                className="event-log-row"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : row.id)}
              >
                <span className="event-log-time">{row.time}</span>
                <span
                  className={`event-log-type ${legacyEventClassName(row.type)}`}
                >
                  {row.type}
                </span>
                <span className="event-log-copy">{row.copy}</span>
                <span className="event-log-chevron" aria-hidden="true">
                  ⌄
                </span>
              </button>
              {expanded ? (
                <pre className="event-log-expanded">
                  {JSON.stringify(row.details, null, 2)}
                </pre>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="event-log-empty">No events yet</div>
      )}
    </div>
  );
}
