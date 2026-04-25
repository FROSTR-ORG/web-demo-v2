import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LoadBackupScreen,
  DecryptBackupScreen,
  ReviewSaveScreen,
  ImportErrorScreen,
} from "../ImportScreens";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locationState: null as Record<string, unknown> | null,
  reloadProfiles: vi.fn().mockResolvedValue(undefined),
  mockSaveProfile: vi.fn().mockResolvedValue(undefined),
  createKeyset: vi.fn().mockResolvedValue(undefined),
  createProfile: vi.fn().mockResolvedValue("profile-abc123"),
  beginImport: vi.fn(),
  decryptImportBackup: vi.fn().mockResolvedValue(undefined),
  saveImportedProfile: vi.fn().mockResolvedValue("profile-abc123"),
  clearImportSession: vi.fn(),
  importSession: null as {
    backupString: string;
    localShareIdx?: number;
    payload?: {
      profile_id: string;
      version: number;
      device: {
        name: string;
        share_secret: string;
        manual_peer_policy_overrides: unknown[];
        relays: string[];
      };
      group_package: {
        group_name: string;
        group_pk: string;
        threshold: number;
        members: { idx: number; pubkey: string }[];
      };
    };
    conflictProfile?: {
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
    };
  } | null,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({
      pathname: "/import",
      search: "",
      hash: "",
      state: mocks.locationState,
      key: "default",
    }),
  };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    reloadProfiles: mocks.reloadProfiles,
    createKeyset: mocks.createKeyset,
    createProfile: mocks.createProfile,
    beginImport: mocks.beginImport,
    decryptImportBackup: mocks.decryptImportBackup,
    saveImportedProfile: mocks.saveImportedProfile,
    clearImportSession: mocks.clearImportSession,
    importSession: mocks.importSession,
  }),
}));

vi.mock("../../lib/storage/profileStore", () => ({
  saveProfile: mocks.mockSaveProfile,
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.createKeyset.mockClear();
  mocks.createProfile.mockClear();
  mocks.createProfile.mockResolvedValue("profile-abc123");
  mocks.beginImport.mockClear();
  mocks.decryptImportBackup.mockClear();
  mocks.decryptImportBackup.mockResolvedValue(undefined);
  mocks.saveImportedProfile.mockClear();
  mocks.saveImportedProfile.mockResolvedValue("profile-abc123");
  mocks.clearImportSession.mockClear();
  mocks.mockSaveProfile.mockClear();
  mocks.locationState = null;
  mocks.importSession = null;
});

function makeImportSession() {
  return {
    backupString: "bfprofile1test",
    localShareIdx: 1,
    payload: {
      profile_id: "profile-imported",
      version: 1,
      device: {
        name: "Igloo Web",
        share_secret: "1".repeat(64),
        manual_peer_policy_overrides: [],
        relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
      },
      group_package: {
        group_name: "My Signing Key",
        group_pk: "2".repeat(64),
        threshold: 2,
        members: [
          { idx: 1, pubkey: "02" + "1".repeat(64) },
          { idx: 2, pubkey: "02" + "2".repeat(64) },
          { idx: 3, pubkey: "02" + "3".repeat(64) },
        ],
      },
    },
  };
}

describe("LoadBackupScreen", () => {
  it("renders heading, backup input, upload button, and continue button", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Load Backup")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bfprofile1...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Upload Backup File/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Continue/i }),
    ).toBeInTheDocument();
    /* VAL-IMP-001: Load Backup uses 'Back to Welcome' label (not default 'Back'). */
    expect(
      screen.getByRole("button", { name: "Back to Welcome" }),
    ).toBeInTheDocument();
  });

  it("Continue CTA is disabled until a valid bfprofile1 backup is entered (VAL-IMP-001)", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>,
    );
    const continueBtn = screen.getByRole("button", { name: /Continue/i });
    expect(continueBtn).toBeDisabled();
    expect(continueBtn).toHaveAttribute("aria-disabled", "true");
    const textarea = screen.getByPlaceholderText("bfprofile1...");
    fireEvent.change(textarea, { target: { value: "bfprofile1abc123" } });
    expect(continueBtn).not.toBeDisabled();
  });

  it("shows validation feedback for valid bfprofile1 input (VAL-IMP-001 canonical copy)", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>,
    );
    const textarea = screen.getByPlaceholderText("bfprofile1...");
    fireEvent.change(textarea, { target: { value: "bfprofile1abc123" } });
    const validator = screen.getByText(/Valid backup/);
    expect(validator.textContent).toBe(
      "Valid backup format — decrypt to review profile details",
    );
    expect(validator.textContent).not.toContain("2 of 3");
    expect(validator.textContent).not.toContain("(Index 1)");
    expect(validator.textContent).not.toContain("Share #");
    expect(validator.textContent).not.toContain("· Created");
  });

  it("shows error feedback for invalid input", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>,
    );
    const textarea = screen.getByPlaceholderText("bfprofile1...");
    fireEvent.change(textarea, { target: { value: "invalid-string" } });
    expect(screen.getByText(/Invalid backup/)).toBeInTheDocument();
  });

  it("renders a 'Scan QR' button that opens the QR scanner dialog (VAL-BACKUP-016)", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>,
    );
    const scanBtn = screen.getByRole("button", { name: /Scan QR/i });
    expect(scanBtn).toBeInTheDocument();
    fireEvent.click(scanBtn);
    expect(screen.getByRole("dialog", { name: /QR Scanner/i })).toBeInTheDocument();
  });

  it("keeps the Paper preset state display-only: decoded copy, no QR scanner affordance", () => {
    mocks.locationState = {
      demoUi: { import: { backupPreset: "bfprofile1paperpreset" } },
    };
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText("bfprofile1...")).toHaveValue(
      "bfprofile1paperpreset",
    );
    expect(
      screen.getByText("Valid backup — Group: My Signing Key (2/3) · Share #1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Scan QR/i }),
    ).not.toBeInTheDocument();
  });
});

describe("DecryptBackupScreen", () => {
  it("renders heading, backup display, password input, and decrypt button", () => {
    mocks.locationState = { backupString: "bfprofile1qvz8k2afcqqszq2v5v5hn" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Decrypt Backup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/bfprofile1qvz8k2afcqqszq2v5v5hn/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Backup Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Decrypt Backup/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("shows prefix-only decrypt-validator copy without fake metadata (VAL-IMP-002)", () => {
    mocks.locationState = { backupString: "bfprofile1qvz8k2afcqqszq2v5v5hn" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>,
    );
    const validator = screen.getByText(/Valid backup/);
    expect(validator.textContent).toBe(
      "Valid backup format — decrypt to review profile details",
    );
    expect(validator.textContent).not.toContain("2 of 3");
    expect(validator.textContent).not.toContain("(Index 1)");
    expect(validator.textContent).not.toContain("Share #");
    expect(validator.textContent).not.toContain("Created Mar 8, 2026");
  });

  it("Decrypt CTA is disabled until the password field has input (VAL-IMP-002)", () => {
    mocks.locationState = { backupString: "bfprofile1qvz8k2afcqqszq2v5v5hn" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>,
    );
    const decryptBtn = screen.getByRole("button", { name: /Decrypt Backup/i });
    expect(decryptBtn).toBeDisabled();
    expect(decryptBtn).toHaveAttribute("aria-disabled", "true");
    const passwordInput = screen.getByLabelText("Backup Password");
    fireEvent.change(passwordInput, { target: { value: "hunter2" } });
    expect(decryptBtn).not.toBeDisabled();
  });

  it("redirects to /import when accessed without backup state (guard redirect)", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>,
    );
    /* When no backup state, the component renders nothing (Navigate redirects) */
    expect(container.textContent).toBe("");
  });

  it("navigates to error with backup context when password is wrong", async () => {
    mocks.importSession = { backupString: "bfprofile1abc123" };
    mocks.decryptImportBackup.mockRejectedValueOnce(
      new Error("Incorrect password"),
    );
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>,
    );
    const passwordInput = screen.getByLabelText("Backup Password");
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Decrypt Backup/i }));
    await waitFor(() =>
      expect(mocks.decryptImportBackup).toHaveBeenCalledWith(
        "bfprofile1abc123",
        "wrong",
      ),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/import/error", {
        state: { backupString: "bfprofile1abc123", errorCode: undefined },
      }),
    );
  });
});

describe("ReviewSaveScreen", () => {
  it("renders heading, Group/Device Profile cards, password fields, and save button", () => {
    mocks.importSession = makeImportSession();
    mocks.locationState = { backupString: "bfprofile1test" };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Review & Save Profile")).toBeInTheDocument();
    expect(screen.getByText("Group Profile")).toBeInTheDocument();
    expect(screen.getByText("Device Profile")).toBeInTheDocument();
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import & Launch Signer/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("renders a help icon next to the Profile Password header (VAL-IMP-003 audit gap)", () => {
    mocks.importSession = makeImportSession();
    mocks.locationState = { backupString: "bfprofile1test" };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>,
    );
    const titleRow = screen.getByText("Profile Password").parentElement;
    expect(titleRow).toHaveClass("import-label-row");
    expect(titleRow?.querySelector(".import-label-help-icon")).toBeTruthy();
  });

  it("Import & Launch Signer saves the decoded profile and navigates to /dashboard/{profileId} (VAL-CROSS-006)", async () => {
    mocks.importSession = makeImportSession();
    mocks.locationState = {
      backupString: "bfprofile1test",
      demoUi: { import: { profilePasswordPreset: "hunter1234" } },
    };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Import & Launch Signer/i }),
    );
    await waitFor(() => expect(mocks.saveImportedProfile).toHaveBeenCalled());
    const profileArg = mocks.saveImportedProfile.mock.calls[0][0] as {
      password: string;
      confirmPassword: string;
    };
    expect(profileArg.password).toBe("hunter1234");
    expect(profileArg.confirmPassword).toBe("hunter1234");
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    const target = mocks.navigate.mock.calls.at(-1)?.[0] as string;
    expect(target).toBe("/dashboard/profile-abc123");
  });

  it("requires explicit replace confirmation when the imported profile already exists", () => {
    mocks.importSession = {
      ...makeImportSession(),
      conflictProfile: {
        id: "profile-imported",
        label: "Existing Signing Key",
        deviceName: "Igloo Web",
        groupName: "My Signing Key",
        threshold: 2,
        memberCount: 3,
        localShareIdx: 1,
        groupPublicKey: "2".repeat(64),
        relays: ["wss://relay.primal.net"],
        createdAt: 1,
        lastUsedAt: 1,
      },
    };
    mocks.locationState = {
      backupString: "bfprofile1test",
      demoUi: { import: { profilePasswordPreset: "hunter1234" } },
    };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>,
    );
    const save = screen.getByRole("button", {
      name: /Import & Launch Signer/i,
    });
    expect(screen.getByText("Existing profile found")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Replace Existing Signing Key/i));
    expect(save).not.toBeDisabled();
  });

  it("redirects to /import when accessed without backup state (guard redirect)", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>,
    );
    /* When no state, the component renders nothing (Navigate redirects) */
    expect(container.textContent).toBe("");
  });

  it("redirects to /import when accessed with only safe retry state but no decoded payload", () => {
    mocks.locationState = { backupString: "bfprofile1test" };
    const { container } = render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("ImportErrorScreen", () => {
  it("renders amber wrong-password variant with primary Try Again + ghost Back to Import (VAL-IMP-004)", () => {
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Import Error")).toBeInTheDocument();
    expect(screen.getByText("Incorrect Password")).toBeInTheDocument();
    const tryAgain = screen.getByRole("button", { name: /Try Again/i });
    const backToImport = screen.getByRole("button", {
      name: /Back to Import/i,
    });
    expect(tryAgain).toBeInTheDocument();
    expect(backToImport).toBeInTheDocument();
    /* Amber variant: Try Again is primary, Back to Import is secondary/ghost. */
    expect(tryAgain).toHaveClass("button-primary");
    expect(backToImport).toHaveClass("button-ghost");
    expect(screen.getByText("Back")).toBeInTheDocument();

    const alert = screen
      .getByText("Incorrect Password")
      .closest(".import-error-alert");
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain("bg-[#EAB3081A]");
    expect(alert?.className).toContain("border-[#EAB30840]");
    expect(alert?.className).not.toContain("red");
  });

  it("renders red corrupted variant with a single primary Back to Import CTA (VAL-IMP-005)", () => {
    mocks.locationState = { demoUi: { import: { errorVariant: "corrupted" } } };
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Backup Corrupted")).toBeInTheDocument();
    expect(screen.getByText(/could not be parsed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try Again/i })).toBeNull();
    const backToImport = screen.getByRole("button", {
      name: /Back to Import/i,
    });
    expect(backToImport).toBeInTheDocument();
    /*
     * VAL-IMP-005 requires the single CTA to render as the solid-blue
     * primary button (`button-primary`), not a secondary/ghost.
     */
    expect(backToImport).toHaveClass("button-primary");
    expect(backToImport).not.toHaveClass("button-ghost");

    const alert = screen
      .getByText("Backup Corrupted")
      .closest(".import-error-alert");
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain("red");
    expect(alert?.className).toContain("bg-[#EF44441A]");
    expect(alert?.className).toContain("border-[#EF444440]");
  });

  it("Try Again button navigates to decrypt screen with backup context (VAL-IMP-006)", () => {
    mocks.locationState = { backupString: "bfprofile1abc123" };
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import/decrypt", {
      state: { backupString: "bfprofile1abc123" },
    });
  });

  it("Back to Import button navigates to load backup screen (VAL-IMP-006)", () => {
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to Import/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import");
  });
});
