import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "../OfflineBanner";

/**
 * Unit tests for the navigator.onLine-driven Offline banner introduced
 * by feature m7-a11y-offline-banner (VAL-CROSS-026).
 */

const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "onLine",
);

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

function dispatchOnline() {
  window.dispatchEvent(new Event("online"));
}

function dispatchOffline() {
  window.dispatchEvent(new Event("offline"));
}

beforeEach(() => {
  setOnLine(true);
});

afterEach(() => {
  cleanup();
  if (originalOnLineDescriptor) {
    Object.defineProperty(window.navigator, "onLine", originalOnLineDescriptor);
  } else {
    // Fallback — reset to a known sane default.
    setOnLine(true);
  }
});

describe("OfflineBanner", () => {
  it("renders nothing while navigator.onLine is true", () => {
    setOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("renders the banner immediately on mount when navigator.onLine is already false", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Offline — relays unreachable");
  });

  it("surfaces the banner when a window 'offline' event fires after mount", () => {
    setOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    setOnLine(false);
    act(() => {
      dispatchOffline();
    });
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Offline — relays unreachable");
  });

  it("uses role=alert and aria-live=assertive so SRs announce the offline condition", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
  });

  it("clears the banner and invokes onReconnect when a window 'online' event fires", () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    setOnLine(false);
    render(<OfflineBanner onReconnect={onReconnect} />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    expect(onReconnect).not.toHaveBeenCalled();
    setOnLine(true);
    act(() => {
      dispatchOnline();
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does not throw or escalate when onReconnect rejects asynchronously", async () => {
    const rejection = new Error("simulated reconnect failure");
    const onReconnect = vi.fn().mockRejectedValue(rejection);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setOnLine(false);
    render(<OfflineBanner onReconnect={onReconnect} />);
    setOnLine(true);
    await act(async () => {
      dispatchOnline();
      // Flush microtasks so the rejected-promise .catch runs in the
      // same test tick; otherwise the unhandled rejection would still
      // race past this expectation.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not throw when onReconnect synchronously throws", () => {
    const onReconnect = vi.fn(() => {
      throw new Error("sync throw");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setOnLine(false);
    render(<OfflineBanner onReconnect={onReconnect} />);
    setOnLine(true);
    act(() => {
      dispatchOnline();
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("removes its window listeners on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    setOnLine(true);
    const { unmount } = render(<OfflineBanner />);
    const addedEvents = addSpy.mock.calls.map(([name]) => name);
    expect(addedEvents).toEqual(
      expect.arrayContaining(["offline", "online"]),
    );
    unmount();
    const removedEvents = removeSpy.mock.calls.map(([name]) => name);
    expect(removedEvents).toEqual(
      expect.arrayContaining(["offline", "online"]),
    );
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("re-shows the banner if offline fires again after a recovery cycle", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    setOnLine(true);
    act(() => {
      dispatchOnline();
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    setOnLine(false);
    act(() => {
      dispatchOffline();
    });
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });
});
