export interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  countLabel?: string;
  size?: "md" | "sm";
}

export function ProgressBar({ value, max, label, countLabel, size = "md" }: ProgressBarProps) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={`progress-bar-section ${size}`}>
      {(label || countLabel) && (
        <div className="progress-bar-header">
          {label ? <span className="progress-bar-title">{label}</span> : null}
          {countLabel ? <span className="progress-bar-count">{countLabel}</span> : null}
        </div>
      )}
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
