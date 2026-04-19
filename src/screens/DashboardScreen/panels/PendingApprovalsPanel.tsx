import { ChevronDown, Clock } from "lucide-react";
import { StatusPill } from "../../../components/ui";
import { MOCK_PENDING_APPROVAL_ROWS } from "../mocks";

export function PendingApprovalsPanel() {
  return (
    <div className="pending-approvals-panel">
      <div className="pending-approvals-header">
        <span className="pending-star">✦</span>
        <div className="pending-title">Pending Approvals</div>
        <StatusPill tone="warning">3 pending</StatusPill>
        <span className="event-log-spacer" />
        <Clock size={12} />
        <span className="pending-nearest">Nearest: 42s</span>
        <ChevronDown size={14} />
      </div>
      {MOCK_PENDING_APPROVAL_ROWS.map(([kind, peer, key, detail, ttl]) => (
        <div className="pending-row" key={`${kind}-${peer}-${detail}`}>
          <span className="pending-dot" />
          <span className={`pending-kind ${kind.toLowerCase()}`}>{kind}</span>
          <span className="pending-peer">{peer}</span>
          <span className="pending-key">{key}</span>
          <span className="pending-detail">{detail}</span>
          <span className="pending-ttl">{ttl}</span>
          <button type="button" className="pending-open">Open</button>
        </div>
      ))}
    </div>
  );
}
