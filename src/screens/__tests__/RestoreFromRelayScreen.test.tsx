/**
 * m6-backup-restore — `RestoreFromRelayScreen` unit tests.
 *
 * Covers the validation surface described in the feature contract:
 *   - VAL-BACKUP-032: invalid relay URL disables submit (no network I/O).
 *   - VAL-BACKUP-011: wrong password → inline password error, form
 *     remains populated.
 *   - VAL-BACKUP-012: "No backup found" rejection → dedicated empty
 *     state renders next to the submit button.
 *
 * We stub `useAppState` to isolate the UI from the WASM bridge; the
 * end-to-end wiring is exercised separately in the multi-device
 * Playwright spec (`src/e2e/multi-device/backup-restore.spec.ts`).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RestoreFromRelayScreen } from "../RestoreFromRelayScreen";

const mockRestoreProfileFromRelay = vi.fn();

vi.mock("../../app/AppState", () => ({
  useAppState: () => ({
    restoreProfileFromRelay: mockRestoreProfileFromRelay,
  }),
}));

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/restore-from-relay"]}>
      <RestoreFromRelayScreen />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mockRestoreProfileFromRelay.mockReset();
});

describe("RestoreFromRelayScreen", () => {
  it("renders the screen heading and the submit button (disabled by default)", () => {
    renderScreen();
    expect(
      screen.getByRole("heading", { name: /Restore from Relay/i }),
    ).toBeDefined();
    const submit = screen.getByRole("button", {
      name: /Restore from Relay/i,
    });
    expect(submit.hasAttribute("disabled")).toBe(true);
  });

  it("VAL-BACKUP-032: disables submit and surfaces an inline error when the relay list contains an invalid URL", () => {
    renderScreen();

    const relayTextarea = screen.getByPlaceholderText(/wss:\/\/relay\.example/);
    fireEvent.change(relayTextarea, {
      target: {
        value: "http://not-a-wss.example.com\nwss://relay.primal.net",
      },
    });

    const bfshareTextarea = screen.getByPlaceholderText(/bfshare1/);
    fireEvent.change(bfshareTextarea, {
      target: { value: "bfshare1validlookingtoken" },
    });

    const passwordInput = screen.getByPlaceholderText(
      /Share package password/i,
    );
    fireEvent.change(passwordInput, {
      target: { value: "longEnoughPassword" },
    });

    expect(
      screen.getByText(/Relay URL must start with wss:\/\//i),
    ).toBeDefined();
    const submit = screen.getByRole("button", {
      name: /Restore from Relay/i,
    });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(mockRestoreProfileFromRelay).not.toHaveBeenCalled();
  });

  it("VAL-BACKUP-011: surfaces 'Invalid password' inline on wrong password", async () => {
    mockRestoreProfileFromRelay.mockRejectedValueOnce(
      new Error("Invalid password — could not decrypt this backup."),
    );
    const { container } = renderScreen();

    fireEvent.change(
      screen.getByPlaceholderText(/bfshare1/),
      { target: { value: "bfshare1abcdef" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(/Share package password/i),
      { target: { value: "someLongPassword" } },
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid password — could not decrypt/i),
      ).toBeDefined();
    });

    // Form fields remain populated for retry.
    expect(
      (screen.getByPlaceholderText(/bfshare1/) as HTMLTextAreaElement).value,
    ).toContain("bfshare1abcdef");
    expect(
      (
        screen.getByPlaceholderText(
          /Share package password/i,
        ) as HTMLInputElement
      ).value,
    ).toBe("someLongPassword");
  });

  it("VAL-BACKUP-012: renders the 'No backup found' empty state on timeout", async () => {
    mockRestoreProfileFromRelay.mockRejectedValueOnce(
      new Error("No backup found for this share."),
    );
    const { container } = renderScreen();

    fireEvent.change(
      screen.getByPlaceholderText(/bfshare1/),
      { target: { value: "bfshare1abcdef" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(/Share package password/i),
      { target: { value: "someLongPassword" } },
    );

    const form = container.querySelector("form");
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByTestId("restore-empty-state")).toBeDefined();
    });
    expect(
      screen.getByText(/No backup found for this share\./i),
    ).toBeDefined();
  });

  it("happy path: calls the mutator with trimmed relay list and bfshare + surfaces success copy", async () => {
    mockRestoreProfileFromRelay.mockResolvedValueOnce({
      profile: {
        id: "restored-id",
        label: "Test Key",
        deviceName: "Igloo Web",
        groupName: "Test Key",
        threshold: 2,
        memberCount: 3,
        localShareIdx: 0,
        groupPublicKey: "pk",
        relays: ["wss://relay.primal.net"],
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
      },
      alreadyExisted: false,
    });
    const { container } = renderScreen();

    fireEvent.change(
      screen.getByPlaceholderText(/bfshare1/),
      { target: { value: "  bfshare1abcdef  " } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(/Share package password/i),
      { target: { value: "someLongPassword" } },
    );

    const form = container.querySelector("form");
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockRestoreProfileFromRelay).toHaveBeenCalledTimes(1);
    });
    const call = mockRestoreProfileFromRelay.mock.calls[0]![0];
    expect(call.bfshare).toBe("bfshare1abcdef");
    expect(call.bfsharePassword).toBe("someLongPassword");
    expect(call.relays).toEqual([
      "wss://relay.primal.net",
      "wss://relay.damus.io",
    ]);
    await waitFor(() => {
      expect(screen.getByText(/Restored "Test Key" successfully/i)).toBeDefined();
    });
  });
});
