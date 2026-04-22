import { useState } from "react";
import { useAppState } from "../../../app/AppState";
import type { PolicyOverrideEntry } from "../../../app/AppStateTypes";
import { PermissionBadge } from "../../../components/ui";
import { shortHex } from "../../../lib/bifrost/format";
import { resolveRequestPolicyAllows } from "../../../lib/bifrost/policy";
import type {
  BfPolicyOverrideValue,
  PeerPermissionState,
  PeerStatus,
} from "../../../lib/bifrost/types";
import { MOCK_PEER_POLICIES } from "../mocks";
import {
  DefaultPolicyDropdown,
  type DefaultPolicyOption,
} from "../panels/DefaultPolicyDropdown";
import {
  PeerPolicyChip,
  resolveManualOverrideValue,
  type PeerPolicyChipMethod,
} from "../panels/PeerPolicyChip";

/**
 * Resolve a Paper-faithful decision-pill label for a Signer Policies
 * rule row derived from an active {@link PolicyOverrideEntry}. Mapping
 * is the inverse of the PolicyPromptModal decisions that produce the
 * entry:
 *
 *   - persistent + allow → "Always"    (pill class `always`)
 *   - session    + allow → "Allow once" (pill class `allow-once`)
 *   - persistent + deny  → "Deny"      (pill class `deny`)
 *
 * `session + deny` is intentionally absent — the PolicyPromptModal
 * "Deny" action is a no-op at the policy layer (VAL-APPROVALS-011).
 */
function resolveDecisionPill(entry: PolicyOverrideEntry): {
  label: string;
  className: string;
} {
  if (entry.value === "allow") {
    return entry.source === "persistent"
      ? { label: "Always", className: "always" }
      : { label: "Allow once", className: "allow-once" };
  }
  // entry.value === "deny"
  return { label: "Deny", className: "deny" };
}

interface RuntimePeerPolicyRow {
  index: number;
  pubkey: string;
  displayId: string;
  permissions: Record<PeerPolicyChipMethod, boolean>;
  overrides: Record<PeerPolicyChipMethod, BfPolicyOverrideValue>;
}

function runtimePeerPolicies(
  peers: PeerStatus[],
  peerPermissionStates: PeerPermissionState[],
  selfPubkey?: string | null,
): RuntimePeerPolicyRow[] {
  const normalizedSelf = selfPubkey?.toLowerCase() ?? null;
  return peerPermissionStates
    .filter(
      (state) =>
        !normalizedSelf || state.pubkey.toLowerCase() !== normalizedSelf,
    )
    .map((state, fallbackIndex) => {
      const peer = peers.find((entry) => entry.pubkey === state.pubkey);
      return {
        index: peer?.idx ?? fallbackIndex,
        pubkey: state.pubkey,
        displayId: shortHex(state.pubkey, 8, 4),
        permissions: {
          sign: resolveRequestPolicyAllows(state, "sign"),
          ecdh: resolveRequestPolicyAllows(state, "ecdh"),
          ping: resolveRequestPolicyAllows(state, "ping"),
          onboard: resolveRequestPolicyAllows(state, "onboard"),
        },
        overrides: {
          sign: resolveManualOverrideValue(state, "request", "sign"),
          ecdh: resolveManualOverrideValue(state, "request", "ecdh"),
          ping: resolveManualOverrideValue(state, "request", "ping"),
          onboard: resolveManualOverrideValue(state, "request", "onboard"),
        },
      };
    });
}

function fallbackPeerPolicies(
  peers: PeerStatus[],
  selfPubkey?: string | null,
): RuntimePeerPolicyRow[] {
  const normalizedSelf = selfPubkey?.toLowerCase() ?? null;
  return peers
    .filter(
      (peer) =>
        !normalizedSelf || peer.pubkey.toLowerCase() !== normalizedSelf,
    )
    .map((peer) => ({
      index: peer.idx,
      pubkey: peer.pubkey,
      displayId: shortHex(peer.pubkey, 8, 4),
      permissions: {
        sign: peer.can_sign,
        ecdh: peer.should_send_nonces,
        ping: peer.online,
        onboard: false,
      },
      overrides: {
        sign: "unset",
        ecdh: "unset",
        ping: "unset",
        onboard: "unset",
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
  selfPubkey,
}: {
  peers: PeerStatus[];
  peerPermissionStates: PeerPermissionState[];
  paperPanels: boolean;
  /**
   * x-only hex pubkey of the local (self) signer, surfaced from
   * `runtime_status.metadata.share_public_key`. Rows targeting this
   * pubkey are filtered out of both the Peer Policies list and the
   * active-override rows: the user cannot grant or deny a policy
   * against their own local signer (VAL-POLICIES-025). Optional for
   * tests / demo fixtures that predate this wiring.
   */
  selfPubkey?: string | null;
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
    setPeerPolicyOverride?: (input: {
      peer: string;
      direction: "request" | "respond";
      method: "sign" | "ecdh" | "ping" | "onboard";
      value: BfPolicyOverrideValue;
    }) => Promise<void>;
  };
  const policyOverrides = appState.policyOverrides ?? [];
  const removePolicyOverride =
    appState.removePolicyOverride ?? (async () => undefined);
  const setPeerPolicyOverride =
    appState.setPeerPolicyOverride ?? (async () => undefined);
  const [defaultPolicy, setDefaultPolicy] =
    useState<DefaultPolicyOption>("Ask every time");
  const [removalError, setRemovalError] = useState<string | null>(null);
  // `paperPanels` keeps the Paper fixture rows (static copy, no pubkey
  // wiring) so pixel-parity demo-gallery routes stay pristine. Runtime
  // mode uses the live `peer_permission_states` snapshot, with a
  // legacy fallback for tests that seed `peers` but no permission
  // states. The paper branch rows have no `pubkey` / `overrides` so the
  // two shapes are kept in separate bindings for type safety.
  const paperPeerPolicies = paperPanels ? MOCK_PEER_POLICIES : null;
  const normalizedSelfPubkey = selfPubkey?.toLowerCase() ?? null;
  const runtimePeerRows: RuntimePeerPolicyRow[] = paperPanels
    ? []
    : peerPermissionStates.length > 0
      ? runtimePeerPolicies(peers, peerPermissionStates, selfPubkey)
      : fallbackPeerPolicies(peers, selfPubkey);
  // Set of pubkeys that the Peer Policies surface considers "known" on
  // the current snapshot. Used below to mark stale override rows whose
  // peer is no longer part of the group (VAL-POLICIES-024). Treats
  // `peer_permission_states` and `peers[]` as independent sources so a
  // peer surfaced by either source is considered present — some early
  // boot / rehydration ticks populate one before the other.
  const knownPeerSet = new Set<string>();
  for (const state of peerPermissionStates) {
    knownPeerSet.add(state.pubkey.toLowerCase());
  }
  for (const peer of peers) {
    knownPeerSet.add(peer.pubkey.toLowerCase());
  }
  // Stable display order — newest overrides at the top so the user sees
  // what they most recently set without scrolling. `policyOverrides` is
  // already keyed on (peer, direction, method); we only need a sort.
  // Self-peer overrides are filtered out entirely (VAL-POLICIES-025);
  // overrides targeting removed peers are retained so the user can
  // sweep them via the Remove control (VAL-POLICIES-024).
  const overrideRows: PolicyOverrideEntry[] = [...policyOverrides]
    .filter(
      (entry) =>
        !normalizedSelfPubkey ||
        entry.peer.toLowerCase() !== normalizedSelfPubkey,
    )
    .sort((a, b) => b.createdAt - a.createdAt);

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

  return (
    <>
      {/* Signer Policies Panel */}
      <div className="policies-panel">
        <div className="policies-panel-header">
          <div className="policies-panel-title">Signer Policies</div>
          <div className="policies-header-right">
            <span className="policies-default-label">Default policy</span>
            <DefaultPolicyDropdown
              value={defaultPolicy}
              onChange={setDefaultPolicy}
              peerPermissionStates={peerPermissionStates}
              dispatch={setPeerPolicyOverride}
            />
          </div>
        </div>
        <div className="policies-panel-body">
          <p className="policies-description">
            Controls how this signer responds to external signing and encryption requests.
          </p>
          <div className="policies-rules-list">
            {overrideRows.map((entry) => {
              const label = peerDisplayLabel(entry.peer, peers);
              const pill = resolveDecisionPill(entry);
              const rowKey = `${entry.peer}:${entry.direction}.${entry.method}`;
              const peerRemoved = !knownPeerSet.has(
                entry.peer.toLowerCase(),
              );
              const rowClassName = peerRemoved
                ? "policies-rule-row policies-rule-row-removed"
                : "policies-rule-row";
              return (
                <div
                  className={rowClassName}
                  key={rowKey}
                  data-testid="policy-override-row"
                  data-override-peer={entry.peer}
                  data-override-method={entry.method}
                  data-override-direction={entry.direction}
                  data-override-source={entry.source}
                  data-override-value={entry.value}
                  data-peer-removed={peerRemoved ? "true" : undefined}
                >
                  <span className="policies-method">
                    {entry.method.toUpperCase()}
                  </span>
                  <span className="policies-domain">{label.shortId}</span>
                  {peerRemoved ? (
                    <span
                      className="policies-removed-marker"
                      title="This peer is no longer in the current group roster."
                    >
                      Removed
                    </span>
                  ) : null}
                  <span className="policies-rule-divider" />
                  <span
                    className={`policies-permission-badge ${pill.className}`}
                    data-testid="policy-override-decision"
                  >
                    {pill.label}
                  </span>
                  <button
                    type="button"
                    className="policies-remove-btn"
                    aria-label={`Remove ${entry.method} override for ${label.name}`}
                    onClick={() => {
                      void handleRemoveOverride(entry);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {overrideRows.length === 0 ? (
              <div className="policies-empty">No explicit signer policies. Default policy applies to new requests.</div>
            ) : null}
          </div>
          {removalError ? (
            <div
              role="alert"
              className="policies-override-error"
            >
              {removalError}
            </div>
          ) : null}
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
            {paperPeerPolicies
              ? paperPeerPolicies.map((peer) => (
                  <div className="policies-peer-row" key={peer.index}>
                    <div className="policies-peer-info">
                      <span className="policies-peer-name">
                        Peer #{peer.index}
                      </span>
                      <span className="policies-peer-key">
                        {peer.displayId}
                      </span>
                    </div>
                    <div className="policies-peer-badges">
                      <PermissionBadge
                        tone="success"
                        muted={!peer.permissions.sign}
                      >
                        SIGN
                      </PermissionBadge>
                      <PermissionBadge
                        tone="info"
                        muted={!peer.permissions.ecdh}
                      >
                        ECDH
                      </PermissionBadge>
                      <PermissionBadge
                        tone="ping"
                        muted={!peer.permissions.ping}
                      >
                        PING
                      </PermissionBadge>
                      <PermissionBadge
                        tone="onboard"
                        muted={!peer.permissions.onboard}
                      >
                        ONBOARD
                      </PermissionBadge>
                    </div>
                  </div>
                ))
              : runtimePeerRows.map((peer) => (
                  <div className="policies-peer-row" key={peer.index}>
                    <div className="policies-peer-info">
                      <span className="policies-peer-name">
                        Peer #{peer.index}
                      </span>
                      <span className="policies-peer-key">
                        {peer.displayId}
                      </span>
                    </div>
                    <div className="policies-peer-badges">
                      <PeerPolicyChip
                        peer={peer.pubkey}
                        method="sign"
                        tone="success"
                        overrideValue={peer.overrides.sign}
                        effectiveAllows={peer.permissions.sign}
                        onDispatch={setPeerPolicyOverride}
                      >
                        SIGN
                      </PeerPolicyChip>
                      <PeerPolicyChip
                        peer={peer.pubkey}
                        method="ecdh"
                        tone="info"
                        overrideValue={peer.overrides.ecdh}
                        effectiveAllows={peer.permissions.ecdh}
                        onDispatch={setPeerPolicyOverride}
                      >
                        ECDH
                      </PeerPolicyChip>
                      <PeerPolicyChip
                        peer={peer.pubkey}
                        method="ping"
                        tone="ping"
                        overrideValue={peer.overrides.ping}
                        effectiveAllows={peer.permissions.ping}
                        onDispatch={setPeerPolicyOverride}
                      >
                        PING
                      </PeerPolicyChip>
                      <PeerPolicyChip
                        peer={peer.pubkey}
                        method="onboard"
                        tone="onboard"
                        overrideValue={peer.overrides.onboard}
                        effectiveAllows={peer.permissions.onboard}
                        onDispatch={setPeerPolicyOverride}
                      >
                        ONBOARD
                      </PeerPolicyChip>
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </div>
    </>
  );
}
