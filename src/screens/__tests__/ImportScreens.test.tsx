import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  locationState: null as Record<string, unknown> | null
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
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
});

describe("ImportErrorScreen", () => {
  it("renders error heading, warning alert, and action buttons", () => {
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
  });

  it("Try Again button navigates to decrypt screen", () => {
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Try Again/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import/decrypt");
  });

  it("Back to Import button navigates to load backup screen", () => {
    render(
      <MemoryRouter>
        <ImportErrorScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to Import/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/import");
  });
});
