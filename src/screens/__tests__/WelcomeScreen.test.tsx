import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WelcomeScreen } from "../WelcomeScreen";

/* ---------- Hoisted mock state ---------- */

const mocks = vi.hoisted(() => ({
  profiles: [] as Array<{
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
  }>,
  navigate: vi.fn(),
  unlockProfile: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    profiles: mocks.profiles,
    unlockProfile: mocks.unlockProfile
  })
}));

function makeProfile(id: string, label: string, threshold = 2, memberCount = 3, shareIdx = 0) {
  return {
    id,
    label,
    deviceName: "Igloo Web",
    groupName: label,
    threshold,
    memberCount,
    localShareIdx: shareIdx,
    groupPublicKey: "npub1test" + "0".repeat(50) + "k4m",
    relays: ["wss://relay.primal.net"],
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.profiles = [];
  mocks.navigate.mockClear();
  mocks.unlockProfile.mockClear();
});

describe("WelcomeScreen", () => {
  it("renders first-time welcome with New Keyset button", () => {
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Igloo Web")).toBeInTheDocument();
    expect(screen.getByText("Split your Nostr key. Sign from anywhere.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Keyset/i })).toBeInTheDocument();
  });

  it("renders single returning profile with Unlock and Rotate actions", () => {
    mocks.profiles = [makeProfile("p1", "My Signing Key")];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Welcome back.")).toBeInTheDocument();
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
    expect(screen.getByText("Unlock")).toBeInTheDocument();
    expect(screen.getByText("Rotate")).toBeInTheDocument();
  });

  it("renders multi returning (2-3 profiles) with Unlock and Rotate buttons", () => {
    mocks.profiles = [
      makeProfile("p1", "My Signing Key"),
      makeProfile("p2", "Work Key"),
      makeProfile("p3", "Backup Key", 3, 5, 2)
    ];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Welcome back.")).toBeInTheDocument();
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
    expect(screen.getByText("Work Key")).toBeInTheDocument();
    expect(screen.getByText("Backup Key")).toBeInTheDocument();

    // Each profile should have Unlock and Rotate buttons
    const unlockButtons = screen.getAllByText("Unlock");
    const rotateButtons = screen.getAllByText("Rotate");
    expect(unlockButtons).toHaveLength(3);
    expect(rotateButtons).toHaveLength(3);
  });

  it("renders many returning (4+ profiles) with scrollable list and count", () => {
    mocks.profiles = [
      makeProfile("p1", "Key 1"),
      makeProfile("p2", "Key 2"),
      makeProfile("p3", "Key 3"),
      makeProfile("p4", "Key 4"),
      makeProfile("p5", "Key 5")
    ];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Welcome back.")).toBeInTheDocument();
    // Should show profile count
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("saved profiles")).toBeInTheDocument();
    // All profiles should have Unlock and Rotate
    expect(screen.getAllByText("Unlock")).toHaveLength(5);
    expect(screen.getAllByText("Rotate")).toHaveLength(5);
  });

  it("opens unlock modal when Unlock button is clicked on multi profile", () => {
    mocks.profiles = [
      makeProfile("p1", "My Signing Key"),
      makeProfile("p2", "Work Key")
    ];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    const unlockButtons = screen.getAllByText("Unlock");
    fireEvent.click(unlockButtons[0]);
    // Modal should be open — title appears in modal header
    expect(screen.getByText("Unlock Profile")).toBeInTheDocument();
    // The modal subtitle should show the profile info
    const modalSubtitle = screen.getByText(/My Signing Key · 2\/3/);
    expect(modalSubtitle).toBeInTheDocument();
    expect(screen.getByLabelText("Profile Password")).toBeInTheDocument();
  });

  it("shows error text on wrong password without closing modal", async () => {
    mocks.profiles = [makeProfile("p1", "My Signing Key")];
    mocks.unlockProfile.mockRejectedValueOnce(new Error("Incorrect password. Please try again."));
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    // Open unlock modal by clicking the profile row (single profile — clicks the row button)
    fireEvent.click(screen.getByText("My Signing Key"));
    // Type a password
    const passwordInput = screen.getByLabelText("Profile Password");
    fireEvent.change(passwordInput, { target: { value: "wrongpass" } });
    // Submit the form
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    // Wait for error to appear
    const errorEl = await screen.findByText("Incorrect password. Please try again.");
    expect(errorEl).toBeInTheDocument();
    // Modal should still be open
    expect(screen.getByText("Unlock Profile")).toBeInTheDocument();
  });

  it("Rotate button navigates to /rotate-keyset with profile state", () => {
    mocks.profiles = [
      makeProfile("p1", "My Signing Key"),
      makeProfile("p2", "Work Key")
    ];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    const rotateButtons = screen.getAllByText("Rotate");
    fireEvent.click(rotateButtons[0]);
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset", {
      state: { profile: mocks.profiles[0] }
    });
  });

  it("Rotate button passes correct profile for non-first profile", () => {
    mocks.profiles = [
      makeProfile("p1", "My Signing Key"),
      makeProfile("p2", "Work Key")
    ];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    const rotateButtons = screen.getAllByText("Rotate");
    fireEvent.click(rotateButtons[1]);
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset", {
      state: { profile: mocks.profiles[1] }
    });
  });

  it("chip-style New Keyset button navigates to /create in multi variant", () => {
    mocks.profiles = [
      makeProfile("p1", "My Signing Key"),
      makeProfile("p2", "Work Key")
    ];
    render(
      <MemoryRouter>
        <WelcomeScreen />
      </MemoryRouter>
    );
    // The chip-style "New Keyset" button is a returning-chip-btn
    const chipBtns = screen.getAllByRole("button", { name: "New Keyset" });
    // In multi variant, there should be exactly 1 chip button (no first-time card)
    expect(chipBtns).toHaveLength(1);
    fireEvent.click(chipBtns[0]);
    expect(mocks.navigate).toHaveBeenCalledWith("/create");
  });
});
