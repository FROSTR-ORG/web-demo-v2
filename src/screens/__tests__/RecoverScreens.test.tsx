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

  // VAL-REC-001 regression: even when the incompatible-shares demo preset
  // preloads Share #1 with a mock value, the paste input must still render
  // and accept user input (validators expect a textbox to type into).
  it("renders the paste input even when Share #1 is preloaded in the incompatible-shares variant", () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/recover/test-profile-id",
            state: { demoUi: { recover: { variant: "incompatible-shares" } } },
          },
        ]}
      >
        <Routes>
          <Route path="/recover/:profileId" element={<CollectSharesScreen />} />
        </Routes>
      </MemoryRouter>
    );
    const input = screen.getByPlaceholderText("Paste share hex...") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    // The input should accept typed text (the paste/typing interaction).
    fireEvent.change(input, { target: { value: "new-share-value" } });
    expect(input.value).toBe("new-share-value");
    // The incompatible alert is still rendered alongside the paste input.
    expect(screen.getByText("Incompatible Shares")).toBeInTheDocument();
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
    // Copy button label stays "Copy to Clipboard" (static per Paper); a
    // separate "Copied!" pill appears alongside it after clicking.
    fireEvent.click(screen.getByText("Copy to Clipboard"));
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
    // The Copy button itself retains its label.
    expect(screen.getByText("Copy to Clipboard")).toBeInTheDocument();
  });

  it("Reveal click shows full NSEC and keeps 'Reveal' label", () => {
    renderSuccess();
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)).toBeInTheDocument();
    // VAL-REC-002 requires the outlined button label stays "Reveal" (no toggle to "Hide").
    expect(screen.getByText("Reveal")).toBeInTheDocument();
  });

  it("Clear button re-masks the revealed NSEC (VAL-REC-003)", () => {
    renderSuccess();
    // First reveal the full nsec.
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)).toBeInTheDocument();
    // Then clear — the revealed text is removed and the display returns
    // to the masked state (not blanked to "—").
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)).not.toBeInTheDocument();
    // Both labels are still present; the revealed panel shows the masked
    // form instead of the full nsec.
    expect(screen.getByText("Recovered NSEC:")).toBeInTheDocument();
    expect(screen.getByText("Recovered NSEC (revealed):")).toBeInTheDocument();
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

  // VAL-REC-002 regression: the "Recovered NSEC (revealed):" panel must
  // START masked. The full nsec is only shown after clicking "Reveal",
  // and clicking "Reveal" a second time toggles the panel back to masked.
  it("starts with the revealed nsec panel masked, then toggles on Reveal click", () => {
    renderSuccess();
    const fullNsec = /nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/;
    // Before any click the full nsec must NOT be visible anywhere.
    expect(screen.queryByText(fullNsec)).not.toBeInTheDocument();
    // First click: the revealed panel now shows the full nsec.
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(fullNsec)).toBeInTheDocument();
    // Second click: toggles back to masked.
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.queryByText(fullNsec)).not.toBeInTheDocument();
  });

  // VAL-REC-002 regression: even when the demo scenario attempts to preset
  // `revealed: true`, the component must still render masked by default so
  // that the Reveal click has observable effect for validators.
  it("ignores demoUi.recover.revealed preset and starts masked", () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/recover/test-profile-id/success",
            state: { demoUi: { recover: { variant: "success", revealed: true } } },
          },
        ]}
      >
        <Routes>
          <Route path="/recover/:profileId/success" element={<RecoverSuccessScreen />} />
        </Routes>
      </MemoryRouter>
    );
    expect(
      screen.queryByText(/nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0/)
    ).not.toBeInTheDocument();
  });
});
