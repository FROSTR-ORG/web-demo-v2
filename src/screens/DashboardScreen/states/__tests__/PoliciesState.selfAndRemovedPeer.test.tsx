import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { MockAppStateProvider } from "../../../../app/AppState";
import type {
  AppStateValue,
  PolicyOverrideEntry,
} from "../../../../app/AppStateTypes";
import { demoScenarios } from "../../../../demo/scenarios";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../../../lib/bifrost/types";
import { PoliciesState } from "../PoliciesState";

/**
 * m3-policy-denial-and-persistence — self-peer exclusion and removed-peer
 * cleanup for the Peer Policies card + active-overrides (Signer Policies)
 * row list (VAL-POLICIES-024 / VAL-POLICIES-025).
 *
 * Assertions under test:
 *
 *  - The local (self) pubkey — surfaced as
 *    `runtime_status.metadata.share_public_key` and passed via the
 *    `selfPubkey` prop — MUST NOT appear as a row in the Peer Policies
 *    card, even when a permission-state snapshot accidentally includes
 *    it.
 *  - Active-override rows (top list under Signer Policies) that target
 *    self are filtered out so the local device can never be
 *    unintentionally configured with a self-override via stored state.
 *  - Active-override rows whose peer is no longer in the current
 *    group's peer_permission_states + peers roster render with a
 *    visible "Removed" marker and still expose a working Remove (✕)
 *    control so the user can sweep stale overrides.
 */

afterEach(cleanup);

function scenarioAppState() {
  const scenario = demoScenarios.find((entry) => entry.id === "dashboard-policies");
  if (!scenario) throw new Error("missing scenario dashboard-policies");
  return scenario.appState as AppStateValue;
}

function makePermissionState(pubkey: string): PeerPermissionState {
  return {
    pubkey,
    manual_override: null,
    remote_observation: null,
    effective_policy: {
      request: { sign: "allow", ecdh: "allow", ping: "allow", onboard: "allow" },
      respond: {},
    },
  };
}

function makePeer(idx: number, pubkey: string): PeerStatus {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: Date.now(),
    online: true,
    incoming_available: 10,
    outgoing_available: 10,
    outgoing_spent: 0,
    can_sign: true,
    should_send_nonces: true,
  };
}

describe("PoliciesState self-peer exclusion (VAL-POLICIES-025)", () => {
  it("never renders a Peer Policies row for the local self pubkey", () => {
    const selfKey = "a".repeat(64);
    const peerKey = "b".repeat(64);
    const peers: PeerStatus[] = [
      makePeer(0, selfKey),
      makePeer(1, peerKey),
    ];
    const permissionStates: PeerPermissionState[] = [
      makePermissionState(selfKey),
      makePermissionState(peerKey),
    ];

    render(
      <MemoryRouter>
        <MockAppStateProvider value={scenarioAppState()} bridge={false}>
          <PoliciesState
            peers={peers}
            peerPermissionStates={permissionStates}
            paperPanels={false}
            selfPubkey={selfKey}
          />
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".policies-peer-row"),
    );
    // Exactly one peer row: the non-self peer.
    expect(rows).toHaveLength(1);
    const only = rows[0];
    expect(only.textContent ?? "").not.toContain(selfKey.slice(0, 8));
    expect(only.textContent ?? "").toContain(peerKey.slice(0, 8));
  });

  it("never renders a Peer Policies row when the only known peer IS self", () => {
    const selfKey = "c".repeat(64);
    const peers: PeerStatus[] = [makePeer(0, selfKey)];
    const permissionStates: PeerPermissionState[] = [
      makePermissionState(selfKey),
    ];

    render(
      <MemoryRouter>
        <MockAppStateProvider value={scenarioAppState()} bridge={false}>
          <PoliciesState
            peers={peers}
            peerPermissionStates={permissionStates}
            paperPanels={false}
            selfPubkey={selfKey}
          />
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".policies-peer-row"),
    );
    expect(rows).toHaveLength(0);
  });

  it("filters out active-override rows targeting self from the Signer Policies list", () => {
    const selfKey = "d".repeat(64);
    const peerKey = "e".repeat(64);
    const overrides: PolicyOverrideEntry[] = [
      {
        peer: selfKey,
        direction: "respond",
        method: "sign",
        value: "deny",
        source: "persistent",
        createdAt: 1,
      },
      {
        peer: peerKey,
        direction: "respond",
        method: "sign",
        value: "deny",
        source: "persistent",
        createdAt: 2,
      },
    ];
    const appState: AppStateValue = {
      ...scenarioAppState(),
      policyOverrides: overrides,
    };

    render(
      <MemoryRouter>
        <MockAppStateProvider value={appState} bridge={false}>
          <PoliciesState
            peers={[makePeer(1, peerKey)]}
            peerPermissionStates={[makePermissionState(peerKey)]}
            paperPanels={false}
            selfPubkey={selfKey}
          />
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const overrideRows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="policy-override-row"]',
      ),
    );
    // Only the non-self row is rendered.
    expect(overrideRows).toHaveLength(1);
    expect(overrideRows[0].getAttribute("data-override-peer")).toBe(peerKey);
  });
});

describe("PoliciesState removed-peer marker (VAL-POLICIES-024)", () => {
  it("marks active-override rows whose peer is not in the current roster as 'Removed' and exposes a Remove control", () => {
    const presentPeer = "f".repeat(64);
    const removedPeer = "9".repeat(64);
    const overrides: PolicyOverrideEntry[] = [
      {
        peer: removedPeer,
        direction: "respond",
        method: "sign",
        value: "allow",
        source: "persistent",
        createdAt: 100,
      },
      {
        peer: presentPeer,
        direction: "respond",
        method: "ecdh",
        value: "deny",
        source: "persistent",
        createdAt: 50,
      },
    ];
    const appState: AppStateValue = {
      ...scenarioAppState(),
      policyOverrides: overrides,
    };

    render(
      <MemoryRouter>
        <MockAppStateProvider value={appState} bridge={false}>
          <PoliciesState
            peers={[makePeer(1, presentPeer)]}
            peerPermissionStates={[makePermissionState(presentPeer)]}
            paperPanels={false}
            selfPubkey={"0".repeat(64)}
          />
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="policy-override-row"]',
      ),
    );
    expect(rows).toHaveLength(2);

    const removedRow = rows.find(
      (row) => row.getAttribute("data-override-peer") === removedPeer,
    );
    expect(removedRow).toBeTruthy();
    expect(removedRow!.getAttribute("data-peer-removed")).toBe("true");
    // Visible marker text.
    expect(removedRow!.textContent ?? "").toMatch(/removed/i);
    // Remove control is present and keyboard reachable.
    const removeBtn = within(removedRow!).getByRole("button", {
      name: /remove .*override/i,
    });
    expect(removeBtn).toBeTruthy();

    const presentRow = rows.find(
      (row) => row.getAttribute("data-override-peer") === presentPeer,
    );
    expect(presentRow).toBeTruthy();
    expect(presentRow!.getAttribute("data-peer-removed")).not.toBe("true");
    expect(presentRow!.textContent ?? "").not.toMatch(/removed/i);
  });

  it("does not mark an override row as removed when the peer exists in peer_permission_states but not in the peers[] array", () => {
    // Defensive: some early-boot ticks populate `peer_permission_states`
    // before `peers[]` is hydrated. Such a peer must NOT be mistakenly
    // flagged as removed.
    const peerKey = "8".repeat(64);
    const overrides: PolicyOverrideEntry[] = [
      {
        peer: peerKey,
        direction: "respond",
        method: "sign",
        value: "deny",
        source: "persistent",
        createdAt: 10,
      },
    ];
    const appState: AppStateValue = {
      ...scenarioAppState(),
      policyOverrides: overrides,
    };

    render(
      <MemoryRouter>
        <MockAppStateProvider value={appState} bridge={false}>
          <PoliciesState
            peers={[]}
            peerPermissionStates={[makePermissionState(peerKey)]}
            paperPanels={false}
            selfPubkey={"0".repeat(64)}
          />
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const row = screen.getByTestId("policy-override-row");
    expect(row.getAttribute("data-peer-removed")).not.toBe("true");
    expect(row.textContent ?? "").not.toMatch(/removed/i);
  });
});
