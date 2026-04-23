import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TestPingPanel enablement — fulfils feature
 * `fix-m1-test-ping-and-refresh-all-enablement` + VAL-OPS-025.
 *
 * Verifies the Ping submit button:
 *   - is ENABLED when the runtime is running (signerPaused=false,
 *     pingBlocked=false) and a valid 64-hex pubkey is typed.
 *   - is DISABLED when `pingBlocked === true` (caller computed from
 *     signerPaused / dashboardState === 'stopped'), and renders the
 *     accessible reason the caller supplies.
 *   - stays DISABLED when input is invalid even if pingBlocked=false
 *     (per-input gate retained).
 *   - does NOT dispatch `handleRuntimeCommand({type:"ping",...})` while
 *     disabled — neither click nor form submit can slip through.
 *
 * This is a pure component test: we pass `pingBlocked` / `pingBlockedReason`
 * directly rather than driving the Dashboard integration, because the
 * Dashboard-level gate derivation is covered by
 * `TestPanel.enablement.integration.test.tsx` (sibling).
 */

const mockHandleRuntimeCommand = vi.fn(async () => ({
  requestId: "req-ping-1",
  debounced: false,
}));

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    handleRuntimeCommand: mockHandleRuntimeCommand,
  }),
}));

// Import AFTER the mock so the panel binds to the mocked context.
import { TestPingPanel } from "../TestPingPanel";

afterEach(() => {
  cleanup();
  mockHandleRuntimeCommand.mockClear();
});

const VALID_PUBKEY = "0123456789abcdef".repeat(4); // 64 hex chars

function getSubmit(): HTMLButtonElement {
  const panel = screen.getByTestId("test-ping-panel");
  return panel.querySelector("button[type='submit']") as HTMLButtonElement;
}

function getInput(): HTMLInputElement {
  const panel = screen.getByTestId("test-ping-panel");
  return panel.querySelector("input") as HTMLInputElement;
}

describe("TestPingPanel enablement — running runtime + valid input", () => {
  it("renders the Ping submit ENABLED when pingBlocked=false and a valid 64-hex pubkey is typed", () => {
    render(<TestPingPanel pingBlocked={false} />);
    const submit = getSubmit();
    const input = getInput();

    // Initially the submit is disabled because the input is empty — this
    // is the valid-hex gate, independent of pingBlocked.
    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: VALID_PUBKEY } });
    expect(submit.disabled).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBe("false");
  });

  it("dispatches ping with the typed pubkey on click", async () => {
    render(<TestPingPanel pingBlocked={false} />);
    const input = getInput();
    const submit = getSubmit();

    fireEvent.change(input, { target: { value: VALID_PUBKEY } });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockHandleRuntimeCommand).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleRuntimeCommand).toHaveBeenCalledWith({
      type: "ping",
      peer_pubkey32_hex: VALID_PUBKEY,
    });
  });
});

describe("TestPingPanel enablement — pingBlocked=true disables the control", () => {
  it("disables submit when pingBlocked=true even with a valid 64-hex pubkey", () => {
    render(<TestPingPanel pingBlocked={true} />);
    const input = getInput();
    const submit = getSubmit();

    fireEvent.change(input, { target: { value: VALID_PUBKEY } });
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
  });

  it("does NOT dispatch handleRuntimeCommand when disabled (click + submit guarded)", () => {
    render(<TestPingPanel pingBlocked={true} />);
    const panel = screen.getByTestId("test-ping-panel");
    const input = getInput();
    const submit = getSubmit();
    const form = panel.querySelector("form") as HTMLFormElement;

    fireEvent.change(input, { target: { value: VALID_PUBKEY } });
    fireEvent.click(submit);
    fireEvent.submit(form);

    expect(mockHandleRuntimeCommand).not.toHaveBeenCalled();
  });

  it("renders the caller-provided accessible reason (signerPaused copy)", () => {
    render(
      <TestPingPanel
        pingBlocked={true}
        pingBlockedReason="Signer paused — resume to ping peers."
      />,
    );
    const reason = screen.getByTestId("test-ping-blocked-reason");
    expect(reason.textContent).toContain("Signer paused");
    expect(reason.getAttribute("role")).toBe("status");
  });

  it("renders the caller-provided accessible reason (stopped copy)", () => {
    render(
      <TestPingPanel
        pingBlocked={true}
        pingBlockedReason="Runtime stopped — start the signer to ping peers."
      />,
    );
    const reason = screen.getByTestId("test-ping-blocked-reason");
    expect(reason.textContent).toContain("Runtime stopped");
  });

  it("falls back to neutral copy when pingBlockedReason is null/undefined", () => {
    render(<TestPingPanel pingBlocked={true} />);
    const reason = screen.getByTestId("test-ping-blocked-reason");
    expect(reason.textContent).toContain("Ping unavailable");
  });
});

describe("TestPingPanel enablement — valid-hex gate is independent of pingBlocked", () => {
  it("stays disabled when pingBlocked=false and input is invalid (non-hex)", () => {
    render(<TestPingPanel pingBlocked={false} />);
    const input = getInput();
    const submit = getSubmit();

    fireEvent.change(input, { target: { value: "z".repeat(64) } });
    expect(submit.disabled).toBe(true);
  });

  it("stays disabled when pingBlocked=false and input is too short", () => {
    render(<TestPingPanel pingBlocked={false} />);
    const input = getInput();
    const submit = getSubmit();

    fireEvent.change(input, { target: { value: "a".repeat(63) } });
    expect(submit.disabled).toBe(true);
  });
});
