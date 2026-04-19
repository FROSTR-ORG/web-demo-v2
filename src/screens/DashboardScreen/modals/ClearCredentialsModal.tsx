import { Trash2, X } from "lucide-react";

export function ClearCredentialsModal({
  groupName,
  shareIdx,
  deviceName,
  onCancel,
  onConfirm,
}: {
  groupName: string;
  shareIdx: number;
  deviceName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="clear-creds-backdrop" role="dialog" aria-modal="true" data-testid="clear-credentials-modal">
      <div className="clear-creds-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="clear-creds-header">
          <div className="clear-creds-title-group">
            <div className="clear-creds-icon">
              <Trash2 size={20} />
            </div>
            <h2 className="clear-creds-title">Clear Credentials</h2>
          </div>
          <button
            type="button"
            className="clear-creds-close"
            onClick={onCancel}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="clear-creds-body">
          <p className="clear-creds-description">
            Are you sure you want to clear this device's saved credentials? This removes the local profile, share, password, and relay configuration from this device. This action cannot be undone. Other peers and the shared group profile are not changed.
          </p>
          <div className="clear-creds-badge">
            {groupName} · Share #{shareIdx} · {deviceName}
          </div>
        </div>

        {/* Actions */}
        <div className="clear-creds-actions">
          <button type="button" className="clear-creds-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="clear-creds-confirm" onClick={onConfirm}>
            Clear Credentials
          </button>
        </div>
      </div>
    </div>
  );
}
