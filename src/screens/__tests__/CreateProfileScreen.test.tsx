import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CreateProfileScreen } from "../CreateProfileScreen";

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  createProfile: vi.fn().mockResolvedValue("demo-profile"),
  createSession: null as {
    draft: { groupName: string; threshold: number; count: number };
    keyset?: { group: { group_name: string; members: { idx: number; pubkey: string }[] } };
    localShare?: { idx: number };
  } | null,
  demoUi: {} as Record<string, unknown>
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

vi.mock("../../app/AppState", async () => {
  const actual = await vi.importActual<typeof import("../../app/AppState")>("../../app/AppState");
  return {
    ...actual,
    useAppState: () => ({
      createSession: mocks.createSession,
      createProfile: mocks.createProfile
    })
  };
});

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => mocks.demoUi
}));

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/create/profile"]}>
      <Routes>
        <Route path="/create/profile" element={<CreateProfileScreen />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.createProfile.mockClear();
  mocks.createSession = {
    draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
    keyset: {
      group: {
        group_name: "My Signing Key",
        members: [
          { idx: 0, pubkey: "02a3f8c2d1e2f3a4b5c6d7e8f9a0b1c28f2c4a" },
          { idx: 1, pubkey: "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d" },
          { idx: 2, pubkey: "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e" }
        ]
      }
    },
    localShare: { idx: 0 }
  };
  mocks.demoUi = {};
});

describe("CreateProfileScreen", () => {
  it("renders heading, subtitle and profile name input with paper copy (VAL-SHR-001)", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "Create Profile" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set the local profile name, password, relays, and peer permissions for the assigned share before distributing the remaining device packages."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("A name for this profile to identify it in the peer list.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Igloo Web")).toBeInTheDocument();
  });

  it("renders Assigned Local Share panel with Share + Keyset rows", () => {
    renderScreen();
    expect(screen.getByText("Assigned Local Share")).toBeInTheDocument();
    expect(
      screen.getByText("The local share for this device is already assigned and ready for profile creation.")
    ).toBeInTheDocument();
    expect(screen.getByText("Share #0, Encrypted")).toBeInTheDocument();
    expect(screen.getAllByText("My Signing Key").length).toBeGreaterThanOrEqual(1);
  });

  it("renders Profile Password section with help copy (VAL-SHR-001)", () => {
    renderScreen();
    expect(screen.getAllByText("Profile Password").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("This password encrypts your profile on this device. You'll need it each time you unlock it.")
    ).toBeInTheDocument();
  });

  it("renders stepper with shared variant labels (VAL-SHR-002)", () => {
    renderScreen();
    expect(screen.getByText("Create / Rotate")).toBeInTheDocument();
    // "Create Profile" appears in stepper + page heading
    expect(screen.getAllByText("Create Profile").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Distribute Shares")).toBeInTheDocument();
    expect(screen.queryByText("Rotate Keyset")).not.toBeInTheDocument();
  });

  it("shows green check on confirm password when passwords match (VAL-SHR-003)", () => {
    mocks.demoUi = { shared: { passwordPreset: "paperpass", relayPreset: "wss://relay.example.com" } };
    renderScreen();
    const confirmContainer = screen.getByLabelText("Confirm Password").closest(".password-shell");
    expect(confirmContainer).toHaveClass("checked");
  });

  it("disables Continue CTA when passwords do not match (VAL-SHR-012)", () => {
    mocks.demoUi = { shared: { passwordPreset: "paperpass" } };
    renderScreen();
    const submitButton = screen.getByRole("button", { name: /Continue to Distribute Shares/ });
    expect(submitButton).not.toBeDisabled();
    const confirmInput = screen.getByLabelText("Confirm Password") as HTMLInputElement;
    fireEvent.change(confirmInput, { target: { value: "paperpass-x" } });
    expect(submitButton).toBeDisabled();
  });

  it("adds a relay when Add clicked with a valid input (VAL-SHR-004)", () => {
    mocks.demoUi = { shared: { relayPreset: "wss://relay.example.com" } };
    renderScreen();
    // Should initially render exactly 2 relays: primal.net + example.com
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.example.com")).toBeInTheDocument();
    // Type damus.io into add-row and click Add
    const addRowInput = screen.getAllByDisplayValue("wss://")[0] as HTMLInputElement;
    fireEvent.change(addRowInput, { target: { value: "wss://relay.damus.io" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
  });

  it("shows Connected - 24ms latency status on first relay (VAL-SHR-001)", () => {
    mocks.demoUi = { shared: { relayPreset: "wss://relay.example.com" } };
    renderScreen();
    expect(screen.getByText("Connected - 24ms latency")).toBeInTheDocument();
  });

  it("renders Peer Permissions with 3 peer rows and SIGN/ECDH/PING/ONBOARD pills (VAL-SHR-001)", () => {
    renderScreen();
    expect(screen.getByText("Peer #0")).toBeInTheDocument();
    expect(screen.getByText("Peer #1")).toBeInTheDocument();
    expect(screen.getByText("Peer #2")).toBeInTheDocument();
    expect(screen.getByText("Local profile")).toBeInTheDocument();
    expect(screen.getAllByText("SIGN").length).toBe(2);
    expect(screen.getAllByText("ECDH").length).toBe(2);
    expect(screen.getAllByText("PING").length).toBe(2);
    expect(screen.getAllByText("ONBOARD").length).toBe(2);
  });

  it("navigates to /create/distribute on successful submit (VAL-SHR-005)", async () => {
    mocks.demoUi = { shared: { passwordPreset: "paperpass", relayPreset: "wss://relay.example.com" } };
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /Continue to Distribute Shares/ }));
    await waitFor(() => {
      expect(mocks.createProfile).toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("/create/distribute");
    });
  });
});
