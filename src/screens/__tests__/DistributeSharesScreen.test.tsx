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

/**
 * fix-followup-distribute-2b-screen-rewrites — DistributeSharesScreen
 * component tests. Coverage:
 *   - "How this step works" info panel copy (VAL-FOLLOWUP-011)
 *   - Per-share status-chip lifecycle PRE / POST / DISTRIBUTED
 *     (VAL-FOLLOWUP-004 / VAL-FOLLOWUP-008)
 *   - Create package click wiring + password validation
 *   - Mark distributed click wiring (VAL-FOLLOWUP-005)
 *   - LOCAL share (idx=0) renders only the "Saved to Igloo Web" badge
 *     — no password input, no Create package button (VAL-FOLLOWUP-008)
 *   - Action row DISABLED before packageCreated, ENABLED after
 *     (VAL-FOLLOWUP-008)
 */

interface TestOnboardingPackage {
  idx: number;
  memberPubkey: string;
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

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  updatePackageState: vi.fn(),
  encodeDistributionPackage: vi.fn(),
  markPackageDistributed: vi.fn(),
  createSession: null as {
    draft: { groupName: string };
    keyset: { group: { group_name: string } };
    localShare: { idx: number };
    createdProfileId: string;
    onboardingPackages: TestOnboardingPackage[];
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
    encodeDistributionPackage: mocks.encodeDistributionPackage,
    markPackageDistributed: mocks.markPackageDistributed,
    getCreateSessionPackageSecret: () => null,
  }),
}));

vi.mock("../../demo/demoUi", () => ({
  useDemoUi: () => ({}),
}));

function makeRemotePackage(
  idx: number,
  overrides: Partial<TestOnboardingPackage> = {},
): TestOnboardingPackage {
  return {
    idx,
    memberPubkey: "02" + String(idx).repeat(64).slice(0, 64),
    packageText: "",
    password: "",
    packageCreated: false,
    peerOnline: false,
    manuallyMarkedDistributed: false,
    packageCopied: false,
    passwordCopied: false,
    qrShown: false,
    ...overrides,
  };
}

function makeCreateSession(
  packages: TestOnboardingPackage[] = [makeRemotePackage(1), makeRemotePackage(2)],
) {
  return {
    draft: { groupName: "My Signing Key" },
    keyset: { group: { group_name: "My Signing Key" } },
    localShare: { idx: 0 },
    createdProfileId: "profile-created",
    onboardingPackages: packages,
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
  mocks.encodeDistributionPackage.mockReset();
  mocks.encodeDistributionPackage.mockResolvedValue(undefined);
  mocks.markPackageDistributed.mockReset();
  mocks.createSession = makeCreateSession();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => cleanup());

describe("DistributeSharesScreen — How this step works info panel (VAL-FOLLOWUP-011)", () => {
  it("renders page header copy per Paper 8GU-0", () => {
    renderScreen();
    expect(
      screen.getByText(
        "Create each remote bfonboard package by setting its password, then hand off the package and password by copy or QR.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the three numbered-step copy strings verbatim", () => {
    renderScreen();
    expect(screen.getByText("How this step works")).toBeInTheDocument();
    expect(screen.getByText("Set password")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Saving a password creates the bfonboard package for that device.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Distribute")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Copy package/password or show QR once the package exists.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Echo turns the row green, or mark distributed manually when handoff is done.",
      ),
    ).toBeInTheDocument();
  });
});

describe("DistributeSharesScreen — LOCAL share badge (VAL-FOLLOWUP-008)", () => {
  it("renders the 'Saved to Igloo Web' badge for the local share and no password input", () => {
    renderScreen();
    expect(screen.getByText("Saved to Igloo Web")).toBeInTheDocument();
    expect(screen.getByText("Saved securely in this browser")).toBeInTheDocument();
    // Only the two remote shares expose password inputs.
    expect(
      screen.getAllByLabelText(/Package password for share/i),
    ).toHaveLength(2);
    // None of the password inputs belongs to the local share (idx 0 -> "share 1"
    // would collide with "Share 1" label for the local share, so we assert the
    // remote shares 2/3 are present).
    expect(
      screen.getByLabelText("Package password for share 2"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Package password for share 3"),
    ).toBeInTheDocument();
  });
});

describe("DistributeSharesScreen — PRE-state rendering (VAL-FOLLOWUP-004)", () => {
  it("renders 'Package not created' chip + 'Waiting for package password' for each remote share", () => {
    renderScreen();
    expect(screen.getAllByText("Package not created")).toHaveLength(2);
    expect(
      screen.getAllByText("Waiting for package password"),
    ).toHaveLength(2);
    // Chip element carries the warning tone class.
    const warningChips = screen.getAllByText("Package not created");
    for (const chip of warningChips) {
      expect(chip.closest(".status-pill")).toHaveClass("warning");
    }
  });

  it("keeps the action row (Copy package / Copy password / QR / Mark distributed) DISABLED", () => {
    renderScreen();
    const copyPackageButtons = screen.getAllByRole("button", {
      name: /^Copy package$/i,
    });
    const copyPasswordButtons = screen.getAllByRole("button", {
      name: /^Copy password$/i,
    });
    const qrButtons = screen.getAllByRole("button", { name: /^QR$/i });
    const markDistributedButtons = screen.getAllByRole("button", {
      name: /^Mark distributed$/i,
    });
    [
      ...copyPackageButtons,
      ...copyPasswordButtons,
      ...qrButtons,
      ...markDistributedButtons,
    ].forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("keeps Continue to Completion disabled while any remote share has not yet been created", () => {
    renderScreen();
    expect(
      screen.getByRole("button", { name: "Continue to Completion" }),
    ).toBeDisabled();
  });
});

describe("DistributeSharesScreen — POST-state rendering (VAL-FOLLOWUP-008)", () => {
  beforeEach(() => {
    mocks.createSession = makeCreateSession([
      makeRemotePackage(1, {
        packageCreated: true,
        packageText: "bfonboard1abcdef01234567",
        password: "[redacted]",
      }),
      makeRemotePackage(2, {
        packageCreated: true,
        packageText: "bfonboard1xyzpdq7777",
        password: "[redacted]",
      }),
    ]);
  });

  it("renders the 'Ready to distribute' info-tone chip and the bfonboard1… preview", () => {
    renderScreen();
    const chips = screen.getAllByText("Ready to distribute");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.closest(".status-pill")).toHaveClass("info");
    }
    expect(screen.getByText("bfonboard1abcdef01234567…")).toBeInTheDocument();
    expect(screen.getAllByText("••••••••").length).toBeGreaterThanOrEqual(2);
  });

  it("ENABLES the Copy package / Copy password / QR / Mark distributed action row", () => {
    renderScreen();
    const copyPackageButtons = screen.getAllByRole("button", {
      name: /^Copy package$/i,
    });
    const copyPasswordButtons = screen.getAllByRole("button", {
      name: /^Copy password$/i,
    });
    const qrButtons = screen.getAllByRole("button", { name: /^QR$/i });
    const markDistributedButtons = screen.getAllByRole("button", {
      name: /^Mark distributed$/i,
    });
    [
      ...copyPackageButtons,
      ...copyPasswordButtons,
      ...qrButtons,
      ...markDistributedButtons,
    ].forEach((btn) => {
      expect(btn).not.toBeDisabled();
    });
  });

  it("enables Continue to Completion once every remote share has been created", () => {
    renderScreen();
    expect(
      screen.getByRole("button", { name: "Continue to Completion" }),
    ).not.toBeDisabled();
  });
});

describe("DistributeSharesScreen — DISTRIBUTED state (VAL-FOLLOWUP-004)", () => {
  it("renders the 'Distributed' success-tone chip when peerOnline is true", () => {
    mocks.createSession = makeCreateSession([
      makeRemotePackage(1, {
        packageCreated: true,
        packageText: "bfonboard1onlineonline00",
        password: "[redacted]",
        peerOnline: true,
      }),
    ]);
    renderScreen();
    const chip = screen.getByText("Distributed");
    expect(chip.closest(".status-pill")).toHaveClass("success");
  });

  it("renders the 'Distributed' success-tone chip when manuallyMarkedDistributed is true", () => {
    mocks.createSession = makeCreateSession([
      makeRemotePackage(1, {
        packageCreated: true,
        packageText: "bfonboard1manual000000000",
        password: "[redacted]",
        manuallyMarkedDistributed: true,
      }),
    ]);
    renderScreen();
    const chip = screen.getByText("Distributed");
    expect(chip.closest(".status-pill")).toHaveClass("success");
  });
});

describe("DistributeSharesScreen — Create package click wiring", () => {
  it("rejects password.length < 8 with an inline error and does NOT invoke encodeDistributionPackage", async () => {
    renderScreen();
    const input = screen.getByLabelText("Package password for share 2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "short" } });
    const createButton = screen
      .getAllByRole("button", { name: /Create package/i })[0];
    fireEvent.click(createButton);
    await waitFor(() => {
      expect(
        screen.getByText("Package password must be at least 8 characters."),
      ).toBeInTheDocument();
    });
    expect(mocks.encodeDistributionPackage).not.toHaveBeenCalled();
  });

  it("invokes encodeDistributionPackage(idx, password) on valid submit", async () => {
    renderScreen();
    const input = screen.getByLabelText("Package password for share 2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "verysecretpw" } });
    const createButton = screen
      .getAllByRole("button", { name: /Create package/i })[0];
    fireEvent.click(createButton);
    await waitFor(() => {
      expect(mocks.encodeDistributionPackage).toHaveBeenCalledWith(
        1,
        "verysecretpw",
      );
    });
  });
});

describe("DistributeSharesScreen — Mark distributed click wiring (VAL-FOLLOWUP-005)", () => {
  it("calls markPackageDistributed(idx) with the correct share index", () => {
    mocks.createSession = makeCreateSession([
      makeRemotePackage(1, {
        packageCreated: true,
        packageText: "bfonboard1readytodistribute00",
        password: "[redacted]",
      }),
    ]);
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /^Mark distributed$/i }));
    expect(mocks.markPackageDistributed).toHaveBeenCalledWith(1);
  });
});

describe("DistributeSharesScreen — Copy package / Copy password wiring (existing contract)", () => {
  beforeEach(() => {
    mocks.createSession = makeCreateSession([
      makeRemotePackage(1, {
        packageCreated: true,
        packageText: "bfonboard1abcd",
        password: "[redacted]",
      }),
    ]);
  });

  it("accounts package handoff only after Copy package is clicked", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /^Copy package$/i }));
    await waitFor(() =>
      expect(mocks.updatePackageState).toHaveBeenCalledWith(1, {
        packageCopied: true,
        copied: true,
      }),
    );
  });

  it("accounts password handoff after Copy password is clicked", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /^Copy password$/i }));
    await waitFor(() =>
      expect(mocks.updatePackageState).toHaveBeenCalledWith(1, {
        passwordCopied: true,
      }),
    );
  });
});
