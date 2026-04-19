import { ChevronDown } from "lucide-react";
import { StatusPill } from "../../../components/ui";
import { MOCK_EVENT_LOG_ROWS } from "../mocks";

export function EventLogPanel() {
  return (
    <div className="event-log-panel">
      <div className="event-log-header">
        <ChevronDown size={12} color="#93c5fd" />
        <div className="event-log-title">Event Log</div>
        <StatusPill>8 events</StatusPill>
        <span className="event-log-spacer" />
        <button type="button" className="event-log-link">Clear</button>
        <button type="button" className="event-log-filter">Filter</button>
      </div>
      {MOCK_EVENT_LOG_ROWS.map(([time, type, copy]) => (
        <div className="event-log-row" key={`${time}-${type}-${copy}`}>
          <span className="event-log-time">{time}</span>
          <span className={`event-log-type ${type.toLowerCase().replace(/\s+/g, "-")}`}>{type}</span>
          <span className="event-log-copy">{copy}</span>
        </div>
      ))}
    </div>
  );
}
