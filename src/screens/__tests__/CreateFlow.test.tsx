import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CreateKeysetScreen } from "../CreateKeysetScreen";
import { GenerationProgressScreen } from "../GenerationProgressScreen";

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  createKeyset: vi.fn().mockResolvedValue(undefined),
  generateNsec: vi.fn(),
  createSession: null as {
    draft: { groupName: string; threshold: number; count: number };
    keyset?: Record<string, unknown>;
    localShare?: Record<string, unknown>;
  } | null,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate-redirect">{to}</div>
    ),
  };
});

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    createKeyset: mocks.createKeyset,
    createSession: mocks.createSession,
  }),
}));

vi.mock("../../lib/bifrost/packageService", () => ({
  generateNsec: mocks.generateNsec,
}));

afterEach(() => {
  cleanup();
});

/* Real checksum-valid nsec strings (produced by bifrost_bridge_wasm::
 * generate_nsec). Structural validation in CreateKeysetScreen now runs
 * a bech32 decode, so test fixtures MUST be valid nsec1 bech32 rather
 * than the synthesized-looking `nsec1pastedtestkey00…` placeholders. */
const VALID_NSEC_A =
  "nsec12tfx8l4x0pf3pug57hj2mvek32nr9za6lwwm08u7sqmndxpmrm4s7eetqs";
const VALID_NSEC_B =
  "nsec1m52qt8wg8fz0rr5h08s5eur84k0xnhnz2vwzekscvhdx2pf02r3sl43fjq";

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.createKeyset.mockClear();
  mocks.generateNsec.mockReset();
  mocks.generateNsec.mockResolvedValue({
    nsec: VALID_NSEC_B,
    signing_key_hex: "a".repeat(64),
  });
  mocks.createSession = null;
});

/* ==========================================================
   CreateKeysetScreen
   ========================================================== */

describe("CreateKeysetScreen", () => {
  it("renders heading and form elements", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Create New Keyset")).toBeInTheDocument();
    expect(screen.getByText("Keyset Name")).toBeInTheDocument();
    expect(screen.getByText("Private Key (nsec)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Keyset" })).toBeInTheDocument();
  });

  it("uses the normal product keyset name by default but allows an empty Paper demo preset", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByPlaceholderText("e.g. My Signing Key, Work Key..."),
    ).toHaveValue("My Signing Key");
    unmount();

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/create",
            state: { demoUi: { create: { keysetNamePreset: "" } } },
          },
        ]}
      >
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByPlaceholderText("e.g. My Signing Key, Work Key..."),
    ).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));
    await waitFor(() => {
      expect(screen.getByText("Keyset name is required.")).toBeInTheDocument();
    });
    expect(mocks.createKeyset).not.toHaveBeenCalled();
  });

  it("blocks non-nsec prefix input with the 'must start with nsec1' error", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, { target: { value: "not-a-valid-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(
        screen.getByText("Invalid nsec format — must start with nsec1."),
      ).toBeInTheDocument();
    });

    expect(nsecInput).toHaveClass("input-error");
    expect(mocks.createKeyset).not.toHaveBeenCalled();
  });

  it("blocks structurally malformed nsec1 input with the 'full secret key' error (fix-m6-nsec-structural-validation)", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );

    // `nsec1abc` has the correct prefix but fails bech32 structural
    // validation (too short, bad checksum). Under the pre-fix behaviour
    // this would slip past input validation and fail later inside
    // createKeyset as a generic top-level error. The structural
    // validator must now block it inline with the more precise copy.
    fireEvent.change(nsecInput, { target: { value: "nsec1abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Invalid nsec — check that you pasted the full secret key.",
        ),
      ).toBeInTheDocument();
    });
    expect(nsecInput).toHaveClass("input-error");
    expect(mocks.createKeyset).not.toHaveBeenCalled();
  });

  it("also blocks 'nsec1' followed by non-bech32 garbage with the structural-error copy", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, { target: { value: "nsec1invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Invalid nsec — check that you pasted the full secret key.",
        ),
      ).toBeInTheDocument();
    });
    expect(mocks.createKeyset).not.toHaveBeenCalled();
  });

  it("clears the inline error once the input becomes a valid nsec1", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, { target: { value: "nsec1abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Invalid nsec — check that you pasted the full secret key.",
        ),
      ).toBeInTheDocument();
    });

    fireEvent.change(nsecInput, { target: { value: VALID_NSEC_A } });
    await waitFor(() => {
      expect(
        screen.queryByText(
          "Invalid nsec — check that you pasted the full secret key.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Invalid nsec format — must start with nsec1."),
      ).not.toBeInTheDocument();
    });
  });

  it("does not leak any part of the rejected nsec into console output", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <MemoryRouter>
          <CreateKeysetScreen />
        </MemoryRouter>,
      );
      const nsecInput = screen.getByPlaceholderText(
        "Paste your existing nsec or generate a new one",
      );
      fireEvent.change(nsecInput, {
        target: { value: "nsec1leakycanaryvaluexyz" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));
      await waitFor(() => {
        expect(
          screen.getByText(
            "Invalid nsec — check that you pasted the full secret key.",
          ),
        ).toBeInTheDocument();
      });
      const allArgs = [
        ...consoleSpy.mock.calls.flat(),
        ...logSpy.mock.calls.flat(),
        ...warnSpy.mock.calls.flat(),
      ];
      for (const arg of allArgs) {
        expect(String(arg)).not.toContain("leakycanaryvalue");
      }
    } finally {
      consoleSpy.mockRestore();
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("navigates to /create/progress on valid submission", async () => {
    mocks.createKeyset.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalledWith({
        groupName: "My Signing Key",
        threshold: 2,
        count: 3,
      });
    });

    expect(mocks.navigate).toHaveBeenCalledWith("/create/progress");
  });

  it("generates a real nsec into the same input field", async () => {
    const generated = VALID_NSEC_B;

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(mocks.generateNsec).toHaveBeenCalled();
      expect(
        screen.getByPlaceholderText("Paste your existing nsec or generate a new one"),
      ).toHaveValue(generated);
    });

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    expect(nsecInput).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Reveal nsec" }));
    expect(nsecInput).toHaveAttribute("type", "text");
  });

  it("submits a generated nsec without storing it in the create draft", async () => {
    const generated = VALID_NSEC_B;

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Paste your existing nsec or generate a new one"),
      ).toHaveValue(generated),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalledWith({
        groupName: "My Signing Key",
        threshold: 2,
        count: 3,
        generatedNsec: generated,
      });
    });

    expect(mocks.navigate).toHaveBeenCalledWith("/create/progress");
  });

  it("shows error when keyset name is empty", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nameInput = screen.getByDisplayValue("My Signing Key");
    fireEvent.change(nameInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(screen.getByText("Keyset name is required.")).toBeInTheDocument();
    });
  });

  it("renders canonical create Stepper labels (VAL-CRT-002)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    // Stepper step 1 "Create Keyset"; step 2 "Setup Profile"; step 3 "Onboard Devices"
    expect(screen.getByText("Setup Profile")).toBeInTheDocument();
    expect(screen.getByText("Onboard Devices")).toBeInTheDocument();
    expect(screen.queryByText("Create Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Distribute Shares")).not.toBeInTheDocument();
  });

  it("renders canonical Keyset Name help text including 'peers in the keyset' (VAL-CRT-003)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        "A friendly name for this keyset's group profile. Visible to all peers in the keyset.",
      ),
    ).toBeInTheDocument();
  });

  it("renders dynamic threshold/shares help line and re-interpolates on stepper change (VAL-CRT-004/013)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        "Any 2 of 3 shares can sign — min threshold is 2, min shares is 2",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Decrease Total Shares"));
    expect(
      screen.getByText(
        "Any 2 of 2 shares can sign — min threshold is 2, min shares is 2",
      ),
    ).toBeInTheDocument();

    // Click the Total Shares + button twice to go 2 -> 4
    fireEvent.click(screen.getByLabelText("Increase Total Shares"));
    fireEvent.click(screen.getByLabelText("Increase Total Shares"));
    expect(
      screen.getByText(
        "Any 2 of 4 shares can sign — min threshold is 2, min shares is 2",
      ),
    ).toBeInTheDocument();

    // Click Threshold + to go 2 -> 3
    fireEvent.click(screen.getByLabelText("Increase Threshold"));
    expect(
      screen.getByText(
        "Any 3 of 4 shares can sign — min threshold is 2, min shares is 3",
      ),
    ).toBeInTheDocument();
  });

  it("allows a 2-of-2 keyset", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("Decrease Total Shares"));
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalledWith({
        groupName: "My Signing Key",
        threshold: 2,
        count: 2,
      });
    });
  });

  /* ---------- m6-nsec-split-create (paste existing nsec) ---------- */

  it("masks the nsec input by default (VAL-BACKUP-022)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    expect(nsecInput).toHaveAttribute("type", "password");
  });

  it("disables the reveal toggle when the nsec input is empty (VAL-BACKUP-022)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    const revealBtn = screen.getByRole("button", { name: "Reveal nsec" });
    expect(revealBtn).toBeDisabled();

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, {
      target: {
        value:
          "nsec1pastedtestkey000000000000000000000000000000000000000000000000",
      },
    });
    expect(screen.getByRole("button", { name: "Reveal nsec" })).not.toBeDisabled();
  });

  it("toggles the reveal/mask affordance when clicked (VAL-BACKUP-022)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );
    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, {
      target: {
        value:
          "nsec1pastedtestkey000000000000000000000000000000000000000000000000",
      },
    });
    expect(nsecInput).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Reveal nsec" }));
    expect(nsecInput).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide nsec" }));
    expect(nsecInput).toHaveAttribute("type", "password");
  });

  it("dispatches createKeyset with existingNsec when a valid nsec is pasted (VAL-BACKUP-020)", async () => {
    const pasted = VALID_NSEC_A;

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalledWith({
        groupName: "My Signing Key",
        threshold: 2,
        count: 3,
        existingNsec: pasted,
      });
    });
  });

  it("trims whitespace/newlines from pasted nsec before validation (VAL-BACKUP-028)", async () => {
    const pasted = VALID_NSEC_A;

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, {
      target: { value: `\n   ${pasted}   \n` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalledWith({
        groupName: "My Signing Key",
        threshold: 2,
        count: 3,
        existingNsec: pasted,
      });
    });
    expect(
      screen.queryByText("Invalid nsec format — must start with nsec1."),
    ).not.toBeInTheDocument();
  });

  it("reflects the trimmed nsec in input.value on change, before submit (VAL-BACKUP-028)", () => {
    const pasted = VALID_NSEC_A;

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    ) as HTMLInputElement;

    // Simulate a paste that includes surrounding whitespace / newline.
    // The contract clause "Input value reflects trimmed string" requires
    // the displayed DOM value to already be trimmed BEFORE the user
    // clicks Create — validators check the field prior to submission.
    fireEvent.change(nsecInput, {
      target: { value: `   ${pasted}   \n` },
    });

    expect(nsecInput.value).toBe(pasted);
    expect(nsecInput.value).not.toMatch(/^\s|\s$/);
  });

  it("rejects whitespace-wrapped invalid nsec with inline error (VAL-BACKUP-021)", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, { target: { value: "  not-valid-key  \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Keyset" }));

    await waitFor(() => {
      expect(
        screen.getByText("Invalid nsec format — must start with nsec1."),
      ).toBeInTheDocument();
    });
    expect(mocks.createKeyset).not.toHaveBeenCalled();
  });

  it("clears pasted nsec from state and resets reveal state when Back is clicked (VAL-BACKUP-029)", () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const pasted = VALID_NSEC_A;
    const nsecInput = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    fireEvent.change(nsecInput, { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal nsec" }));
    expect(nsecInput).toHaveValue(pasted);
    expect(nsecInput).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Back to Welcome" }));

    const nsecInputAfter = screen.getByPlaceholderText(
      "Paste your existing nsec or generate a new one",
    );
    expect(nsecInputAfter).toHaveValue("");
    expect(nsecInputAfter).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Reveal nsec" })).toBeDisabled();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
});

/* ==========================================================
   GenerationProgressScreen
   ========================================================== */

describe("GenerationProgressScreen", () => {
  it("redirects to /create when no keyset exists", () => {
    mocks.createSession = null;
    render(
      <MemoryRouter>
        <GenerationProgressScreen />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("navigate-redirect")).toHaveTextContent(
      "/create",
    );
  });

  it("renders progress screen with phases when keyset exists", () => {
    mocks.createSession = {
      draft: { groupName: "Test Key", threshold: 2, count: 3 },
      keyset: { group: {} } as Record<string, unknown>,
    };
    render(
      <MemoryRouter>
        <GenerationProgressScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("Generation Progress")).toBeInTheDocument();
    expect(screen.getByText("Generate New Key")).toBeInTheDocument();
    expect(screen.getByText("Split Initial Shares")).toBeInTheDocument();
    expect(screen.getByText("Prepare Shares for Setup")).toBeInTheDocument();
    expect(screen.getByText(/of 3 phases/)).toBeInTheDocument();
    expect(screen.getByText("Overall Progress")).toBeInTheDocument();
  });

  it("shows Back link that navigates to /create", () => {
    mocks.createSession = {
      draft: { groupName: "Test Key", threshold: 2, count: 3 },
      keyset: { group: {} } as Record<string, unknown>,
    };
    render(
      <MemoryRouter>
        <GenerationProgressScreen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/create");
  });

  it("auto-transitions to /create/profile after all phases complete", async () => {
    mocks.createSession = {
      draft: { groupName: "Test Key", threshold: 2, count: 3 },
      keyset: { group: {} } as Record<string, unknown>,
    };
    render(
      <MemoryRouter>
        <GenerationProgressScreen />
      </MemoryRouter>,
    );

    /* Wait for auto-transition — phases advance every 800ms, 3 phases + 600ms transition delay */
    await waitFor(
      () => {
        expect(mocks.navigate).toHaveBeenCalledWith("/create/profile", {
          replace: true,
        });
      },
      { timeout: 5000 },
    );
  });
});
