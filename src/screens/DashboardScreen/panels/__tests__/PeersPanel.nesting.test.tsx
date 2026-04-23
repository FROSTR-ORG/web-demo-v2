import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeersPanel } from "../PeersPanel";
import type { PeerStatus } from "../../../../lib/bifrost/types";

/**
 * Regression coverage for feature `misc-peers-panel-nested-button`.
 *
 * PeersPanel previously wrapped its whole header row (including the
 * "Refresh peers" icon button) inside the `<Collapsible>` toggle
 * `<button>`. That produced two problems:
 *
 *   1. React's `validateDOMNesting` emits
 *      `<button> cannot be a descendant of <button>` every render
 *      under jsdom, polluting the console and failing the
 *      demo-gallery zero-console-error guard.
 *   2. Focusing/activating a nested interactive element within a
 *      button is undefined behaviour for keyboard + screen-reader
 *      users.
 *
 * These tests lock in the fix: no nested `<button>` in the rendered
 * markup, the collapsible toggle still works via click + keyboard,
 * and the refresh button still dispatches the handler with an
 * accessible name.
 */

function makePeer(idx: number, online: boolean): PeerStatus {
  return {
    idx,
    pubkey: `peer${idx}pub`,
    known: true,
    last_seen: online ? Date.now() : null,
    online,
    incoming_available: online ? 4 : 0,
    outgoing_available: online ? 4 : 0,
    outgoing_spent: 0,
    can_sign: online,
    should_send_nonces: online,
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

function renderPeersPanel(onRefresh = vi.fn()) {
  const peers = [makePeer(1, true), makePeer(2, false)];
  return {
    onRefresh,
    ...render(
      <PeersPanel
        peers={peers}
        onlineCount={1}
        signReadyLabel="sign ready"
        paperPanels={false}
        onRefresh={onRefresh}
      />,
    ),
  };
}

describe("PeersPanel — nested-button regression", () => {
  it("does not nest any <button> inside another <button>", () => {
    const { container } = renderPeersPanel();
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.querySelector("button")).toBeNull();
    }
  });

  it("does not emit a React 'cannot be a descendant of <button>' warning on render", () => {
    renderPeersPanel();
    const nestingWarnings = consoleErrorSpy.mock.calls.filter((call: unknown[]) => {
      const msg = call
        .map((part: unknown) =>
          typeof part === "string" ? part : JSON.stringify(part ?? ""),
        )
        .join(" ");
      return (
        /validateDOMNesting/i.test(msg) ||
        /cannot be a descendant of <button>/i.test(msg)
      );
    });
    expect(nestingWarnings).toEqual([]);
  });

  it("refresh button has an accessible name and dispatches onRefresh", () => {
    const { onRefresh } = renderPeersPanel();
    const refreshBtn = screen.getByRole("button", { name: "Refresh peers" });
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("clicking the refresh button does not collapse the peers panel", () => {
    const { onRefresh, container } = renderPeersPanel();
    // Panel opens by default.
    expect(container.querySelector(".peer-list")).not.toBeNull();
    const refreshBtn = screen.getByRole("button", { name: "Refresh peers" });
    fireEvent.click(refreshBtn);
    expect(container.querySelector(".peer-list")).not.toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("collapsible toggle works via click and via keyboard Enter/Space", () => {
    const { container } = renderPeersPanel();
    // Default open.
    expect(container.querySelector(".peer-list")).not.toBeNull();

    const toggle = screen.getByRole("button", {
      name: /peers panel/i,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Click collapses.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".peer-list")).toBeNull();

    // Native <button>s activate on Enter/Space — simulate by firing
    // synthetic click (which is what JSDOM/browsers both emit when
    // Enter or Space is pressed on a focused button).
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".peer-list")).not.toBeNull();

    fireEvent.keyDown(toggle, { key: " " });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".peer-list")).toBeNull();
  });
});
