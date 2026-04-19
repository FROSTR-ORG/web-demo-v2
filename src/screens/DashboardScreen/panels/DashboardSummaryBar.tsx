import { paperGroupKey, paperShareKey } from "../mocks";

export function DashboardSummaryBar({
  groupName,
  threshold,
  memberCount,
  groupPublicKey,
  shareIdx,
  sharePublicKey,
}: {
  groupName: string;
  threshold: number;
  memberCount: number;
  groupPublicKey: string;
  shareIdx: number;
  sharePublicKey: string;
}) {
  return (
    <div className="dashboard-summary">
      <div className="dashboard-summary-group">
        <span className="value">{groupName}</span>
        <span className="help">·</span>
        <span className="help">
          {threshold}/{memberCount}
        </span>
        <span className="help">·</span>
        <span className="dashboard-key">{paperGroupKey(groupPublicKey)}</span>
      </div>
      <div className="dashboard-summary-separator" />
      <div className="dashboard-summary-share">
        <span className="help">Share #{shareIdx}</span>
        <span className="help">·</span>
        <span className="dashboard-key">{paperShareKey(sharePublicKey)}</span>
      </div>
    </div>
  );
}
