import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RotateKeysetFormScreen,
  ReviewGenerateScreen,
  RotateGenerationProgressScreen,
  RotateWrongPasswordScreen,
  RotateGroupMismatchScreen,
  RotateGenerationFailedScreen,
  RotateCreateProfileScreen,
  RotateDistributeSharesScreen,
  RotateDistributionCompleteScreen
} from "../RotateKeysetScreens";

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
});

/* ==========================================================
   RotateKeysetFormScreen
   ========================================================== */

describe("RotateKeysetFormScreen", () => {
  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Rotate Keyset" })).toBeInTheDocument();
    expect(screen.getByText("Source Share #1")).toBeInTheDocument();
    expect(screen.getByText("Source Share #2")).toBeInTheDocument();
    expect(screen.getByText("Shares Collected")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 required")).toBeInTheDocument();
    expect(screen.getByText("New Configuration")).toBeInTheDocument();
    expect(screen.getByText(/Validate & Continue/)).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    /* Step 1 of stepper should be "Rotate Keyset" */
    const stepperLabels = screen.getAllByText("Rotate Keyset");
    /* One from stepper, one from heading */
    expect(stepperLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("renders source share #1 with validated badge", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Validated")).toBeInTheDocument();
    /* "My Signing Key" appears in both header-meta and source share card */
    expect(screen.getAllByText("My Signing Key").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("02a3f8...8f2c")).toBeInTheDocument();
    expect(screen.getByText("Belongs to current group")).toBeInTheDocument();
  });

  it("renders source share #2 with input areas", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText("Paste bfshare from another device or backup...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter password to decrypt")).toBeInTheDocument();
    expect(screen.getByText("Waiting for input")).toBeInTheDocument();
  });

  it("renders info callout", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("All shares change, group key stays the same")).toBeInTheDocument();
  });

  it("back link navigates to /", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("Validate & Continue navigates to /rotate-keyset/review", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText(/Validate & Continue/));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
  });
});

/* ==========================================================
   ReviewGenerateScreen
   ========================================================== */

describe("ReviewGenerateScreen", () => {
  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Review & Generate")).toBeInTheDocument();
    expect(screen.getByText("Before generating fresh shares")).toBeInTheDocument();
    expect(screen.getByText("Distribution Password")).toBeInTheDocument();
    expect(screen.getByText(/Rotate & Generate Keyset/)).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label at step 1", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders amber warning callout", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Before generating fresh shares")).toBeInTheDocument();
    expect(screen.getByText(/reconstruct the existing signing key/)).toBeInTheDocument();
  });

  it("renders distribution password inputs", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  it("Rotate & Generate Keyset button navigates to /rotate-keyset/progress", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText(/Rotate & Generate Keyset/));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/progress");
  });
});

/* ==========================================================
   RotateGenerationProgressScreen
   ========================================================== */

describe("RotateGenerationProgressScreen", () => {
  it("renders heading and 4-phase checklist", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Generation Progress" })).toBeInTheDocument();
    expect(screen.getByText("Process Source Shares")).toBeInTheDocument();
    expect(screen.getByText("Recover Existing Key")).toBeInTheDocument();
    expect(screen.getByText("Generate Fresh Shares")).toBeInTheDocument();
    expect(screen.getByText("Prepare Rotated Shares")).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label at step 1", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("shows progress bar with 4 phases count", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>
    );
    expect(screen.getByText(/of 4 phases/)).toBeInTheDocument();
    expect(screen.getByText("Overall Progress")).toBeInTheDocument();
  });

  it("back link navigates to /rotate-keyset/review", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
  });
});

/* ==========================================================
   RotateWrongPasswordScreen
   ========================================================== */

describe("RotateWrongPasswordScreen", () => {
  it("renders Source Share Error heading and failed card", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Source Share Error" })).toBeInTheDocument();
    expect(screen.getByText("Source Share #2")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders red error banner and amber warning", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>
    );
    expect(screen.getByText(/Wrong password/)).toBeInTheDocument();
    expect(screen.getByText(/No encrypted backup found/)).toBeInTheDocument();
  });

  it("renders bfshare package text and masked password", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("bfshare1qvz8k2afcqqszq...")).toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
  });

  it("Retry button navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });
});

/* ==========================================================
   RotateGroupMismatchScreen
   ========================================================== */

describe("RotateGroupMismatchScreen", () => {
  it("renders Source Group Mismatch heading", () => {
    render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Source Group Mismatch" })).toBeInTheDocument();
    expect(screen.getByText("Sources belong to different groups")).toBeInTheDocument();
  });

  it("renders contrasting group keys (blue + red)", () => {
    render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("npub1qe3...7kkm")).toBeInTheDocument();
    expect(screen.getByText("npub1x7f...2mnp")).toBeInTheDocument();
    expect(screen.getByText("Share #1 Group")).toBeInTheDocument();
    expect(screen.getByText("Share #2 Group")).toBeInTheDocument();
  });

  it("Back to Source Intake navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back to Source Intake"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });
});

/* ==========================================================
   RotateGenerationFailedScreen
   ========================================================== */

describe("RotateGenerationFailedScreen", () => {
  it("renders Generation Failed heading and failed phase", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Generation Failed" })).toBeInTheDocument();
    expect(screen.getByText("Reconstruct signing key")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders completed phases with done states", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Decrypt sources")).toBeInTheDocument();
    expect(screen.getByText("Recover current profiles")).toBeInTheDocument();
    expect(screen.getByText("Verify same group config + group public key")).toBeInTheDocument();
  });

  it("renders green safety banner", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>
    );
    /* Text appears in both page copy and safety banner; verify at least the banner exists */
    const matches = screen.getAllByText(/No shares were modified/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    /* The safety banner has a distinct class */
    const banner = document.querySelector(".rotate-safety-banner");
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("Your current configuration is intact");
  });

  it("Retry Generation button navigates to /rotate-keyset/review", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Retry Generation"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });
});

/* ==========================================================
   RotateCreateProfileScreen (shared screen in rotate context)
   ========================================================== */

describe("RotateCreateProfileScreen", () => {
  it("renders Create Profile heading and stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Create Profile" })).toBeInTheDocument();
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders profile form fields", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>
    );
    /* "Profile Name" appears as both section header and input label — verify at least one */
    expect(screen.getAllByText("Profile Name").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Assigned Local Share")).toBeInTheDocument();
    /* "Profile Password" appears as section header */
    expect(screen.getAllByText("Profile Password").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Relays")).toBeInTheDocument();
    expect(screen.getByText("Peer Permissions")).toBeInTheDocument();
  });

  it("Continue button navigates to /rotate-keyset/distribute", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Continue to Distribute Shares"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/distribute");
  });

  it("back link navigates to /rotate-keyset/progress", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/progress");
  });
});

/* ==========================================================
   RotateDistributeSharesScreen (shared screen in rotate context)
   ========================================================== */

describe("RotateDistributeSharesScreen", () => {
  it("renders Distribute Shares heading and stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Distribute Shares" })).toBeInTheDocument();
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders local and remote share cards", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Saved to Igloo Web")).toBeInTheDocument();
    expect(screen.getByText("Share 2")).toBeInTheDocument();
    expect(screen.getByText("Share 3")).toBeInTheDocument();
  });

  it("Continue button navigates to /rotate-keyset/complete", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Continue to Completion"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/complete");
  });

  it("back link navigates to /rotate-keyset/profile", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/profile");
  });
});

/* ==========================================================
   RotateDistributionCompleteScreen (shared screen in rotate context)
   ========================================================== */

describe("RotateDistributionCompleteScreen", () => {
  it("renders Distribution Completion heading and stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Distribution Completion" })).toBeInTheDocument();
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders distribution status and completion list", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Distribution Status")).toBeInTheDocument();
    expect(screen.getByText("All packages distributed")).toBeInTheDocument();
  });

  it("Finish Distribution button navigates to /", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Finish Distribution"));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("back link navigates to /rotate-keyset/distribute", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/distribute");
  });
});
