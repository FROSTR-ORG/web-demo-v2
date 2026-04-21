import { useState } from "react";
import { PermissionBadge } from "../../../components/ui";
import { shortHex } from "../../../lib/bifrost/format";
import type { PeerPermissionState, PeerStatus } from "../../../lib/bifrost/types";
import { MOCK_PEER_POLICIES, MOCK_SIGNER_RULES } from "../mocks";

function requestPolicyAllows(
  state: PeerPermissionState,
  method: "sign" | "ecdh" | "ping" | "onboard",
): boolean {
  const effective = state.effective_policy as {
    request?: Record<string, unknown>;
  } & Record<string, unknown>;
  const value = effective.request?.[method] ?? effective[method];
  return value === true || value === "allow";
}

function runtimePeerPolicies(
  peers: PeerStatus[],
  peerPermissionStates: PeerPermissionState[],
) {
  return peerPermissionStates.map((state, fallbackIndex) => {
    const peer = peers.find((entry) => entry.pubkey === state.pubkey);
    return {
      index: peer?.idx ?? fallbackIndex,
      displayId: shortHex(state.pubkey, 8, 4),
      permissions: {
        sign: requestPolicyAllows(state, "sign"),
        ecdh: requestPolicyAllows(state, "ecdh"),
        ping: requestPolicyAllows(state, "ping"),
        onboard: requestPolicyAllows(state, "onboard"),
      },
    };
  });
}

function fallbackPeerPolicies(peers: PeerStatus[]) {
  return peers.map((peer) => ({
    index: peer.idx,
    displayId: shortHex(peer.pubkey, 8, 4),
    permissions: {
      sign: peer.can_sign,
      ecdh: peer.should_send_nonces,
      ping: peer.online,
      onboard: false,
    },
  }));
}

export function PoliciesState({
  peers,
  peerPermissionStates,
  paperPanels,
}: {
  peers: PeerStatus[];
  peerPermissionStates: PeerPermissionState[];
  paperPanels: boolean;
}) {
  const [defaultPolicy, setDefaultPolicy] = useState("Ask every time");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hiddenRules, setHiddenRules] = useState<Set<string>>(() => new Set());
  const visibleRules = MOCK_SIGNER_RULES.filter((rule) => !hiddenRules.has(rule.method));
  const peerPolicies = paperPanels
    ? MOCK_PEER_POLICIES
    : peerPermissionStates.length > 0
      ? runtimePeerPolicies(peers, peerPermissionStates)
      : fallbackPeerPolicies(peers);

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
            {peerPolicies.map((peer) => (
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
