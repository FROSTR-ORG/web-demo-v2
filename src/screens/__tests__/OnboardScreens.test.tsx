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
  createProfile: vi.fn().mockResolvedValue("profile-abc123"),
  decodeOnboardPackage: vi.fn().mockResolvedValue(undefined),
  startOnboardHandshake: vi.fn().mockResolvedValue(undefined),
  saveOnboardedProfile: vi.fn().mockResolvedValue("profile-onboarded"),
  clearOnboardSession: vi.fn(),
  onboardSession: null as {
    phase: "decoded" | "handshaking" | "ready_to_save" | "failed";
    packageString: string;
    payload: { share_secret: string; relays: string[]; peer_pk: string };
    progress?: {
      relays: "pending" | "connecting" | "connected" | "failed";
      request: "pending" | "published" | "failed";
      response: "pending" | "candidate" | "received" | "failed";
      snapshot: "pending" | "built" | "failed";
      connectedRelays?: string[];
      publishedRelays?: string[];
      activeRequestCount?: number;
      responseCandidateCount?: number;
      lastResponseRelay?: string;
      lastEventAt?: number;
      responseDecodedAt?: number;
      snapshotBuiltAt?: number;
      requestAttempts?: number;
      retryDelayMs?: number;
    };
    response?: {
      group: { group_name: string; threshold: number; members: Array<{ idx: number; pubkey: string }> };
      nonces: unknown[];
    };
    runtimeSnapshot?: { bootstrap: { share: { idx: number; seckey: string } }; state_hex: string };
    localShareIdx?: number;
    error?: { code: string; message: string };
  } | null
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
	    createProfile: mocks.createProfile,
	    decodeOnboardPackage: mocks.decodeOnboardPackage,
	    startOnboardHandshake: mocks.startOnboardHandshake,
	    saveOnboardedProfile: mocks.saveOnboardedProfile,
	    onboardSession: mocks.onboardSession,
	    clearOnboardSession: mocks.clearOnboardSession
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
  mocks.decodeOnboardPackage.mockClear();
  mocks.decodeOnboardPackage.mockResolvedValue(undefined);
  mocks.startOnboardHandshake.mockClear();
  mocks.startOnboardHandshake.mockResolvedValue(undefined);
  mocks.saveOnboardedProfile.mockClear();
  mocks.saveOnboardedProfile.mockResolvedValue("profile-onboarded");
  mocks.clearOnboardSession.mockClear();
  mocks.onboardSession = null;
  mocks.locationState = null;
});

function makeOnboardSession() {
  return {
    phase: "decoded" as const,
    packageString: "bfonboard1abc123",
    payload: {
      share_secret: "1".repeat(64),
      relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
      peer_pk: "02a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4c5d6e7f8a9b0c1d28f2c"
    },
    progress: {
      relays: "pending" as const,
      request: "pending" as const,
      response: "pending" as const,
      snapshot: "pending" as const
    }
  };
}

function makeReadyOnboardSession() {
  return {
    ...makeOnboardSession(),
    phase: "ready_to_save" as const,
    response: {
      group: {
        group_name: "Live Onboard Key",
        threshold: 2,
        members: [
          { idx: 0, pubkey: "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          { idx: 1, pubkey: "02bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
        ]
      },
      nonces: []
    },
    runtimeSnapshot: {
      bootstrap: { share: { idx: 1, seckey: "1".repeat(64) } },
      state_hex: "abcd"
    },
    localShareIdx: 1
  };
}

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
    expect(screen.getByText(/Valid bfonboard package format/)).toBeInTheDocument();
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

  it("Begin Onboarding button is disabled until valid package AND non-empty password are provided", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    /* Initial state: both inputs empty → disabled */
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).toBeDisabled();
    /* Typing a valid package alone is not sufficient — password still empty */
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).toBeDisabled();
    /* Adding a non-empty password enables the CTA */
    const passwordInput = screen.getByLabelText("Package Password");
    fireEvent.change(passwordInput, { target: { value: "pkg-pass" } });
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).not.toBeDisabled();
  });

  it("Begin Onboarding stays disabled when package is valid but password is only whitespace", () => {
    render(
      <MemoryRouter>
        <EnterPackageScreen />
      </MemoryRouter>
    );
    const textarea = screen.getByPlaceholderText("bfonboard1...");
    fireEvent.change(textarea, { target: { value: "bfonboard1abc123" } });
    const passwordInput = screen.getByLabelText("Package Password");
    /* Whitespace-only passwords should not satisfy the non-empty requirement */
    fireEvent.change(passwordInput, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Begin Onboarding/i })).toBeDisabled();
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
    mocks.onboardSession = makeOnboardSession();
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding...")).toBeInTheDocument();
    expect(screen.getByText("Connected to relays")).toBeInTheDocument();
    expect(screen.getByText("Request accepted by relays")).toBeInTheDocument();
    expect(screen.getByText("Waiting for source response")).toBeInTheDocument();
    expect(screen.getByText("Preparing signer state")).toBeInTheDocument();
    expect(screen.queryByText("Saving to device")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel Onboarding/i })).toBeInTheDocument();
    expect(mocks.startOnboardHandshake).toHaveBeenCalled();
  });

  it("does not show later product steps as complete before relay progress reaches them", () => {
    mocks.onboardSession = {
      ...makeOnboardSession(),
      progress: {
        relays: "connected",
        request: "pending",
        response: "pending",
        snapshot: "pending",
        connectedRelays: ["wss://relay.primal.net"]
      }
    };
    const { container } = render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    const rows = Array.from(container.querySelectorAll(".onboard-timeline-step"));
    const sourceRow = rows.find((row) =>
      row.textContent?.includes("Request accepted by relays"),
    );
    const responseRow = rows.find((row) =>
      row.textContent?.includes("Waiting for source response"),
    );
    expect(sourceRow?.querySelector(".onboard-dot.done")).toBeNull();
    expect(responseRow?.querySelector(".onboard-dot.done")).toBeNull();
  });

  it("shows retry detail while waiting for the source response", () => {
    mocks.onboardSession = {
      ...makeOnboardSession(),
      progress: {
        relays: "connected",
        request: "published",
        response: "pending",
        snapshot: "pending",
        publishedRelays: ["wss://relay.primal.net"],
        requestAttempts: 3,
        retryDelayMs: 5_000
      }
    };
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(
      screen.getByText(/Waiting for source response · attempt 3 · retrying every 5s/),
    ).toBeInTheDocument();
  });

  it("does not render a Back link (VAL-ONB-002)", () => {
    mocks.onboardSession = makeOnboardSession();
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /^Back$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Back to/i })).not.toBeInTheDocument();
  });

  it("retries a failed product session by starting the live handshake again", () => {
    mocks.onboardSession = {
      ...makeOnboardSession(),
      phase: "failed",
      error: { code: "onboard_timeout", message: "Timed out." }
    };
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(mocks.startOnboardHandshake).toHaveBeenCalled();
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

  it("does not allow product /onboard/handshake to render demo state without an explicit demo marker", () => {
    mocks.locationState = {
      packageString: "bfonboard1abc123",
      demoUi: { onboard: { packagePreset: "bfonboard1abc123" } },
    };
    const { container } = render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByText("Found source device")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving to device")).not.toBeInTheDocument();
  });

  it("keeps the demo handshake available for explicitly marked demo scenarios", () => {
    mocks.locationState = {
      packageString: "bfonboard1abc123",
      demoUi: {
        __demoScenario: true,
        progress: { frozen: true },
        onboard: { packagePreset: "bfonboard1abc123" },
      },
    };
    render(
      <MemoryRouter>
        <HandshakeScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Onboarding...")).toBeInTheDocument();
    expect(screen.getByText("Found source device")).toBeInTheDocument();
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
    expect(screen.getByText(/source device confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Onboarding/i })).toBeInTheDocument();
    /* VAL-ONB-003: amber/timeout variant carries Paper's exact Tailwind tokens. */
    const alert = container.querySelector(".onboard-error-alert");
    expect(alert?.className).toContain("bg-[#EAB3081A]");
    expect(alert?.className).toContain("border-[#EAB30840]");
    expect(alert?.className).not.toContain("red");
  });

  it("Retry button returns to package entry when no decoded session exists", () => {
    render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(mocks.clearOnboardSession).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/onboard");
  });

  it("Retry button returns to handshake when a decoded session exists", () => {
    mocks.onboardSession = makeOnboardSession();
    render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/onboard/handshake");
  });

  it("Back to Onboarding button navigates to enter package", () => {
    render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Back to Onboarding/i }));
    expect(mocks.clearOnboardSession).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/onboard");
  });

  it("renders rejected variant with red alert styling (VAL-ONB-004)", () => {
    mocks.locationState = { demoUi: { onboard: { failedVariant: "rejected" } } };
    const { container } = render(
      <MemoryRouter>
        <OnboardingFailedScreen />
      </MemoryRouter>
    );
    /* Copy parity: rejected variant uses different title/body than timeout. */
    expect(screen.getByText("Onboarding Rejected")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Challenge verification failed. You may not have a valid share for this group."
      )
    ).toBeInTheDocument();
    /* Class tokens the validator inspects for Paper parity. */
    const alert = container.querySelector(".onboard-error-alert");
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain("red");
    expect(alert?.className).toContain("bg-[#EF44441A]");
    expect(alert?.className).toContain("border-[#EF444440]");
    /* Guard: rejected variant must not leak amber tokens from the timeout variant. */
    expect(alert?.className).not.toContain("EAB308");
  });
});

/*
 * VAL-ONB-004 relies on the explicit `.onboard-error-alert.red` CSS rule
 * (Tailwind-style arbitrary utilities are not compiled in this project).
 * Pin the rule text here so a future refactor cannot silently drop the
 * override that makes the red variant visually distinct from the amber
 * timeout variant.
 */
describe("onboard-error-alert red variant CSS rule (VAL-ONB-004)", () => {
  it("declares red background, border, title, and body colors", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const cssPath = path.resolve(__dirname, "../../styles/global.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    /* Rule that wins specificity over the base amber styles. */
    expect(css).toMatch(
      /\.onboard-error-alert\.red\s*{[^}]*background:\s*rgba\(\s*239\s*,\s*68\s*,\s*68\s*,\s*0?\.1\s*\)/
    );
    expect(css).toMatch(
      /\.onboard-error-alert\.red\s*{[^}]*border-color:\s*rgba\(\s*239\s*,\s*68\s*,\s*68\s*,\s*0?\.25\s*\)/
    );
    /* Title color #F87171 and body color #FCA5A5 per validation contract. */
    expect(css).toMatch(
      /\.onboard-error-alert\.red\s+\.onboard-error-title\s*{[^}]*color:\s*#f87171/i
    );
    expect(css).toMatch(
      /\.onboard-error-alert\.red\s+\.onboard-error-description\s*{[^}]*color:\s*#fca5a5/i
    );
  });
});

describe("OnboardingCompleteScreen", () => {
  it("renders success header, profile cards, password fields, and save button", () => {
    mocks.locationState = { fromHandshake: true, demoUi: { onboard: { packagePreset: "bfonboard1abc123" } } };
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

  it("redirects product complete attempts and never creates a fake profile", () => {
    mocks.locationState = { fromHandshake: true };
    const { container } = render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    expect(container.textContent).toBe("");
    expect(mocks.createKeyset).not.toHaveBeenCalled();
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });

  it("renders real product completion from a ready onboarding session", () => {
    mocks.locationState = null;
    mocks.onboardSession = makeReadyOnboardSession();
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Live Onboard Key")).toBeInTheDocument();
    expect(screen.getByText("#1 (Index 1)")).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByText("2 connected")).toBeInTheDocument();
    expect(screen.getByText("1 peers")).toBeInTheDocument();
  });

  it("product completion saves through saveOnboardedProfile instead of fake create flow", async () => {
    mocks.locationState = null;
    mocks.onboardSession = makeReadyOnboardSession();
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "local-password" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "local-password" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & Launch Signer/i }));
    await waitFor(() => {
      expect(mocks.saveOnboardedProfile).toHaveBeenCalledWith({
        password: "local-password",
        confirmPassword: "local-password"
      });
    });
    expect(mocks.createKeyset).not.toHaveBeenCalled();
    expect(mocks.createProfile).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/profile-onboarded");
  });

  it("has no Back link (terminal success state)", () => {
    mocks.locationState = { fromHandshake: true, demoUi: { onboard: { packagePreset: "bfonboard1abc123" } } };
    render(
      <MemoryRouter>
        <OnboardingCompleteScreen />
      </MemoryRouter>
    );
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
  });

  it("Save & Launch Signer creates keyset + profile and navigates to dashboard (VAL-ONB-005 / VAL-CROSS-007)", async () => {
    mocks.locationState = { fromHandshake: true, demoUi: { onboard: { packagePreset: "bfonboard1abc123" } } };
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
