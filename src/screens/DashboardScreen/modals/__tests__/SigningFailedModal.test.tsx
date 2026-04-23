import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAppStateProvider } from "../../../../app/AppState";
import type { AppStateValue } from "../../../../app/AppState";
import type { OperationFailure } from "../../../../lib/bifrost/types";
import {
  createDemoAppState,
  demoProfile,
  demoRuntimeStatus,
} from "../../../../demo/fixtures";
import { DashboardScreen } from "../../index";
import { SigningFailedModal } from "../SigningFailedModal";

/**
 * Tests for feature `m1-signing-failed-modal`.
 *
 * Fulfils:
 *  - VAL-OPS-006 — SigningFailedModal renders real failure payload (not
 *    the hard-coded Paper copy) when surfaced from `runtimeFailures`.
 *  - VAL-OPS-007 — Retry re-dispatches `handleCommand({type:"sign", ...})`
 *    with the SAME `message_hex_32` and closes the modal.
 *  - VAL-OPS-008 — Dismiss closes the modal without dispatching a command
 *    and the same failure payload does NOT re-open the modal.
 *  - VAL-OPS-015 — Non-sign failures (ecdh / ping / onboard) do not open
 *    the modal.
 *  - VAL-OPS-016 — On a relay-disconnect/timeout failure, any
 *    `console.error` emitted matches /relay|websocket|disconnect|timeout/i.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* =========================================================================
 * Unit tests — SigningFailedModal in isolation
 * ========================================================================= */
describe("SigningFailedModal — unit", () => {
  it("renders a neutral fallback when no failure prop is supplied — no synthesized peer-response copy", () => {
    render(<SigningFailedModal onClose={() => undefined} />);
    expect(
      screen.getByRole("heading", { name: "Signing Failed" }),
    ).toBeInTheDocument();
    const codeText = screen.getByTestId("signing-failed-code-text");
    // Neutral fallback must NOT fabricate a peer-response ratio or reuse
    // any of the old Paper placeholders.
    expect(codeText.textContent).not.toContain("no peers responded");
    expect(codeText.textContent).not.toContain("Peers responded");
    expect(codeText.textContent).not.toContain("1/2");
    expect(codeText.textContent).not.toContain("r-0x4f2a");
    expect(codeText.textContent).not.toContain(
      "insufficient partial signatures",
    );
    // Description must not reference the hard-coded "3 retry attempts"
    // string from the old Paper fallback either.
    expect(
      screen.queryByText(
        "Unable to complete signature for event kind:1. All 3 retry attempts exhausted.",
      ),
    ).not.toBeInTheDocument();
    // Description and summary both signal the neutral data-gap copy.
    expect(
      screen.getByText(/failure details are unavailable/i),
    ).toBeInTheDocument();
    expect(codeText.textContent).toMatch(/failure details unavailable/i);
  });

  it("renders the real failure payload fields verbatim — request_id, code, message — without any synthesized peer-response ratio", () => {
    const failure: OperationFailure = {
      request_id: "d4f2a7be-91c3-4f5b",
      op_type: "sign",
      code: "timeout",
      message: "relay disconnect: websocket closed before threshold signatures arrived",
      failed_peer: null,
    };
    render(
      <SigningFailedModal
        failure={failure}
        messageHex={"a".repeat(64)}
        onClose={() => undefined}
      />,
    );
    const codeText = screen.getByTestId("signing-failed-code-text");
    // Round = first 8 chars of the runtime's real request_id.
    expect(codeText.textContent).toContain("Round: r-d4f2a7be");
    // Runtime-provided code surfaced verbatim.
    expect(codeText.textContent).toContain("Code: timeout");
    // Runtime-provided message surfaced verbatim.
    expect(codeText.textContent).toContain(
      "Error: relay disconnect: websocket closed before threshold signatures arrived",
    );
    // Payload has no failed_peer, so the row must be omitted entirely —
    // no fabricated "no peers responded" or "0/N" ratio of any kind.
    expect(codeText.textContent).not.toContain("Peers responded");
    expect(codeText.textContent).not.toContain("no peers responded");
    expect(codeText.textContent).not.toContain("Failed peer");
    // And none of the hard-coded Paper placeholders.
    expect(codeText.textContent).not.toContain("r-0x4f2a");
    expect(codeText.textContent).not.toContain("1/2");
    expect(codeText.textContent).not.toContain(
      "insufficient partial signatures",
    );
    // The error substring still carries enough runtime context to satisfy
    // VAL-OPS-016's relay-disconnect regex.
    expect(codeText.textContent).toMatch(
      /relay|websocket|disconnect|timeout/i,
    );
  });

  it("renders the real failed_peer short identifier when present — no synthesized ratio", () => {
    const failure: OperationFailure = {
      request_id: "abcdef12-9999-0000",
      op_type: "sign",
      code: "peer_rejected",
      message: "peer rejected the sign request",
      failed_peer: "b".repeat(64),
    };
    render(
      <SigningFailedModal
        failure={failure}
        messageHex={"a".repeat(64)}
        onClose={() => undefined}
      />,
    );
    const codeText = screen.getByTestId("signing-failed-code-text");
    expect(codeText.textContent).toContain("Round: r-abcdef12");
    expect(codeText.textContent).toContain("Code: peer_rejected");
    expect(codeText.textContent).toContain(
      "Error: peer rejected the sign request",
    );
    // Short hex of failed_peer surfaced verbatim, no invented ratio.
    expect(codeText.textContent).toContain("Failed peer:");
    expect(codeText.textContent).toContain("bbbbbb...bbbb");
    expect(codeText.textContent).not.toContain("no peers responded");
    expect(codeText.textContent).not.toContain("Peers responded");
    expect(codeText.textContent).not.toContain("1/2");
  });

  it("Retry button invokes onRetry when supplied and does NOT call onDismiss", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const failure: OperationFailure = {
      request_id: "req-1",
      op_type: "sign",
      code: "peer_rejected",
      message: "peer rejected the sign request",
      failed_peer: "c".repeat(64),
    };
    render(
      <SigningFailedModal
        failure={failure}
        messageHex={"a".repeat(64)}
        onClose={onDismiss}
        onDismiss={onDismiss}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Dismiss button invokes onDismiss and does NOT call onRetry", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const failure: OperationFailure = {
      request_id: "req-2",
      op_type: "sign",
      code: "timeout",
      message: "timeout waiting for peers",
      failed_peer: null,
    };
    render(
      <SigningFailedModal
        failure={failure}
        messageHex={"a".repeat(64)}
        onClose={onDismiss}
        onDismiss={onDismiss}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("Retry button is disabled when the originating messageHex is unavailable", () => {
    const onRetry = vi.fn();
    const failure: OperationFailure = {
      request_id: "req-no-msg",
      op_type: "sign",
      code: "timeout",
      message: "timeout",
      failed_peer: null,
    };
    render(
      <SigningFailedModal
        failure={failure}
        onClose={() => undefined}
        onRetry={onRetry}
      />,
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

/* =========================================================================
 * Integration tests — Dashboard + MockAppStateProvider
 * ========================================================================= */

function renderDashboard(initialValue: AppStateValue) {
  return render(
    <MockAppStateProvider value={initialValue} bridge={false}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/dashboard/${initialValue.activeProfile?.id ?? "demo-profile"}`,
            state: { demoUi: { dashboard: { paperPanels: false } } },
          },
        ]}
      >
        <Routes>
          <Route
            path="/dashboard/:profileId"
            element={<DashboardScreen />}
          />
          <Route path="/" element={<div data-testid="welcome-screen" />} />
        </Routes>
      </MemoryRouter>
    </MockAppStateProvider>,
  );
}

function buildSeed(options: {
  runtimeFailures?: OperationFailure[];
  signDispatchLog?: Record<string, string>;
  handleRuntimeCommand?: AppStateValue["handleRuntimeCommand"];
}): AppStateValue {
  const seed = createDemoAppState({
    profiles: [demoProfile],
    activeProfile: demoProfile,
    runtimeStatus: demoRuntimeStatus,
    runtimeFailures: options.runtimeFailures ?? [],
    signDispatchLog: options.signDispatchLog ?? {},
    ...(options.handleRuntimeCommand
      ? { handleRuntimeCommand: options.handleRuntimeCommand }
      : {}),
  });
  return seed;
}

describe("DashboardScreen — SigningFailedModal reactive integration", () => {
  beforeEach(() => {
    // Swallow console.error calls the dashboard emits for observed failures
    // so the test runner doesn't flag them as noise, but we still want to
    // assert the messages match VAL-OPS-016.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("VAL-OPS-006 — opens the modal with real failure data when a new sign failure appears in runtimeFailures", async () => {
    const failure: OperationFailure = {
      request_id: "abc123de-4567-89ab",
      op_type: "sign",
      code: "timeout",
      message: "relay disconnect: websocket closed before threshold",
      failed_peer: null,
    };
    const seed = buildSeed({
      runtimeFailures: [failure],
      signDispatchLog: { [failure.request_id]: "a".repeat(64) },
    });
    renderDashboard(seed);

    // Modal appears with real data (no static Paper copy).
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Signing Failed" }),
      ).toBeInTheDocument();
    });
    const codeText = screen.getByTestId("signing-failed-code-text");
    expect(codeText.textContent).toContain("Round: r-abc123de");
    expect(codeText.textContent).not.toContain("r-0x4f2a");
    expect(codeText.textContent).not.toContain("insufficient partial signatures");
  });

  it("VAL-OPS-007 — Retry re-dispatches handleRuntimeCommand with the same message_hex_32 and closes the modal", async () => {
    const messageHex = "d".repeat(64);
    const failure: OperationFailure = {
      request_id: "retry-req-1",
      op_type: "sign",
      code: "timeout",
      message: "timeout",
      failed_peer: null,
    };
    const handleRuntimeCommand = vi.fn(async () => ({
      requestId: "retry-req-2",
      debounced: false,
    }));
    const seed = buildSeed({
      runtimeFailures: [failure],
      signDispatchLog: { [failure.request_id]: messageHex },
      handleRuntimeCommand:
        handleRuntimeCommand as unknown as AppStateValue["handleRuntimeCommand"],
    });
    renderDashboard(seed);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Signing Failed" }),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Signing Failed" }),
      ).not.toBeInTheDocument(),
    );
    // The retry dispatch hits handleRuntimeCommand with SAME message hex
    expect(handleRuntimeCommand).toHaveBeenCalledTimes(1);
    expect(handleRuntimeCommand).toHaveBeenCalledWith({
      type: "sign",
      message_hex_32: messageHex,
    });
  });

  it("VAL-OPS-008 — Dismiss closes without dispatching and the same failure does not re-open the modal", async () => {
    const failure: OperationFailure = {
      request_id: "dismiss-req-1",
      op_type: "sign",
      code: "peer_rejected",
      message: "peer rejected",
      failed_peer: null,
    };
    const handleRuntimeCommand = vi.fn(async () => ({
      requestId: null,
      debounced: false,
    }));
    const seed = buildSeed({
      runtimeFailures: [failure],
      signDispatchLog: { [failure.request_id]: "a".repeat(64) },
      handleRuntimeCommand:
        handleRuntimeCommand as unknown as AppStateValue["handleRuntimeCommand"],
    });
    renderDashboard(seed);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Signing Failed" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Signing Failed" }),
      ).not.toBeInTheDocument(),
    );
    // No runtime dispatch on Dismiss.
    expect(handleRuntimeCommand).not.toHaveBeenCalled();

    // Wait a tick to ensure the effect doesn't re-open the modal from the
    // same (still-present) failure record.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      screen.queryByRole("heading", { name: "Signing Failed" }),
    ).not.toBeInTheDocument();
  });

  it("VAL-OPS-015 — ECDH / ping / onboard failures do NOT open the SigningFailedModal", async () => {
    const seed = buildSeed({
      runtimeFailures: [
        {
          request_id: "ecdh-1",
          op_type: "ecdh",
          code: "timeout",
          message: "ecdh timeout",
          failed_peer: null,
        },
        {
          request_id: "ping-1",
          op_type: "ping",
          code: "timeout",
          message: "ping timeout",
          failed_peer: null,
        },
        {
          request_id: "onboard-1",
          op_type: "onboard",
          code: "peer_rejected",
          message: "onboard rejected",
          failed_peer: null,
        },
      ],
    });
    renderDashboard(seed);

    // Let effects settle.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      screen.queryByRole("heading", { name: "Signing Failed" }),
    ).not.toBeInTheDocument();
  });

  it("VAL-OPS-016 — console.error emitted during a relay-disconnect/timeout sign failure matches /relay|websocket|disconnect|timeout/i", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const failure: OperationFailure = {
      request_id: "relay-disc-1",
      op_type: "sign",
      code: "timeout",
      message: "all relays disconnected before aggregation",
      failed_peer: null,
    };
    const seed = buildSeed({
      runtimeFailures: [failure],
      signDispatchLog: { [failure.request_id]: "a".repeat(64) },
    });
    renderDashboard(seed);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Signing Failed" }),
      ).toBeInTheDocument(),
    );
    // At least one console.error call must match the regex. Build a single
    // string out of all logged call args for a robust match.
    const loggedText = errorSpy.mock.calls
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(loggedText).toMatch(/relay|websocket|disconnect|timeout/i);
    // Every console.error captured during the window (per VAL-OPS-016) must
    // also match — nothing off-topic may leak into stderr.
    for (const args of errorSpy.mock.calls) {
      const line = args.map((a) => String(a)).join(" ");
      expect(line).toMatch(/relay|websocket|disconnect|timeout/i);
    }
  });
});
