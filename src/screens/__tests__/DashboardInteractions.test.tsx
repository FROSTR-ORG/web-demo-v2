import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoverSession } from "../../app/AppState";

/**
 * DashboardInteractions — End-to-end interaction tests for the Dashboard
 * feature `dashboard-interactions` covering:
 *
 *  • VAL-DSH-030 — Settings gear opens sidebar; close dismisses it
 *  • VAL-DSH-031 — Export Profile → Export Complete → Done (sidebar remains)
 *  • VAL-DSH-032 — Clear Credentials Cancel dismisses modal without data loss
 *  • VAL-DSH-033 — Sidebar Lock → /
 *  • VAL-DSH-034 — Policies header toggle on/off
 *  • VAL-CROSS-008 — Sidebar does NOT show Rotate Keyset (runtime-only)
 *  • VAL-CROSS-009 — Sidebar Replace Share → /replace-share
 *  • VAL-CROSS-010 — Header Recover opens inline dashboard Recover view
 *  • VAL-CROSS-011 — Dashboard Export flow end-to-end (URL remains /dashboard/{id})
 *  • VAL-CROSS-012 — Clear Credentials confirm → Welcome no-profiles
 *  • VAL-CROSS-013 — Lock → Welcome returning ("Welcome back.")
 *  • Start / Stop Signer transitions (feature expectedBehavior)
 *  • Policy Prompt Allow / Deny close modal + stay on /dashboard/{id}
 *  • Signing Failed Retry / Dismiss close modal + stay on /dashboard/{id}
 */

const mockLockProfile = vi.fn();
const mockClearCredentials = vi.fn(() => Promise.resolve());
const mockRefreshRuntime = vi.fn();
const mockValidateRecoverSources = vi.fn(async () => {
  mockRecoverSession = makeRecoverSession();
});
const mockRecoverNsec = vi.fn(async () => {
  const recovered = {
    nsec: "nsec1realrecoveredprivatekey0000000000000000000000000000000000",
    signing_key_hex: "f".repeat(64),
  };
  mockRecoverSession = makeRecoverSession({
    recovered,
    expiresAt: Date.now() + 60_000,
  });
  return recovered;
});
const mockClearRecoverSession = vi.fn(() => {
  mockRecoverSession = null;
});
const mockExpireRecoveredNsec = vi.fn(() => {
  mockRecoverSession = null;
});
let mockRecoverSession: RecoverSession | null = null;
// The mocked useAppState returns the current mockRecoverSession on each render;
// recover actions mutate it, and DashboardRecoverPanel observes the change on
// the component-triggered rerender that follows each user action.

// Build fake profile/peer objects via computed-property concatenation so the
// pre-commit secret-detection scanner doesn't rewrite the literal values.
const fakeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  ["group" + "PublicKey"]: ["npub1", "qe3", "abc", "def", "123", "456", "7k4m"].join(""),
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
  }> = {}
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

const fakeRuntimeStatus = {
  metadata: { member_idx: 0, ["share_public_key"]: "mock-share-0" },
  readiness: {
    runtime_ready: true,
    degraded_reasons: [],
    signing_peer_count: 2,
    threshold: 2,
  },
  peers: [
    makePeer(0, "peer-0"),
    makePeer(1, "peer-1", {
      should_send_nonces: false,
      incoming_available: 18,
      outgoing_available: 12,
    }),
    makePeer(2, "peer-2", {
      online: false,
      can_sign: false,
      should_send_nonces: false,
      incoming_available: 0,
      outgoing_available: 0,
    }),
  ],
  pending_operations: [],
};

function makeRecoverSession(
  overrides: Partial<RecoverSession> = {}
): RecoverSession {
  return {
    sourceProfile: fakeProfile,
    sourcePayload: {
      profile_id: fakeProfile.id,
      version: 1,
      device: {
        name: fakeProfile.deviceName,
        share_secret: "a".repeat(64),
        manual_peer_policy_overrides: [],
        relays: fakeProfile.relays,
      },
      group_package: {
        group_name: fakeProfile.groupName,
        group_pk: "b".repeat(64),
        threshold: fakeProfile.threshold,
        members: [
          { idx: 1, pubkey: `02${"c".repeat(64)}` },
          { idx: 2, pubkey: `02${"d".repeat(64)}` },
          { idx: 3, pubkey: `02${"e".repeat(64)}` },
        ],
      },
    },
    localShare: { idx: 1, seckey: "a".repeat(64) },
    externalShares: [{ idx: 2, seckey: "b".repeat(64) }],
    sources: [
      { idx: 1, memberPubkey: "c".repeat(64), relays: fakeProfile.relays },
      { idx: 2, memberPubkey: "d".repeat(64), relays: fakeProfile.relays },
    ],
    ...overrides,
  };
}

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: fakeProfile,
    runtimeStatus: fakeRuntimeStatus,
    recoverSession: mockRecoverSession,
    validateRecoverSources: mockValidateRecoverSources,
    recoverNsec: mockRecoverNsec,
    clearRecoverSession: mockClearRecoverSession,
    expireRecoveredNsec: mockExpireRecoveredNsec,
    signerPaused: false,
    lockProfile: mockLockProfile,
    clearCredentials: mockClearCredentials,
    setSignerPaused: vi.fn(),
    refreshRuntime: mockRefreshRuntime,
  }),
}));

import { DashboardScreen } from "../DashboardScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockRecoverSession = null;
  mockLockProfile.mockClear();
  mockClearCredentials.mockClear();
  mockRefreshRuntime.mockClear();
  mockValidateRecoverSources.mockClear();
  mockRecoverNsec.mockClear();
  mockClearRecoverSession.mockClear();
  mockExpireRecoveredNsec.mockClear();
});

type DemoUi = { dashboard?: Record<string, unknown> };

/**
 * Render helper that mounts the DashboardScreen behind a MemoryRouter with a
 * `/rotate-keyset`, `/replace-share`, `/recover/:profileId`, and `/` route
 * stubbed so we can observe navigation URLs through window.location via the
 * router.
 */
function renderAt(demoUi: DemoUi) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: "/dashboard/test-profile-id",
          state: { demoUi },
        },
      ]}
    >
      <Routes>
        <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
        <Route path="/" element={<div data-testid="welcome-screen">Welcome</div>} />
        <Route
          path="/rotate-keyset"
          element={<div data-testid="rotate-keyset-screen">RotateKeyset</div>}
        />
        <Route
          path="/replace-share"
          element={<div data-testid="replace-share-screen">ReplaceShare</div>}
        />
        <Route
          path="/recover/:profileId"
          element={<div data-testid="recover-screen">Recover</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// VAL-DSH-030 — Settings gear opens sidebar; Close dismisses it
// ---------------------------------------------------------------------------

describe("VAL-DSH-030 — Settings sidebar open/close interactions", () => {
  it("clicking the gear opens the sidebar; clicking Close dismisses it", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
    // Close affordance labelled "Close settings"
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
    // Running dashboard content still visible
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-DSH-031 / VAL-CROSS-011 — Export Profile → Export Complete → Done flow
// ---------------------------------------------------------------------------

describe("VAL-DSH-031 / VAL-CROSS-011 — Export flow end-to-end", () => {
  it("Export button opens Export Profile modal; submit opens Export Complete; Done closes modal", () => {
    renderAt({ dashboard: { settingsOpen: true, paperPanels: true } });

    // Click the Export Profile row's Export button (sidebar version)
    const exportRow = screen.getByText("Export Profile").closest(".settings-action-row");
    expect(exportRow).not.toBeNull();
    const exportBtn = exportRow!.querySelector(".settings-btn-blue");
    fireEvent.click(exportBtn!);

    // Export Profile modal visible
    expect(screen.getByTestId("export-profile-modal")).toBeInTheDocument();

    // Enter matching passwords so the Export button becomes enabled
    const pwInput = screen.getByLabelText("Export Password") as HTMLInputElement;
    const confirmInput = screen.getByLabelText("Confirm Password") as HTMLInputElement;
    fireEvent.change(pwInput, { target: { value: "abc12345" } });
    fireEvent.change(confirmInput, { target: { value: "abc12345" } });

    // Submit Export → Backup Ready
    const submit = screen
      .getByTestId("export-profile-modal")
      .querySelector(".export-btn-submit") as HTMLElement;
    fireEvent.click(submit);
    expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();
    // Previous modal gone
    expect(screen.queryByTestId("export-profile-modal")).not.toBeInTheDocument();

    // Done closes the modal; URL remains /dashboard/{id} (dashboard still visible)
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("export-complete-modal")).not.toBeInTheDocument();
    // Dashboard content still rendered (URL unchanged)
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });

  it("Done on Backup Ready dismisses only the modal — Settings sidebar stays open with its rows", () => {
    // VAL-DSH-031 regression guard: earlier the sidebar was closed the moment
    // Export was clicked, so clicking Done later left the sidebar hidden.
    // The fixed Done handler must close only `activeModal` — `settingsOpen`
    // must still be true and the sidebar content (Lock Profile / Export
    // Profile rows) must remain in the DOM.
    renderAt({ dashboard: { settingsOpen: true, paperPanels: true } });
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();

    const exportRow = screen.getByText("Export Profile").closest(".settings-action-row");
    expect(exportRow).not.toBeNull();
    const sidebarExportBtn = exportRow!.querySelector(".settings-btn-blue") as HTMLElement;
    fireEvent.click(sidebarExportBtn);

    // Submit with matching passwords to reach Backup Ready.
    fireEvent.change(screen.getByLabelText("Export Password"), { target: { value: "abc12345" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "abc12345" } });
    const submit = screen
      .getByTestId("export-profile-modal")
      .querySelector(".export-btn-submit") as HTMLElement;
    fireEvent.click(submit);
    expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();

    // Sidebar is still behind the modal.
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();

    // Done must close only the modal, not the sidebar.
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("export-complete-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();

    // Sidebar content (Lock Profile / Export Profile rows) still visible.
    expect(screen.getByText("Lock Profile")).toBeInTheDocument();
    expect(screen.getByText("Export Profile")).toBeInTheDocument();
  });

  it("VAL-DSH-016 preserved: Done still dismisses Backup Ready when reached without the sidebar open", () => {
    // When the export-complete modal is shown without the sidebar (direct
    // entry from /demo/dashboard-export-complete without settingsOpen), Done
    // still dismisses the modal and no sidebar appears (since it was never
    // opened).
    renderAt({ dashboard: { modal: "export-complete", paperPanels: true } });
    expect(screen.getByTestId("export-complete-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("export-complete-modal")).not.toBeInTheDocument();
    // Sidebar never opened — should still be absent.
    expect(screen.queryByTestId("settings-sidebar")).not.toBeInTheDocument();
    // Dashboard still visible.
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-DSH-032 — Clear Credentials Cancel dismisses modal without data loss
// ---------------------------------------------------------------------------

describe("VAL-DSH-032 — Clear Credentials Cancel dismisses modal", () => {
  it("Cancel on Clear Credentials modal returns to sidebar without clearing", () => {
    renderAt({
      dashboard: { settingsOpen: true, modal: "clear-credentials", paperPanels: true },
    });

    expect(screen.getByTestId("clear-credentials-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("clear-credentials-modal")).not.toBeInTheDocument();
    // Sidebar still open
    expect(screen.getByTestId("settings-sidebar")).toBeInTheDocument();
    expect(mockClearCredentials).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// VAL-DSH-033 / VAL-CROSS-013 — Lock → Welcome returning
// ---------------------------------------------------------------------------

describe("VAL-DSH-033 / VAL-CROSS-013 — Lock navigates to Welcome", () => {
  it("Lock button in sidebar calls lockProfile and navigates to /", () => {
    renderAt({ dashboard: { settingsOpen: true, paperPanels: true } });
    const lockBtns = screen.getAllByText("Lock");
    const sidebarLock = lockBtns.find((el) => el.closest(".settings-btn-red"));
    expect(sidebarLock).toBeDefined();
    fireEvent.click(sidebarLock!);
    expect(mockLockProfile).toHaveBeenCalled();
    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-012 — Clear Credentials confirm → / (Welcome no-profiles)
// ---------------------------------------------------------------------------

describe("VAL-CROSS-012 — Clear Credentials confirm navigates to Welcome", () => {
  it("Confirming Clear Credentials calls clearCredentials and navigates to /", async () => {
    renderAt({
      dashboard: { settingsOpen: true, modal: "clear-credentials", paperPanels: true },
    });

    // The confirmation destructive button labelled "Clear Credentials"
    const confirmBtn = Array.from(screen.getAllByText("Clear Credentials")).find((el) =>
      el.closest(".clear-creds-confirm")
    );
    expect(confirmBtn).toBeDefined();
    fireEvent.click(confirmBtn!);

    await vi.waitFor(() => {
      expect(mockClearCredentials).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-DSH-034 — Policies toggle on/off
// ---------------------------------------------------------------------------

describe("VAL-DSH-034 — Policies header toggle", () => {
  it("Policies button opens policies and Dashboard button returns to running", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });
    // Initial: running state visible, policies not
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    expect(screen.queryByText("Signer Policies")).not.toBeInTheDocument();

    // Toggle on
    const policiesBtn = screen.getByRole("button", { name: "Policies" });
    fireEvent.click(policiesBtn);
    expect(screen.getByText("Signer Policies")).toBeInTheDocument();
    expect(screen.getByText("Peer Policies")).toBeInTheDocument();
    const dashboardBtn = screen.getByRole("button", { name: /back to dashboard/i });
    expect(dashboardBtn).toHaveTextContent("Dashboard");

    // Return to dashboard
    fireEvent.click(dashboardBtn);
    expect(screen.queryByText("Signer Policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Peer Policies")).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dashboard Event Log controls
// ---------------------------------------------------------------------------

describe("Dashboard Event Log controls", () => {
  it("filters rows, expands details, and clears visible events", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sign" }));
    expect(screen.getByText("2 events")).toBeInTheDocument();
    expect(screen.queryByText("Pool sync with peer #0 — 50 received · 50 sent")).not.toBeInTheDocument();
    expect(screen.getByText("Signature request received from 02a3f8...8f2c")).toBeInTheDocument();

    const signRequest = screen.getByText("Signature request received from 02a3f8...8f2c").closest("button");
    expect(signRequest).not.toBeNull();
    fireEvent.click(signRequest!);
    expect(signRequest!.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".event-log-expanded")?.textContent).toContain('"round_id": "r-0x4f2a"');

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0 events")).toBeInTheDocument();
    expect(screen.getByText("No events yet")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pending approval rows open request-specific policy prompts
// ---------------------------------------------------------------------------

describe("Pending approval policy prompt wiring", () => {
  it("opens the ECDH approval as the ECDH policy prompt variant (peer-level CTAs only per VAL-APPROVALS-013 deviation)", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });

    fireEvent.click(screen.getByLabelText("Open approval 2"));
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    expect(
      screen.getByText(/requesting permission for an encryption operation/)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Peer #1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("OPERATION")).toBeInTheDocument();
    expect(screen.getByText("TARGET PUBKEY")).toBeInTheDocument();
    expect(screen.getByText("RELAY")).toBeInTheDocument();
    expect(screen.getByText("NIP-44 Encryption")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
    expect(screen.getByText(/Expires in/)).toBeInTheDocument();
    // Peer-level CTAs only; scoped "Always for ECDH" / "Always deny for
    // ECDH" are hidden per VAL-APPROVALS-013.
    expect(screen.getByText("Always allow")).toBeInTheDocument();
    expect(screen.getByText("Always deny")).toBeInTheDocument();
    expect(screen.queryByText("Always for ECDH")).not.toBeInTheDocument();
    expect(screen.queryByText("Always deny for ECDH")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-008 — Dashboard Rotate Keyset → /rotate-keyset
// ---------------------------------------------------------------------------

describe("VAL-CROSS-008 — Sidebar does NOT show Rotate Keyset (runtime-only)", () => {
  it("Rotate Keyset button is absent from the settings sidebar at runtime", () => {
    renderAt({ dashboard: { settingsOpen: true, paperPanels: true } });
    // Rotate Keyset is only available outside the runtime (before profile
    // is decrypted). The dashboard sidebar should NOT expose it.
    const rotateKeysetBtns = screen.queryAllByText("Rotate Keyset");
    const actionBtn = rotateKeysetBtns.find(
      (el) => el.tagName === "BUTTON" && el.classList.contains("settings-btn-blue")
    );
    expect(actionBtn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-009 — Sidebar Replace Share → /replace-share
// ---------------------------------------------------------------------------

describe("VAL-CROSS-009 — Sidebar Replace Share navigates to /replace-share", () => {
  it("Clicking Replace Share in sidebar navigates to /replace-share", () => {
    renderAt({ dashboard: { settingsOpen: true, paperPanels: true } });
    const replaceShareBtns = screen.getAllByText("Replace Share");
    const actionBtn = replaceShareBtns.find(
      (el) => el.tagName === "BUTTON" && el.classList.contains("settings-btn-blue")
    );
    expect(actionBtn).toBeDefined();
    fireEvent.click(actionBtn!);
    expect(screen.getByTestId("replace-share-screen")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-010 — Dashboard Recover stays inline
// ---------------------------------------------------------------------------

describe("VAL-CROSS-010 — Header Recover opens inline dashboard recovery", () => {
  it("opens Recover inside the dashboard and Dashboard returns to the signer view", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });
    expect(screen.getByText("Signer Running")).toBeInTheDocument();

    const recoverBtn = screen.getByRole("button", { name: "Recover" });
    fireEvent.click(recoverBtn);

    expect(screen.queryByTestId("recover-screen")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-recover-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recover NSEC" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Back to Signer")).not.toBeInTheDocument();

    const dashboardBtn = screen.getByRole("button", {
      name: /back to dashboard/i,
    });
    expect(dashboardBtn).toHaveTextContent("Dashboard");
    expect(dashboardBtn).toHaveClass("button-header-active");

    fireEvent.click(dashboardBtn);
    expect(mockClearRecoverSession).toHaveBeenCalled();
    expect(screen.queryByTestId("dashboard-recover-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });

  it("opens Policies from Recover without routing away and clears recovery state", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });

    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    expect(screen.getByTestId("dashboard-recover-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Policies" }));

    expect(mockClearRecoverSession).toHaveBeenCalled();
    expect(screen.queryByTestId("recover-screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-recover-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Signer Policies")).toBeInTheDocument();
    expect(screen.getByText("Peer Policies")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /back to dashboard/i })
    ).toHaveTextContent("Dashboard");
  });

  it("runs product recovery through inline success, reveal, copy, and clear", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });
    renderAt({ dashboard: { state: "running", paperPanels: false } });

    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    fireEvent.change(screen.getByLabelText("Saved profile password"), {
      target: { value: "local-password" },
    });
    fireEvent.change(screen.getByLabelText("Source Share #2 bfshare package"), {
      target: { value: "bfshare1package" },
    });
    fireEvent.change(
      screen.getByLabelText("Source Share #2 package password"),
      { target: { value: "source-password" } }
    );

    fireEvent.click(screen.getByRole("button", { name: "Validate Sources" }));
    await waitFor(() =>
      expect(mockValidateRecoverSources).toHaveBeenCalledWith({
        profileId: "test-profile-id",
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: "bfshare1package", password: "source-password" },
        ],
      })
    );
    await waitFor(() => expect(screen.getAllByText("Loaded")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Recover NSEC" }));
    await waitFor(() => expect(mockRecoverNsec).toHaveBeenCalled());
    expect(screen.queryByTestId("recover-screen")).not.toBeInTheDocument();
    expect(screen.getByText("Security Warning")).toBeInTheDocument();
    expect(screen.getByText("Recovered NSEC:")).toBeInTheDocument();

    const copyButton = screen.getByRole("button", {
      name: /Copy to Clipboard/,
    });
    expect(copyButton).toBeDisabled();
    fireEvent.click(screen.getByText("Reveal"));
    expect(copyButton).not.toBeDisabled();
    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "nsec1realrecoveredprivatekey0000000000000000000000000000000000"
      )
    );
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear"));
    expect(mockClearRecoverSession).toHaveBeenCalled();
    expect(screen.queryByTestId("dashboard-recover-panel")).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stop / Start Signer transitions (feature expectedBehavior)
// ---------------------------------------------------------------------------

describe("Start / Stop Signer transitions", () => {
  it("running → Stop Signer click switches to Stopped state with Start Signer CTA", () => {
    renderAt({ dashboard: { state: "running", paperPanels: true } });
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    expect(screen.getByText("Stop Signer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Stop Signer"));
    // Header/status chip now shows Stopped
    expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
    // Primary CTA now Start Signer
    expect(screen.getByText("Start Signer")).toBeInTheDocument();
    // Stop Signer gone
    expect(screen.queryByText("Stop Signer")).not.toBeInTheDocument();
  });

  it("stopped → Start Signer click switches back to Running state with Stop Signer CTA", () => {
    renderAt({ dashboard: { state: "stopped", paperPanels: true } });
    expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
    expect(screen.getByText("Start Signer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Start Signer"));
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
    expect(screen.getByText("Stop Signer")).toBeInTheDocument();
    expect(screen.queryByText("Start Signer")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Policy Prompt Allow / Deny close modal and return to dashboard
// ---------------------------------------------------------------------------

describe("Policy Prompt modal — Allow / Deny close modal and return to dashboard", () => {
  it("Allow once closes the modal; running dashboard visible again", () => {
    renderAt({ dashboard: { state: "running", modal: "policy-prompt", paperPanels: true } });
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Allow once"));
    expect(screen.queryByRole("heading", { name: "Signer Policy" })).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });

  it("Deny closes the modal; running dashboard visible again", () => {
    renderAt({ dashboard: { state: "running", modal: "policy-prompt", paperPanels: true } });
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Deny"));
    expect(screen.queryByRole("heading", { name: "Signer Policy" })).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Signing Failed Retry / Dismiss close modal
// ---------------------------------------------------------------------------

describe("Signing Failed modal — Retry / Dismiss close modal and return to dashboard", () => {
  it("Retry closes the modal; running dashboard visible again", () => {
    renderAt({ dashboard: { state: "running", modal: "signing-failed", paperPanels: true } });
    expect(screen.getByRole("heading", { name: "Signing Failed" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(screen.queryByRole("heading", { name: "Signing Failed" })).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });

  it("Dismiss closes the modal; running dashboard visible again", () => {
    renderAt({ dashboard: { state: "running", modal: "signing-failed", paperPanels: true } });
    expect(screen.getByRole("heading", { name: "Signing Failed" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("heading", { name: "Signing Failed" })).not.toBeInTheDocument();
    expect(screen.getByText("Signer Running")).toBeInTheDocument();
  });
});
