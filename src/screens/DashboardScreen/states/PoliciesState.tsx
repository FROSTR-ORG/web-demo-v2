import { useState } from "react";
import { PermissionBadge } from "../../../components/ui";
import type { PeerStatus } from "../../../lib/bifrost/types";
import { MOCK_PEER_POLICIES, MOCK_SIGNER_RULES } from "../mocks";

export function PoliciesState({ peers: _peers }: { peers: PeerStatus[] }) {
  const [defaultPolicy, setDefaultPolicy] = useState("Ask every time");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hiddenRules, setHiddenRules] = useState<Set<string>>(() => new Set());
  const visibleRules = MOCK_SIGNER_RULES.filter((rule) => !hiddenRules.has(rule.method));

  function removeRule(method: string) {
    setHiddenRules((previous) => {
      const next = new Set(previous);
      next.add(method);
      return next;
    });
  }

  return (
    <>
      {/* Signer Policies Panel */}
      <div className="policies-panel">
        <div className="policies-panel-header">
          <div className="policies-panel-title">Signer Policies</div>
          <div className="policies-header-right">
            <span className="policies-default-label">Default policy</span>
            <div className="policies-dropdown-wrap">
              <button
                type="button"
                className="policies-dropdown"
                aria-expanded={dropdownOpen}
                onClick={() => setDropdownOpen((value) => !value)}
              >
                <span className="policies-dropdown-text">{defaultPolicy}</span>
                <span className="policies-dropdown-caret">▾</span>
              </button>
              {dropdownOpen ? (
                <div className="policies-dropdown-menu" role="menu" aria-label="Default policy options">
                  {["Ask every time", "Allow known peers", "Deny by default"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="menuitemradio"
                      aria-checked={defaultPolicy === option}
                      className={defaultPolicy === option ? "active" : undefined}
                      onClick={() => {
                        setDefaultPolicy(option);
                        setDropdownOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="policies-panel-body">
          <p className="policies-description">
            Controls how this signer responds to external signing and encryption requests.
          </p>
          <div className="policies-rules-list">
            {visibleRules.map((rule) => (
              <div className="policies-rule-row" key={rule.method}>
                <span className="policies-method">{rule.method}</span>
                <span className="policies-domain">{rule.domain}</span>
                <span className="policies-rule-divider" />
                <span
                  className={`policies-permission-badge ${rule.permission === "Always" ? "always" : "allow-once"}`}
                >
                  {rule.permission}
                </span>
                <button type="button" className="policies-remove-btn" aria-label="Remove rule" onClick={() => removeRule(rule.method)}>
                  ✕
                </button>
              </div>
            ))}
            {visibleRules.length === 0 ? (
              <div className="policies-empty">No explicit signer policies. Default policy applies to new requests.</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Peer Policies Panel */}
      <div className="policies-panel">
        <div className="policies-panel-header">
          <div className="policies-panel-title">Peer Policies</div>
        </div>
        <div className="policies-panel-body">
          <p className="policies-description">
            Review which request types each peer is allowed to make from this signer.
          </p>
          <div className="policies-peer-list">
            {MOCK_PEER_POLICIES.map((peer) => (
              <div className="policies-peer-row" key={peer.index}>
                <div className="policies-peer-info">
                  <span className="policies-peer-name">Peer #{peer.index}</span>
                  <span className="policies-peer-key">{peer.displayId}</span>
                </div>
                <div className="policies-peer-badges">
                  <PermissionBadge tone="success" muted={!peer.permissions.sign}>
                    SIGN
                  </PermissionBadge>
                  <PermissionBadge tone="info" muted={!peer.permissions.ecdh}>
                    ECDH
                  </PermissionBadge>
                  <PermissionBadge tone="ping" muted={!peer.permissions.ping}>
                    PING
                  </PermissionBadge>
                  <PermissionBadge tone="onboard" muted={!peer.permissions.onboard}>
                    ONBOARD
                  </PermissionBadge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
