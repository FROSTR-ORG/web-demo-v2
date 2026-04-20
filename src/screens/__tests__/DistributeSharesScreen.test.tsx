import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DistributeSharesScreen } from "../DistributeSharesScreen";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  updatePackageState: vi.fn(),
  createSession: null as {
    draft: { groupName: string };
    keyset: { group: { group_name: string } };
    localShare: { idx: number };
    createdProfileId: string;
    onboardingPackages: Array<{
      idx: number;
      memberPubkey: string;
      packageText: string;
      password: string;
      packageCopied: boolean;
      passwordCopied: boolean;
      qrShown: boolean;
      copied?: boolean;
    }>;
  } | null,
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

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    createSession: mocks.createSession,
    updatePackageState: mocks.updatePackageState,
  }),
}));

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => ({}),
}));

function makeCreateSession(accounted = false) {
  return {
    draft: { groupName: "My Signing Key" },
    keyset: { group: { group_name: "My Signing Key" } },
    localShare: { idx: 0 },
    createdProfileId: "profile-created",
    onboardingPackages: [
      {
        idx: 1,
        memberPubkey: "02" + "1".repeat(64),
        packageText: "bfonboard1remote",
        password: "remote-pass",
        packageCopied: accounted,
        passwordCopied: accounted,
        qrShown: false,
      },
    ],
  };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <DistributeSharesScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.updatePackageState.mockClear();
  mocks.createSession = makeCreateSession(false);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => cleanup());

describe("DistributeSharesScreen distribution accounting", () => {
  it("keeps Continue to Completion disabled until package handoff and password copy are accounted for", () => {
    renderScreen();
    expect(
      screen.getByRole("button", { name: "Continue to Completion" }),
    ).toBeDisabled();
  });

  it("enables Continue to Completion after every remote package and password is accounted for", () => {
    mocks.createSession = makeCreateSession(true);
    renderScreen();
    expect(
      screen.getByRole("button", { name: "Continue to Completion" }),
    ).not.toBeDisabled();
  });

  it("accounts package and password handoff only after clipboard copy succeeds", async () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: /Copy Package/ }));
    await waitFor(() =>
      expect(mocks.updatePackageState).toHaveBeenCalledWith(1, {
        packageCopied: true,
        copied: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Copy Password/ }));
    await waitFor(() =>
      expect(mocks.updatePackageState).toHaveBeenCalledWith(1, {
        passwordCopied: true,
      }),
    );
  });

  it("does not account package handoff when clipboard copy fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("denied"),
    );
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: /Copy Package/ }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    );
    expect(mocks.updatePackageState).not.toHaveBeenCalled();
  });
});
