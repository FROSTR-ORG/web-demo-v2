/**
 * m7-onboard-sponsor-ui — component tests for the source-side
 * onboarding sponsor flow (VAL-ONBOARD-003, VAL-ONBOARD-005,
 * VAL-ONBOARD-019, VAL-ONBOARD-021, VAL-ONBOARD-023, VAL-ONBOARD-024,
 * VAL-ONBOARD-025). Renders the Config and Handoff screens through
 * `MockAppStateProvider` so the mutator contract exercised here matches
 * the real AppStateProvider.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockAppStateProvider } from "../../app/MockAppStateProvider";
import { createDemoAppState } from "../../demo/fixtures";
import type { StoredProfileSummary } from "../../lib/bifrost/types";
import {
  ONBOARD_SPONSOR_LABEL_EMPTY_ERROR,
  ONBOARD_SPONSOR_PASSWORD_MISMATCH_ERROR,
  ONBOARD_SPONSOR_PASSWORD_TOO_SHORT_ERROR,
  ONBOARD_SPONSOR_RELAY_EMPTY_ERROR,
  ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR,
  ONBOARD_SPONSOR_THRESHOLD_INVALID_ERROR,
  type AppStateValue,
} from "../../app/AppStateTypes";
import {
  OnboardSponsorConfigScreen,
  OnboardSponsorHandoffScreen,
  passwordStrengthLabel,
} from "../OnboardSponsorScreens";
import { RELAY_INVALID_URL_ERROR } from "../../lib/relay/relayUrl";

const baseProfile: StoredProfileSummary = {
  id: "profile-test",
  label: "Test Keyset",
  deviceName: "Alice iPhone",
  groupName: "Test Keyset",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  groupPublicKey:
    "npub1qe3abcdefghijklmnopqrstuvwxyz1234567890abcdef7k4m",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: 1_700_000_000_000,
  lastUsedAt: 1_700_000_000_000,
};

function renderConfig(options: {
  profile?: StoredProfileSummary | null;
  signerPaused?: boolean;
  createOnboardSponsorPackageMock?: AppStateValue["createOnboardSponsorPackage"];
} = {}) {
  const value = createDemoAppState({
    profiles: options.profile === null ? [] : [options.profile ?? baseProfile],
    activeProfile: options.profile === null ? null : options.profile ?? baseProfile,
    signerPaused: Boolean(options.signerPaused),
    createOnboardSponsorPackage:
      options.createOnboardSponsorPackageMock ??
      (async () => "bfonboard1testingpackagestring"),
  });
  return render(
    <MemoryRouter initialEntries={["/onboard-sponsor"]}>
      <MockAppStateProvider value={value} bridge={false}>
        <Routes>
          <Route
            path="/onboard-sponsor"
            element={<OnboardSponsorConfigScreen />}
          />
          <Route
            path="/onboard-sponsor/handoff"
            element={<OnboardSponsorHandoffScreen />}
          />
        </Routes>
      </MockAppStateProvider>
    </MemoryRouter>,
  );
}

function renderHandoff(options: {
  packageText?: string;
  deviceLabel?: string;
} = {}) {
  const packageText = options.packageText ?? "bfonboard1testingpackagestring";
  const value = createDemoAppState({
    profiles: [baseProfile],
    activeProfile: baseProfile,
    onboardSponsorSession: {
      deviceLabel: options.deviceLabel ?? "Alice iPhone",
      packageText,
      relays: baseProfile.relays,
      createdAt: Date.now(),
    },
  });
  return render(
    <MemoryRouter initialEntries={["/onboard-sponsor/handoff"]}>
      <MockAppStateProvider value={value} bridge={false}>
        <Routes>
          <Route
            path="/onboard-sponsor"
            element={<OnboardSponsorConfigScreen />}
          />
          <Route
            path="/onboard-sponsor/handoff"
            element={<OnboardSponsorHandoffScreen />}
          />
        </Routes>
      </MockAppStateProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(""),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("passwordStrengthLabel", () => {
  it("reports weak for short passwords", () => {
    expect(passwordStrengthLabel("")).toBe("weak");
    expect(passwordStrengthLabel("short")).toBe("weak");
  });

  it("reports ok for medium complexity at minimum length", () => {
    expect(passwordStrengthLabel("abcdefg1")).toBe("ok");
  });

  it("reports strong for long + mixed categories", () => {
    expect(passwordStrengthLabel("Str0ng!Passw0rd!!")).toBe("strong");
  });
});

describe("OnboardSponsorConfigScreen — VAL-ONBOARD-003 / 019 / 021 / 024", () => {
  it("renders the three groups and disables CTA until all validate", () => {
    renderConfig();
    // Label input present
    expect(
      screen.getByTestId("onboard-sponsor-label-input"),
    ).toBeInTheDocument();
    // Password + confirm inputs present
    expect(
      screen.getByTestId("onboard-sponsor-password-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("onboard-sponsor-confirm-input"),
    ).toBeInTheDocument();
    // Relay overrides prefilled from activeProfile.relays
    const rows = screen.getAllByTestId("onboard-sponsor-relay-row");
    expect(rows).toHaveLength(baseProfile.relays.length);
    // CTA disabled initially
    const cta = screen.getByTestId(
      "onboard-sponsor-create-btn",
    ) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it("leaves CTA disabled when the label is empty (VAL-ONBOARD-003)", () => {
    renderConfig();
    const cta = screen.getByTestId(
      "onboard-sponsor-create-btn",
    ) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    // Even with valid password, CTA remains disabled when label is empty.
    fireEvent.change(screen.getByTestId("onboard-sponsor-password-input"), {
      target: { value: "super-secret-1" },
    });
    fireEvent.change(screen.getByTestId("onboard-sponsor-confirm-input"), {
      target: { value: "super-secret-1" },
    });
    // fix-m7-onboard-distinct-share-allocation — the new profile
    // password gate also participates in the CTA-enable check.
    fireEvent.change(
      screen.getByTestId("onboard-sponsor-profile-password-input"),
      { target: { value: "profile-password-1" } },
    );
    expect(cta.disabled).toBe(true);
    // Fill label — CTA enables.
    fireEvent.change(screen.getByTestId("onboard-sponsor-label-input"), {
      target: { value: "Bob" },
    });
    expect(cta.disabled).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    renderConfig();
    const pw = screen.getByTestId("onboard-sponsor-password-input");
    fireEvent.change(pw, { target: { value: "short" } });
    expect(
      screen.getByText(ONBOARD_SPONSOR_PASSWORD_TOO_SHORT_ERROR),
    ).toBeInTheDocument();
  });

  it("rejects password / confirm mismatch inline", () => {
    renderConfig();
    const pw = screen.getByTestId("onboard-sponsor-password-input");
    const cf = screen.getByTestId("onboard-sponsor-confirm-input");
    fireEvent.change(pw, { target: { value: "strong-pass-1" } });
    fireEvent.change(cf, { target: { value: "other-pass-1" } });
    expect(
      screen.getByText(ONBOARD_SPONSOR_PASSWORD_MISMATCH_ERROR),
    ).toBeInTheDocument();
  });

  it(
    "surfaces the empty-relay error immediately when all relays are removed, not after a submit click (fix-m7-scrutiny-r1-sponsor-ui-relay-validation)",
    () => {
      renderConfig();
      // No error yet — profile has relays configured.
      expect(
        screen.queryByTestId("onboard-sponsor-relay-empty-error"),
      ).not.toBeInTheDocument();

      // Remove every relay row via its per-row remove button.
      const rows = screen.getAllByTestId("onboard-sponsor-relay-row");
      expect(rows.length).toBeGreaterThan(0);
      const removeButtons = screen.getAllByRole("button", {
        name: /^Remove wss:\/\//,
      });
      // Click from the end to avoid index shifting invalidating earlier
      // buttons (React re-renders after each click).
      for (let i = removeButtons.length - 1; i >= 0; i--) {
        fireEvent.click(removeButtons[i]);
      }

      // Inline error appears immediately, before any submit attempt.
      const emptyError = screen.getByTestId(
        "onboard-sponsor-relay-empty-error",
      );
      expect(emptyError).toHaveTextContent(ONBOARD_SPONSOR_RELAY_EMPTY_ERROR);
      // CTA stays disabled because no relay is configured.
      const cta = screen.getByTestId(
        "onboard-sponsor-create-btn",
      ) as HTMLButtonElement;
      expect(cta.disabled).toBe(true);

      // Re-adding a valid relay clears the inline error.
      fireEvent.change(
        screen.getByTestId("onboard-sponsor-add-relay-input"),
        { target: { value: "wss://relay.example.net" } },
      );
      fireEvent.click(screen.getByTestId("onboard-sponsor-add-relay-btn"));
      expect(
        screen.queryByTestId("onboard-sponsor-relay-empty-error"),
      ).not.toBeInTheDocument();
    },
  );

  it("rejects invalid relay overrides with canonical wss:// copy", () => {
    renderConfig();
    const addInput = screen.getByTestId(
      "onboard-sponsor-add-relay-input",
    );
    fireEvent.change(addInput, { target: { value: "http://evil.example" } });
    fireEvent.click(screen.getByTestId("onboard-sponsor-add-relay-btn"));
    expect(
      screen.getByTestId("onboard-sponsor-add-relay-error"),
    ).toHaveTextContent(RELAY_INVALID_URL_ERROR);
  });

  it("blocks CTA when signerPaused (VAL-ONBOARD-024)", () => {
    renderConfig({ signerPaused: true });
    expect(
      screen.getByTestId("onboard-sponsor-signer-paused"),
    ).toHaveTextContent(ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR);
    const cta = screen.getByTestId(
      "onboard-sponsor-create-btn",
    ) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it("blocks CTA when the active profile threshold is invalid (VAL-ONBOARD-021)", () => {
    renderConfig({
      profile: { ...baseProfile, threshold: 5, memberCount: 3 },
    });
    expect(
      screen.getByTestId("onboard-sponsor-threshold-invalid"),
    ).toHaveTextContent(ONBOARD_SPONSOR_THRESHOLD_INVALID_ERROR);
    const cta = screen.getByTestId(
      "onboard-sponsor-create-btn",
    ) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it("enables CTA once every group validates and calls createOnboardSponsorPackage (VAL-ONBOARD-003)", async () => {
    const spy = vi.fn().mockResolvedValue("bfonboard1generatedstring");
    renderConfig({ createOnboardSponsorPackageMock: spy });
    fireEvent.change(screen.getByTestId("onboard-sponsor-label-input"), {
      target: { value: "Bob Laptop" },
    });
    fireEvent.change(screen.getByTestId("onboard-sponsor-password-input"), {
      target: { value: "super-secret-1" },
    });
    fireEvent.change(screen.getByTestId("onboard-sponsor-confirm-input"), {
      target: { value: "super-secret-1" },
    });
    // fix-m7-onboard-distinct-share-allocation — must also fill the
    // profile password to enable the CTA and pass it through to the
    // mutator.
    fireEvent.change(
      screen.getByTestId("onboard-sponsor-profile-password-input"),
      { target: { value: "profile-password-1" } },
    );
    const cta = screen.getByTestId(
      "onboard-sponsor-create-btn",
    ) as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith({
      deviceLabel: "Bob Laptop",
      password: "super-secret-1",
      relays: baseProfile.relays,
      profilePassword: "profile-password-1",
    });
  });

  it("shows duplicate-label warning when label matches the active device name (VAL-ONBOARD-018)", () => {
    renderConfig();
    fireEvent.change(screen.getByTestId("onboard-sponsor-label-input"), {
      target: { value: "Alice iPhone" },
    });
    expect(
      screen.getByTestId("onboard-sponsor-duplicate-warning"),
    ).toBeInTheDocument();
  });
});

describe("OnboardSponsorHandoffScreen — VAL-ONBOARD-005 / 023 / 025", () => {
  it("renders the package string in a monospaced textarea (VAL-ONBOARD-005)", () => {
    renderHandoff({ packageText: "bfonboard1abcdefg1234567" });
    const textarea = screen.getByTestId(
      "onboard-sponsor-package-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("bfonboard1abcdefg1234567");
    expect(textarea.readOnly).toBe(true);
  });

  it("renders a QR canvas ≥ 256×256 (VAL-ONBOARD-005)", () => {
    renderHandoff();
    const canvas = screen.getByTestId(
      "onboard-sponsor-qr-canvas",
    ) as HTMLCanvasElement;
    expect(canvas.tagName.toLowerCase()).toBe("canvas");
    expect(canvas.width).toBeGreaterThanOrEqual(256);
    expect(canvas.height).toBeGreaterThanOrEqual(256);
  });

  it("Tab on the textarea does NOT insert a tab character (VAL-ONBOARD-023)", () => {
    renderHandoff({ packageText: "bfonboard1zzz" });
    const textarea = screen.getByTestId(
      "onboard-sponsor-package-textarea",
    ) as HTMLTextAreaElement;
    const original = textarea.value;
    fireEvent.keyDown(textarea, { key: "Tab" });
    // Value unchanged — no tab character inserted by default.
    expect(textarea.value).toBe(original);
    expect(textarea.value).not.toMatch(/\t/);
  });

  it("Copy button writes the package to clipboard and shows transient 'Copied' (VAL-ONBOARD-025)", async () => {
    const pkg = "bfonboard1copyTest";
    renderHandoff({ packageText: pkg });
    const btn = screen.getByTestId("onboard-sponsor-copy-btn");
    expect(btn).toHaveTextContent("Copy Package");
    fireEvent.click(btn);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(pkg),
    );
    expect(btn).toHaveTextContent("Copied");
    // Transient — resets within ≤ 3 seconds via a real setTimeout. We
    // wait 1.8s (over the 1.6s reset window, under the 3s contract).
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(btn).toHaveTextContent("Copy Package");
  }, 10000);

  it("Cancel button opens a confirm dialog and keeps session until user confirms (VAL-ONBOARD-014/022)", () => {
    renderHandoff();
    fireEvent.click(screen.getByTestId("onboard-sponsor-cancel-btn"));
    expect(
      screen.getByTestId("onboard-sponsor-cancel-confirm"),
    ).toBeInTheDocument();
    // Keep package dismisses the dialog without canceling.
    fireEvent.click(screen.getByTestId("onboard-sponsor-cancel-keep"));
    expect(
      screen.queryByTestId("onboard-sponsor-cancel-confirm"),
    ).not.toBeInTheDocument();
    // Textarea still renders the package.
    expect(
      screen.getByTestId("onboard-sponsor-package-textarea"),
    ).toBeInTheDocument();
  });

  it("Escape key opens the cancel confirm (keyboard reachable)", () => {
    renderHandoff();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByTestId("onboard-sponsor-cancel-confirm"),
    ).toBeInTheDocument();
  });
});
