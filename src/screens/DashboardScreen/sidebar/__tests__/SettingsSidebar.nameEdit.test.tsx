import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "../SettingsSidebar";
import {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_EMPTY_ERROR,
  PROFILE_NAME_TOO_LONG_ERROR,
} from "../SettingsSidebar";

const mockUpdateProfileName = vi.fn();
const mockChangeProfilePassword = vi.fn();

type UseAppStateStub = {
  activeProfile: {
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
  } | null;
};

let activeProfileStub: UseAppStateStub["activeProfile"] = {
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

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: activeProfileStub,
    updateProfileName: mockUpdateProfileName,
    changeProfilePassword: mockChangeProfilePassword,
  }),
}));

function renderSidebar(props?: Partial<Parameters<typeof SettingsSidebar>[0]>) {
  const defaultProfile = activeProfileStub ?? {
    groupName: "My Signing Key",
    deviceName: "Igloo Web",
  };
  const mergedProps = {
    profile: {
      groupName: defaultProfile.groupName,
      deviceName: defaultProfile.deviceName,
    },
    relays: activeProfileStub?.relays ?? [
      "wss://relay.primal.net",
      "wss://relay.damus.io",
    ],
    groupPublicKey:
      activeProfileStub?.groupPublicKey ??
      "npub1qe3abcdef1234567890abcdef7k4m",
    threshold: activeProfileStub?.threshold ?? 2,
    memberCount: activeProfileStub?.memberCount ?? 3,
    shareIdx: activeProfileStub?.localShareIdx ?? 0,
    onClose: () => {},
    onLock: () => {},
    onClearCredentials: () => {},
    onExport: () => {},
    onExportShare: () => {},
    ...props,
  } as Parameters<typeof SettingsSidebar>[0];

  return render(
    <MemoryRouter>
      <SettingsSidebar {...mergedProps} />
    </MemoryRouter>,
  );
}

function enterEditMode() {
  fireEvent.click(screen.getByLabelText("Edit profile name"));
}

beforeEach(() => {
  mockUpdateProfileName.mockReset();
  mockUpdateProfileName.mockResolvedValue(undefined);
  mockChangeProfilePassword.mockReset();
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

describe("SettingsSidebar — Profile Name edit (VAL-SETTINGS-001/002/024/025)", () => {
  it("saves a valid trimmed name via updateProfileName (VAL-SETTINGS-001)", async () => {
    renderSidebar();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Alice Laptop  " } });
    fireEvent.click(screen.getByRole("button", { name: /save profile name/i }));

    await waitFor(() => {
      expect(mockUpdateProfileName).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateProfileName).toHaveBeenCalledWith("Alice Laptop");
  });

  it("rejects an empty name with an inline error and does NOT call updateProfileName (VAL-SETTINGS-002)", () => {
    renderSidebar();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    const save = screen.getByRole("button", {
      name: /save profile name/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(save);
    expect(screen.getByText(PROFILE_NAME_EMPTY_ERROR)).toBeInTheDocument();
    expect(mockUpdateProfileName).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only name with an inline error (VAL-SETTINGS-002)", () => {
    renderSidebar();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "     " } });
    expect(
      (screen.getByRole("button", {
        name: /save profile name/i,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(PROFILE_NAME_EMPTY_ERROR)).toBeInTheDocument();
    expect(mockUpdateProfileName).not.toHaveBeenCalled();
  });

  it("renders unicode/emoji/RTL names as literal text (VAL-SETTINGS-024)", async () => {
    const exotic = "🧊 مرحبا José 中文";
    activeProfileStub = {
      ...activeProfileStub!,
      deviceName: exotic,
    };
    renderSidebar({ profile: { groupName: "My Signing Key", deviceName: exotic } });
    expect(screen.getByText(exotic)).toBeInTheDocument();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    expect(input.value).toBe(exotic);
  });

  it("renders XSS payloads as literal text (no script injection) (VAL-SETTINGS-024)", () => {
    const xss = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    activeProfileStub = {
      ...activeProfileStub!,
      deviceName: xss,
    };
    renderSidebar({ profile: { groupName: "My Signing Key", deviceName: xss } });
    // Rendered value should equal the attacker string verbatim
    expect(screen.getByText(xss)).toBeInTheDocument();
    // No actual <script> or <img onerror=...> element should have been injected into the sidebar
    const sidebar = screen.getByTestId("settings-sidebar");
    expect(sidebar.querySelectorAll("script").length).toBe(0);
    expect(sidebar.querySelector("img[src='x']")).toBeNull();
  });

  it("enforces PROFILE_NAME_MAX_LENGTH via the HTML maxLength attribute (VAL-SETTINGS-025)", () => {
    renderSidebar();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    expect(input.maxLength).toBe(PROFILE_NAME_MAX_LENGTH);
  });

  it("shows an inline error if the typed name exceeds PROFILE_NAME_MAX_LENGTH (VAL-SETTINGS-025)", () => {
    renderSidebar();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    // Bypass the maxLength attribute via direct fireEvent.change (simulating paste semantics)
    const oversized = "a".repeat(PROFILE_NAME_MAX_LENGTH + 5);
    fireEvent.change(input, { target: { value: oversized } });

    expect(screen.getByText(PROFILE_NAME_TOO_LONG_ERROR)).toBeInTheDocument();
    expect(
      (screen.getByRole("button", {
        name: /save profile name/i,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("surfaces an inline error when updateProfileName rejects", async () => {
    mockUpdateProfileName.mockRejectedValueOnce(new Error("Persistence failed."));
    renderSidebar();
    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Valid Name" } });
    fireEvent.click(screen.getByRole("button", { name: /save profile name/i }));

    await waitFor(() => {
      expect(screen.getByText("Persistence failed.")).toBeInTheDocument();
    });
  });

  it("Cancel reverts draft edit without calling updateProfileName", () => {
    renderSidebar();

    enterEditMode();
    const input = screen.getByLabelText("Profile Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Abandon" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel profile name edit/i }));

    expect(mockUpdateProfileName).not.toHaveBeenCalled();
    expect(screen.getByText("Igloo Web")).toBeInTheDocument();
  });
});
