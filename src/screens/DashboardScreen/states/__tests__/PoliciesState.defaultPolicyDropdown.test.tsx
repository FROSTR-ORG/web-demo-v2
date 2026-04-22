import { createRef, useState } from "react";
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
import {
  DefaultPolicyDropdown,
  type DefaultPolicyDropdownHandle,
  type DefaultPolicyOption,
} from "../../panels/DefaultPolicyDropdown";
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

  it("user-authored chip overrides survive a subsequent default switch (no-clobber invariant, fix-m3-default-policy-no-clobber-user-overrides)", async () => {
    // Scenario:
    //  (a) Default is applied: "Deny by default" dispatches
    //      respond.sign=deny (etc) for peer P. The dropdown records
    //      these cells in `defaultAppliedKeys` so a future switch can
    //      revert only what the dropdown itself wrote.
    //  (b) The runtime snapshot propagates the deny into
    //      `manual_override.respond.*` for P.
    //  (c) The user clicks P's SIGN chip and overrides
    //      respond.sign → "allow". The snapshot now shows a concrete
    //      value that differs from what the dropdown originally wrote.
    //  (d) The user switches the default to "Ask every time". The
    //      dropdown should revert the three cells it still owns
    //      (respond.{ecdh,ping,onboard}) but MUST NOT dispatch
    //      `unset` for (P, respond, sign) — doing so would clobber the
    //      user-authored override.
    //
    // We drive the snapshot transitions explicitly via `rerender`
    // rather than relying on runtime propagation because the test
    // dispatcher is a bare `vi.fn` that doesn't mutate AppState.
    const dispatch = vi.fn(async () => undefined);
    const peers = [makePeer(0, PEER_A_PUBKEY)];
    const seed = createDemoAppState({ setPeerPolicyOverride: dispatch });

    const initialStates: PeerPermissionState[] = [
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
    ];

    const renderTree = (states: PeerPermissionState[]) => (
      <MemoryRouter>
        <MockAppStateProvider value={seed} bridge={false}>
          <PoliciesState
            peers={peers}
            peerPermissionStates={states}
            paperPanels={false}
          />
        </MockAppStateProvider>
      </MemoryRouter>
    );

    const view = render(renderTree(initialStates));

    // (a) Apply Deny by default.
    await openDropdown();
    const denyOption = screen.getByRole("radio", { name: "Deny by default" });
    await act(async () => {
      fireEvent.click(denyOption);
    });
    await waitFor(() => {
      const deniedPeers = dispatchedPeersForValue(dispatch, "deny");
      expect(deniedPeers.has(PEER_A_PUBKEY)).toBe(true);
    });

    // (b) Propagate the deny into the snapshot so the dropdown sees
    // its writes reflected in `manual_override.respond.*`.
    const afterDeny: PeerPermissionState[] = [
      {
        pubkey: PEER_A_PUBKEY,
        manual_override: {
          request: {},
          respond: {
            sign: "deny",
            ecdh: "deny",
            ping: "deny",
            onboard: "deny",
          },
        },
        remote_observation: { observed_at: Date.now() },
        effective_policy: {
          request: {
            sign: "allow",
            ecdh: "allow",
            ping: "allow",
            onboard: "deny",
          },
          respond: {
            sign: "deny",
            ecdh: "deny",
            ping: "deny",
            onboard: "deny",
          },
        },
      } as PeerPermissionState,
    ];
    view.rerender(renderTree(afterDeny));

    // (c) Simulate user flipping respond.sign → allow (e.g. via a chip
    //     surface that writes `respond.*`).
    const afterUserOverride: PeerPermissionState[] = [
      {
        pubkey: PEER_A_PUBKEY,
        manual_override: {
          request: {},
          respond: {
            sign: "allow",
            ecdh: "deny",
            ping: "deny",
            onboard: "deny",
          },
        },
        remote_observation: { observed_at: Date.now() },
        effective_policy: {
          request: {
            sign: "allow",
            ecdh: "allow",
            ping: "allow",
            onboard: "deny",
          },
          respond: {
            sign: "allow",
            ecdh: "deny",
            ping: "deny",
            onboard: "deny",
          },
        },
      } as PeerPermissionState,
    ];
    view.rerender(renderTree(afterUserOverride));

    // Drop the dispatches accumulated so far so we only observe the
    // switch-to-"Ask every time" call log.
    dispatch.mockClear();

    // (d) Switch the default to "Ask every time".
    await openDropdown();
    const askOption = screen.getByRole("radio", { name: "Ask every time" });
    await act(async () => {
      fireEvent.click(askOption);
    });

    // Wait for the unset dispatches to settle for the three cells the
    // dropdown still owns (ecdh / ping / onboard on P).
    await waitFor(() => {
      for (const method of ["ecdh", "ping", "onboard"] as const) {
        expect(dispatch).toHaveBeenCalledWith({
          peer: PEER_A_PUBKEY,
          direction: "respond",
          method,
          value: "unset",
        });
      }
    });

    // Invariant: no `unset` dispatch is emitted for (P, respond,
    // sign) because the user-authored chip override removed that key
    // from `defaultAppliedKeys` — switching defaults must not revert
    // user-authored cells. We walk `mock.calls` via the loose
    // `ReturnType<typeof vi.fn>` cast the other helpers in this file
    // use so we don't trip on vitest's empty-args inference for typed
    // `vi.fn` returns.
    const dispatchLog = (
      dispatch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls as unknown as ReadonlyArray<
      [
        {
          peer: string;
          direction: string;
          method: string;
          value: string;
        },
      ]
    >;
    const signUnsetCalls = dispatchLog.filter((call) => {
      const arg = call[0];
      return (
        arg.peer === PEER_A_PUBKEY &&
        arg.direction === "respond" &&
        arg.method === "sign" &&
        arg.value === "unset"
      );
    });
    expect(signUnsetCalls).toHaveLength(0);

    // And the dropdown must not emit any new allow/deny dispatches
    // under "Ask every time".
    const allowDenyCalls = dispatchLog.filter((call) => {
      const arg = call[0];
      return arg.value === "allow" || arg.value === "deny";
    });
    expect(allowDenyCalls).toHaveLength(0);
    // All dropdown-emitted dispatches still target `respond.*`.
    assertAllDispatchesTargetRespond(dispatch);
  });

  it("eager drop: chip write BEFORE snapshot tick survives a subsequent default switch (fix-m3-default-policy-no-clobber-race-eager-drop)", async () => {
    // Race window reproduction:
    //   (a) Dropdown applies "Deny by default" — writes respond.{sign,ecdh,
    //       ping,onboard}=deny to the runtime for peer P and records those
    //       cells in `defaultAppliedKeys`.
    //   (b) Runtime snapshot propagates the deny into manual_override.respond.*
    //       for P.
    //   (c) The user clicks a (hypothetical future) respond.* chip for P.sign
    //       that dispatches setPeerPolicyOverride({peer: P, direction: "respond",
    //       method: "sign", value: "allow"}). The dispatch fires IMMEDIATELY,
    //       but the runtime has not yet reflected it back through the poller,
    //       so `peerPermissionStates` still shows respond.sign=deny on the
    //       next render.
    //   (d) Before any `peerPermissionStates` tick arrives, the user switches
    //       the default to "Ask every time". Without the eager-drop fix the
    //       dropdown still owns (P, respond, sign) in `defaultAppliedKeys`
    //       and dispatches `unset` for it — clobbering the user-authored
    //       chip write.
    //
    // The fix wires the PeerPolicyChip dispatch path (via PoliciesState's
    // setPeerPolicyOverride wrapper) to call the DefaultPolicyDropdown
    // imperative handle's `notifyPeerPolicyWrite(cell)` the MOMENT the
    // dispatch lands, dropping dropdown ownership of that cell before any
    // snapshot propagates. This test exercises that handle directly so the
    // race is reproduced deterministically (no real runtime / poll-tick
    // timing).
    const dispatch = vi.fn(async () => undefined);
    const handleRef = createRef<DefaultPolicyDropdownHandle>();
    const peer = PEER_A_PUBKEY;

    const initialStates: PeerPermissionState[] = [
      {
        pubkey: peer,
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
    ];

    function Harness({ states }: { states: PeerPermissionState[] }) {
      const [value, setValue] = useState<DefaultPolicyOption>("Ask every time");
      return (
        <DefaultPolicyDropdown
          ref={handleRef}
          value={value}
          onChange={setValue}
          peerPermissionStates={states}
          dispatch={dispatch}
        />
      );
    }

    const view = render(<Harness states={initialStates} />);

    // (a) Apply "Deny by default" — dropdown writes deny to respond.* for peer.
    const trigger = screen.getByRole("combobox", { name: /default policy/i });
    await act(async () => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    const denyOption = screen.getByRole("radio", { name: "Deny by default" });
    await act(async () => {
      fireEvent.click(denyOption);
    });
    await waitFor(() => {
      const deniedPeers = dispatchedPeersForValue(dispatch, "deny");
      expect(deniedPeers.has(peer)).toBe(true);
    });

    // (b) Propagate the deny into the snapshot so the dropdown sees its
    // writes reflected in manual_override.respond.*.
    const afterDeny: PeerPermissionState[] = [
      {
        pubkey: peer,
        manual_override: {
          request: {},
          respond: {
            sign: "deny",
            ecdh: "deny",
            ping: "deny",
            onboard: "deny",
          },
        },
        remote_observation: { observed_at: Date.now() },
        effective_policy: {
          request: {
            sign: "allow",
            ecdh: "allow",
            ping: "allow",
            onboard: "deny",
          },
          respond: {
            sign: "deny",
            ecdh: "deny",
            ping: "deny",
            onboard: "deny",
          },
        },
      } as PeerPermissionState,
    ];
    view.rerender(<Harness states={afterDeny} />);

    // (c) Simulate a respond.sign chip click that dispatches but has NOT
    //     yet propagated through the poller. In production PoliciesState
    //     wraps setPeerPolicyOverride for the chip path so this notify is
    //     invoked synchronously when the chip fires — here we invoke the
    //     imperative handle directly to reproduce that exact moment.
    //
    //     Crucially, we do NOT rerender with an updated snapshot — this
    //     captures the race window where the runtime has not yet echoed
    //     the chip's write back.
    act(() => {
      handleRef.current?.notifyPeerPolicyWrite({
        peer,
        direction: "respond",
        method: "sign",
      });
    });

    dispatch.mockClear();

    // (d) IMMEDIATE default switch to "Ask every time" BEFORE any
    //     peerPermissionStates tick arrives.
    const trigger2 = screen.getByRole("combobox", { name: /default policy/i });
    await act(async () => {
      trigger2.focus();
      fireEvent.keyDown(trigger2, { key: "Enter" });
    });
    const askOption = screen.getByRole("radio", { name: "Ask every time" });
    await act(async () => {
      fireEvent.click(askOption);
    });

    // The three cells the dropdown still owns — respond.{ecdh,ping,onboard} —
    // get reverted with `unset`. The eagerly-dropped respond.sign cell must
    // NOT be reverted.
    await waitFor(() => {
      for (const method of ["ecdh", "ping", "onboard"] as const) {
        expect(dispatch).toHaveBeenCalledWith({
          peer,
          direction: "respond",
          method,
          value: "unset",
        });
      }
    });

    const dispatchLog = (
      dispatch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls as unknown as ReadonlyArray<
      [
        {
          peer: string;
          direction: string;
          method: string;
          value: string;
        },
      ]
    >;
    const signUnsetCalls = dispatchLog.filter((call) => {
      const arg = call[0];
      return (
        arg.peer === peer &&
        arg.direction === "respond" &&
        arg.method === "sign" &&
        arg.value === "unset"
      );
    });
    expect(signUnsetCalls).toHaveLength(0);

    // Ask-every-time must not emit any allow/deny writes.
    const allowDenyCalls = dispatchLog.filter((call) => {
      const arg = call[0];
      return arg.value === "allow" || arg.value === "deny";
    });
    expect(allowDenyCalls).toHaveLength(0);
  });

  it("wrapped setPeerPolicyOverride: PoliciesState forwards chip dispatch through a wrapper that notifies the dropdown handle (fix-m3-default-policy-no-clobber-race-eager-drop)", async () => {
    // Integration guard: PoliciesState wraps the chip's onDispatch
    // prop so every chip write synchronously notifies DefaultPolicyDropdown
    // to drop ownership. We verify the wrapper's call-through (the
    // underlying setPeerPolicyOverride is still invoked exactly once
    // per chip click) because the eager-drop logic must not regress
    // the VAL-POLICIES-008 "one dispatch per click" contract.
    const dispatch = vi.fn(async () => undefined);
    renderPolicies({ dispatch });

    // Click a SIGN chip on peer A to cycle unset → allow (writes request.*).
    const chip = screen.getByTestId(`peer-policy-chip-${PEER_A_PUBKEY}-sign`);
    await act(async () => {
      fireEvent.click(chip);
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        peer: PEER_A_PUBKEY,
        direction: "request",
        method: "sign",
        value: "allow",
      });
    });
    // Exactly one dispatch landed (wrapper must not double-call).
    expect(dispatch).toHaveBeenCalledTimes(1);
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
