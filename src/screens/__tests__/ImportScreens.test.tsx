import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LoadBackupScreen,
  DecryptBackupScreen,
  ReviewSaveScreen,
  ImportErrorScreen
} from "../ImportScreens";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locationState: null as Record<string, unknown> | null,
  reloadProfiles: vi.fn().mockResolvedValue(undefined),
  mockSaveProfile: vi.fn().mockResolvedValue(undefined),
  createKeyset: vi.fn().mockResolvedValue(undefined),
  createProfile: vi.fn().mockResolvedValue("profile-abc123")
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
      key: "default"
    })
  };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    reloadProfiles: mocks.reloadProfiles,
    createKeyset: mocks.createKeyset,
    createProfile: mocks.createProfile
  })
}));

vi.mock("../../lib/storage/profileStore", () => ({
  saveProfile: mocks.mockSaveProfile
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.createKeyset.mockClear();
  mocks.createProfile.mockClear();
  mocks.createProfile.mockResolvedValue("profile-abc123");
  mocks.mockSaveProfile.mockClear();
  mocks.locationState = null;
});

describe("LoadBackupScreen", () => {
  it("renders heading, backup input, upload button, and continue button", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Load Backup")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bfprofile1...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload Backup File/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("Continue CTA is disabled until a valid bfprofile1 backup is entered (VAL-IMP-001)", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>
    );
    const continueBtn = screen.getByRole("button", { name: /Continue/i });
    expect(continueBtn).toBeDisabled();
    expect(continueBtn).toHaveAttribute("aria-disabled", "true");
    const textarea = screen.getByPlaceholderText("bfprofile1...");
    fireEvent.change(textarea, { target: { value: "bfprofile1abc123" } });
    expect(continueBtn).not.toBeDisabled();
  });

  it("shows validation feedback for valid bfprofile1 input", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfprofile1...");
    fireEvent.change(textarea, { target: { value: "bfprofile1abc123" } });
    expect(screen.getByText(/Valid backup/)).toBeInTheDocument();
  });

  it("shows error feedback for invalid input", () => {
    render(
      <MemoryRouter>
        <LoadBackupScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfprofile1...");
    fireEvent.change(textarea, { target: { value: "invalid-string" } });
    expect(screen.getByText(/Invalid backup/)).toBeInTheDocument();
  });
});

describe("DecryptBackupScreen", () => {
  it("renders heading, backup display, password input, and decrypt button", () => {
    mocks.locationState = { backupString: "bfprofile1qvz8k2afcqqszq2v5v5hn" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Decrypt Backup" })).toBeInTheDocument();
    expect(screen.getByText(/bfprofile1qvz8k2afcqqszq2v5v5hn/)).toBeInTheDocument();
    expect(screen.getByLabelText("Backup Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Decrypt Backup/i })).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("shows 'Created Mar 8, 2026' suffix in the backup validator (VAL-IMP-002)", () => {
    mocks.locationState = { backupString: "bfprofile1qvz8k2afcqqszq2v5v5hn" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>
    );
    const validator = screen.getByText(/Valid backup/);
    expect(validator.textContent).toContain("· Created Mar 8, 2026");
    expect(validator.textContent).toContain("My Signing Key (2 of 3)");
    expect(validator.textContent).toContain("Share #1 (Index 1)");
  });

  it("Decrypt CTA is disabled until the password field has input (VAL-IMP-002)", () => {
    mocks.locationState = { backupString: "bfprofile1qvz8k2afcqqszq2v5v5hn" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>
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
      </MemoryRouter>
    );
    /* When no backup state, the component renders nothing (Navigate redirects) */
    expect(container.textContent).toBe("");
  });

  it("navigates to error with backup context when password is 'wrong'", () => {
    mocks.locationState = { backupString: "bfprofile1abc123" };
    render(
      <MemoryRouter>
        <DecryptBackupScreen />
      </MemoryRouter>
    );
    const passwordInput = screen.getByLabelText("Backup Password");
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Decrypt Backup/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import/error", { state: { backupString: "bfprofile1abc123" } });
  });
});

describe("ReviewSaveScreen", () => {
  it("renders heading, Group/Device Profile cards, password fields, and save button", () => {
    mocks.locationState = { backupString: "bfprofile1test", password: "test" };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Review & Save Profile")).toBeInTheDocument();
    expect(screen.getByText("Group Profile")).toBeInTheDocument();
    expect(screen.getByText("Device Profile")).toBeInTheDocument();
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import & Launch Signer/i })).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
  });

  it("renders a help icon next to the Profile Password header (VAL-IMP-003 audit gap)", () => {
    mocks.locationState = { backupString: "bfprofile1test", password: "test" };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>
    );
    const titleRow = screen.getByText("Profile Password").parentElement;
    expect(titleRow).toHaveClass("import-label-row");
    expect(titleRow?.querySelector(".import-label-help-icon")).toBeTruthy();
  });

  it("Import & Launch Signer creates a keyset+profile and navigates to /dashboard/{profileId} (VAL-CROSS-006)", async () => {
    mocks.locationState = {
      backupString: "bfprofile1test",
      password: "test",
      demoUi: { import: { profilePasswordPreset: "hunter1234" } }
    };
    render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Import & Launch Signer/i }));
    await waitFor(() => expect(mocks.createKeyset).toHaveBeenCalled());
    await waitFor(() => expect(mocks.createProfile).toHaveBeenCalled());
    const keysetArg = mocks.createKeyset.mock.calls[0][0] as { groupName: string; threshold: number; count: number };
    expect(keysetArg.groupName).toBe("My Signing Key");
    expect(keysetArg.threshold).toBe(2);
    expect(keysetArg.count).toBe(3);
    const profileArg = mocks.createProfile.mock.calls[0][0] as { password: string; confirmPassword: string };
    expect(profileArg.password).toBe("hunter1234");
    expect(profileArg.confirmPassword).toBe("hunter1234");
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    const target = mocks.navigate.mock.calls.at(-1)?.[0] as string;
    expect(target).toBe("/dashboard/profile-abc123");
  });

  it("redirects to /import when accessed without backup state (guard redirect)", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <ReviewSaveScreen />
      </MemoryRouter>
    );
    /* When no state, the component renders nothing (Navigate redirects) */
    expect(container.textContent).toBe("");
  });
});

describe("ImportErrorScreen", () => {
  it("renders amber wrong-password variant with Try Again + Back to Import (VAL-IMP-004)", () => {
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Import Error")).toBeInTheDocument();
    expect(screen.getByText("Incorrect Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try Again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Import/i })).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();

    const alert = screen.getByText("Incorrect Password").closest(".import-error-alert");
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain("bg-[#EAB3081A]");
    expect(alert?.className).toContain("border-[#EAB30840]");
    expect(alert?.className).not.toContain("red");
  });

  it("renders red corrupted variant with only Back to Import (VAL-IMP-005)", () => {
    mocks.locationState = { demoUi: { import: { errorVariant: "corrupted" } } };
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Backup Corrupted")).toBeInTheDocument();
    expect(screen.getByText(/could not be parsed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try Again/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Back to Import/i })).toBeInTheDocument();

    const alert = screen.getByText("Backup Corrupted").closest(".import-error-alert");
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
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import/decrypt", { state: { backupString: "bfprofile1abc123" } });
  });

  it("Back to Import button navigates to load backup screen (VAL-IMP-006)", () => {
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to Import/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import");
  });
});
