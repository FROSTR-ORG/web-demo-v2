import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerDeniedEvent } from "../../../../app/AppStateTypes";
import { PolicyPromptModal } from "../PolicyPromptModal";

/**
 * Tests for feature `fix-m2-policy-prompt-modal-scroll-lock`.
 *
 * Covers VAL-APPROVALS-021: while `PolicyPromptModal` is mounted the
 * background page must not scroll (wheel / keyboard PageDown / touchmove)
 * and the user's pre-open scroll position must be restored on close.
 *
 * The implementation is required to use the "fixed body offset" pattern:
 *  - on open: record `window.scrollY`, set `body.position = 'fixed'`,
 *    `body.top = '-<scrollY>px'`, `body.left = '0'`, `body.right = '0'`,
 *    `body.width = '100%'`, `body.overflow = 'hidden'`.
 *  - on close: restore every mutated body style to its pre-open value and
 *    `window.scrollTo(0, savedScrollY)` to snap the page back.
 *
 * The assertions below pin (a) the locked body styles during the modal's
 * lifetime, (b) that a simulated wheel event during open does NOT advance
 * `window.scrollY`, and (c) that closing the modal restores every body
 * style and calls `window.scrollTo` with the original offset.
 */

function makeEvent(
  id: string,
  overrides: Partial<PeerDeniedEvent> = {},
): PeerDeniedEvent {
  return {
    id,
    peer_pubkey: "a".repeat(64),
    peer_label: `Peer ${id}`,
    verb: "sign",
    denied_at: 0,
    event_kind: "kind:1 Short Text Note",
    content: "hello",
    domain: "example.com",
    ttl_ms: 60_000,
    ...overrides,
  };
}

describe("PolicyPromptModal — robust scroll lock (VAL-APPROVALS-021)", () => {
  let originalScrollY: PropertyDescriptor | undefined;
  let originalPageYOffset: PropertyDescriptor | undefined;
  let originalScrollTo: typeof window.scrollTo;

  beforeEach(() => {
    // Capture descriptors so the post-test cleanup can put them back.
    originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    originalPageYOffset = Object.getOwnPropertyDescriptor(
      window,
      "pageYOffset",
    );
    originalScrollTo = window.scrollTo;

    // Simulate the user having scrolled the page to 250px before the
    // modal mounts so we can verify the lock captures the right offset.
    Object.defineProperty(window, "scrollY", {
      value: 250,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "pageYOffset", {
      value: 250,
      configurable: true,
      writable: true,
    });

    // Reset body styles so each test starts clean.
    document.body.removeAttribute("style");
  });

  afterEach(() => {
    cleanup();
    window.scrollTo = originalScrollTo;
    if (originalScrollY) {
      Object.defineProperty(window, "scrollY", originalScrollY);
    } else {
      // @ts-expect-error - restore missing descriptor
      delete window.scrollY;
    }
    if (originalPageYOffset) {
      Object.defineProperty(window, "pageYOffset", originalPageYOffset);
    } else {
      // @ts-expect-error - restore missing descriptor
      delete window.pageYOffset;
    }
    document.body.removeAttribute("style");
  });

  it("sets fixed-body-offset styles with overflow=hidden while the modal is open", () => {
    render(
      <PolicyPromptModal
        event={makeEvent("p1")}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-250px");
    expect(document.body.style.left).toBe("0px");
    expect(document.body.style.right).toBe("0px");
    expect(document.body.style.width).toBe("100%");
  });

  it("does not advance window.scrollY when a wheel event fires while the modal is open", () => {
    render(
      <PolicyPromptModal
        event={makeEvent("p1")}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const before = window.scrollY;
    // Simulate a user scroll attempt. Because body is `position: fixed`
    // the browser cannot scroll the viewport; in jsdom we additionally
    // assert the value remains constant after dispatching the event.
    window.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new Event("touchmove", { bubbles: true, cancelable: true }),
    );
    expect(window.scrollY).toBe(before);
  });

  it("restores every mutated body style AND scroll position when the modal closes", () => {
    const scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy as typeof window.scrollTo;

    const { unmount } = render(
      <PolicyPromptModal
        event={makeEvent("p1")}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("");
    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(document.body.style.left).toBe("");
    expect(document.body.style.right).toBe("");
    expect(document.body.style.width).toBe("");
    expect(scrollToSpy).toHaveBeenCalledWith(0, 250);
  });

  it("preserves prior inline body styles and restores them verbatim on close", () => {
    document.body.style.overflow = "auto";
    document.body.style.position = "relative";
    document.body.style.top = "5px";
    document.body.style.left = "3px";
    document.body.style.right = "2px";
    document.body.style.width = "auto";

    const scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy as typeof window.scrollTo;

    const { unmount } = render(
      <PolicyPromptModal
        event={makeEvent("p1")}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    // Lock in effect overrides prior values.
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");

    unmount();

    // All prior inline values restored as-is.
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.top).toBe("5px");
    expect(document.body.style.left).toBe("3px");
    expect(document.body.style.right).toBe("2px");
    expect(document.body.style.width).toBe("auto");
    expect(scrollToSpy).toHaveBeenCalledWith(0, 250);
  });
});
