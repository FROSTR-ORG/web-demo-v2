import { Minus, Plus } from "lucide-react";

export interface ThresholdSelectorProps {
  threshold: number;
  total: number;
  minThreshold?: number;
  maxTotal?: number;
  onThresholdChange: (value: number) => void;
  onTotalChange: (value: number) => void;
  help?: string;
  error?: string;
}

export function ThresholdSelector({
  threshold,
  total,
  minThreshold = 2,
  maxTotal = 10,
  onThresholdChange,
  onTotalChange,
  help,
  error,
}: ThresholdSelectorProps) {
  const canDecreaseThreshold = threshold > minThreshold;
  const canIncreaseThreshold = threshold < total;
  const canDecreaseTotal = total > threshold;
  const canIncreaseTotal = total < maxTotal;

  return (
    <div className="field">
      <div className="threshold-selector">
        <div className="threshold-pair">
          <span className="label">Threshold</span>
          <div className="number-stepper">
            <button
              type="button"
              aria-label="Decrease Threshold"
              disabled={!canDecreaseThreshold}
              onClick={() => onThresholdChange(threshold - 1)}
            >
              <Minus size={14} />
            </button>
            <div className="number-value">{threshold}</div>
            <button
              type="button"
              aria-label="Increase Threshold"
              disabled={!canIncreaseThreshold}
              onClick={() => onThresholdChange(threshold + 1)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="threshold-divider">/</div>
        <div className="threshold-pair">
          <span className="label">Total Shares</span>
          <div className="number-stepper">
            <button
              type="button"
              aria-label="Decrease Total Shares"
              disabled={!canDecreaseTotal}
              onClick={() => {
                const next = total - 1;
                onTotalChange(next);
                if (threshold > next) {
                  onThresholdChange(next);
                }
              }}
            >
              <Minus size={14} />
            </button>
            <div className="number-value">{total}</div>
            <button
              type="button"
              aria-label="Increase Total Shares"
              disabled={!canIncreaseTotal}
              onClick={() => onTotalChange(total + 1)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
      {help && !error ? <span className="help">{help}</span> : null}
      {error ? <span className="field-error-text">{error}</span> : null}
    </div>
  );
}
