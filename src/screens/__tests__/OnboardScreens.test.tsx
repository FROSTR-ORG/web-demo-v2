import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  locationState: null as Record<string, unknown> | null
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
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
    expect(screen.getByText("Back")).toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
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
    render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding Failed")).toBeInTheDocument();
    expect(screen.getByText("Onboarding Timed Out")).toBeInTheDocument();
    expect(screen.getByText(/peer did not respond/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Onboarding/i })).toBeInTheDocument();
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

  it("Save & Launch Signer navigates to home", () => {
    mocks.locationState = { fromHandshake: true };
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Save & Launch Signer/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
});
