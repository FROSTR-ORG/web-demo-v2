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
 * m3-peer-policy-chip-cycle — component-level coverage for
 * VAL-POLICIES-008 / VAL-POLICIES-021 / VAL-POLICIES-026.
 *
 *  - VAL-POLICIES-008: click cycles the Peer Policies chip through
 *    `unset → allow → deny → unset`; each click dispatches exactly one
 *    `setPeerPolicyOverride` call with the correct next value
 *    (including the `value: "unset"` "clear this cell" transition).
 *  - VAL-POLICIES-021: Enter and Space trigger the same cycle as
 *    click; `role="button"`, `aria-pressed`, and `aria-label` reflect
 *    the chip's current state.
 *  - VAL-POLICIES-026: a failing dispatch rolls the chip back to the
 *    prior state within 1 s and surfaces an inline error.
 *
 *  The chip is wired against a real `MockAppStateProvider` so the test
 *  exercises the full (component + provider + spy) dispatch path.
 */

afterEach(cleanup);

const PEER_PUBKEY = "aaaa".padEnd(64, "0");

function makePeer(): PeerStatus {
  return {
    idx: 0,
    pubkey: PEER_PUBKEY,
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

function makePermissionState(): PeerPermissionState {
  return {
    pubkey: PEER_PUBKEY,
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
  } as PeerPermissionState;
}

function renderPoliciesWithChipSpy(options: {
  dispatch: AppStateValue["setPeerPolicyOverride"];
}) {
  const peers = [makePeer()];
  const permissionStates = [makePermissionState()];
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

function chipByMethod(method: "sign" | "ecdh" | "ping" | "onboard") {
  return screen.getByTestId(`peer-policy-chip-${PEER_PUBKEY}-${method}`);
}

describe("PeerPolicyChip — cycle + keyboard + rollback (VAL-POLICIES-008/021/026)", () => {
  it("click cycles unset → allow → deny → unset and dispatches one setPeerPolicyOverride per step", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPoliciesWithChipSpy({ dispatch });

    const chip = chipByMethod("sign");
    expect(chip.getAttribute("data-state")).toBe("unset");
    expect(chip.getAttribute("role")).toBe("button");
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    // Click 1: unset → allow
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      peer: PEER_PUBKEY,
      direction: "request",
      method: "sign",
      value: "allow",
    });
    expect(chip.getAttribute("data-state")).toBe("allow");
    expect(chip.getAttribute("aria-pressed")).toBe("true");

    // Click 2: allow → deny
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      peer: PEER_PUBKEY,
      direction: "request",
      method: "sign",
      value: "deny",
    });
    expect(chip.getAttribute("data-state")).toBe("deny");
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    // Click 3: deny → unset (the "clear this cell" transition — dispatched as
    // `value: "unset"` so the runtime scopes the clear to this single cell).
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      peer: PEER_PUBKEY,
      direction: "request",
      method: "sign",
      value: "unset",
    });
    expect(chip.getAttribute("data-state")).toBe("unset");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("Enter and Space activate the cycle the same as click (VAL-POLICIES-021)", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPoliciesWithChipSpy({ dispatch });

    const chip = chipByMethod("ecdh");
    expect(chip.getAttribute("data-state")).toBe("unset");

    // Enter: unset → allow
    await act(async () => {
      fireEvent.keyDown(chip, { key: "Enter" });
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith({
      peer: PEER_PUBKEY,
      direction: "request",
      method: "ecdh",
      value: "allow",
    });
    expect(chip.getAttribute("data-state")).toBe("allow");

    // Space: allow → deny
    await act(async () => {
      fireEvent.keyDown(chip, { key: " " });
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({
      peer: PEER_PUBKEY,
      direction: "request",
      method: "ecdh",
      value: "deny",
    });
    expect(chip.getAttribute("data-state")).toBe("deny");
  });

  it("rolls back optimistic state and surfaces an inline error when dispatch rejects (VAL-POLICIES-026)", async () => {
    const dispatch = vi.fn<AppStateValue["setPeerPolicyOverride"]>(
      async () => {
        throw new Error("runtime refused");
      },
    );
    renderPoliciesWithChipSpy({ dispatch });

    const chip = chipByMethod("ping");
    expect(chip.getAttribute("data-state")).toBe("unset");

    await act(async () => {
      fireEvent.click(chip);
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    // Rollback to prior `unset` visual within one microtask — well under
    // the 1 s budget VAL-POLICIES-026 allows.
    await waitFor(() => {
      expect(chip.getAttribute("data-state")).toBe("unset");
    });
    // aria-pressed reflects rolled-back state too.
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    // Inline error is surfaced via a role="status" region so screen
    // readers announce the failure without opening a modal.
    const errorNode = screen.getByTestId(
      `peer-policy-chip-error-${PEER_PUBKEY}-ping`,
    );
    expect(errorNode.textContent).toMatch(/runtime refused/);
    expect(errorNode.getAttribute("role")).toBe("status");
  });

  it("aria-label narrates the current state so screen readers distinguish unset / allow / deny", async () => {
    const dispatch = vi.fn(async () => undefined);
    renderPoliciesWithChipSpy({ dispatch });

    const chip = chipByMethod("onboard");
    expect(chip.getAttribute("aria-label")).toMatch(/ONBOARD/i);
    expect(chip.getAttribute("aria-label")).toMatch(/Unset/i);

    await act(async () => {
      fireEvent.click(chip);
    });
    expect(chip.getAttribute("aria-label")).toMatch(/Allow/i);

    await act(async () => {
      fireEvent.click(chip);
    });
    expect(chip.getAttribute("aria-label")).toMatch(/Deny/i);
  });
});
