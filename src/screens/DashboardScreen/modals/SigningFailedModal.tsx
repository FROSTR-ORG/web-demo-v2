import { X, XCircle } from "lucide-react";

export function SigningFailedModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="policy-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="signing-failed-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="signing-failed-header">
          <div className="signing-failed-title-group">
            <div className="signing-failed-icon">
              <XCircle size={20} color="#EF4444" />
            </div>
            <h2 className="signing-failed-title">Signing Failed</h2>
          </div>
          <button type="button" className="policy-modal-close" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="signing-failed-body">
          <p className="signing-failed-description">
            Unable to complete signature for event kind:1. All 3 retry attempts exhausted.
          </p>
          <div className="signing-failed-code">
            <span className="signing-failed-code-text">
              Round: r-0x4f2a · Peers responded: 1/2 · Error: insufficient partial signatures
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="signing-failed-actions">
          <button type="button" className="signing-failed-dismiss" onClick={onClose}>
            Dismiss
          </button>
          <button type="button" className="signing-failed-retry" onClick={onClose}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
