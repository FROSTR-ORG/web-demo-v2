import { useState } from "react";
import { useAppState } from "../../../app/AppState";
import type { PolicyOverrideEntry } from "../../../app/AppStateTypes";
import { PermissionBadge } from "../../../components/ui";
import { shortHex } from "../../../lib/bifrost/format";
import { resolveRequestPolicyAllows } from "../../../lib/bifrost/policy";
import type { PeerPermissionState, PeerStatus } from "../../../lib/bifrost/types";
import { MOCK_PEER_POLICIES, MOCK_SIGNER_RULES } from "../mocks";

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
        sign: resolveRequestPolicyAllows(state, "sign"),
        ecdh: resolveRequestPolicyAllows(state, "ecdh"),
        ping: resolveRequestPolicyAllows(state, "ping"),
        onboard: resolveRequestPolicyAllows(state, "onboard"),
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

/**
 * Map of peer pubkey → display label (`Peer #idx · shortHex`) so the
 * active-overrides rows can render the same identity the top peer list
 * uses. Falls back to `shortHex(peer)` when the pubkey is not present
 * in the current roster (e.g. a peer recently removed from the group).
 */
function peerDisplayLabel(
  peer: string,
  peers: PeerStatus[],
): { name: string; shortId: string } {
  const match = peers.find((entry) => entry.pubkey === peer);
  return {
    name: match ? `Peer #${match.idx}` : "Peer",
    shortId: shortHex(peer, 8, 4),
  };
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
  // Tolerant destructure — some screen-level tests mock `useAppState`
  // with a minimal fixture that predates these fields; defaulting to
  // sensible no-ops keeps the Peer Policies view usable in those
  // contexts without forcing every existing mock to be updated.
  const appState = useAppState() as ReturnType<typeof useAppState> & {
    policyOverrides?: PolicyOverrideEntry[];
    removePolicyOverride?: (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
    }) => Promise<void>;
  };
  const policyOverrides = appState.policyOverrides ?? [];
  const removePolicyOverride =
    appState.removePolicyOverride ?? (async () => undefined);
  const [defaultPolicy, setDefaultPolicy] = useState("Ask every time");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hiddenRules, setHiddenRules] = useState<Set<string>>(() => new Set());
  const [removalError, setRemovalError] = useState<string | null>(null);
  const visibleRules = MOCK_SIGNER_RULES.filter((rule) => !hiddenRules.has(rule.method));
  const peerPolicies = paperPanels
    ? MOCK_PEER_POLICIES
    : peerPermissionStates.length > 0
      ? runtimePeerPolicies(peers, peerPermissionStates)
      : fallbackPeerPolicies(peers);
  // Stable display order — newest overrides at the top so the user sees
  // what they most recently set without scrolling. `policyOverrides` is
  // already keyed on (peer, direction, method); we only need a sort.
  const overrideRows: PolicyOverrideEntry[] = [...policyOverrides].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  async function handleRemoveOverride(entry: PolicyOverrideEntry) {
    setRemovalError(null);
    try {
      await removePolicyOverride({
        peer: entry.peer,
        direction: entry.direction,
        method: entry.method,
      });
    } catch (error) {
      setRemovalError(
        error instanceof Error
          ? error.message
          : "Failed to remove override",
      );
    }
  }

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
          {overrideRows.length > 0 ? (
            <div className="policies-override-section">
              <div className="policies-override-heading">Active overrides</div>
              <ul
                className="policies-override-list"
                aria-label="Active peer policy overrides"
              >
                {overrideRows.map((entry) => {
                  const label = peerDisplayLabel(entry.peer, peers);
                  const effectLabel =
                    entry.value === "allow" ? "Allow" : "Deny";
                  const persistenceLabel =
                    entry.source === "persistent" ? "Persistent" : "Session";
                  const rowKey = `${entry.peer}:${entry.direction}.${entry.method}`;
                  return (
                    <li
                      className="policies-override-row"
                      key={rowKey}
                      data-testid="policy-override-row"
                      data-override-peer={entry.peer}
                      data-override-method={entry.method}
                      data-override-direction={entry.direction}
                      data-override-source={entry.source}
                      data-override-value={entry.value}
                    >
                      <div className="policies-override-identity">
                        <span className="policies-peer-name">
                          {label.name}
                        </span>
                        <span className="policies-peer-key">
                          {label.shortId}
                        </span>
                      </div>
                      <div className="policies-override-meta">
                        <span className="policies-override-verb">
                          {entry.method.toUpperCase()}
                        </span>
                        <span
                          className={`policies-override-effect ${
                            entry.value === "allow" ? "allow" : "deny"
                          }`}
                        >
                          {effectLabel}
                        </span>
                        <span
                          className={`policies-override-persistence ${entry.source}`}
                          data-testid="policy-override-persistence"
                        >
                          {persistenceLabel}
                        </span>
                        <button
                          type="button"
                          className="policies-override-remove"
                          aria-label={`Remove ${entry.method} override for ${label.name}`}
                          onClick={() => {
                            void handleRemoveOverride(entry);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {removalError ? (
                <div
                  role="alert"
                  className="policies-override-error"
                >
                  {removalError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
