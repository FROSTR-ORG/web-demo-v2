import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { MockAppStateProvider } from "../../../../app/AppState";
import type { AppStateValue } from "../../../../app/AppStateTypes";
import { CoreRoutes } from "../../../../app/CoreRoutes";
import { demoScenarios } from "../../../../demo/scenarios";
import { PeersPanel } from "../../panels/PeersPanel";
import { resolveRequestPolicyAllows } from "../../../../lib/bifrost/policy";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../../../lib/bifrost/types";
import { PoliciesState } from "../PoliciesState";

/**
 * m3-peer-policies-view — VAL-POLICIES-005 / VAL-POLICIES-006 /
 * VAL-POLICIES-020: for every (peer P, verb M) the Peer Policies chip
 * and the PeerRow inline badge must resolve from the same
 * `effective_policy.request.M` token and therefore surface identical
 * allowed/denied state. This test wires the PoliciesState card and
 * PeersPanel with a shared permission-state snapshot and asserts the
 * two surfaces agree across every (peer, verb) combination.
 */

afterEach(cleanup);

function scenarioByIdOrThrow(id: string) {
  const scenario = demoScenarios.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`missing scenario ${id}`);
  return scenario;
}

describe("PoliciesState ↔ PeerRow parity (VAL-POLICIES-005 / VAL-POLICIES-006)", () => {
  it("both surfaces surface identical allowed-verb state per peer/verb", () => {
    // Hand-crafted mixed permission matrix covering allow / deny / ask
    // across every (peer, verb) so each branch of the grant resolver is
    // exercised.
    const peers: PeerStatus[] = [
      {
        idx: 0,
        pubkey: ["parity-peer-", "aaaa0000"].join(""),
        known: true,
        last_seen: Date.now(),
        online: true,
        incoming_available: 60,
        outgoing_available: 60,
        outgoing_spent: 0,
        can_sign: true,
        should_send_nonces: true,
      },
      {
        idx: 1,
        pubkey: ["parity-peer-", "bbbb1111"].join(""),
        known: true,
        last_seen: Date.now(),
        online: true,
        incoming_available: 40,
        outgoing_available: 40,
        outgoing_spent: 0,
        can_sign: true,
        should_send_nonces: false,
      },
      {
        idx: 2,
        pubkey: ["parity-peer-", "cccc2222"].join(""),
        known: true,
        last_seen: Date.now(),
        online: true,
        incoming_available: 20,
        outgoing_available: 20,
        outgoing_spent: 0,
        can_sign: false,
        should_send_nonces: false,
      },
      // Offline peer — regression coverage for
      // `fix-m3-peerrow-badges-render-for-offline-peers`. PeerRow must
      // still render the four verb badges from `effective_policy.request.*`
      // so the Peer Policies card and the Peers panel never disagree
      // for the same (peer, verb) tuple regardless of online state.
      {
        idx: 3,
        pubkey: ["parity-peer-", "dddd3333"].join(""),
        known: true,
        last_seen: null,
        online: false,
        incoming_available: 0,
        outgoing_available: 0,
        outgoing_spent: 0,
        can_sign: false,
        should_send_nonces: false,
      },
    ];

    const permissionStates: PeerPermissionState[] = [
      {
        pubkey: peers[0].pubkey,
        manual_override: null,
        remote_observation: null,
        effective_policy: {
          request: { sign: "allow", ecdh: "allow", ping: "allow", onboard: "deny" },
          respond: {},
        },
      },
      {
        pubkey: peers[1].pubkey,
        manual_override: null,
        remote_observation: null,
        effective_policy: {
          request: { sign: "deny", ecdh: "allow", ping: "allow", onboard: "allow" },
          respond: {},
        },
      },
      {
        pubkey: peers[2].pubkey,
        manual_override: null,
        remote_observation: null,
        effective_policy: {
          sign: "allow",
          ecdh: "ask",
          ping: "allow",
          onboard: "deny",
        },
      },
      // Offline peer grant matrix — exercised so PeerRow is forced to
      // surface badges for an offline peer whenever a runtime
      // permissionState is wired in, matching PoliciesState.
      {
        pubkey: peers[3].pubkey,
        manual_override: null,
        remote_observation: null,
        effective_policy: {
          request: {
            sign: "allow",
            ecdh: "deny",
            ping: "allow",
            onboard: "allow",
          },
          respond: {},
        },
      },
    ];

    const scenario = scenarioByIdOrThrow("dashboard-policies");
    const appState = scenario.appState as AppStateValue;

    render(
      <MemoryRouter>
        <MockAppStateProvider value={appState} bridge={false}>
          <div>
            <PoliciesState
              peers={peers}
              peerPermissionStates={permissionStates}
              paperPanels={false}
            />
            <PeersPanel
              peers={peers}
              onlineCount={peers.filter((p) => p.online).length}
              signReadyLabel="— ready"
              paperPanels={false}
              onRefresh={() => undefined}
              peerPermissionStates={permissionStates}
            />
          </div>
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const policyRows = Array.from(
      document.querySelectorAll<HTMLElement>(".policies-peer-row"),
    );
    expect(policyRows).toHaveLength(peers.length);
    const peerRows = Array.from(
      document.querySelectorAll<HTMLElement>(".peer-row"),
    );
    expect(peerRows).toHaveLength(peers.length);

    for (const peer of peers) {
      const state = permissionStates.find((s) => s.pubkey === peer.pubkey)!;
      const policyRow = policyRows.find((row) =>
        row.textContent?.includes(`Peer #${peer.idx}`),
      );
      expect(policyRow).toBeTruthy();
      const peerRow = peerRows.find((row) =>
        row.textContent?.includes(`#${peer.idx}`),
      );
      expect(peerRow).toBeTruthy();

      const policyBadges = within(policyRow as HTMLElement).getAllByText(
        /^(SIGN|ECDH|PING|ONBOARD)$/,
      );
      expect(policyBadges).toHaveLength(4);

      for (const verb of ["sign", "ecdh", "ping", "onboard"] as const) {
        const label = verb.toUpperCase();
        const chipNode = policyBadges.find(
          (node) => node.textContent === label,
        );
        expect(chipNode).toBeTruthy();
        const chipBadge = chipNode!.closest(
          ".permission-badge",
        ) as HTMLElement;

        const allowed = resolveRequestPolicyAllows(state, verb);

        // PoliciesState: muted class iff !allowed
        expect(chipBadge.classList.contains("muted")).toBe(!allowed);

        // PeerRow: badge present iff allowed (for online peers).
        const rowBadges = Array.from(
          peerRow!.querySelectorAll<HTMLElement>(".permission-badge"),
        );
        const rowBadgePresent = rowBadges.some(
          (node) => node.textContent?.trim() === label,
        );
        expect(rowBadgePresent).toBe(allowed);
      }
    }
  });

  it("Peer Policies card renders exactly one row per configured peer (VAL-POLICIES-001)", () => {
    const scenario = scenarioByIdOrThrow("dashboard-policies");
    const appState = scenario.appState as AppStateValue;
    const expected =
      appState.runtimeStatus?.peer_permission_states?.length ?? 0;

    render(
      <MemoryRouter>
        <MockAppStateProvider value={appState} bridge={false}>
          <CoreRoutes location={scenario.location} />
        </MockAppStateProvider>
      </MemoryRouter>,
    );

    const rows = screen.getAllByText(/Peer #\d+/, {
      selector: ".policies-peer-name",
    });
    expect(rows).toHaveLength(expected);
  });
});
