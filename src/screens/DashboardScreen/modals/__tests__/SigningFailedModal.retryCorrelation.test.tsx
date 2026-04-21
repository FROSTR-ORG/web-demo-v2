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
 * Tests for feature
 * `fix-m1-signing-failed-modal-peer-response-and-retry-correlation`.
 *
 * Fulfils VAL-OPS-007 (strict):
 *  - Retry enablement MUST NOT require an entry in `signDispatchLog`. When
 *    the enriched `OperationFailure` carries a `message_hex_32` from the
 *    AppStateProvider's `pendingDispatchIndex`, Retry is enabled and
 *    dispatches a fresh sign with that message.
 *  - Retry is disabled only when no message is resolvable anywhere.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SigningFailedModal — retry correlation via enriched failure (VAL-OPS-007 strict)", () => {
  it("unit: Retry is ENABLED when the `messageHex` prop resolves, even when the parent never wrote to signDispatchLog", () => {
    // Simulates the case where the failure was enriched via pendingDispatchIndex
    // (so the parent derives `messageHex` from the enriched OperationFailure,
    // not signDispatchLog) and supplies it to the modal directly.
    const failure: OperationFailure = {
      request_id: "req-enriched-1",
      op_type: "sign",
      code: "timeout",
      message: "timeout",
      failed_peer: null,
    };
    const onRetry = vi.fn();
    render(
      <SigningFailedModal
        failure={failure}
        messageHex={"a".repeat(64)}
        onClose={() => undefined}
        onRetry={onRetry}
      />,
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).not.toBeDisabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("unit: Retry is DISABLED with a clear reason when the failure genuinely has no resolvable message", () => {
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
        onRetry={() => undefined}
      />,
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeDisabled();
    // The modal must surface a clear user-visible reason for the disabled
    // state — not just silently deactivate the button.
    expect(retry).toHaveAttribute("title");
    const title = retry.getAttribute("title") ?? "";
    expect(title.length).toBeGreaterThan(0);
    expect(title.toLowerCase()).toMatch(/message|correlate|retry|unavailable/);
  });
});

/* =========================================================================
 * Integration — DashboardScreen + MockAppStateProvider. Validates that
 * Retry resolves the message via the enriched failure (message_hex_32
 * attached by AppStateProvider.pendingDispatchIndex) and calls
 * handleRuntimeCommand, WITHOUT requiring any signDispatchLog entry.
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

describe("DashboardScreen — SigningFailedModal retry via enriched failure", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("VAL-OPS-007 — Retry enables and dispatches a fresh sign when the runtimeFailures entry carries an enriched message_hex_32 (no prior signDispatchLog entry required)", async () => {
    const messageHex = "b".repeat(64);
    // Failure shape that would be produced by AppStateProvider.absorbDrains
    // after enriching via pendingDispatchIndex — `message_hex_32` is
    // attached directly on the failure record.
    const enrichedFailure = {
      request_id: "enriched-req-1",
      op_type: "sign" as const,
      code: "timeout" as const,
      message: "timeout waiting for peers",
      failed_peer: null,
      message_hex_32: messageHex,
    } as OperationFailure & { message_hex_32?: string };
    const handleRuntimeCommand = vi.fn(async () => ({
      requestId: "enriched-req-2",
      debounced: false,
    }));
    const seed = createDemoAppState({
      profiles: [demoProfile],
      activeProfile: demoProfile,
      runtimeStatus: demoRuntimeStatus,
      runtimeFailures: [enrichedFailure],
      // Intentionally NO signDispatchLog entry for this request_id — the
      // enriched failure is the only source of truth for the message.
      signDispatchLog: {},
      handleRuntimeCommand:
        handleRuntimeCommand as unknown as AppStateValue["handleRuntimeCommand"],
    });
    renderDashboard(seed);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Signing Failed" }),
      ).toBeInTheDocument(),
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Signing Failed" }),
      ).not.toBeInTheDocument(),
    );
    expect(handleRuntimeCommand).toHaveBeenCalledTimes(1);
    expect(handleRuntimeCommand).toHaveBeenCalledWith({
      type: "sign",
      message_hex_32: messageHex,
    });
  });

  it("VAL-OPS-007 — Retry falls back to signDispatchLog when the runtime did not enrich the failure", async () => {
    const messageHex = "c".repeat(64);
    const failure: OperationFailure = {
      request_id: "fallback-req-1",
      op_type: "sign",
      code: "timeout",
      message: "timeout",
      failed_peer: null,
    };
    const handleRuntimeCommand = vi.fn(async () => ({
      requestId: "fallback-req-2",
      debounced: false,
    }));
    const seed = createDemoAppState({
      profiles: [demoProfile],
      activeProfile: demoProfile,
      runtimeStatus: demoRuntimeStatus,
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
    expect(handleRuntimeCommand).toHaveBeenCalledWith({
      type: "sign",
      message_hex_32: messageHex,
    });
  });

  it("VAL-OPS-007 — Retry stays disabled only when the failure has no resolvable message via enrichment OR signDispatchLog", async () => {
    const failure: OperationFailure = {
      request_id: "unresolvable-req-1",
      op_type: "sign",
      code: "timeout",
      message: "timeout",
      failed_peer: null,
    };
    const handleRuntimeCommand = vi.fn(async () => ({
      requestId: null,
      debounced: false,
    }));
    const seed = createDemoAppState({
      profiles: [demoProfile],
      activeProfile: demoProfile,
      runtimeStatus: demoRuntimeStatus,
      runtimeFailures: [failure],
      signDispatchLog: {}, // genuinely empty
      handleRuntimeCommand:
        handleRuntimeCommand as unknown as AppStateValue["handleRuntimeCommand"],
    });
    renderDashboard(seed);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Signing Failed" }),
      ).toBeInTheDocument(),
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeDisabled();
    // Surface a clear reason for the disabled state.
    expect(retry).toHaveAttribute("title");
  });
});
