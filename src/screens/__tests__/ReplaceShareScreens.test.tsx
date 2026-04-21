import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EnterReplacePackageScreen,
  ApplyingReplacementScreen,
  ReplacementFailedScreen,
  ShareReplacedScreen
} from "../ReplaceShareScreens";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locationState: null as Record<string, unknown> | null,
  activeProfile: null as { id: string; groupName: string; groupPublicKey: string; threshold: number; memberCount: number } | null,
  replaceShareSession: null as { phase: string; packageString?: string; localShareIdx?: number; oldProfileId?: string; newProfileId?: string } | null,
  decodeReplaceSharePackage: vi.fn(),
  applyReplaceShareUpdate: vi.fn(),
  clearReplaceShareSession: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({
      pathname: "/replace-share",
      search: "",
      hash: "",
      state: mocks.locationState,
      key: "default"
    })
  };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: mocks.activeProfile,
    replaceShareSession: mocks.replaceShareSession,
    decodeReplaceSharePackage: mocks.decodeReplaceSharePackage,
    applyReplaceShareUpdate: mocks.applyReplaceShareUpdate,
    clearReplaceShareSession: mocks.clearReplaceShareSession,
  })
}));

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => ({
    replaceShare: null as { packagePreset?: string; passwordPreset?: string } | null,
    progress: null as { frozen?: boolean } | null,
  })
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.decodeReplaceSharePackage.mockClear();
  mocks.applyReplaceShareUpdate.mockClear();
  mocks.clearReplaceShareSession.mockClear();
  mocks.locationState = null;
  mocks.activeProfile = null;
  mocks.replaceShareSession = null;
});

/* ==========================================================
   Screen 1 — Enter Replace Share Package
   ========================================================== */

describe("EnterReplacePackageScreen", () => {
  it("renders heading, package input, QR button, password fields, and Apply button", () => {
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Enter Onboarding Package")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bfonboard1...")).toBeInTheDocument();
    expect(screen.getByText("Scan QR")).toBeInTheDocument();
    expect(screen.getByLabelText("Package Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Profile Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Replace Share/i })).toBeInTheDocument();
  });

  it("has Back to Settings link", () => {
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Back to Settings")).toBeInTheDocument();
  });

  it("has header with keyset name when activeProfile exists", () => {
    mocks.activeProfile = { id: "test", groupName: "My Signing Key", groupPublicKey: "npub1abc", threshold: 2, memberCount: 3 };
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
  });

  it("Replace Share button is disabled until all fields are valid", () => {
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    const button = screen.getByRole("button", { name: /Replace Share/i });
    expect(button).toBeDisabled();

    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    expect(button).toBeDisabled();

    const packagePassword = screen.getByLabelText("Package Password");
    fireEvent.change(packagePassword, { target: { value: "pkgpass" } });
    expect(button).toBeDisabled();

    const profilePassword = screen.getByLabelText("Profile Password");
    fireEvent.change(profilePassword, { target: { value: "profpass123" } });
    expect(button).not.toBeDisabled();
  });

  it("calls decodeReplaceSharePackage and navigates on Replace Share", async () => {
    mocks.decodeReplaceSharePackage.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByPlaceholderText("bfonboard1..."), { target: { value: "bfonboard1abc123" } });
    fireEvent.change(screen.getByLabelText("Package Password"), { target: { value: "pkgpass" } });
    fireEvent.change(screen.getByLabelText("Profile Password"), { target: { value: "profpass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Replace Share/i }));

    await waitFor(() => {
      expect(mocks.decodeReplaceSharePackage).toHaveBeenCalledWith(
        "bfonboard1abc123",
        "pkgpass",
        "profpass123",
      );
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/replace-share/applying");
  });

  it("shows error when decodeReplaceSharePackage fails", async () => {
    mocks.decodeReplaceSharePackage.mockRejectedValue(new Error("Wrong password"));
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByPlaceholderText("bfonboard1..."), { target: { value: "bfonboard1abc123" } });
    fireEvent.change(screen.getByLabelText("Package Password"), { target: { value: "pkgpass" } });
    fireEvent.change(screen.getByLabelText("Profile Password"), { target: { value: "profpass123" } });
    fireEvent.click(screen.getByRole("button", { name: /Replace Share/i }));

    await waitFor(() => {
      expect(screen.getByText("Wrong password")).toBeInTheDocument();
    });
  });

  it("has Onboarding Package label", () => {
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding Package")).toBeInTheDocument();
  });

  it("does not have a stepper", () => {
    render(
      <MemoryRouter>
        <EnterReplacePackageScreen />
      </MemoryRouter>
    );
    expect(screen.queryByLabelText("Create progress")).not.toBeInTheDocument();
  });
});

/* ==========================================================
   Screen 2 — Applying Replacement
   ========================================================== */

describe("ApplyingReplacementScreen", () => {
  it("renders vertical step timeline when replaceShareSession is decoded", () => {
    mocks.replaceShareSession = { phase: "decoded", packageString: "bfonboard1abc123", localShareIdx: 0 };
    render(
      <MemoryRouter>
        <ApplyingReplacementScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Applying Replacement")).toBeInTheDocument();
    expect(screen.getByText("Validated package")).toBeInTheDocument();
    expect(screen.getByText("Matched Group Profile")).toBeInTheDocument();
    expect(screen.getByText("Replacing local share")).toBeInTheDocument();
    expect(screen.getByText("Saving updated local share")).toBeInTheDocument();
  });

  it("has package info bar", () => {
    mocks.replaceShareSession = { phase: "decoded", packageString: "bfonboard1abc123", localShareIdx: 0 };
    render(
      <MemoryRouter>
        <ApplyingReplacementScreen />
      </MemoryRouter>
    );
    expect(screen.getByText(/Onboarding package:/)).toBeInTheDocument();
    expect(screen.getByText("Share #0")).toBeInTheDocument();
  });

  it("has Cancel button", () => {
    mocks.replaceShareSession = { phase: "decoded", packageString: "bfonboard1abc123", localShareIdx: 0 };
    render(
      <MemoryRouter>
        <ApplyingReplacementScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Cancel Replacement/i })).toBeInTheDocument();
  });

  it("has Back to Settings link", () => {
    mocks.replaceShareSession = { phase: "decoded", packageString: "bfonboard1abc123", localShareIdx: 0 };
    render(
      <MemoryRouter>
        <ApplyingReplacementScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Back to Settings")).toBeInTheDocument();
  });

  it("guard redirects to /replace-share if no session", () => {
    mocks.replaceShareSession = null;
    const { container } = render(
      <MemoryRouter>
        <ApplyingReplacementScreen />
      </MemoryRouter>
    );
    expect(container.textContent).toBe("");
  });
});

/* ==========================================================
   Screen 3 — Replacement Failed
   ========================================================== */

describe("ReplacementFailedScreen", () => {
  it("renders amber warning callout with title and description", () => {
    render(
      <MemoryRouter>
        <ReplacementFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Replacement Failed")).toBeInTheDocument();
    expect(screen.getByText("Onboarding package did not apply")).toBeInTheDocument();
    expect(screen.getByText(/Check the package, password/)).toBeInTheDocument();
  });

  it("has Retry and Back to Replace Share buttons (VAL-RTS-003)", () => {
    render(
      <MemoryRouter>
        <ReplacementFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /^Retry$/i })).toBeInTheDocument();
    const backBtns = screen.getAllByRole("button", { name: /Back to Replace Share/i });
    expect(backBtns).toHaveLength(1);
  });

  it("Retry button calls applyReplaceShareUpdate", () => {
    render(
      <MemoryRouter>
        <ReplacementFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(mocks.applyReplaceShareUpdate).toHaveBeenCalled();
  });

  it("Back to Replace Share inline button navigates to enter package", () => {
    render(
      <MemoryRouter>
        <ReplacementFailedScreen />
      </MemoryRouter>
    );
    const inlineBtn = screen.getByRole("button", { name: /Back to Replace Share/i });
    fireEvent.click(inlineBtn);
    expect(mocks.navigate).toHaveBeenCalledWith("/replace-share");
    expect(mocks.clearReplaceShareSession).toHaveBeenCalled();
  });

  it("does NOT render a top BackLink above the title (VAL-RTS-003)", () => {
    const { container } = render(
      <MemoryRouter>
        <ReplacementFailedScreen />
      </MemoryRouter>
    );
    expect(container.querySelector(".back-link")).toBeNull();
    expect(screen.queryByText("Back to Settings")).not.toBeInTheDocument();
  });
});

/* ==========================================================
   Screen 4 — Share Replaced
   ========================================================== */

describe("ShareReplacedScreen", () => {
  it("renders green success banner and replacement summary card", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Share Replaced")).toBeInTheDocument();
    expect(screen.getByText("Replacement share is active on this device")).toBeInTheDocument();
    expect(screen.getByText("REPLACEMENT SUMMARY")).toBeInTheDocument();
  });

  it("shows Group Public Key as Unchanged", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = { id: "test", groupName: "My Signing Key", groupPublicKey: "npub1qe3...7kkm", threshold: 2, memberCount: 3 };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Group Public Key")).toBeInTheDocument();
    expect(screen.getByText("npub1qe3...7kkm")).toBeInTheDocument();
    expect(screen.getAllByText("Unchanged").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Share Public Key old → new values", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = { id: "new-prof-id", groupName: "My Signing Key", groupPublicKey: "npub1new", threshold: 2, memberCount: 3 };
    mocks.replaceShareSession = { phase: "updated", oldProfileId: "old-prof-id", newProfileId: "new-prof-id" };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Share Public Key")).toBeInTheDocument();
    expect(screen.getByText("old-pr...f-id")).toBeInTheDocument();
    expect(screen.getByText("new-pr...f-id")).toBeInTheDocument();
  });

  it("shows Group Profile as unchanged", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = { id: "new-prof", groupName: "My Signing Key", groupPublicKey: "npub1new", threshold: 2, memberCount: 3 };
    mocks.replaceShareSession = { phase: "updated", oldProfileId: "old-prof", newProfileId: "new-prof" };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Group Profile")).toBeInTheDocument();
    expect(screen.getAllByText("Unchanged").length).toBeGreaterThanOrEqual(1);
  });

  it("has Return to Signer button", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Return to Signer/i })).toBeInTheDocument();
  });

  it("Return to Signer navigates to /dashboard/{profileId} when active profile exists", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = { id: "test-profile-456", groupName: "My Signing Key", groupPublicKey: "npub1abc", threshold: 2, memberCount: 3 };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
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
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Return to Signer/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("has no Back link (terminal success state)", () => {
    mocks.locationState = { fromApplying: true };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Replace Share")).not.toBeInTheDocument();
  });

  it("guard redirects to /replace-share if no state", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(container.textContent).toBe("");
  });

  it("has header with keyset name", () => {
    mocks.locationState = { fromApplying: true };
    mocks.activeProfile = { id: "test", groupName: "My Signing Key", groupPublicKey: "npub1abc", threshold: 2, memberCount: 3 };
    render(
      <MemoryRouter>
        <ShareReplacedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
  });
});
