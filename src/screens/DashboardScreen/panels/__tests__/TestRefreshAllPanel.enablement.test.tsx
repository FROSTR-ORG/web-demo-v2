import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TestRefreshAllPanel enablement — fulfils feature
 * `fix-m1-test-ping-and-refresh-all-enablement` + VAL-OPS-025.
 *
 * Verifies the Refresh All submit button:
 *   - is ENABLED when refreshBlocked=false (no per-input gate — the
 *     broadcast refresh takes no arguments).
 *   - is DISABLED when refreshBlocked=true, and surfaces the caller-
 *     provided accessible reason (signerPaused / stopped variants).
 *   - does NOT dispatch `handleRuntimeCommand({type:"refresh_all_peers"})`
 *     while disabled.
 *
 * Pure component test; sibling to `TestPingPanel.enablement.test.tsx`.
 */

const mockHandleRuntimeCommand = vi.fn(async () => ({
  requestId: "req-refresh-1",
  debounced: false,
}));
const mockRefreshRuntime = vi.fn();

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    handleRuntimeCommand: mockHandleRuntimeCommand,
    refreshRuntime: mockRefreshRuntime,
  }),
}));

// Import AFTER the mock so the panel binds to the mocked context.
import { TestRefreshAllPanel } from "../TestRefreshAllPanel";

afterEach(() => {
  cleanup();
  mockHandleRuntimeCommand.mockClear();
  mockRefreshRuntime.mockClear();
});

function getSubmit(): HTMLButtonElement {
  const panel = screen.getByTestId("test-refresh-all-panel");
  return panel.querySelector("button[type='submit']") as HTMLButtonElement;
}

describe("TestRefreshAllPanel enablement — running runtime", () => {
  it("renders Refresh All ENABLED when refreshBlocked=false (no input required)", () => {
    render(<TestRefreshAllPanel refreshBlocked={false} />);
    const submit = getSubmit();
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBe("false");
  });

  it("dispatches refresh_all_peers on click", async () => {
    render(<TestRefreshAllPanel refreshBlocked={false} />);
    fireEvent.click(getSubmit());

    await waitFor(() => {
      expect(mockHandleRuntimeCommand).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleRuntimeCommand).toHaveBeenCalledWith({
      type: "refresh_all_peers",
    });
  });
});

describe("TestRefreshAllPanel enablement — refreshBlocked=true disables the control", () => {
  it("disables submit when refreshBlocked=true", () => {
    render(<TestRefreshAllPanel refreshBlocked={true} />);
    const submit = getSubmit();
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
  });

  it("does NOT dispatch handleRuntimeCommand when disabled (click + submit guarded)", () => {
    render(<TestRefreshAllPanel refreshBlocked={true} />);
    const panel = screen.getByTestId("test-refresh-all-panel");
    const submit = getSubmit();
    const form = panel.querySelector("form") as HTMLFormElement;

    fireEvent.click(submit);
    fireEvent.submit(form);

    expect(mockHandleRuntimeCommand).not.toHaveBeenCalled();
  });

  it("renders the caller-provided accessible reason (signerPaused copy)", () => {
    render(
      <TestRefreshAllPanel
        refreshBlocked={true}
        refreshBlockedReason="Signer paused — resume to ping peers."
      />,
    );
    const reason = screen.getByTestId("test-refresh-all-blocked-reason");
    expect(reason.textContent).toContain("Signer paused");
    expect(reason.getAttribute("role")).toBe("status");
  });

  it("renders the caller-provided accessible reason (stopped copy)", () => {
    render(
      <TestRefreshAllPanel
        refreshBlocked={true}
        refreshBlockedReason="Runtime stopped — start the signer to ping peers."
      />,
    );
    const reason = screen.getByTestId("test-refresh-all-blocked-reason");
    expect(reason.textContent).toContain("Runtime stopped");
  });

  it("falls back to neutral copy when refreshBlockedReason is null/undefined", () => {
    render(<TestRefreshAllPanel refreshBlocked={true} />);
    const reason = screen.getByTestId("test-refresh-all-blocked-reason");
    expect(reason.textContent).toContain("Refresh All unavailable");
  });
});
