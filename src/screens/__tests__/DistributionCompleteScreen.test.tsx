import {
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

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  finishDistribution: vi.fn().mockResolvedValue("demo-profile"),
  clearCreateSession: vi.fn(),
  createSession: null as {
    draft: { groupName: string; threshold: number; count: number };
    createdProfileId?: string;
    onboardingPackages: { idx: number; copied: boolean; qrShown: boolean }[];
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
    }),
  };
});

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => mocks.demoUi,
}));

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
  mocks.createSession = {
    draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
    createdProfileId: DEMO_PROFILE_ID,
    onboardingPackages: [
      { idx: 1, copied: true, qrShown: false },
      { idx: 2, copied: false, qrShown: true },
    ],
  };
  mocks.demoUi = { shared: { completionPreset: true } };
});

afterEach(() => cleanup());

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
