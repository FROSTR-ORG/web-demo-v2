import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EnterRotatePackageScreen,
  ApplyingShareUpdateScreen,
  ShareUpdateFailedScreen,
  LocalShareUpdatedScreen
} from "../RotateShareScreens";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locationState: null as Record<string, unknown> | null,
  activeProfile: null as { id: string } | null
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({
      pathname: "/rotate-share",
      search: "",
      hash: "",
      state: mocks.locationState,
      key: "default"
    })
  };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: mocks.activeProfile
  })
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.locationState = null;
  mocks.activeProfile = null;
});

/* ==========================================================
   Screen 1 — Enter Rotate Package
   ========================================================== */

describe("EnterRotatePackageScreen", () => {
  it("renders heading, package input, QR button, password field, and Apply button", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Enter Rotate Package")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bfonboard1...")).toBeInTheDocument();
    expect(screen.getByText("Scan QR")).toBeInTheDocument();
    expect(screen.getByLabelText("Package Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply Share Update/i })).toBeInTheDocument();
  });

  it("has Back to Settings link", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Back to Settings")).toBeInTheDocument();
  });

  it("has header with keyset name", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
  });

  it("shows validation feedback for valid bfonboard1 input", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    expect(screen.getByText(/Valid package/)).toBeInTheDocument();
  });

  it("shows error feedback for invalid input", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "invalid-string" } });
    expect(screen.getByText(/Invalid package/)).toBeInTheDocument();
  });

  it("Apply Share Update button is disabled until valid input", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Apply Share Update/i })).toBeDisabled();
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    expect(screen.getByRole("button", { name: /Apply Share Update/i })).not.toBeDisabled();
  });

  it("Apply navigates to /rotate-share/applying with state", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply Share Update/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-share/applying", {
      state: { packageString: "bfonboard1abc123", password: "" }
    });
  });

  it("has info tooltip next to Rotate Package label", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Rotate Package")).toBeInTheDocument();
  });

  it("does not have a stepper", () => {
    render(
      <MemoryRouter>
        <EnterRotatePackageScreen />
      </MemoryRouter>
    );
    expect(screen.queryByLabelText("Create progress")).not.toBeInTheDocument();
  });
});

/* ==========================================================
   Screen 2 — Applying Share Update
   ========================================================== */

describe("ApplyingShareUpdateScreen", () => {
  it("renders vertical step timeline when package state is present", () => {
    mocks.locationState = { packageString: "bfonboard1abc123", password: "test" };
    render(
      <MemoryRouter>
        <ApplyingShareUpdateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Applying Share Update")).toBeInTheDocument();
    expect(screen.getByText("Connected to relays")).toBeInTheDocument();
    expect(screen.getByText("Verified rotate package")).toBeInTheDocument();
    expect(screen.getByText("Applying local share update")).toBeInTheDocument();
    expect(screen.getByText("Saving updated profile")).toBeInTheDocument();
  });

  it("has package info bar", () => {
    mocks.locationState = { packageString: "bfonboard1abc123", password: "test" };
    render(
      <MemoryRouter>
        <ApplyingShareUpdateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText(/Rotate package:/)).toBeInTheDocument();
    expect(screen.getByText("Share #0")).toBeInTheDocument();
  });

  it("has Cancel button", () => {
    mocks.locationState = { packageString: "bfonboard1abc123", password: "test" };
    render(
      <MemoryRouter>
        <ApplyingShareUpdateScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Cancel Share Update/i })).toBeInTheDocument();
  });

  it("has Back to Settings link", () => {
    mocks.locationState = { packageString: "bfonboard1abc123", password: "test" };
    render(
      <MemoryRouter>
        <ApplyingShareUpdateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Back to Settings")).toBeInTheDocument();
  });

  it("guard redirects to /rotate-share if no state", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <ApplyingShareUpdateScreen />
      </MemoryRouter>
    );
    expect(container.textContent).toBe("");
  });
});

/* ==========================================================
   Screen 3 — Share Update Failed
   ========================================================== */

describe("ShareUpdateFailedScreen", () => {
  it("renders amber warning callout with title and description", () => {
    render(
      <MemoryRouter>
        <ShareUpdateFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Share Update Failed")).toBeInTheDocument();
    expect(screen.getByText("Rotate package did not apply")).toBeInTheDocument();
    expect(screen.getByText(/Check relay connectivity/)).toBeInTheDocument();
  });

  it("has Retry and Back to Rotate Share buttons", () => {
    render(
      <MemoryRouter>
        <ShareUpdateFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /^Retry$/i })).toBeInTheDocument();
    // BackLink at top + inline action button both say "Back to Rotate Share"
    const backBtns = screen.getAllByRole("button", { name: /Back to Rotate Share/i });
    expect(backBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("Retry button navigates to applying screen", () => {
    render(
      <MemoryRouter>
        <ShareUpdateFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-share/applying", expect.anything());
  });

  it("Back to Rotate Share inline button navigates to enter package", () => {
    render(
      <MemoryRouter>
        <ShareUpdateFailedScreen />
      </MemoryRouter>
    );
    // Click the inline action button (second one, in inline-actions div)
    const backBtns = screen.getAllByRole("button", { name: /Back to Rotate Share/i });
    // The inline-actions button is the ghost variant
    const inlineBtn = backBtns.find((btn) => btn.classList.contains("button-ghost"));
    fireEvent.click(inlineBtn!);
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-share");
  });

  it("has Back to Rotate Share link in header area", () => {
    render(
      <MemoryRouter>
        <ShareUpdateFailedScreen />
      </MemoryRouter>
    );
    // BackLink at top of screen
    const backLinks = screen.getAllByText("Back to Rotate Share");
    expect(backLinks.length).toBeGreaterThanOrEqual(1);
  });
});

/* ==========================================================
   Screen 4 — Local Share Updated
   ========================================================== */

describe("LocalShareUpdatedScreen", () => {
  it("renders green success banner and identity changes card", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Local Share Updated")).toBeInTheDocument();
    expect(screen.getByText("Updated share is active on this device")).toBeInTheDocument();
    expect(screen.getByText("IDENTITY CHANGES")).toBeInTheDocument();
  });

  it("shows Group Public Key as Unchanged", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Group Public Key")).toBeInTheDocument();
    expect(screen.getByText("npub1qe3...7kkm")).toBeInTheDocument();
    expect(screen.getByText("Unchanged")).toBeInTheDocument();
  });

  it("shows Share Public Key old → new values", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Share Public Key")).toBeInTheDocument();
    expect(screen.getByText("02a3f8...8f2c")).toBeInTheDocument();
    expect(screen.getByText("03b7d9...2e5a")).toBeInTheDocument();
  });

  it("shows Profile ID old → new values", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Profile ID")).toBeInTheDocument();
    expect(screen.getByText("prof_8f2c4a")).toBeInTheDocument();
    expect(screen.getByText("prof_2e5a19")).toBeInTheDocument();
  });

  it("has Return to Signer button", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Return to Signer/i })).toBeInTheDocument();
  });

  it("Return to Signer navigates to /dashboard/{profileId} when active profile exists", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = { id: "test-profile-456" };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Return to Signer/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/test-profile-456");
  });

  it("Return to Signer navigates to / as fallback when no active profile", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = null;
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Return to Signer/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("has no Back link (terminal success state)", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Rotate Share")).not.toBeInTheDocument();
  });

  it("guard redirects to /rotate-share if no state", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(container.textContent).toBe("");
  });

  it("has header with keyset name", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <LocalShareUpdatedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
  });
});
