import { Clock, X } from "lucide-react";

export function PolicyPromptModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="policy-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="policy-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="policy-modal-header">
          <div className="policy-modal-header-row">
            <div className="policy-modal-title-group">
              <div className="policy-modal-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 1L18 5.5V14.5L10 19L2 14.5V5.5L10 1Z" stroke="#EAB308" strokeWidth="1.5" fill="none" />
                  <path d="M10 7V11M10 13V13.5" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="policy-modal-title">Signer Policy</h2>
            </div>
            <button type="button" className="policy-modal-close" onClick={onClose} aria-label="Close modal">
              <X size={16} />
            </button>
          </div>
          <p className="policy-modal-subtitle">
            A peer is requesting permission to sign on your behalf
          </p>
        </div>

        {/* Request info */}
        <div className="policy-modal-request">
          <span className="policy-request-badge">SIGN</span>
          <span className="policy-request-peer">from Peer #2</span>
          <span className="policy-request-key">029c4a...1f5e</span>
          <span className="policy-request-domain"> · primal.net</span>
        </div>

        {/* Details table */}
        <div className="policy-details-table">
          <div className="policy-detail-row">
            <span className="policy-detail-label">EVENT KIND</span>
            <span className="policy-detail-value">kind:1 (Short Text Note)</span>
          </div>
          <div className="policy-detail-row">
            <span className="policy-detail-label">CONTENT</span>
            <span className="policy-detail-value">&ldquo;gm nostr, anyone up for a coffee meetup...&rdquo;</span>
          </div>
          <div className="policy-detail-row">
            <span className="policy-detail-label">PUBKEY</span>
            <span className="policy-detail-value mono">029c4a...1f5e</span>
          </div>
          <div className="policy-detail-row">
            <span className="policy-detail-label">DOMAIN</span>
            <span className="policy-detail-value bold">primal.net</span>
          </div>
        </div>

        {/* Expiration timer */}
        <div className="policy-expiry">
          <Clock size={14} />
          <span>Expires in 42s</span>
        </div>

        {/* Action buttons — 3 rows × 2 buttons */}
        <div className="policy-actions">
          <div className="policy-action-row">
            <button type="button" className="policy-btn deny" onClick={onClose}>
              Deny
            </button>
            <button type="button" className="policy-btn allow" onClick={onClose}>
              Allow once
            </button>
          </div>
          <div className="policy-action-row">
            <button type="button" className="policy-btn allow-outline" onClick={onClose}>
              Always allow
            </button>
            <button type="button" className="policy-btn allow-outline" onClick={onClose}>
              Always for kind:1
            </button>
          </div>
          <div className="policy-action-row">
            <button type="button" className="policy-btn deny-outline" onClick={onClose}>
              Always deny for kind:1
            </button>
            <button type="button" className="policy-btn deny-outline" onClick={onClose}>
              Always deny for primal.net
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
