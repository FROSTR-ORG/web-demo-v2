import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoverSession } from "../../app/AppState";

const mockNavigate = vi.fn();
const mockApp = vi.hoisted(() => ({
  state: {} as any
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const fakeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 2,
  localShareIdx: 0,
  groupPublicKey: "npub1qe3abcdef1234567890abcdef7k4m",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: Date.now(),
  lastUsedAt: Date.now()
};

function recoveredSession(overrides: Partial<RecoverSession> = {}): RecoverSession {
  return {
    sourceProfile: fakeProfile,
    sourcePayload: {
      profile_id: fakeProfile.id,
      version: 1,
      device: {
        name: "Igloo Web",
        share_secret: "a".repeat(64),
        manual_peer_policy_overrides: [],
        relays: fakeProfile.relays
      },
      group_package: {
        group_name: fakeProfile.groupName,
        group_pk: "b".repeat(64),
        threshold: 2,
        members: [
          { idx: 1, pubkey: `02${"c".repeat(64)}` },
          { idx: 2, pubkey: `02${"d".repeat(64)}` }
        ]
      }
    },
    localShare: { idx: 1, seckey: "a".repeat(64) },
    externalShares: [{ idx: 2, seckey: "b".repeat(64) }],
    sources: [
      { idx: 1, memberPubkey: "c".repeat(64), relays: fakeProfile.relays },
      { idx: 2, memberPubkey: "d".repeat(64), relays: fakeProfile.relays }
    ],
    ...overrides
  };
}

vi.mock("../../app/AppState", () => ({
  useAppState: () => mockApp.state
}));

import { CollectSharesScreen, RecoverSuccessScreen } from "../RecoverScreens";

beforeEach(() => {
  mockApp.state = {
    activeProfile: fakeProfile,
    recoverSession: null,
    validateRecoverSources: vi.fn(async () => {
      mockApp.state.recoverSession = recoveredSession();
    }),
    recoverNsec: vi.fn(async () => {
      const recovered = {
        nsec: "nsec1realrecoveredprivatekey0000000000000000000000000000000000",
        signing_key_hex: "f".repeat(64)
      };
      mockApp.state.recoverSession = recoveredSession({
        recovered,
        expiresAt: Date.now() + 60_000
      });
      return recovered;
    }),
    clearRecoverSession: vi.fn(() => {
      mockApp.state.recoverSession = null;
    }),
    expireRecoveredNsec: vi.fn(() => {
      mockApp.state.recoverSession = null;
    })
  };
});

afterEach(() => {
  cleanup();
  mockNavigate.mockClear();
  vi.useRealTimers();
});

describe("CollectSharesScreen", () => {
  /**
   * Product-vs-demo isolation: product recovery must require AppState-backed
   * source validation before real recovery is enabled. The raw-share shortcut
   * exists only for scripted gallery demos and stays behind demoUi.recover.
   */
  function renderCollect(routeState?: unknown) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/recover/test-profile-id", state: routeState }]}>
        <Routes>
          <Route path="/recover/:profileId" element={<CollectSharesScreen />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders real recovery inputs for the saved profile and required bfshare slot", () => {
    renderCollect();
    expect(screen.getByRole("heading", { name: "Recover NSEC" })).toBeInTheDocument();
    expect(screen.getByText(/requires 2 of your 2 shares/)).toBeInTheDocument();
    expect(screen.getByLabelText("Saved profile password")).toBeInTheDocument();
    expect(screen.getByLabelText("Source Share #2 bfshare package")).toBeInTheDocument();
    expect(screen.getByLabelText("Source Share #2 package password")).toBeInTheDocument();
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
  });

  it("validates sources before enabling real recovery", async () => {
    renderCollect();
    expect(screen.getByRole("button", { name: "Validate Sources" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recover NSEC" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Saved profile password"), { target: { value: "local-password" } });
    fireEvent.change(screen.getByLabelText("Source Share #2 bfshare package"), { target: { value: "bfshare1package" } });
    fireEvent.change(screen.getByLabelText("Source Share #2 package password"), { target: { value: "source-password" } });

    fireEvent.click(screen.getByRole("button", { name: "Validate Sources" }));
    await waitFor(() => expect(mockApp.state.validateRecoverSources).toHaveBeenCalledWith({
      profileId: "test-profile-id",
      profilePassword: "local-password",
      sourcePackages: [{ packageText: "bfshare1package", password: "source-password" }]
    }));
    await waitFor(() => expect(screen.getAllByText("Loaded")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Recover NSEC" }));
    await waitFor(() => expect(mockApp.state.recoverNsec).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith("/recover/test-profile-id/success");
  });

  it("renders real AppState validation errors", async () => {
    mockApp.state.validateRecoverSources = vi.fn(async () => {
      throw new Error("The profile password could not decrypt Source Share #1.");
    });
    renderCollect();
    fireEvent.change(screen.getByLabelText("Saved profile password"), { target: { value: "wrong-password" } });
    fireEvent.change(screen.getByLabelText("Source Share #2 bfshare package"), { target: { value: "bfshare1package" } });
    fireEvent.change(screen.getByLabelText("Source Share #2 package password"), { target: { value: "source-password" } });

    fireEvent.click(screen.getByRole("button", { name: "Validate Sources" }));
    await waitFor(() => {
      expect(screen.getByText("Recovery Error")).toBeInTheDocument();
      expect(screen.getByText("The profile password could not decrypt Source Share #1.")).toBeInTheDocument();
    });
  });

  it("clears recovery state and navigates back to the dashboard", () => {
    renderCollect();
    fireEvent.click(screen.getByText("Back to Signer"));
    expect(mockApp.state.clearRecoverSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/test-profile-id");
  });

  it("keeps the demo-only raw-share click-through isolated behind demo state", () => {
    // Demo raw-share behavior must not leak into product recovery because it
    // bypasses package validation and exists only for paper/demo continuity.
    renderCollect({ demoUi: { recover: { variant: "incompatible-shares" } } });
    const input = screen.getByPlaceholderText("Paste share hex...") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "new-share-value" } });
    expect(input.value).toBe("new-share-value");
    expect(screen.getByText("Incompatible Shares")).toBeInTheDocument();
  });
});

describe("RecoverSuccessScreen", () => {
  /**
   * Recovered-key security contract: product success masks recovered nsec by
   * default, requires an explicit reveal action, supports user-initiated copy
   * and clear, and auto-expires the in-memory recovered key.
   */
  const fullNsec = "nsec1realrecoveredprivatekey0000000000000000000000000000000000";

  function renderSuccess(routeState?: unknown) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: "/recover/test-profile-id/success", state: routeState }]}>
        <Routes>
          <Route path="/recover/:profileId/success" element={<RecoverSuccessScreen />} />
        </Routes>
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    mockApp.state.recoverSession = recoveredSession({
      recovered: {
        nsec: fullNsec,
        signing_key_hex: "f".repeat(64)
      },
      expiresAt: Date.now() + 60_000
    });
  });

  it("renders the real recovered nsec masked by default", () => {
    renderSuccess();
    expect(screen.getByText("Security Warning")).toBeInTheDocument();
    expect(screen.getByText(/auto-clear in 60 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Recovered NSEC:")).toBeInTheDocument();
    expect(screen.queryByText(fullNsec)).not.toBeInTheDocument();
  });

  it("copies, reveals, and clears the real recovered nsec", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    renderSuccess();

    fireEvent.click(screen.getByText("Copy to Clipboard"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullNsec));
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(fullNsec)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear"));
    expect(mockApp.state.clearRecoverSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/test-profile-id");
  });

  it("auto-clears the recovered nsec after 60 seconds", async () => {
    vi.useFakeTimers();
    renderSuccess();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(mockApp.state.expireRecoveredNsec).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/test-profile-id", { replace: true });
  });

  it("clears recovery state when returning to the dashboard", () => {
    renderSuccess();
    fireEvent.click(screen.getByText("Back to Signer"));
    expect(mockApp.state.clearRecoverSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/test-profile-id");
  });

  it("keeps demo-only fake nsec behavior behind demo state", () => {
    // The fake recovered key is a demo-gallery affordance; product routes must
    // continue reading recovered keys only from the AppState recovery session.
    renderSuccess({ demoUi: { recover: { variant: "success", revealed: true } } });
    expect(screen.queryByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)).toBeInTheDocument();
  });
});
