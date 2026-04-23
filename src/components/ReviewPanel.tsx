import type { ReactNode } from "react";

export interface ReviewRow {
  label: string;
  value: ReactNode;
  mono?: boolean;
  badge?: string;
}

export interface ReviewPanelProps {
  title?: string;
  rows: ReviewRow[];
  className?: string;
}

export function ReviewPanel({ title, rows, className }: ReviewPanelProps) {
  return (
    <div className={`review-panel ${className ?? ""}`}>
      {title ? <div className="review-panel-title">{title}</div> : null}
      {rows.map((row, index) => (
        <div key={row.label} className={`review-row ${index === rows.length - 1 ? "review-row-last" : ""}`}>
          <span className="review-row-label">{row.label}</span>
          <div className="review-row-value">
            {row.mono ? (
              <span className="review-row-mono">{row.value}</span>
            ) : (
              <span>{row.value}</span>
            )}
            {row.badge ? <span className="review-row-badge">{row.badge}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
