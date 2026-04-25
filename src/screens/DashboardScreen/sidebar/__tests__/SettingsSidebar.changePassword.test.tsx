import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "../SettingsSidebar";
import {
  CHANGE_PASSWORD_WRONG_CURRENT_ERROR,
  CHANGE_PASSWORD_SAME_AS_CURRENT_ERROR,
  CHANGE_PASSWORD_MISMATCH_ERROR,
  CHANGE_PASSWORD_TOO_SHORT_ERROR,
  CHANGE_PASSWORD_MIN_LENGTH,
} from "../SettingsSidebar";
import { BifrostPackageError } from "../../../../lib/bifrost/packageService";

const mockUpdateProfileName = vi.fn();
const mockUpdateRelays = vi.fn();
const mockChangeProfilePassword = vi.fn();

const fakeActiveProfile = {
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
    activeProfile: fakeActiveProfile,
    updateProfileName: mockUpdateProfileName,
    updateRelays: mockUpdateRelays,
    changeProfilePassword: mockChangeProfilePassword,
  }),
}));

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SettingsSidebar
        profile={{ groupName: "My Signing Key", deviceName: "Igloo Web" }}
        relays={fakeActiveProfile.relays}
        groupPublicKey={fakeActiveProfile.groupPublicKey}
        threshold={2}
        memberCount={3}
        shareIdx={0}
        onClose={() => {}}
        onLock={() => {}}
        onClearCredentials={() => {}}
        onExport={() => {}}
        onExportShare={() => {}}
      />
    </MemoryRouter>,
  );
}

function openChangePassword() {
  // Find the "Change" button next to Profile Password
  const changeBtn = screen.getByRole("button", { name: /^change password$/i });
  fireEvent.click(changeBtn);
}

function getField(name: RegExp) {
  return screen.getByLabelText(name) as HTMLInputElement;
}

beforeEach(() => {
  mockUpdateProfileName.mockReset();
  mockUpdateProfileName.mockResolvedValue(undefined);
  mockUpdateRelays.mockReset();
  mockUpdateRelays.mockResolvedValue(undefined);
  mockChangeProfilePassword.mockReset();
  mockChangeProfilePassword.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("SettingsSidebar — Change Password (VAL-SETTINGS-018/019/026/027/028)", () => {
  it("opens the change-password form when the Change button is clicked", () => {
    renderSidebar();
    openChangePassword();
    expect(getField(/current password/i)).toBeInTheDocument();
    expect(getField(/^new password/i)).toBeInTheDocument();
    expect(getField(/confirm new password/i)).toBeInTheDocument();
  });

  it("disables Update Password when fields are empty", () => {
    renderSidebar();
    openChangePassword();
    const save = screen.getByRole("button", {
      name: /update password/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("rejects sub-minimum-length new password with inline error and disables submit (VAL-SETTINGS-028)", () => {
    renderSidebar();
    openChangePassword();
    fireEvent.change(getField(/current password/i), { target: { value: "oldpass123" } });
    fireEvent.change(getField(/^new password/i), { target: { value: "abc" } });
    fireEvent.change(getField(/confirm new password/i), { target: { value: "abc" } });

    const save = screen.getByRole("button", {
      name: /update password/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(CHANGE_PASSWORD_TOO_SHORT_ERROR)).toBeInTheDocument();
    expect(CHANGE_PASSWORD_MIN_LENGTH).toBe(4);
    expect(mockChangeProfilePassword).not.toHaveBeenCalled();
  });

  it("disables submit and shows inline error when confirm does not match new (VAL-SETTINGS-027)", () => {
    renderSidebar();
    openChangePassword();
    fireEvent.change(getField(/current password/i), { target: { value: "oldpass123" } });
    fireEvent.change(getField(/^new password/i), { target: { value: "newpass123" } });
    fireEvent.change(getField(/confirm new password/i), { target: { value: "different123" } });

    const save = screen.getByRole("button", {
      name: /update password/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(CHANGE_PASSWORD_MISMATCH_ERROR)).toBeInTheDocument();
    expect(mockChangeProfilePassword).not.toHaveBeenCalled();
  });

  it("rejects new password equal to current with inline error (VAL-SETTINGS-026)", async () => {
    renderSidebar();
    openChangePassword();
    fireEvent.change(getField(/current password/i), { target: { value: "samepass123" } });
    fireEvent.change(getField(/^new password/i), { target: { value: "samepass123" } });
    fireEvent.change(getField(/confirm new password/i), { target: { value: "samepass123" } });

    const save = screen.getByRole("button", {
      name: /update password/i,
    }) as HTMLButtonElement;
    // Either disabled OR click surfaces inline error without dispatch
    if (!save.disabled) fireEvent.click(save);
    await waitFor(() => {
      expect(
        screen.getByText(CHANGE_PASSWORD_SAME_AS_CURRENT_ERROR),
      ).toBeInTheDocument();
    });
    expect(mockChangeProfilePassword).not.toHaveBeenCalled();
  });

  it("shows 'Current password is incorrect' when the mutator rejects with wrong_password (VAL-SETTINGS-019)", async () => {
    mockChangeProfilePassword.mockRejectedValueOnce(
      new BifrostPackageError("wrong_password", "decode failed"),
    );
    renderSidebar();
    openChangePassword();
    fireEvent.change(getField(/current password/i), { target: { value: "wrongcurrent" } });
    fireEvent.change(getField(/^new password/i), { target: { value: "newpass123" } });
    fireEvent.change(getField(/confirm new password/i), { target: { value: "newpass123" } });

    const save = screen.getByRole("button", {
      name: /update password/i,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      expect(
        screen.getByText(CHANGE_PASSWORD_WRONG_CURRENT_ERROR),
      ).toBeInTheDocument();
    });
    expect(mockChangeProfilePassword).toHaveBeenCalledTimes(1);
  });

  it("also maps a thrown Error whose message matches the canonical copy to the wrong-current message", async () => {
    mockChangeProfilePassword.mockRejectedValueOnce(
      new Error(CHANGE_PASSWORD_WRONG_CURRENT_ERROR),
    );
    renderSidebar();
    openChangePassword();
    fireEvent.change(getField(/current password/i), { target: { value: "wrongcurrent" } });
    fireEvent.change(getField(/^new password/i), { target: { value: "newpass123" } });
    fireEvent.change(getField(/confirm new password/i), { target: { value: "newpass123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /update password/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(CHANGE_PASSWORD_WRONG_CURRENT_ERROR),
      ).toBeInTheDocument();
    });
  });

  it("dispatches changeProfilePassword on a valid submit (VAL-SETTINGS-018)", async () => {
    renderSidebar();
    openChangePassword();
    fireEvent.change(getField(/current password/i), { target: { value: "oldpass123" } });
    fireEvent.change(getField(/^new password/i), { target: { value: "newpass123" } });
    fireEvent.change(getField(/confirm new password/i), { target: { value: "newpass123" } });

    fireEvent.click(
      screen.getByRole("button", { name: /update password/i }),
    );

    await waitFor(() => {
      expect(mockChangeProfilePassword).toHaveBeenCalledTimes(1);
    });
    expect(mockChangeProfilePassword).toHaveBeenCalledWith(
      "oldpass123",
      "newpass123",
    );
  });
});
