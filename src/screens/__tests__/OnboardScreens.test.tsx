import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EnterPackageScreen,
  HandshakeScreen,
  OnboardingFailedScreen,
  OnboardingCompleteScreen
} from "../OnboardScreens";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  locationState: null as Record<string, unknown> | null,
  reloadProfiles: vi.fn().mockResolvedValue(undefined),
  createKeyset: vi.fn().mockResolvedValue(undefined),
  createProfile: vi.fn().mockResolvedValue("profile-abc123")
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({
      pathname: "/onboard",
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.createKeyset.mockClear();
  mocks.createProfile.mockClear();
  mocks.createProfile.mockResolvedValue("profile-abc123");
  mocks.locationState = null;
});

describe("EnterPackageScreen", () => {
  it("renders heading, package input, QR button, password field, and begin button", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Enter Onboarding Package")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("bfonboard1...")).toBeInTheDocument();
    expect(screen.getByText("Scan QR")).toBeInTheDocument();
    expect(screen.getByLabelText("Package Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).toBeInTheDocument();
    /* VAL-ONB-001: Enter Package uses 'Back to Welcome' label (not default 'Back'). */
    expect(screen.getByRole("button", { name: "Back to Welcome" })).toBeInTheDocument();
  });

  it("shows validation feedback for valid bfonboard1 input", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    expect(screen.getByText(/Valid package/)).toBeInTheDocument();
  });

  it("shows error feedback for invalid input", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "invalid-string" } });
    expect(screen.getByText(/Invalid package/)).toBeInTheDocument();
  });

  it("Begin Onboarding button is disabled until valid input", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).toBeDisabled();
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).not.toBeDisabled();
  });

  it("Back link navigates to welcome", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to Welcome" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("renders inline help icons on Onboarding Package and Package Password labels (VAL-ONB-001)", () => {
    const { container } = render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    /* Both labels live inside import-label-row wrappers that contain help icons. */
    const helpIcons = container.querySelectorAll(".import-label-help-icon");
    expect(helpIcons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("HandshakeScreen", () => {
  it("renders timeline with progress states when package state is present", () => {
    mocks.locationState = { packageString: "bfonboard1abc123", password: "test" };
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding...")).toBeInTheDocument();
    expect(screen.getByText("Connected to relays")).toBeInTheDocument();
    expect(screen.getByText("Found source device")).toBeInTheDocument();
    expect(screen.getByText("Receiving keyset data")).toBeInTheDocument();
    expect(screen.getByText("Saving to device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel Onboarding/i })).toBeInTheDocument();
  });

  it("does not render a Back link (VAL-ONB-002)", () => {
    mocks.locationState = { packageString: "bfonboard1abc123", password: "test" };
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /^Back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Back to/i })).not.toBeInTheDocument();
  });

  it("guard redirects to /onboard if no state", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    /* When no state, the component renders nothing (Navigate redirects) */
    expect(container.textContent).toBe("");
  });
});

describe("OnboardingFailedScreen", () => {
  it("renders warning alert with timeout message and action buttons", () => {
    const { container } = render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding Failed")).toBeInTheDocument();
    expect(screen.getByText("Onboarding Timed Out")).toBeInTheDocument();
    expect(screen.getByText(/peer did not respond/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Onboarding/i })).toBeInTheDocument();
    /* VAL-ONB-003: amber/timeout variant carries Paper's exact Tailwind tokens. */
    const alert = container.querySelector(".onboard-error-alert");
    expect(alert?.className).toContain("bg-[#EAB3081A]");
    expect(alert?.className).toContain("border-[#EAB30840]");
    expect(alert?.className).not.toContain("red");
  });

  it("Retry button navigates to handshake", () => {
    render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/onboard/handshake", expect.anything());
  });

  it("Back to Onboarding button navigates to enter package", () => {
    render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to Onboarding/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/onboard");
  });
});

describe("OnboardingCompleteScreen", () => {
  it("renders success header, profile cards, password fields, and save button", () => {
    mocks.locationState = { fromHandshake: true };
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding Complete")).toBeInTheDocument();
    expect(screen.getByText("Group Profile")).toBeInTheDocument();
    expect(screen.getByText("Device Profile")).toBeInTheDocument();
    expect(screen.getByText("My Signing Key")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save & Launch Signer/i })).toBeInTheDocument();
  });

  it("guard redirects to /onboard if no state", () => {
    mocks.locationState = null;
    const { container } = render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    /* When no state, the component renders nothing (Navigate redirects) */
    expect(container.textContent).toBe("");
  });

  it("has no Back link (terminal success state)", () => {
    mocks.locationState = { fromHandshake: true };
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("Save & Launch Signer creates keyset + profile and navigates to dashboard (VAL-ONB-005 / VAL-CROSS-007)", async () => {
    mocks.locationState = { fromHandshake: true };
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Save & Launch Signer/i }));
    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mocks.createProfile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/profile-abc123");
    });
  });
});
