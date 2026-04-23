import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DistributionCompleteScreen } from "../DistributionCompleteScreen";
import { DEMO_PROFILE_ID } from "../../demo/fixtures";

interface TestOnboardingPackage {
  idx: number;
  memberPubkey: string;
  deviceLabel?: string;
  packageText: string;
  password: string;
  packageCreated: boolean;
  peerOnline: boolean;
  manuallyMarkedDistributed: boolean;
  packageCopied: boolean;
  passwordCopied: boolean;
  qrShown: boolean;
  copied?: boolean;
}

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  finishDistribution: vi.fn().mockResolvedValue("demo-profile"),
  clearCreateSession: vi.fn(),
  markPackageDistributed: vi.fn(),
  createSession: null as {
    draft: { groupName: string; threshold: number; count: number };
    createdProfileId?: string;
    onboardingPackages: TestOnboardingPackage[];
  } | null,
  demoUi: {} as Record<string, unknown>,
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("../../app/AppState", async () => {
  const actual =
    await vi.importActual<typeof import("../../app/AppState")>(
      "../../app/AppState",
    );
  return {
    ...actual,
    useAppState: () => ({
      createSession: mocks.createSession,
      finishDistribution: mocks.finishDistribution,
      clearCreateSession: mocks.clearCreateSession,
      markPackageDistributed: mocks.markPackageDistributed,
    }),
  };
});

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => mocks.demoUi,
}));

function makeRemotePackage(
  idx: number,
  overrides: Partial<TestOnboardingPackage> = {},
): TestOnboardingPackage {
  return {
    idx,
    memberPubkey:
      "02" +
      (String(idx) +
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567").slice(0, 64),
    packageText: "bfonboard1" + "x".repeat(12),
    password: "[redacted]",
    packageCreated: true,
    peerOnline: false,
    manuallyMarkedDistributed: false,
    packageCopied: false,
    passwordCopied: false,
    qrShown: false,
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/create/complete"]}>
      <Routes>
        <Route
          path="/create/complete"
          element={<DistributionCompleteScreen />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.finishDistribution.mockReset();
  mocks.finishDistribution.mockResolvedValue(DEMO_PROFILE_ID);
  mocks.clearCreateSession.mockClear();
  mocks.markPackageDistributed.mockReset();
  mocks.createSession = {
    draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
    createdProfileId: DEMO_PROFILE_ID,
    onboardingPackages: [
      makeRemotePackage(1, { manuallyMarkedDistributed: true }),
      makeRemotePackage(2, { manuallyMarkedDistributed: true }),
    ],
  };
  mocks.demoUi = {};
});

afterEach(() => cleanup());

describe("DistributionCompleteScreen — Paper LN7-0 parity (VAL-FOLLOWUP-012)", () => {
  it("renders the 'Distribution Completion' header", () => {
    renderScreen();
    expect(
      screen.getByRole("heading", { name: "Distribution Completion" }),
    ).toBeInTheDocument();
  });

  it("renders the subhead copy EXACT per Paper LN7-0", () => {
    renderScreen();
    expect(
      screen.getByText(
        "Track which remote bfonboard adoption packages have been distributed. Finish when each target device is ready to adopt its fresh share through the standard onboarding flow.",
      ),
    ).toBeInTheDocument();
  });

  it("renders one row per remote member with a 'Marked distributed' green chip when distributed", () => {
    renderScreen();
    const chips = screen.getAllByText("Marked distributed");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.closest(".status-pill")).toHaveClass("success");
    }
  });

  it("prefers deviceLabel over shortHex(memberPubkey) and falls back when blank", () => {
    mocks.createSession = {
      draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
      createdProfileId: DEMO_PROFILE_ID,
      onboardingPackages: [
        makeRemotePackage(1, {
          deviceLabel: "Igloo Mobile",
          manuallyMarkedDistributed: true,
        }),
        makeRemotePackage(2, {
          deviceLabel: "   ",
          manuallyMarkedDistributed: true,
        }),
      ],
    };

    renderScreen();

    expect(
      screen.getByText("Member #2 — Igloo Mobile"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Member #3 — 022abcde\.\.\.4567/i),
    ).toBeInTheDocument();
  });

  it("renders the success callout EXACT when allPackagesDistributed", () => {
    renderScreen();
    const callout = screen
      .getByText(/All packages distributed/)
      .closest(".success-callout");
    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain(
      "All packages distributed — 2 of 2 remote bfonboard packages have been marked distributed. Continue when device adoption handoff can proceed.",
    );
  });

  it("ENABLES the Finish Distribution CTA iff allPackagesDistributed", () => {
    renderScreen();
    expect(
      screen.getByRole("button", { name: /Finish Distribution/ }),
    ).not.toBeDisabled();
  });

  it("DISABLES the Finish Distribution CTA when any share is still 'Ready to distribute'", () => {
    mocks.createSession = {
      draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
      createdProfileId: DEMO_PROFILE_ID,
      onboardingPackages: [
        makeRemotePackage(1, { manuallyMarkedDistributed: true }),
        makeRemotePackage(2), // not distributed
      ],
    };
    renderScreen();
    expect(
      screen.getByRole("button", { name: /Finish Distribution/ }),
    ).toBeDisabled();
    // Success callout should not render while a share is still pending.
    expect(
      screen.queryByText(/All packages distributed/),
    ).not.toBeInTheDocument();
  });

  it("exposes a Mark distributed fallback on pending rows (VAL-FOLLOWUP-005)", () => {
    mocks.createSession = {
      draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
      createdProfileId: DEMO_PROFILE_ID,
      onboardingPackages: [
        makeRemotePackage(1), // pending
        makeRemotePackage(2, { manuallyMarkedDistributed: true }),
      ],
    };
    renderScreen();
    const pendingMark = screen.getByRole("button", {
      name: /^Mark distributed$/i,
    });
    fireEvent.click(pendingMark);
    expect(mocks.markPackageDistributed).toHaveBeenCalledWith(1);
  });
});

describe("DistributionCompleteScreen finish handler — VAL-SHR-011", () => {
  it("navigates to /dashboard/{profileId} returned from finishDistribution", async () => {
    renderScreen();
    fireEvent.click(
      screen.getByRole("button", { name: /Finish Distribution/ }),
    );
    await waitFor(() => {
      expect(mocks.finishDistribution).toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith(
        `/dashboard/${DEMO_PROFILE_ID}`,
      );
      expect(mocks.clearCreateSession).toHaveBeenCalled();
    });
  });

  it("prevents a second finish run while the dashboard handoff is in flight", async () => {
    let resolveFinish!: (value: string) => void;
    mocks.finishDistribution.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveFinish = resolve;
      }),
    );
    renderScreen();

    const finishButton = screen.getByRole("button", {
      name: /Finish Distribution/,
    });
    fireEvent.click(finishButton);
    fireEvent.click(finishButton);

    expect(mocks.finishDistribution).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(finishButton).toBeDisabled());

    await act(async () => {
      resolveFinish(DEMO_PROFILE_ID);
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        `/dashboard/${DEMO_PROFILE_ID}`,
      );
      expect(mocks.clearCreateSession).toHaveBeenCalled();
    });
  });

  it("falls back to createSession.createdProfileId when finishDistribution returns an empty value", async () => {
    mocks.finishDistribution.mockResolvedValue("" as unknown as string);
    renderScreen();
    fireEvent.click(
      screen.getByRole("button", { name: /Finish Distribution/ }),
    );
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        `/dashboard/${DEMO_PROFILE_ID}`,
      );
      expect(mocks.clearCreateSession).toHaveBeenCalled();
    });
  });

  it("still navigates to /dashboard/{fallbackId} when finishDistribution throws", async () => {
    mocks.finishDistribution.mockRejectedValue(new Error("boom"));
    renderScreen();
    fireEvent.click(
      screen.getByRole("button", { name: /Finish Distribution/ }),
    );
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        `/dashboard/${DEMO_PROFILE_ID}`,
      );
      expect(mocks.clearCreateSession).toHaveBeenCalled();
    });
  });

  it("does not navigate to /dashboard/ (bare) when no profile id is available", async () => {
    mocks.createSession = null;
    renderScreen();
    // With no createSession the screen redirects to "/" via <Navigate/>, so the
    // Finish Distribution button is not rendered. Ensure no stray navigation
    // to `/dashboard/` occurs in that edge-case.
    expect(
      screen.queryByRole("button", { name: /Finish Distribution/ }),
    ).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/dashboard/");
  });
});
