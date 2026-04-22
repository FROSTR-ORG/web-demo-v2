import { ChevronDown } from "lucide-react";
import {
  useCallback,
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
 * The ten canonical Paper badges rendered by the runtime-wired Event
 * Log panel. Order here is the order shown in the Filter dropdown and
 * the order in which colour-class hints are matched in CSS
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
];

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
  // runtime_event
  const payload = entry.payload as { kind?: string } | null;
  const kind = payload?.kind ?? "runtime event";
  return String(kind);
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
  selectedBadges: new Set(RUNTIME_BADGES),
};

/** Test-only helper: reset module-scoped filter cache to "all selected". */
export function __resetEventLogFilterPersistenceForTest(): void {
  eventLogFilterCache.selectedBadges = new Set(RUNTIME_BADGES);
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
  // Multiple rows may be expanded simultaneously — independent per
  // row. Supports VAL-EVENTLOG-020 ("Expand state persists across new
  // event ingestion") and the VAL-CROSS-015 flow of expanding two
  // related rows to compare request_ids.
  const [expandedSeqs, setExpandedSeqs] = useState<Set<number>>(
    () => new Set(),
  );
  const toggleExpanded = useCallback((seq: number) => {
    setExpandedSeqs((previous) => {
      const next = new Set(previous);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
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
  const visibleRows = useMemo(() => {
    const filtered =
      selectedBadges.size === RUNTIME_BADGES.length
        ? runtimeEventLog
        : runtimeEventLog.filter((entry) => selectedBadges.has(entry.badge));
    // Reverse into newest-first order without mutating the buffer.
    return filtered.slice().sort((a, b) => b.seq - a.seq);
  }, [runtimeEventLog, selectedBadges]);

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
  }, [visibleRows]);

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

  const countLabel = `${visibleRows.length} event${
    visibleRows.length === 1 ? "" : "s"
  }`;

  return (
    <div className="event-log-panel">
      <div className="event-log-header">
        <ChevronDown size={12} color="#93c5fd" />
        <div className="event-log-title">Event Log</div>
        <StatusPill>{countLabel}</StatusPill>
        <span className="event-log-spacer" />
        {!atTop && visibleRows.length > 0 ? (
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
        <div className="event-log-filter-wrap">
          <button
            type="button"
            className="event-log-filter"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            Filter
          </button>
          {filterOpen ? (
            <div
              className="event-log-filter-menu"
              role="menu"
              aria-label="Event log filters"
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
              {RUNTIME_BADGES.map((badge) => (
                <button
                  key={badge}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={selectedBadges.has(badge)}
                  className={selectedBadges.has(badge) ? "active" : undefined}
                  onClick={() => toggleBadge(badge)}
                >
                  {badge}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {visibleRows.length > 0 ? (
        <div
          className="event-log-list"
          ref={listRef}
          onScroll={handleScroll}
        >
          {visibleRows.map((entry) => {
            const expanded = expandedSeqs.has(entry.seq);
            const scrubbed = scrubEventLogPayload(entry.payload);
            return (
              <div className="event-log-item" key={entry.seq}>
                <button
                  type="button"
                  className="event-log-row"
                  aria-expanded={expanded}
                  onClick={() => toggleExpanded(entry.seq)}
                >
                  <span className="event-log-time">
                    {formatHhMmSs(entry.at)}
                  </span>
                  <span
                    className={`event-log-type ${runtimeBadgeClassName(entry.badge)}`}
                  >
                    {entry.badge}
                  </span>
                  <span className="event-log-copy">{summarizeEntry(entry)}</span>
                  <span className="event-log-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                {expanded ? (
                  <pre className="event-log-expanded">
                    {JSON.stringify(scrubbed, null, 2)}
                  </pre>
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
