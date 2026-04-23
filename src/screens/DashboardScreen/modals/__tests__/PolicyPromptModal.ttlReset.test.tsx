import {
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerDeniedEvent } from "../../../../app/AppStateTypes";
import { PolicyPromptModal } from "../PolicyPromptModal";

/**
 * Tests for feature `fix-m2-policy-prompt-modal-ttl-reset`.
 *
 * Covers the FIFO-advancement TTL reset behavior: when the PolicyPromptModal's
 * active `event` prop advances from the previous head of `peerDenialQueue`
 * (e.g. after the head was auto-dismissed on TTL expiry) to the next queued
 * prompt, the internal `remainingMs` countdown state must be reset to the
 * newly-active prompt's fresh TTL — the modal must NOT inherit the terminal
 * `0` value from the outgoing prompt and auto-dismiss the advanced one.
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
    ...overrides,
  };
}

describe("PolicyPromptModal — multi-prompt FIFO TTL reset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("auto-dismisses the head prompt exactly once when its TTL expires (single-prompt baseline)", () => {
    const onDismiss = vi.fn();
    const onResolve = vi.fn();
    const event = makeEvent("prompt-1", { ttl_ms: 2_000 });

    render(
      <PolicyPromptModal
        event={event}
        onResolve={onResolve}
        onDismiss={onDismiss}
      />,
    );

    // Initial render shows the event's TTL (2s).
    expect(screen.getByText(/Expires in/).textContent).toContain("2s");
    expect(onDismiss).not.toHaveBeenCalled();

    // Advance past TTL → the interval callback sees next === 0 and fires
    // onDismiss once for this event.
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does NOT immediately auto-dismiss the next prompt when the queue advances after the head prompt expired", () => {
    // Parent state that will be flipped from event1 → event2 after the
    // first prompt auto-dismisses. onDismiss identity intentionally
    // changes with the active event so we reproduce the real
    // DashboardScreen closure behavior (see `handleDismissPolicyPrompt`).
    const event1 = makeEvent("prompt-1", { ttl_ms: 2_000 });
    const event2 = makeEvent("prompt-2", {
      ttl_ms: 60_000,
      peer_pubkey: "b".repeat(64),
      content: "second prompt content",
    });

    const onDismiss1 = vi.fn();
    const onDismiss2 = vi.fn();
    const onResolve = vi.fn();

    const { rerender } = render(
      <PolicyPromptModal
        event={event1}
        onResolve={onResolve}
        onDismiss={onDismiss1}
      />,
    );

    // Drive event1 to its TTL so the modal auto-dismisses event1.
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(onDismiss1).toHaveBeenCalledTimes(1);

    // Queue advances: parent re-renders the modal with event2 and a new
    // onDismiss closure identity (as DashboardScreen would).
    rerender(
      <PolicyPromptModal
        event={event2}
        onResolve={onResolve}
        onDismiss={onDismiss2}
      />,
    );

    // CRITICAL: the advanced prompt must NOT inherit remainingMs=0 from
    // event1 and immediately auto-dismiss. Without the TTL reset this
    // call fires synchronously on the first commit with the new event.
    expect(onDismiss2).not.toHaveBeenCalled();

    // The displayed countdown reflects event2's fresh 60s TTL (rendered
    // as "1m 00s"), not the terminal "Expires in 0s" of event1.
    const expiryText = screen.getByText(/Expires in/).textContent ?? "";
    expect(expiryText).not.toMatch(/Expires in 0s$/);
    expect(expiryText).toContain("1m 00s");

    // Nudging time a bit under event2's TTL must still not dismiss.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onDismiss2).not.toHaveBeenCalled();

    // After event2's full TTL elapses, it is auto-dismissed exactly once.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss2).toHaveBeenCalledTimes(1);
  });

  it("resets the countdown display for the next prompt even when the prior prompt was user-dismissed mid-countdown", () => {
    const event1 = makeEvent("prompt-1", { ttl_ms: 60_000 });
    const event2 = makeEvent("prompt-2", {
      ttl_ms: 30_000,
      peer_pubkey: "c".repeat(64),
    });

    const onResolve = vi.fn();
    const onDismiss1 = vi.fn();
    const onDismiss2 = vi.fn();

    const { rerender } = render(
      <PolicyPromptModal
        event={event1}
        onResolve={onResolve}
        onDismiss={onDismiss1}
      />,
    );

    // User waits 40s, then parent swaps to event2 (queue advanced).
    act(() => {
      vi.advanceTimersByTime(40_000);
    });

    rerender(
      <PolicyPromptModal
        event={event2}
        onResolve={onResolve}
        onDismiss={onDismiss2}
      />,
    );

    // Advanced prompt shows its own fresh TTL (30s) — not the residual
    // "20s" that would be leaking from event1's mid-countdown state.
    // Allow the reset effect to settle before asserting.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const expiryText = screen.getByText(/Expires in/).textContent ?? "";
    expect(expiryText).toContain("30s");
    expect(expiryText).not.toContain("20s");
    expect(onDismiss2).not.toHaveBeenCalled();
  });
});
