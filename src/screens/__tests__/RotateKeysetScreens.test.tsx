import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
  RotateDistributionCompleteScreen,
} from "../RotateKeysetScreens";
import {
  formatMismatchGroup,
  generationFailurePhases,
  mismatchLabel,
  mismatchValue,
} from "../RotateKeysetScreen/ErrorScreens";

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  activeProfile: null as { id: string } | null,
  profiles: [] as Array<{
    id: string;
    label: string;
    deviceName: string;
    groupPublicKey: string;
    relays: string[];
    threshold: number;
    memberCount: number;
  }>,
  rotateKeysetSession: null as Record<string, unknown> | null,
  validateRotateKeysetSources: vi.fn().mockResolvedValue(undefined),
  generateRotatedKeyset: vi.fn().mockResolvedValue(undefined),
  createRotatedProfile: vi.fn().mockResolvedValue("test-profile-123"),
  encodeRotateDistributionPackage: vi.fn().mockResolvedValue(undefined),
  updateRotatePackageState: vi.fn(),
  markRotatePackageDistributed: vi.fn(),
  finishRotateDistribution: vi.fn().mockResolvedValue("test-profile-123"),
  getRotateSessionPackageSecret: vi.fn().mockReturnValue(null),
  clearRotateKeysetSession: vi.fn(),
  demoUi: {
    rotateKeyset: { passwordPreset: "rotate-pass" },
    progress: { frozen: true },
    shared: { completionPreset: true },
  } as Record<string, unknown>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: mocks.activeProfile,
    profiles: mocks.profiles,
    rotateKeysetSession: mocks.rotateKeysetSession,
    validateRotateKeysetSources: mocks.validateRotateKeysetSources,
    generateRotatedKeyset: mocks.generateRotatedKeyset,
    createRotatedProfile: mocks.createRotatedProfile,
    encodeRotateDistributionPackage: mocks.encodeRotateDistributionPackage,
    updateRotatePackageState: mocks.updateRotatePackageState,
    markRotatePackageDistributed: mocks.markRotatePackageDistributed,
    finishRotateDistribution: mocks.finishRotateDistribution,
    getRotateSessionPackageSecret: mocks.getRotateSessionPackageSecret,
    clearRotateKeysetSession: mocks.clearRotateKeysetSession,
  }),
}));

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => mocks.demoUi,
}));

function RouteStateProbe() {
  const location = useLocation();
  return (
    <output data-testid="route-state">{JSON.stringify(location.state)}</output>
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.activeProfile = null;
  mocks.profiles = [];
  mocks.rotateKeysetSession = null;
  mocks.validateRotateKeysetSources.mockClear();
  mocks.validateRotateKeysetSources.mockResolvedValue(undefined);
  mocks.generateRotatedKeyset.mockClear();
  mocks.generateRotatedKeyset.mockResolvedValue(undefined);
  mocks.createRotatedProfile.mockClear();
  mocks.createRotatedProfile.mockResolvedValue("test-profile-123");
  mocks.encodeRotateDistributionPackage.mockClear();
  mocks.encodeRotateDistributionPackage.mockResolvedValue(undefined);
  mocks.updateRotatePackageState.mockClear();
  mocks.markRotatePackageDistributed.mockClear();
  mocks.finishRotateDistribution.mockClear();
  mocks.finishRotateDistribution.mockResolvedValue("test-profile-123");
  mocks.getRotateSessionPackageSecret.mockClear();
  mocks.getRotateSessionPackageSecret.mockReturnValue(null);
  mocks.clearRotateKeysetSession.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
  mocks.demoUi = {
    rotateKeyset: { passwordPreset: "rotate-pass" },
    progress: { frozen: true },
    shared: { completionPreset: true },
  };
});

/* ==========================================================
   RotateKeysetFormScreen
   ========================================================== */

describe("RotateKeysetFormScreen", () => {
  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Rotate Keyset" }),
    ).toBeInTheDocument();
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
      </MemoryRouter>,
    );
    /* Step 1 of stepper should be "Rotate Keyset" */
    const stepperLabels = screen.getAllByText("Rotate Keyset");
    /* One from stepper, one from heading */
    expect(stepperLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("renders source share #1 as password-required until the saved profile decrypts", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Password required")).toBeInTheDocument();
    expect(screen.queryByText("Validated")).not.toBeInTheDocument();
    /* "My Signing Key" appears in both header-meta and source share card */
    expect(screen.getAllByText("My Signing Key").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      screen.getAllByText("Pending password").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByText("Belongs to current group"),
    ).not.toBeInTheDocument();
  });

  it("returns to Welcome with a safe notice when no saved profile id is available in product mode", () => {
    mocks.demoUi = {};
    render(
      <MemoryRouter initialEntries={["/rotate-keyset"]}>
        <Routes>
          <Route path="/" element={<div>Welcome fallback</div>} />
          <Route path="/rotate-keyset" element={<RotateKeysetFormScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(mocks.clearRotateKeysetSession).toHaveBeenCalled();
    expect(screen.getByText("Welcome fallback")).toBeInTheDocument();
  });

  it("reads location state profile and shows its keyset name", () => {
    const profile = {
      id: "prof_work",
      label: "Work Key",
      deviceName: "Work Laptop",
      groupPublicKey:
        "03b7d2e4f1a8c9054f6a2e83d7b1094c5e8f3a6d2b7e4c19085f6d3a2b8ea91e",
      relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
      threshold: 2,
      memberCount: 3,
    };
    mocks.profiles = [profile];
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/rotate-keyset", state: { profileId: "prof_work" } },
        ]}
      >
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    /* Source share card should show the passed profile name */
    expect(screen.getAllByText("Work Key").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Work Laptop")).toBeInTheDocument();
    expect(screen.getByText("prof_work")).toBeInTheDocument();
    expect(screen.getByText("2 configured")).toBeInTheDocument();
  });

  it("renders source share #2 with input areas", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByPlaceholderText(
        "Paste bfshare from another device or backup...",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Enter password to decrypt"),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting for input")).toBeInTheDocument();
  });

  it("renders info callout", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("All shares change, group key stays the same"),
    ).toBeInTheDocument();
  });

  it("back link navigates to /", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.clearRotateKeysetSession).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("Validate & Continue validates real source inputs and navigates to /rotate-keyset/review", async () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    fireEvent.change(
      screen.getByPlaceholderText("Enter saved profile password"),
      { target: { value: "profile-pass" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Paste bfshare from another device or backup...",
      ),
      { target: { value: "bfshare1abc123" } },
    );
    fireEvent.change(screen.getByPlaceholderText("Enter password to decrypt"), {
      target: { value: "share-pass" },
    });
    fireEvent.click(screen.getByText(/Validate & Continue/));
    await waitFor(() => {
      expect(mocks.validateRotateKeysetSources).toHaveBeenCalledWith({
        profileId: expect.stringMatching(/^prof_/),
        profilePassword: "profile-pass",
        sourcePackages: [
          { packageText: "bfshare1abc123", password: "share-pass" },
        ],
        threshold: 2,
        count: 3,
      });
      expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
    });
  });

  /* VAL-RTK-001: Validate & Continue CTA shows disabled visual when only 1 of
     2 required source shares are collected — bg-[#2563EB40] + aria-disabled. */
  it("Validate & Continue renders with disabled visual (aria-disabled + bg-[#2563EB40])", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>,
    );
    const button = screen.getByText(/Validate & Continue/).closest("button")!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.className).toContain("bg-[#2563EB40]");
  });
});

/* ==========================================================
   ReviewGenerateScreen
   ========================================================== */

describe("ReviewGenerateScreen", () => {
  it("guards product review without a validated rotate session", () => {
    mocks.demoUi = {};
    render(
      <MemoryRouter initialEntries={["/rotate-keyset/review"]}>
        <Routes>
          <Route
            path="/rotate-keyset"
            element={<div>Rotate intake fallback</div>}
          />
          <Route
            path="/rotate-keyset/review"
            element={<ReviewGenerateScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Rotate intake fallback")).toBeInTheDocument();
  });

  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Review & Generate")).toBeInTheDocument();
    expect(
      screen.getByText("Before generating fresh shares"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Distribution happens per share"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rotate & Generate Keyset/)).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label at step 1", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders amber warning callout", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Before generating fresh shares"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reconstruct the existing signing key/),
    ).toBeInTheDocument();
  });

  it("renders the per-share distribution note", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/You will create each remote bfonboard package/),
    ).toBeInTheDocument();
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  it("Rotate & Generate Keyset button navigates to /rotate-keyset/progress", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText(/Rotate & Generate Keyset/));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/progress");
  });

  /* VAL-RTK-002: destructive "Rotate & Generate Keyset" CTA is rendered on
     solid #DC2626 via the rotate-generate-btn class. */
  it("Rotate & Generate Keyset button is styled as the destructive #DC2626 variant", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>,
    );
    const button = screen
      .getByText(/Rotate & Generate Keyset/)
      .closest("button")!;
    expect(button.className).toContain("rotate-generate-btn");
    expect(button.className).toContain("button-full");
  });
});

/* ==========================================================
   RotateGenerationProgressScreen
   ========================================================== */

describe("RotateGenerationProgressScreen", () => {
  /* Product guard regression: review is the route that owns the selected saved
     profile context, so blocked redirects must carry profileId back with them. */
  it("preserves profile route state when product progress redirects back to review", async () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "sources_validated",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      sourceShares: [],
    };

    render(
      <MemoryRouter initialEntries={["/rotate-keyset/progress"]}>
        <Routes>
          <Route path="/rotate-keyset/review" element={<RouteStateProbe />} />
          <Route
            path="/rotate-keyset/progress"
            element={<RotateGenerationProgressScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("route-state")).toHaveTextContent(
        '"profileId":"prof_work"',
      );
    });
  });

  it("renders heading and 4-phase checklist", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Generation Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Process Source Shares")).toBeInTheDocument();
    expect(screen.getByText("Recover Existing Key")).toBeInTheDocument();
    expect(screen.getByText("Generate Fresh Shares")).toBeInTheDocument();
    expect(screen.getByText("Prepare Rotated Shares")).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label at step 1", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("shows progress bar with 4 phases count", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText(/of 4 phases/)).toBeInTheDocument();
    expect(screen.getByText("Overall Progress")).toBeInTheDocument();
  });

  it("back link navigates to /rotate-keyset/review", () => {
    render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
  });

  /* VAL-RTK-003: active phase uses outlined ring (.generation-phase-dot.active),
     not a plain solid dot. Pending phases use the thin outline variant. */
  it("renders outlined active-ring indicator on the active phase", () => {
    const { container } = render(
      <MemoryRouter>
        <RotateGenerationProgressScreen />
      </MemoryRouter>,
    );
    expect(
      container.querySelector(".generation-phase-dot.active"),
    ).toBeTruthy();
    expect(
      container.querySelector(".generation-phase-dot.pending"),
    ).toBeTruthy();
  });
});

/* ==========================================================
   RotateWrongPasswordScreen
   ========================================================== */

describe("RotateWrongPasswordScreen", () => {
  it("renders Source Package Error heading and failed card", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Source Package Error" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Source Share #2")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders red error banner and amber warning", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Wrong password/)).toBeInTheDocument();
    expect(screen.getByText(/No share data found/)).toBeInTheDocument();
  });

  it("renders bfshare package text and masked password", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("bfshare1qvz8k2afcqqszq...")).toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
  });

  it("Retry button navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateWrongPasswordScreen />
      </MemoryRouter>,
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
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Source Group Mismatch" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sources belong to different groups"),
    ).toBeInTheDocument();
  });

  it("renders contrasting group keys (blue + red)", () => {
    render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("npub1qe3...7kkm")).toBeInTheDocument();
    expect(screen.getByText("npub1x7f...2mnp")).toBeInTheDocument();
    expect(screen.getByText("Share #1 Group")).toBeInTheDocument();
    expect(screen.getByText("Share #2 Group")).toBeInTheDocument();
  });

  it("formats live mismatch details without relying on static paper placeholders", () => {
    expect(formatMismatchGroup("npub1livecurrentgroupabcdef123456")).toBe(
      "npub1livec...3456",
    );
    expect(mismatchLabel({ sourceIndex: 3, shareIndex: 8 })).toBe("Share #3");
    expect(mismatchValue({ shareIndex: 8 })).toBe("Index 8");
  });

  it("Back to Source Intake navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back to Source Intake"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  /* VAL-RTK-008: Group mismatch screen must NOT render a top BackLink — the
     only way out is the primary "Back to Source Intake" CTA. */
  it("does NOT render a top BackLink (audit gap)", () => {
    const { container } = render(
      <MemoryRouter>
        <RotateGroupMismatchScreen />
      </MemoryRouter>,
    );
    expect(container.querySelector(".back-link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
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
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Generation Failed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reconstruct signing key")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders completed phases with done states", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Decrypt sources")).toBeInTheDocument();
    expect(screen.getByText("Recover current profiles")).toBeInTheDocument();
    expect(
      screen.getByText("Verify same group config + group public key"),
    ).toBeInTheDocument();
  });

  it("derives generation failure phases from live failure details", () => {
    expect(
      generationFailurePhases("Verify same group config + group public key").at(
        -1,
      ),
    ).toEqual({
      label: "Verify same group config + group public key",
      state: "failed",
    });
    expect(generationFailurePhases("Unknown phase").at(-1)).toEqual({
      label: "Reconstruct signing key",
      state: "failed",
    });
  });

  it("renders green safety banner", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>,
    );
    /* Text appears in both page copy and safety banner; verify at least the banner exists */
    const matches = screen.getAllByText(/No shares were modified/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    /* The safety banner has a distinct class */
    const banner = document.querySelector(".rotate-safety-banner");
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain(
      "Your current configuration is intact",
    );
  });

  it("Retry Generation button navigates to /rotate-keyset/review", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Retry Generation"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <RotateGenerationFailedScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });
});

/* ==========================================================
   RotateCreateProfileScreen (shared screen in rotate context)
   ========================================================== */

describe("RotateCreateProfileScreen", () => {
  /* Same guard invariant as progress: a premature profile step should fall back
     to review without losing the source profile selected for rotation. */
  it("preserves profile route state when product profile setup redirects back to review", async () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "sources_validated",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      sourceShares: [],
    };

    render(
      <MemoryRouter initialEntries={["/rotate-keyset/profile"]}>
        <Routes>
          <Route path="/rotate-keyset/review" element={<RouteStateProbe />} />
          <Route
            path="/rotate-keyset/profile"
            element={<RotateCreateProfileScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("route-state")).toHaveTextContent(
        '"profileId":"prof_work"',
      );
    });
  });

  it("renders Create Profile heading and stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Create Profile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders profile form fields", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>,
    );
    /* "Profile Name" appears as both section header and input label — verify at least one */
    expect(screen.getAllByText("Profile Name").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("Assigned Local Share")).toBeInTheDocument();
    /* "Profile Password" appears as section header */
    expect(
      screen.getAllByText("Profile Password").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Relays")).toBeInTheDocument();
    expect(screen.getByText("Peer Permissions")).toBeInTheDocument();
  });

  it("Continue button navigates to /rotate-keyset/distribute", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Continue to Distribute Shares"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/distribute");
  });

  it("back link navigates to /rotate-keyset/progress", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/progress");
  });

  /* VAL-RTK-004: Relays section lists wss://relay.primal.net (neutral status)
     and wss://relay.example.com per Paper shared/2-create-profile. */
  it("renders Paper relays wss://relay.primal.net and wss://relay.example.com", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.example.com")).toBeInTheDocument();
    expect(screen.getByText("Status unavailable")).toBeInTheDocument();
  });

  /* VAL-RTK-004: Assigned Local Share panel surfaces Local Share / Keyset rows. */
  it("renders Assigned Local Share panel with Local Share and Keyset rows", () => {
    render(
      <MemoryRouter>
        <RotateCreateProfileScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Assigned Local Share")).toBeInTheDocument();
    expect(screen.getByText("Share #0, Encrypted")).toBeInTheDocument();
    expect(screen.getByText("Local Share")).toBeInTheDocument();
    expect(screen.getByText("Keyset")).toBeInTheDocument();
  });
});

/* ==========================================================
   RotateDistributeSharesScreen (shared screen in rotate context)
   ========================================================== */

describe("RotateDistributeSharesScreen", () => {
  it("guards product distribution until the rotated profile has been created", () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "rotated",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      createdProfileId: undefined,
      onboardingPackages: [],
    };
    render(
      <MemoryRouter initialEntries={["/rotate-keyset/distribute"]}>
        <Routes>
          <Route
            path="/rotate-keyset/profile"
            element={<div>Create profile fallback</div>}
          />
          <Route
            path="/rotate-keyset/distribute"
            element={<RotateDistributeSharesScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Create profile fallback")).toBeInTheDocument();
  });

  it("keeps product completion disabled until every remote package is distributed", () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "profile_created",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      localShare: { idx: 1 },
      createdProfileId: "prof_rotated",
      onboardingPackages: [
        {
          idx: 2,
          memberPubkey: "member",
          packageText: "bfonboard1abc",
          password: "[redacted]",
          packageCreated: true,
          peerOnline: false,
          manuallyMarkedDistributed: false,
          packageCopied: true,
          copied: true,
          passwordCopied: true,
          qrShown: false,
        },
      ],
    };
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "Continue to Completion" }),
    ).toBeDisabled();
  });

  it("renders Distribute Shares heading and stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Distribute Shares" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders local and remote share cards", () => {
    const { container } = render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Saved to Igloo Web")).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll(".package-title")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["Share 1", "Share 2", "Share 3"]);
    expect(
      Array.from(container.querySelectorAll(".package-index")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["Index 0", "Index 1", "Index 2"]);
    expect(screen.getByText("Share 1")).toBeInTheDocument();
    expect(screen.getByText("Share 2")).toBeInTheDocument();
    expect(screen.getByText("Share 3")).toBeInTheDocument();
  });

  it("Continue button navigates to /rotate-keyset/complete after demo handoff is accounted for", async () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    const continueButton = screen.getByRole("button", {
      name: "Continue to Completion",
    });
    expect(continueButton).toBeDisabled();

    const passwordInputs = screen.getAllByLabelText(/Package password for share/i);
    fireEvent.change(passwordInputs[0], { target: { value: "rotate-pass-1" } });
    for (const button of screen.getAllByRole("button", {
      name: /Create package/i,
    })) {
      fireEvent.click(button);
    }
    await waitFor(() =>
      expect(
        screen.queryByText("Package not created"),
      ).not.toBeInTheDocument(),
    );
    for (const button of screen.getAllByRole("button", {
      name: /Mark distributed/i,
    })) {
      fireEvent.click(button);
    }

    await waitFor(() => expect(continueButton).not.toBeDisabled());
    fireEvent.click(continueButton);
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/complete");
  });

  it("back link navigates to /rotate-keyset/profile", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/profile");
  });

  /* VAL-RTK-005: Subtitle mentions "fresh share" so the rotate adaptation
     preserves the rotation-aware language required by the contract. */
  it("subtitle mentions fresh share (rotation-aware language)", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText(/fresh share/)).toBeInTheDocument();
  });

  it("renders the Paper mixed state with share 2 pending and share 3 ready", () => {
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Package not created")).toHaveLength(1);
    expect(screen.getAllByText("Waiting for package password")).toHaveLength(1);
    expect(screen.getByText("Ready to distribute")).toBeInTheDocument();
    expect(screen.getByText(/bfonboard1d1qm9v4xp8cz/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Copy Package/i })[0],
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: /Copy Password/i })[0],
    ).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: /Copy Package/i })[1],
    ).toBeEnabled();
  });

  it("creates a rotate package per share through the new mutator", async () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "profile_created",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      localShare: { idx: 1 },
      createdProfileId: "prof_rotated",
      onboardingPackages: [
        {
          idx: 2,
          memberPubkey: "member",
          packageText: "",
          password: "",
          packageCreated: false,
          peerOnline: false,
          manuallyMarkedDistributed: false,
          packageCopied: false,
          copied: false,
          passwordCopied: false,
          qrShown: false,
        },
      ],
    };
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Package password for share 2"), {
      target: { value: "distribution-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create package/i }));
    await waitFor(() =>
      expect(mocks.encodeRotateDistributionPackage).toHaveBeenCalledWith(
        2,
        "distribution-password",
      ),
    );
  });

  it("marks a created rotate package distributed through the new mutator", () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "profile_created",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      localShare: { idx: 1 },
      createdProfileId: "prof_rotated",
      onboardingPackages: [
        {
          idx: 2,
          memberPubkey: "member",
          packageText: "bfonboard1preview",
          password: "[redacted]",
          packageCreated: true,
          peerOnline: false,
          manuallyMarkedDistributed: false,
          packageCopied: false,
          copied: false,
          passwordCopied: false,
          qrShown: false,
        },
      ],
    };
    render(
      <MemoryRouter>
        <RotateDistributeSharesScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mark distributed/i }));
    expect(mocks.markRotatePackageDistributed).toHaveBeenCalledWith(2);
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
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Distribution Completion" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders distribution status and completion list", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Distribution Status")).toBeInTheDocument();
    expect(screen.getByText("All remote packages complete")).toBeInTheDocument();
  });

  it("Finish Distribution button navigates to /dashboard/{profileId} when active profile exists", () => {
    mocks.activeProfile = { id: "test-profile-123" };
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Finish Distribution"));
    expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/test-profile-123");
  });

  it("Finish Distribution button navigates to / as fallback when no active profile", () => {
    mocks.activeProfile = null;
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Finish Distribution"));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("back link navigates to /rotate-keyset/distribute", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/distribute");
  });

  it("renders live member rows with shortHex labels and distributed statuses", () => {
    mocks.demoUi = {};
    mocks.rotateKeysetSession = {
      phase: "distribution_ready",
      sourceProfile: { id: "prof_work", label: "Work Key" },
      localShare: { idx: 0 },
      createdProfileId: "prof_rotated",
      onboardingPackages: [
        {
          idx: 1,
          memberPubkey:
            "03b7d2e4f1a8c9054f6a2e83d7b1094c5e8f3a6d2b7e4c19085f6d3a2b8ea91e",
          packageText: "bfonboard1preview",
          password: "[redacted]",
          packageCreated: true,
          peerOnline: false,
          manuallyMarkedDistributed: true,
          packageCopied: false,
          copied: false,
          passwordCopied: false,
          qrShown: false,
        },
        {
          idx: 2,
          memberPubkey:
            "02c4e8f9a1d3b5c7e9f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c3d7",
          packageText: "bfonboard1preview",
          password: "[redacted]",
          packageCreated: true,
          peerOnline: true,
          manuallyMarkedDistributed: false,
          packageCopied: false,
          copied: false,
          passwordCopied: false,
          qrShown: false,
        },
      ],
    };
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Member #2 — 03b7d2e4...a91e")).toBeInTheDocument();
    expect(screen.getByText("Member #3 — 02c4e8f9...c3d7")).toBeInTheDocument();
    expect(screen.getByText("Marked distributed")).toBeInTheDocument();
    expect(screen.getByText("Echo received")).toBeInTheDocument();
  });

  it("success callout body reads '2 of 2 remote bfonboard packages ...'", () => {
    render(
      <MemoryRouter>
        <RotateDistributionCompleteScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        /2 of 2 remote bfonboard packages are complete/,
      ),
    ).toBeInTheDocument();
  });
});
