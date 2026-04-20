import { ChevronDown, Clock } from "lucide-react";
import { StatusPill } from "../../../components/ui";
import { MOCK_PENDING_APPROVAL_ROWS, type DashboardApprovalRow, type PolicyPromptRequest } from "../mocks";

export function PendingApprovalsPanel({
  rows = MOCK_PENDING_APPROVAL_ROWS,
  onOpenPolicyPrompt,
}: {
  rows?: DashboardApprovalRow[];
  onOpenPolicyPrompt?: (request: PolicyPromptRequest) => void;
} = {}) {
  const nearest = rows[0]?.ttl ?? "—";

  return (
    <div className="pending-approvals-panel">
      <div className="pending-approvals-header">
        <span className="pending-star">✦</span>
        <div className="pending-title">Pending Approvals</div>
        <StatusPill tone="warning">{rows.length} pending</StatusPill>
        <span className="event-log-spacer" />
        <Clock size={12} />
        <span className="pending-nearest">Nearest: {nearest}</span>
        <ChevronDown size={14} />
      </div>
      {rows.map((row, rowIdx) => (
        <div className="pending-row" key={row.id}>
          <span className="pending-dot" />
          <span className={`pending-kind ${row.kind.toLowerCase()}`}>{row.kind}</span>
          <span className="pending-peer">{row.peer}</span>
          <span className="pending-key">{row.key}</span>
          <span className="pending-detail">{row.detail}</span>
          <span className="pending-ttl">{row.ttl}</span>
          <button
            type="button"
            className="pending-open"
            onClick={() => onOpenPolicyPrompt?.(row.request)}
            aria-label={`Open approval ${rowIdx + 1}`}
          >
            Open
          </button>
        </div>
      ))}
    </div>
  );
}
