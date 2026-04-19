import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RotateKeysetFormScreen, ReviewGenerateScreen } from "../RotateKeysetScreens";

/* ---------- Mocks ---------- */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.navigate.mockClear();
});

/* ==========================================================
   RotateKeysetFormScreen
   ========================================================== */

describe("RotateKeysetFormScreen", () => {
  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Rotate Keyset" })).toBeInTheDocument();
    expect(screen.getByText("Source Share #1")).toBeInTheDocument();
    expect(screen.getByText("Source Share #2")).toBeInTheDocument();
    expect(screen.getByText("Shares Collected")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 required")).toBeInTheDocument();
    expect(screen.getByText("New Configuration")).toBeInTheDocument();
    expect(screen.getByText(/Validate & Continue/)).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    /* Step 1 of stepper should be "Rotate Keyset" */
    const stepperLabels = screen.getAllByText("Rotate Keyset");
    /* One from stepper, one from heading */
    expect(stepperLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("renders source share #1 with validated badge", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Validated")).toBeInTheDocument();
    /* "My Signing Key" appears in both header-meta and source share card */
    expect(screen.getAllByText("My Signing Key").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("02a3f8...8f2c")).toBeInTheDocument();
    expect(screen.getByText("Belongs to current group")).toBeInTheDocument();
  });

  it("renders source share #2 with input areas", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText("Paste bfshare from another device or backup...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter password to decrypt")).toBeInTheDocument();
    expect(screen.getByText("Waiting for input")).toBeInTheDocument();
  });

  it("renders info callout", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("All shares change, group key stays the same")).toBeInTheDocument();
  });

  it("back link navigates to /", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("Validate & Continue navigates to /rotate-keyset/review", () => {
    render(
      <MemoryRouter>
        <RotateKeysetFormScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText(/Validate & Continue/));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/review");
  });
});

/* ==========================================================
   ReviewGenerateScreen
   ========================================================== */

describe("ReviewGenerateScreen", () => {
  it("renders heading and key elements", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Review & Generate")).toBeInTheDocument();
    expect(screen.getByText("Before generating fresh shares")).toBeInTheDocument();
    expect(screen.getByText("Distribution Password")).toBeInTheDocument();
    expect(screen.getByText(/Rotate & Generate Keyset/)).toBeInTheDocument();
  });

  it("renders stepper with Rotate Keyset label at step 1", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Rotate Keyset")).toBeInTheDocument();
  });

  it("renders amber warning callout", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByText("Before generating fresh shares")).toBeInTheDocument();
    expect(screen.getByText(/reconstruct the existing signing key/)).toBeInTheDocument();
  });

  it("renders distribution password inputs", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
  });

  it("back link navigates to /rotate-keyset", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Back"));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset");
  });

  it("Rotate & Generate Keyset button navigates to /rotate-keyset/progress", () => {
    render(
      <MemoryRouter>
        <ReviewGenerateScreen />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText(/Rotate & Generate Keyset/));
    expect(mocks.navigate).toHaveBeenCalledWith("/rotate-keyset/progress");
  });
});
