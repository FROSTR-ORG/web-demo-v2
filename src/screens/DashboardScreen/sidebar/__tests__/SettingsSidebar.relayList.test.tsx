import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RELAY_DUPLICATE_ERROR,
  RELAY_INVALID_URL_ERROR,
  SettingsSidebar,
} from "../SettingsSidebar";

/**
 * Component coverage for the m5-relay-list-persist feature — every
 * validation + persistence behavior is exercised here without booting
 * the real AppStateProvider (jsdom). See the multi-device Playwright
 * spec for the full hot-reload contract against a live relay pump.
 *
 * Assertions mapped to validation-contract IDs:
 *   - VAL-SETTINGS-003: adding a valid wss:// URL renders the row and
 *     dispatches the mutator.
 *   - VAL-SETTINGS-004: invalid schemes / malformed URLs are rejected
 *     with the canonical inline error and never reach the mutator.
 *   - VAL-SETTINGS-005: removing a relay dispatches the mutator with
 *     the filtered list and the row disappears.
 *   - VAL-SETTINGS-006: editing a relay URL dispatches the mutator
 *     with the swapped list.
 *   - VAL-SETTINGS-023: duplicate add / edit (case-insensitive,
 *     trailing-slash normalised) is rejected with the canonical error
 *     and never reaches the mutator.
 */

const mockUpdateRelays = vi.fn();
const mockUpdateProfileName = vi.fn();
const mockChangeProfilePassword = vi.fn();

const baseProfile = {
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

let activeProfile: typeof baseProfile = { ...baseProfile };

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile,
    updateProfileName: mockUpdateProfileName,
    changeProfilePassword: mockChangeProfilePassword,
    updateRelays: mockUpdateRelays,
  }),
}));

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SettingsSidebar
        profile={{ groupName: activeProfile.groupName, deviceName: activeProfile.deviceName }}
        relays={activeProfile.relays}
        groupPublicKey={activeProfile.groupPublicKey}
        threshold={activeProfile.threshold}
        memberCount={activeProfile.memberCount}
        shareIdx={activeProfile.localShareIdx}
        onClose={() => {}}
        onLock={() => {}}
        onClearCredentials={() => {}}
        onExport={() => {}}
        onExportShare={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUpdateRelays.mockReset();
  mockUpdateRelays.mockImplementation(async (next: string[]) => {
    activeProfile = { ...activeProfile, relays: next.slice() };
  });
  mockUpdateProfileName.mockReset();
  mockChangeProfilePassword.mockReset();
  activeProfile = {
    ...baseProfile,
    relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("SettingsSidebar — Relay List (VAL-SETTINGS-003..006, 023)", () => {
  it("renders every relay from activeProfile.relays as its own row", () => {
    renderSidebar();
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
  });

  it("Add dispatches updateRelays with the appended list (VAL-SETTINGS-003)", async () => {
    renderSidebar();
    const input = screen.getByLabelText("Add relay URL") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wss://nos.lol" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(mockUpdateRelays).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateRelays).toHaveBeenCalledWith([
      "wss://relay.primal.net",
      "wss://relay.damus.io",
      "wss://nos.lol",
    ]);
    // Input clears on success.
    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("Add rejects a non-wss URL with the canonical inline error (VAL-SETTINGS-004)", async () => {
    renderSidebar();
    const input = screen.getByLabelText("Add relay URL");
    fireEvent.change(input, { target: { value: "http://nos.lol" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByTestId("settings-relay-add-error"),
    ).toHaveTextContent(RELAY_INVALID_URL_ERROR);
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("renders the exact local demo relay when the dev env toggle is set", () => {
    vi.stubEnv("VITE_IGLOO_USE_LOCAL_RELAY", "1");
    renderSidebar();
    expect(screen.getByText("ws://127.0.0.1:8194")).toBeInTheDocument();
  });

  it("Add rejects local relay variants even when the dev env toggle is set", async () => {
    vi.stubEnv("VITE_IGLOO_USE_LOCAL_RELAY", "1");
    renderSidebar();
    const input = screen.getByLabelText("Add relay URL");
    fireEvent.change(input, { target: { value: "ws://localhost:8194" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByTestId("settings-relay-add-error"),
    ).toHaveTextContent(RELAY_INVALID_URL_ERROR);
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("Add rejects a malformed URL with the canonical inline error (VAL-SETTINGS-004)", async () => {
    renderSidebar();
    const input = screen.getByLabelText("Add relay URL");
    for (const bad of ["relay.example.com", "wss://", "not a url"]) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(
        await screen.findByTestId("settings-relay-add-error"),
      ).toHaveTextContent(RELAY_INVALID_URL_ERROR);
    }
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("Add rejects a duplicate URL (case-insensitive / trailing slash) with the canonical error (VAL-SETTINGS-023)", async () => {
    renderSidebar();
    const input = screen.getByLabelText("Add relay URL");
    fireEvent.change(input, {
      target: { value: "WSS://Relay.Damus.io/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      await screen.findByTestId("settings-relay-add-error"),
    ).toHaveTextContent(RELAY_DUPLICATE_ERROR);
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("Remove dispatches updateRelays with the filtered list (VAL-SETTINGS-005)", async () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Remove wss://relay.primal.net"));
    await waitFor(() => {
      expect(mockUpdateRelays).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateRelays).toHaveBeenCalledWith(["wss://relay.damus.io"]);
  });

  it("Remove is blocked when only one relay remains (cannot drop to zero)", () => {
    activeProfile = { ...activeProfile, relays: ["wss://relay.damus.io"] };
    renderSidebar();
    const removeBtn = screen.getByLabelText(
      "Remove wss://relay.damus.io",
    ) as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
    fireEvent.click(removeBtn);
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("Edit dispatches updateRelays with the swapped list (VAL-SETTINGS-006)", async () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Edit wss://relay.damus.io"));
    const editInput = screen.getByLabelText(
      "Edit wss://relay.damus.io",
    ) as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: "wss://nos.lol" } });
    fireEvent.click(screen.getByLabelText("Save wss://relay.damus.io"));
    await waitFor(() => {
      expect(mockUpdateRelays).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateRelays).toHaveBeenCalledWith([
      "wss://relay.primal.net",
      "wss://nos.lol",
    ]);
  });

  it("Edit rejects an invalid URL with the canonical inline error (VAL-SETTINGS-004)", async () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Edit wss://relay.damus.io"));
    const editInput = screen.getByLabelText("Edit wss://relay.damus.io");
    fireEvent.change(editInput, { target: { value: "ws://no.lol" } });
    fireEvent.click(screen.getByLabelText("Save wss://relay.damus.io"));
    expect(
      await screen.findByTestId("settings-relay-edit-error"),
    ).toHaveTextContent(RELAY_INVALID_URL_ERROR);
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("Remove preserves the auto-added local demo relay when the dev env toggle is set", async () => {
    vi.stubEnv("VITE_IGLOO_USE_LOCAL_RELAY", "1");
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Remove wss://relay.damus.io"));
    await waitFor(() => {
      expect(mockUpdateRelays).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateRelays).toHaveBeenCalledWith([
      "wss://relay.primal.net",
      "ws://127.0.0.1:8194",
    ]);
  });

  it("Edit rejects a duplicate with the canonical inline error (VAL-SETTINGS-023)", async () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Edit wss://relay.damus.io"));
    const editInput = screen.getByLabelText("Edit wss://relay.damus.io");
    fireEvent.change(editInput, {
      target: { value: "WSS://relay.primal.net/" },
    });
    fireEvent.click(screen.getByLabelText("Save wss://relay.damus.io"));
    expect(
      await screen.findByTestId("settings-relay-edit-error"),
    ).toHaveTextContent(RELAY_DUPLICATE_ERROR);
    expect(mockUpdateRelays).not.toHaveBeenCalled();
  });

  it("Edit Escape cancels without dispatching the mutator", () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Edit wss://relay.damus.io"));
    const editInput = screen.getByLabelText("Edit wss://relay.damus.io");
    fireEvent.change(editInput, { target: { value: "wss://nos.lol" } });
    fireEvent.keyDown(editInput, { key: "Escape" });
    expect(mockUpdateRelays).not.toHaveBeenCalled();
    // Row reverts to original value (no longer in edit mode).
    expect(screen.getByText("wss://relay.damus.io")).toBeInTheDocument();
  });

  it("surfaces a persistence-layer error as the inline add error", async () => {
    mockUpdateRelays.mockReset();
    mockUpdateRelays.mockRejectedValueOnce(new Error("Storage unavailable."));
    renderSidebar();
    fireEvent.change(screen.getByLabelText("Add relay URL"), {
      target: { value: "wss://nos.lol" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-relay-add-error"),
      ).toHaveTextContent("Storage unavailable.");
    });
  });
});
