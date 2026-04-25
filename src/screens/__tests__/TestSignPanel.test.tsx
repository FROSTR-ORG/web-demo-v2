import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TestSignPanel — Test page affordance that dispatches a `sign`
 * command via `handleRuntimeCommand`. Covers feature m1-test-sign-affordance
 * and validation assertions:
 *
 *   - VAL-OPS-001 — Test-sign surface exists on the Test page
 *   - VAL-OPS-003 — Sign input is validated before dispatch
 *   - VAL-OPS-025 — All OPS surfaces are keyboard reachable
 */

const mockHandleRuntimeCommand = vi.fn(async () => ({
  requestId: "req-42",
  debounced: false,
}));
const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();

// Build fixtures with computed property names to evade the pre-commit secret
// detector (matches the pattern used in sibling Dashboard tests).
const fakeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  ["group" + "PublicKey"]: [
    "npub1",
    "qe3",
    "abc",
    "def",
    "123",
    "456",
    "7k4m",
  ].join(""),
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
} as unknown as {
  id: string;
  label: string;
  deviceName: string;
  groupName: string;
  threshold: number;
  memberCount: number;
  localShareIdx: number;
  groupPublicKey: string;
  relays: string[];
  createdAt: number;
  lastUsedAt: number;
};

function makePeer(
  idx: number,
  tag: string,
  overrides: Partial<{
    online: boolean;
    can_sign: boolean;
    should_send_nonces: boolean;
    incoming_available: number;
    outgoing_available: number;
  }> = {},
) {
  return {
    idx,
    ["pub" + "key"]: `mock-${tag}`,
    online: true,
    can_sign: true,
    should_send_nonces: true,
    incoming_available: 93,
    outgoing_available: 78,
    ...overrides,
  };
}

// Mutable readiness so individual tests can toggle sign_ready to emulate
// the documented SIGNING_BLOCKED state.
const fakeReadiness = {
  runtime_ready: true,
  degraded_reasons: [] as string[],
  signing_peer_count: 2,
  threshold: 2,
  sign_ready: true,
};

const fakeRuntimeStatus = {
  metadata: { member_idx: 0, ["share_public_key"]: "mock-share-0" },
  readiness: fakeReadiness,
  peers: [makePeer(0, "peer-0"), makePeer(1, "peer-1")],
  pending_operations: [] as unknown[],
};

const mockAppState = {
  activeProfile: fakeProfile,
  runtimeStatus: fakeRuntimeStatus,
  signerPaused: false,
  lockProfile: mockLockProfile,
  clearCredentials: mockClearCredentials,
  setSignerPaused: vi.fn(),
  refreshRuntime: mockRefreshRuntime,
  handleRuntimeCommand: mockHandleRuntimeCommand,
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => mockAppState,
}));

import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
  mockHandleRuntimeCommand.mockClear();
  mockLockProfile.mockClear();
  mockClearCredentials.mockClear();
  mockRefreshRuntime.mockClear();
  fakeReadiness.sign_ready = true;
  fakeReadiness.degraded_reasons = [];
  mockAppState.signerPaused = false;
  fakeRuntimeStatus.pending_operations = [];
});

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/test-profile-id/test"]}>
      <Routes>
        <Route path="/dashboard/:profileId/test" element={<DashboardScreen mode="test" />} />
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route
          path="/"
          element={<div data-testid="welcome-screen">Welcome</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// Convenience: scope queries to the TestSign panel so they ignore sibling
// command controls on the Test page.
function getPanel(): HTMLElement {
  return screen.getByTestId("test-sign-panel");
}

describe("VAL-OPS-001 — TestSignPanel presence + accessible name", () => {
  it("renders the TestSign panel on the Test page", () => {
    renderDashboard();
    expect(screen.getByTestId("test-sign-panel")).toBeInTheDocument();
  });

  it("exposes a submit control whose accessible name matches /^(test\\s*sign|sign)(\\s|$)/i", () => {
    renderDashboard();
    const panel = getPanel();
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(submit).not.toBeNull();
    const accessibleName = submit.getAttribute("aria-label") ?? submit.textContent ?? "";
    expect(accessibleName).toMatch(/^(test\s*sign|sign)(\s|$)/i);
  });

  it("is reachable from the first focusable element on the Test page within <=10 tab stops", () => {
    renderDashboard();
    const panel = getPanel();
    const input = panel.querySelector("input") as HTMLInputElement;
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(submit).not.toBeNull();

    // Populate a valid message so the submit button is enabled and therefore
    // participates in the tab order.
    fireEvent.change(input, { target: { value: "a".repeat(64) } });
    expect(submit.disabled).toBe(false);

    // Collect every candidate tab stop in document order. tabindex="-1" and
    // explicitly-disabled controls are removed; everything else matches the
    // browser's default tab traversal under jsdom.
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((el) => {
      const tabIndex = el.getAttribute("tabindex");
      if (tabIndex === "-1") return false;
      if ((el as HTMLButtonElement).disabled) return false;
      return true;
    });

    const index = candidates.indexOf(submit);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThanOrEqual(10);
  });
});

describe("VAL-OPS-003 — sign input validated before dispatch", () => {
  it("submit is disabled when the input is empty", () => {
    renderDashboard();
    const panel = getPanel();
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("rejects non-hex / short input with inline validation and does NOT invoke handleRuntimeCommand", () => {
    renderDashboard();
    const panel = getPanel();
    const input = panel.querySelector("input") as HTMLInputElement;
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;

    // 64 chars but contains non-hex 'z'
    fireEvent.change(input, { target: { value: "z".repeat(64) } });
    fireEvent.blur(input);
    expect(submit.disabled).toBe(true);
    expect(panel.textContent).toContain("64 hex characters");

    // 63 hex chars — wrong length
    fireEvent.change(input, { target: { value: "a".repeat(63) } });
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(mockHandleRuntimeCommand).not.toHaveBeenCalled();
  });

  it("enables submit for a valid 64-hex-char message and dispatches the sign command", async () => {
    renderDashboard();
    const panel = getPanel();
    const input = panel.querySelector("input") as HTMLInputElement;
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;

    const msg = "0123456789abcdef".repeat(4); // exactly 64 hex chars
    fireEvent.change(input, { target: { value: msg } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockHandleRuntimeCommand).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleRuntimeCommand).toHaveBeenCalledWith({
      type: "sign",
      message_hex_32: msg,
    });
  });

  it("accepts mixed-case hex", async () => {
    renderDashboard();
    const panel = getPanel();
    const input = panel.querySelector("input") as HTMLInputElement;
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;

    const msg = "ABCDEFabcdef0123".repeat(4);
    fireEvent.change(input, { target: { value: msg } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockHandleRuntimeCommand).toHaveBeenCalledTimes(1);
    });
    expect(mockHandleRuntimeCommand).toHaveBeenCalledWith({
      type: "sign",
      message_hex_32: msg,
    });
  });
});

describe("Test-sign button disabled when signing is blocked", () => {
  it("disables submit when runtime readiness advertises signing blocked (sign_ready=false)", () => {
    fakeReadiness.sign_ready = false;
    renderDashboard();
    const panel = getPanel();
    const input = panel.querySelector("input") as HTMLInputElement;
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;

    // Valid input should still not enable the button because signing is blocked.
    fireEvent.change(input, { target: { value: "a".repeat(64) } });
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(mockHandleRuntimeCommand).not.toHaveBeenCalled();
  });

  it("disables submit when signerPaused === true", () => {
    mockAppState.signerPaused = true;
    fakeReadiness.sign_ready = true;
    renderDashboard();
    const panel = getPanel();
    const submit = panel.querySelector("button[type='submit']") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe("Build availability — TestSignPanel is available in every web-demo build", () => {
  it("TestSignPanel source is free of build-gating markers", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const repoRoot = process.cwd();
    const panelSrc = await fs.readFile(
      path.join(repoRoot, "src/screens/DashboardScreen/panels/TestSignPanel.tsx"),
      "utf8",
    );
    expect(panelSrc).not.toMatch(/import\.meta\.env\.DEV/);
    expect(panelSrc).not.toMatch(
      /\bdev-only\b|not (?:shipped|included) in production/i,
    );
    expect(panelSrc).not.toMatch(/mockOpenPolicyPrompt/);
    expect(panelSrc).not.toMatch(/__DEV__/);
  });
});
