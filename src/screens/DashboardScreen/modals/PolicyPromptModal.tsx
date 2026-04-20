import { Clock, X } from "lucide-react";
import { DEFAULT_POLICY_PROMPT_REQUEST, type PolicyPromptRequest } from "../mocks";

function scopeLabel(request: PolicyPromptRequest) {
  if (request.kind === "ECDH") return "ECDH";
  const { eventKind } = request;
  const match = eventKind.match(/^kind:\d+/);
  if (match) return match[0];
  return eventKind;
}

export function PolicyPromptModal({
  onClose,
  request = DEFAULT_POLICY_PROMPT_REQUEST,
}: {
  onClose: () => void;
  request?: PolicyPromptRequest;
}) {
  const isEcdh = request.kind === "ECDH";
  const scope = scopeLabel(request);
  const subtitle = isEcdh
    ? "A peer is requesting permission for an encryption operation"
    : "A peer is requesting permission to sign on your behalf";
  const detailRows: Array<{ label: string; value: string; className?: string }> = isEcdh
    ? [
        { label: "OPERATION", value: request.eventKind },
        { label: "TARGET PUBKEY", value: request.pubkey, className: "mono" },
        { label: "RELAY", value: request.relay ?? request.domain, className: "mono" },
      ]
    : [
        { label: "EVENT KIND", value: request.eventKind },
        { label: "CONTENT", value: request.content },
        { label: "PUBKEY", value: request.pubkey, className: "mono" },
        { label: "DOMAIN", value: request.domain, className: "bold" },
      ];

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
            {subtitle}
          </p>
        </div>

        {/* Request info */}
        <div className="policy-modal-request">
          <span className={`policy-request-badge ${request.kind.toLowerCase()}`}>{request.kind}</span>
          <span className="policy-request-peer">from {request.peer}</span>
          <span className="policy-request-key">{request.key}</span>
          <span className="policy-request-domain"> · {request.domain}</span>
        </div>

        {/* Details table */}
        <div className={`policy-details-table ${isEcdh ? "ecdh" : "sign"}`}>
          {detailRows.map((row) => (
            <div className="policy-detail-row" key={row.label}>
              <span className="policy-detail-label">{row.label}</span>
              <span className={`policy-detail-value ${row.className ?? ""}`}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Expiration timer */}
        <div className="policy-expiry">
          <Clock size={14} />
          <span>Expires in {request.ttl}</span>
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
              Always for {scope}
            </button>
          </div>
          <div className="policy-action-row">
            <button type="button" className="policy-btn deny-outline" onClick={onClose}>
              Always deny for {scope}
            </button>
            <button type="button" className="policy-btn deny-outline" onClick={onClose}>
              Always deny for {request.domain}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
