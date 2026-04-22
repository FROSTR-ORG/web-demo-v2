import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MockAppStateProvider } from "../../../../app/AppState";
import type { AppStateValue } from "../../../../app/AppStateTypes";
import type {
  PeerPermissionState,
  PeerStatus,
} from "../../../../lib/bifrost/types";
import { createDemoAppState } from "../../../../demo/fixtures";
import { PoliciesState } from "../PoliciesState";

/**
 * m3-default-policy-dropdown — VAL-POLICIES-011 / VAL-POLICIES-012 /
 * VAL-POLICIES-013 / VAL-POLICIES-019 / VAL-POLICIES-022.
 *
 * Covers:
 *  - "Deny by default" sets every override-free peer's
 *    `effective_policy.respond.*` cells to `deny` via
 *    `setPeerPolicyOverride({direction: "respond", value: "deny"})`,
 *    while peers with a manual override are untouched
 *    (VAL-POLICIES-011). The dropdown governs THIS signer's inbound
 *    response permission — see
 *    `docs/runtime-deviations-from-paper.md` → "Default Policy dropdown
 *    writes to `respond.*`, not `request.*`".
 *  - "Allow known peers" dispatches `value: "allow"` only for peers
 *    whose `remote_observation` is present (known in-roster peers);
 *    unknown peers are skipped (VAL-POLICIES-012).
 *  - "Ask every time" does not dispatch any overrides so override-free
 *    peer chips stay `unset` (VAL-POLICIES-013).
 *  - Dropdown keyboard operability: Enter/Space opens, ArrowUp/Down
 *    cycles options, Enter confirms, Escape closes, outside click
 *    closes. Trigger carries `aria-expanded`; selected option gets
 *    `aria-checked="true"` with exactly one checked at a time
 *    (VAL-POLICIES-019 / VAL-POLICIES-022).
 *  - ARIA role=radio + aria-activedescendant per pattern.
 */

afterEach(cleanup);

const PEER_A_PUBKEY = "aaaa".padEnd(64, "a");
const PEER_B_PUBKEY = "bbbb".padEnd(64, "b");
const PEER_C_PUBKEY = "cccc".padEnd(64, "c");

function makePeer(idx: number, pubkey: string): PeerStatus {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: Date.now(),
    online: true,
    incoming_available: 50,
    outgoing_available: 50,
    outgoing_spent: 0,
    can_sign: true,
    should_send_nonces: true,
  };
}

/**
 * Three peers covering the three relevant default-policy semantics:
 *  - Peer A: remote_observation present + no manual override → targeted
 *    by "Allow known peers" and "Deny by default".
 *  - Peer B: remote_observation null + no manual override → targeted
 *    by "Deny by default" but NOT by "Allow known peers".
 *  - Peer C: manual override present → never targeted by the dropdown
 *    regardless of selected default (VAL-POLICIES-011 "peers with
 *    overrides are unaffected").
 */
function makePermissionStates(): PeerPermissionState[] {
  return [
    {
      pubkey: PEER_A_PUBKEY,
      manual_override: null,
      remote_observation: { observed_at: Date.now() },
      effective_policy: {
        request: {
          sign: "allow",
          ecdh: "allow",
          ping: "allow",
          onboard: "deny",
        },
        respond: {},
      },
    } as PeerPermissionState,
    {
      pubkey: PEER_B_PUBKEY,
      manual_override: null,
      remote_observation: null,
      effective_policy: {
        request: {
          sign: "allow",
          ecdh: "allow",
          ping: "allow",
          onboard: "deny",
        },
        respond: {},
      },
    } as PeerPermissionState,
    {
      pubkey: PEER_C_PUBKEY,
      // User-authored `respond.*` override (e.g. from a Signer Policies
      // "Always allow" row). The Default Policy dropdown must leave
      // this peer alone (VAL-POLICIES-011 "peers with overrides are
      // unaffected") because the dropdown itself owns only the cells
      // tracked in `defaultAppliedKeys`.
      manual_override: {
        request: {},
        respond: { sign: "allow" },
      },
      remote_observation: { observed_at: Date.now() },
      effective_policy: {
        request: {
          sign: "allow",
          ecdh: "allow",
          ping: "allow",
          onboard: "deny",
        },
        respond: {},
      },
    } as PeerPermissionState,
  ];
}

function renderPolicies(options: {
  dispatch: AppStateValue["setPeerPolicyOverride"];
}) {
  const peers = [
    makePeer(0, PEER_A_PUBKEY),
    makePeer(1, PEER_B_PUBKEY),
    makePeer(2, PEER_C_PUBKEY),
  ];
  const permissionStates = makePermissionStates();
  const seed = createDemoAppState({
    setPeerPolicyOverride: options.dispatch,
  });
  return render(
    <MemoryRouter>
      <MockAppStateProvider value={seed} bridge={false}>
        <PoliciesState
          peers={peers}
          peerPermissionStates={permissionStates}
          paperPanels={false}
        />
      </MockAppStateProvider>
    </MemoryRouter>,
  );
}

function getTrigger(): HTMLElement {
  return screen.getByRole("combobox", { name: /default policy/i });
}

async function openDropdown() {
  const trigger = getTrigger();
  await act(async () => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
}

const METHODS = ["sign", "ecdh", "ping", "onboard"] as const;

function dispatchedPeersForValue(
  dispatch: ReturnType<typeof vi.fn>,
  value: "allow" | "deny" | "unset",
): Set<string> {
  const peers = new Set<string>();
  for (const call of dispatch.mock.calls) {
    const arg = call[0] as {
      peer: string;
      direction: string;
      method: string;
      value: string;
    };
    if (arg.value === value && arg.direction === "respond") {
      peers.add(arg.peer);
    }
  }
  return peers;
}

/**
 * Every `setPeerPolicyOverride` call made by the Default Policy
 * dropdown MUST target `direction: "respond"` (VAL-POLICIES-011/012/013
 * direction correction — see `docs/runtime-deviations-from-paper.md`).
 * This helper asserts that invariant across the whole spy log so
 * individual tests can guard against accidental `request.*` writes.
 */
function assertAllDispatchesTargetRespond(
  dispatch: ReturnType<typeof vi.fn>,
) {
  for (const call of dispatch.mock.calls) {
    const arg = call[0] as { direction?: string };
    expect(arg.direction).toBe("respond");
  }
}

describe("DefaultPolicyDropdown — semantics + keyboard + ARIA (VAL-POLICIES-011/012/013/019/022)", () => {
  it("'Deny by default' dispatches request-deny for peers without manual overrides only (VAL-POLICIES-011)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    // Open dropdown, pick Deny by default.
    await openDropdown();
    const denyOption = screen.getByRole("radio", { name: "Deny by default" });
    await act(async () => {
      fireEvent.click(denyOption);
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalled();
    });

    const deniedPeers = dispatchedPeersForValue(dispatch, "deny");
    expect(deniedPeers).toEqual(new Set([PEER_A_PUBKEY, PEER_B_PUBKEY]));
    // Peer C has a manual_override → must not be in the deny dispatch set.
    expect(deniedPeers.has(PEER_C_PUBKEY)).toBe(false);

    // Every eligible peer gets one dispatch per method.
    for (const peer of [PEER_A_PUBKEY, PEER_B_PUBKEY]) {
      for (const method of METHODS) {
        expect(dispatch).toHaveBeenCalledWith({
          peer,
          direction: "respond",
          method,
          value: "deny",
        });
      }
    }
    // All dropdown dispatches target `respond.*` (never `request.*`).
    assertAllDispatchesTargetRespond(dispatch);

    // Trigger label updates; dropdown closes.
    expect(getTrigger()).toHaveTextContent("Deny by default");
    expect(
      screen.queryByRole("radiogroup", { name: /default policy/i }),
    ).not.toBeInTheDocument();
  });

  it("'Allow known peers' dispatches request-allow only for peers with remote_observation (VAL-POLICIES-012)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    await openDropdown();
    const option = screen.getByRole("radio", { name: "Allow known peers" });
    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalled();
    });

    const allowed = dispatchedPeersForValue(dispatch, "allow");
    expect(allowed).toEqual(new Set([PEER_A_PUBKEY]));
    expect(allowed.has(PEER_B_PUBKEY)).toBe(false);
    expect(allowed.has(PEER_C_PUBKEY)).toBe(false);

    // All four methods dispatched for the only eligible peer.
    for (const method of METHODS) {
      expect(dispatch).toHaveBeenCalledWith({
        peer: PEER_A_PUBKEY,
        direction: "respond",
        method,
        value: "allow",
      });
    }
    // All dropdown dispatches target `respond.*` (never `request.*`).
    assertAllDispatchesTargetRespond(dispatch);
  });

  it("'Ask every time' does not dispatch any overrides (VAL-POLICIES-013)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    await openDropdown();
    // Pick a non-default option first so "Ask every time" is a real change.
    const denyOption = screen.getByRole("radio", { name: "Deny by default" });
    await act(async () => {
      fireEvent.click(denyOption);
    });
    await waitFor(() => {
      expect(dispatchedPeersForValue(dispatch, "deny").size).toBeGreaterThan(0);
    });
    dispatch.mockClear();

    // Now switch to Ask every time.
    await openDropdown();
    const askOption = screen.getByRole("radio", { name: "Ask every time" });
    await act(async () => {
      fireEvent.click(askOption);
    });

    // No `allow` or `deny` dispatches fire — only `unset` cleanup of the
    // overrides the dropdown itself applied (if any).
    expect(dispatchedPeersForValue(dispatch, "allow").size).toBe(0);
    expect(dispatchedPeersForValue(dispatch, "deny").size).toBe(0);
    // Any unset-cleanup dispatches emitted here also target respond.*.
    assertAllDispatchesTargetRespond(dispatch);
    expect(getTrigger()).toHaveTextContent("Ask every time");
  });

  it("keyboard: Enter opens, ArrowDown/ArrowUp move activedescendant, Enter confirms (VAL-POLICIES-022)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    const trigger = getTrigger();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const group = screen.getByRole("radiogroup", { name: /default policy/i });
    const initialActive = group.getAttribute("aria-activedescendant");
    expect(initialActive).toBeTruthy();

    // ArrowDown → next option becomes active.
    await act(async () => {
      fireEvent.keyDown(group, { key: "ArrowDown" });
    });
    const afterDown = group.getAttribute("aria-activedescendant");
    expect(afterDown).toBeTruthy();
    expect(afterDown).not.toBe(initialActive);

    // ArrowUp returns to prior option.
    await act(async () => {
      fireEvent.keyDown(group, { key: "ArrowUp" });
    });
    expect(group.getAttribute("aria-activedescendant")).toBe(initialActive);

    // Advance to "Deny by default" (third option) using ArrowDown twice.
    await act(async () => {
      fireEvent.keyDown(group, { key: "ArrowDown" });
      fireEvent.keyDown(group, { key: "ArrowDown" });
    });

    // Enter confirms the current active descendant.
    await act(async () => {
      fireEvent.keyDown(group, { key: "Enter" });
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalled();
    });
    expect(dispatchedPeersForValue(dispatch, "deny").size).toBe(2);
    // Keyboard-driven selection must also target respond.*.
    assertAllDispatchesTargetRespond(dispatch);
    expect(getTrigger()).toHaveTextContent("Deny by default");
  });

  it("keyboard: Space opens dropdown; Escape closes without selection (VAL-POLICIES-022)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    const trigger = getTrigger();
    await act(async () => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: " " });
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const group = screen.getByRole("radiogroup", { name: /default policy/i });
    await act(async () => {
      fireEvent.keyDown(group, { key: "Escape" });
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(dispatch).not.toHaveBeenCalled();
    // Trigger label unchanged.
    expect(getTrigger()).toHaveTextContent("Ask every time");
  });

  it("outside click closes the menu without selection", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    await openDropdown();
    expect(getTrigger().getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      fireEvent.mouseDown(document.body);
    });

    expect(getTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("role=radio with aria-checked: exactly one option checked at a time (VAL-POLICIES-019)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    await openDropdown();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);

    // "Ask every time" is the initial default.
    const askInitial = options.find(
      (el) => el.textContent === "Ask every time",
    );
    expect(askInitial?.getAttribute("aria-checked")).toBe("true");
    expect(
      options.filter((el) => el.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);

    // Select a different option → single-selection invariant holds.
    const denyOption = screen.getByRole("radio", { name: "Deny by default" });
    await act(async () => {
      fireEvent.click(denyOption);
    });

    await openDropdown();
    const nextOptions = screen.getAllByRole("radio");
    expect(
      nextOptions.filter((el) => el.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
    const denyAfter = nextOptions.find(
      (el) => el.textContent === "Deny by default",
    );
    expect(denyAfter?.getAttribute("aria-checked")).toBe("true");
  });
});
