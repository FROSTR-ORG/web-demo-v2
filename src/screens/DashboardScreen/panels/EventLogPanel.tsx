import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusPill } from "../../../components/ui";
import { MOCK_EVENT_LOG_ROWS, MOCK_EVENT_TOTAL, type DashboardEventKind, type DashboardEventRow } from "../mocks";

const FILTERS: Array<"all" | DashboardEventKind> = ["all", "Sync", "Sign", "Ecdh", "Signer Policy", "Ping", "Echo", "Error"];

function labelForFilter(filter: "all" | DashboardEventKind) {
  return filter === "all" ? "All" : filter;
}

function eventClassName(type: DashboardEventKind) {
  return type.toLowerCase().replace(/\s+/g, "-");
}

export function EventLogPanel({
  rows = MOCK_EVENT_LOG_ROWS,
  initialFilter = "all",
  initialExpandedId,
}: {
  rows?: DashboardEventRow[];
  initialFilter?: "all" | DashboardEventKind;
  initialExpandedId?: string;
} = {}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | DashboardEventKind>(initialFilter);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [cleared, setCleared] = useState(false);

  const visibleRows = useMemo(() => {
    if (cleared) return [];
    if (filter === "all") return rows;
    return rows.filter((row) => row.type === filter);
  }, [cleared, filter, rows]);

  const countLabel = cleared ? "0 events" : filter === "all" && rows === MOCK_EVENT_LOG_ROWS ? `${MOCK_EVENT_TOTAL} events` : `${visibleRows.length} events`;

  return (
    <div className="event-log-panel">
      <div className="event-log-header">
        <ChevronDown size={12} color="#93c5fd" />
        <div className="event-log-title">Event Log</div>
        <StatusPill>{countLabel}</StatusPill>
        <span className="event-log-spacer" />
        <button type="button" className="event-log-link" onClick={() => setCleared(true)}>Clear</button>
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
            <div className="event-log-filter-menu" role="menu" aria-label="Event log filters">
              {FILTERS.map((option) => (
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
                  {labelForFilter(option)}
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
                <span className={`event-log-type ${eventClassName(row.type)}`}>{row.type}</span>
                <span className="event-log-copy">{row.copy}</span>
                <span className="event-log-chevron" aria-hidden="true">⌄</span>
              </button>
              {expanded ? (
                <pre className="event-log-expanded">{JSON.stringify(row.details, null, 2)}</pre>
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
