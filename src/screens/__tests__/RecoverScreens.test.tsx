import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
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
  memberCount: 3,
  localShareIdx: 0,
  groupPublicKey: "npub1qe3abcdef1234567890abcdef7k4m",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: fakeProfile,
  }),
}));

import { CollectSharesScreen, RecoverSuccessScreen } from "../RecoverScreens";

afterEach(() => {
  cleanup();
  mockNavigate.mockClear();
});

/* ============================
   Collect Shares Screen
   ============================ */

describe("CollectSharesScreen", () => {
  function renderCollect() {
    return render(
      <MemoryRouter initialEntries={["/recover/test-profile-id"]}>
        <Routes>
          <Route path="/recover/:profileId" element={<CollectSharesScreen />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders Recover NSEC heading", () => {
    renderCollect();
    expect(screen.getByRole("heading", { name: "Recover NSEC" })).toBeInTheDocument();
  });

  it("renders threshold description with correct numbers", () => {
    renderCollect();
    expect(screen.getByText(/requires 2 of your 3 shares/)).toBeInTheDocument();
  });

  it("renders preloaded local share (#0 — This Browser)", () => {
    renderCollect();
    expect(screen.getByText("Share #0 — This Browser")).toBeInTheDocument();
    expect(screen.getByText("Loaded")).toBeInTheDocument();
  });

  it("renders additional share input (Share #1 — Pasted)", () => {
    renderCollect();
    expect(screen.getByText("Share #1 — Pasted")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste share hex...")).toBeInTheDocument();
  });

  it("renders Recover NSEC button disabled initially", () => {
    renderCollect();
    const buttons = screen.getAllByText("Recover NSEC");
    const recoverBtn = buttons.find((el) => el.closest("button[type='button']") && el.closest(".button-full"));
    expect(recoverBtn?.closest("button")).toBeDisabled();
  });

  it("enables Recover NSEC button when valid share is pasted", () => {
    renderCollect();
    const input = screen.getByPlaceholderText("Paste share hex...");
    fireEvent.change(input, { target: { value: "a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4" } });
    const buttons = screen.getAllByText("Recover NSEC");
    const recoverBtn = buttons.find((el) => el.closest("button") && el.closest(".button-full"));
    expect(recoverBtn?.closest("button")).not.toBeDisabled();
  });

  it("navigates to success screen on Recover NSEC click with valid share", () => {
    renderCollect();
    const input = screen.getByPlaceholderText("Paste share hex...");
    fireEvent.change(input, { target: { value: "a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4" } });
    const buttons = screen.getAllByText("Recover NSEC");
    const recoverBtn = buttons.find((el) => el.closest("button") && el.closest(".button-full"));
    fireEvent.click(recoverBtn!.closest("button")!);
    expect(mockNavigate).toHaveBeenCalledWith("/recover/test-profile-id/success");
  });

  it("renders Back to Signer link", () => {
    renderCollect();
    expect(screen.getByText("Back to Signer")).toBeInTheDocument();
  });

  it("navigates back to dashboard on Back to Signer click", () => {
    renderCollect();
    fireEvent.click(screen.getByText("Back to Signer"));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/test-profile-id");
  });
});

/* ============================
   Recover Success Screen
   ============================ */

describe("RecoverSuccessScreen", () => {
  function renderSuccess() {
    return render(
      <MemoryRouter initialEntries={["/recover/test-profile-id/success"]}>
        <Routes>
          <Route path="/recover/:profileId/success" element={<RecoverSuccessScreen />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders Recover NSEC heading", () => {
    renderSuccess();
    expect(screen.getByRole("heading", { name: "Recover NSEC" })).toBeInTheDocument();
  });

  it("renders Security Warning panel with amber styling", () => {
    renderSuccess();
    expect(screen.getByText("Security Warning")).toBeInTheDocument();
    expect(screen.getByText("Your private key will auto-clear in 60 seconds")).toBeInTheDocument();
    expect(screen.getByText("Do not screenshot or share this key")).toBeInTheDocument();
    expect(screen.getByText("Copy to a secure password manager")).toBeInTheDocument();
  });

  it("renders masked and revealed NSEC labels", () => {
    renderSuccess();
    expect(screen.getByText("Recovered NSEC:")).toBeInTheDocument();
    expect(screen.getByText("Recovered NSEC (revealed):")).toBeInTheDocument();
  });

  it("renders Copy to Clipboard, Reveal, and Clear buttons", () => {
    renderSuccess();
    expect(screen.getByText("Copy to Clipboard")).toBeInTheDocument();
    expect(screen.getByText("Reveal")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("Copy to Clipboard shows Copied! feedback", async () => {
    // Mock clipboard API
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    renderSuccess();
    fireEvent.click(screen.getByText("Copy to Clipboard"));
    await waitFor(() => {
      expect(screen.getAllByText("Copied!").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("Reveal toggle shows full NSEC", () => {
    renderSuccess();
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)).toBeInTheDocument();
  });

  it("Clear button removes NSEC from display", () => {
    renderSuccess();
    fireEvent.click(screen.getByText("Clear"));
    // After clearing, both nsec display areas should show "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(2);
  });

  it("renders Back to Signer link", () => {
    renderSuccess();
    expect(screen.getByText("Back to Signer")).toBeInTheDocument();
  });

  it("navigates back to dashboard on Back to Signer click", () => {
    renderSuccess();
    fireEvent.click(screen.getByText("Back to Signer"));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/test-profile-id");
  });
});
