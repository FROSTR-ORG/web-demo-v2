import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SettingsSidebar,
  UNSAVED_CHANGES_DESCRIPTION,
  UNSAVED_CHANGES_TITLE,
} from "../SettingsSidebar";

/**
 * VAL-SETTINGS-029 — `SettingsSidebar` must never silently drop a
 * pending Profile Name or Change Password edit when the user
 * attempts to close the sidebar, lock the profile, or clear
 * credentials. The chosen approach (documented in
 * `docs/runtime-deviations-from-paper.md`) is a confirm-unsaved
 * dialog that gates the navigate-away action until the user
 * explicitly chooses Discard or Keep editing.
 */

const mockUpdateProfileName = vi.fn();
const mockChangeProfilePassword = vi.fn();

let activeProfileStub: {
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
} | null = null;

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: activeProfileStub,
    updateProfileName: mockUpdateProfileName,
    changeProfilePassword: mockChangeProfilePassword,
  }),
}));

function defaultProps(override?: {
  onClose?: () => void;
  onLock?: () => void;
  onClearCredentials?: () => void;
  onExport?: () => void;
  onExportShare?: () => void;
}) {
  return {
    profile: { groupName: "My Signing Key", deviceName: "Igloo Web" },
    relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
    groupPublicKey: "npub1qe3abcdef1234567890abcdef7k4m",
    threshold: 2,
    memberCount: 3,
    shareIdx: 0,
    onClose: override?.onClose ?? (() => {}),
    onLock: override?.onLock ?? (() => {}),
    onClearCredentials: override?.onClearCredentials ?? (() => {}),
    onExport: override?.onExport ?? (() => {}),
    onExportShare: override?.onExportShare ?? (() => {}),
  };
}

function renderSidebar(override?: Parameters<typeof defaultProps>[0]) {
  return render(
    <MemoryRouter>
      <SettingsSidebar {...defaultProps(override)} />
    </MemoryRouter>,
  );
}

/**
 * Tiny location probe used by the Replace Share navigation tests.
 * Renders the current `pathname` into a stable `data-testid` node so
 * the tests can assert that a guarded navigation actually lands on
 * `/replace-share` (Discard path) or stays on `/` (Keep-editing path).
 */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-pathname">{location.pathname}</span>;
}

function renderSidebarWithRouter(
  override?: Parameters<typeof defaultProps>[0],
) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <SettingsSidebar {...defaultProps(override)} />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/replace-share"
          element={
            <span data-testid="replace-share-route">replace-share</span>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function startEditingName(nextValue: string): void {
  fireEvent.click(screen.getByLabelText("Edit profile name"));
  const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
  fireEvent.change(input, { target: { value: nextValue } });
}

beforeEach(() => {
  mockUpdateProfileName.mockReset();
  mockUpdateProfileName.mockResolvedValue(undefined);
  mockChangeProfilePassword.mockReset();
  mockChangeProfilePassword.mockResolvedValue(undefined);
  activeProfileStub = {
    id: "test-profile-id",
    label: "My Signing Key",
    deviceName: "Igloo Web",
    groupName: "My Signing Key",
    threshold: 2,
    memberCount: 3,
    localShareIdx: 0,
    groupPublicKey: "npub1qe3abcdef1234567890abcdef7k4m",
    relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
});

afterEach(() => {
  cleanup();
});

describe("SettingsSidebar — confirm unsaved changes (VAL-SETTINGS-029)", () => {
  it("close (X) while editing name surfaces confirm dialog and blocks onClose", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    startEditingName("Alice Laptop");

    expect(
      screen.queryByTestId("settings-unsaved-confirm"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(
      screen.getByTestId("settings-unsaved-confirm"),
    ).toBeInTheDocument();
    expect(screen.getByText(UNSAVED_CHANGES_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(UNSAVED_CHANGES_DESCRIPTION),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close (X) with no unsaved edits runs onClose immediately (no modal)", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("settings-unsaved-confirm"),
    ).not.toBeInTheDocument();
  });

  it("Keep editing dismisses the confirm dialog and preserves the draft", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    startEditingName("Alice Laptop");
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(screen.getByTestId("settings-unsaved-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-unsaved-keep-editing"));
    expect(
      screen.queryByTestId("settings-unsaved-confirm"),
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Draft survives — input still shows the typed value.
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    expect(input.value).toBe("Alice Laptop");
  });

  it("Discard runs onClose and discards the draft without calling updateProfileName", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    startEditingName("Alice Laptop");
    fireEvent.click(screen.getByLabelText("Close settings"));
    fireEvent.click(screen.getByTestId("settings-unsaved-discard"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfileName).not.toHaveBeenCalled();
  });

  it("Lock Profile while dirty surfaces confirm dialog and blocks onLock", () => {
    const onLock = vi.fn();
    renderSidebar({ onLock });

    startEditingName("Alice Laptop");

    const lockButtons = screen.getAllByText("Lock");
    const lockBtn = lockButtons.find((btn) =>
      btn.closest(".settings-btn-red"),
    )!;
    fireEvent.click(lockBtn);

    expect(screen.getByTestId("settings-unsaved-confirm")).toBeInTheDocument();
    expect(onLock).not.toHaveBeenCalled();
  });

  it("Clear Credentials while dirty surfaces confirm dialog and blocks onClearCredentials", () => {
    const onClearCredentials = vi.fn();
    renderSidebar({ onClearCredentials });

    startEditingName("Alice Laptop");

    const clearBtn = screen
      .getAllByText("Clear")
      .find((btn) => btn.closest(".settings-btn-red"))!;
    fireEvent.click(clearBtn);

    expect(screen.getByTestId("settings-unsaved-confirm")).toBeInTheDocument();
    expect(onClearCredentials).not.toHaveBeenCalled();
  });

  it("scrim click while dirty surfaces confirm dialog", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    startEditingName("Alice Laptop");
    fireEvent.click(screen.getByTestId("settings-scrim"));

    expect(screen.getByTestId("settings-unsaved-confirm")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirm dialog appears when Change Password form has any typed content", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    // Open Change Password form.
    fireEvent.click(screen.getByLabelText("Change password"));
    const newInput = screen.getByLabelText(
      "New password",
    ) as HTMLInputElement;
    fireEvent.change(newInput, { target: { value: "partial" } });

    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(screen.getByTestId("settings-unsaved-confirm")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Replace Share while dirty surfaces confirm dialog and blocks navigation", () => {
    const onClose = vi.fn();
    renderSidebarWithRouter({ onClose });

    startEditingName("Alice Laptop");

    const replaceShareBtn = screen
      .getAllByText("Replace Share")
      .find((el) => el.tagName === "BUTTON")!;
    fireEvent.click(replaceShareBtn);

    expect(screen.getByTestId("settings-unsaved-confirm")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Navigation did NOT occur — still on the initial route.
    expect(screen.getByTestId("location-pathname").textContent).toBe("/");
    expect(
      screen.queryByTestId("replace-share-route"),
    ).not.toBeInTheDocument();
  });

  it("Replace Share → Discard proceeds to /replace-share and calls onClose", () => {
    const onClose = vi.fn();
    renderSidebarWithRouter({ onClose });

    startEditingName("Alice Laptop");

    const replaceShareBtn = screen
      .getAllByText("Replace Share")
      .find((el) => el.tagName === "BUTTON")!;
    fireEvent.click(replaceShareBtn);

    fireEvent.click(screen.getByTestId("settings-unsaved-discard"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfileName).not.toHaveBeenCalled();
    expect(screen.getByTestId("replace-share-route")).toBeInTheDocument();
  });

  it("Replace Share → Keep-editing dismisses dialog and does NOT navigate", () => {
    const onClose = vi.fn();
    renderSidebarWithRouter({ onClose });

    startEditingName("Alice Laptop");

    const replaceShareBtn = screen
      .getAllByText("Replace Share")
      .find((el) => el.tagName === "BUTTON")!;
    fireEvent.click(replaceShareBtn);

    fireEvent.click(screen.getByTestId("settings-unsaved-keep-editing"));

    expect(
      screen.queryByTestId("settings-unsaved-confirm"),
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("location-pathname").textContent).toBe("/");
    expect(
      screen.queryByTestId("replace-share-route"),
    ).not.toBeInTheDocument();
    // Draft survives — input still shows the typed value.
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    expect(input.value).toBe("Alice Laptop");
  });

  it("Replace Share with no unsaved edits proceeds immediately (no modal)", () => {
    const onClose = vi.fn();
    renderSidebarWithRouter({ onClose });

    const replaceShareBtn = screen
      .getAllByText("Replace Share")
      .find((el) => el.tagName === "BUTTON")!;
    fireEvent.click(replaceShareBtn);

    expect(
      screen.queryByTestId("settings-unsaved-confirm"),
    ).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("replace-share-route")).toBeInTheDocument();
  });

  it("saving the name clears the dirty flag so subsequent close is unguarded", async () => {
    const onClose = vi.fn();
    renderSidebar({ onClose });

    startEditingName("Alice Laptop");
    fireEvent.click(
      screen.getByRole("button", { name: /save profile name/i }),
    );
    await waitFor(() => {
      expect(mockUpdateProfileName).toHaveBeenCalledWith("Alice Laptop");
    });

    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(
      screen.queryByTestId("settings-unsaved-confirm"),
    ).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
