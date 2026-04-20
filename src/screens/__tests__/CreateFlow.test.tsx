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

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.createKeyset.mockClear();
  mocks.generateNsec.mockReset();
  mocks.generateNsec.mockResolvedValue({
    nsec: "nsec1generatedtestkey0000000000000000000000000000000000000000000000",
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
    expect(screen.getByText("Create Keyset")).toBeInTheDocument();
  });

  it("blocks existing nsec input because splitting is not supported yet", async () => {
    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    const nsecInput = screen.getByPlaceholderText(
      "Paste existing nsec (unsupported)",
    );
    fireEvent.change(nsecInput, { target: { value: "not-a-valid-key" } });
    fireEvent.click(screen.getByText("Create Keyset"));

    await waitFor(() => {
      expect(
        screen.getByText("Existing nsec splitting is not supported yet."),
      ).toBeInTheDocument();
    });

    expect(nsecInput).toHaveClass("input-error");
  });

  it("navigates to /create/progress on valid submission", async () => {
    mocks.createKeyset.mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Create Keyset"));

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
    const generated =
      "nsec1generatedtestkey0000000000000000000000000000000000000000000000";

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate NSEC" }));

    await waitFor(() => {
      expect(mocks.generateNsec).toHaveBeenCalled();
      expect(
        screen.getByPlaceholderText("Paste existing nsec (unsupported)"),
      ).toHaveValue(generated);
    });

    const nsecInput = screen.getByPlaceholderText(
      "Paste existing nsec (unsupported)",
    );
    expect(nsecInput).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Reveal nsec" }));
    expect(nsecInput).toHaveAttribute("type", "text");
  });

  it("submits a generated nsec without storing it in the create draft", async () => {
    const generated =
      "nsec1generatedtestkey0000000000000000000000000000000000000000000000";

    render(
      <MemoryRouter>
        <CreateKeysetScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate NSEC" }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Paste existing nsec (unsupported)"),
      ).toHaveValue(generated),
    );
    fireEvent.click(screen.getByText("Create Keyset"));

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
    fireEvent.click(screen.getByText("Create Keyset"));

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
    // Stepper step 1 "Create"; step 2 "Create Profile"; step 3 "Distribute Shares"
    expect(screen.getByText("Create Profile")).toBeInTheDocument();
    expect(screen.getByText("Distribute Shares")).toBeInTheDocument();
    expect(screen.queryByText("Setup Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Onboard Devices")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Create Keyset"));

    await waitFor(() => {
      expect(mocks.createKeyset).toHaveBeenCalledWith({
        groupName: "My Signing Key",
        threshold: 2,
        count: 2,
      });
    });
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
