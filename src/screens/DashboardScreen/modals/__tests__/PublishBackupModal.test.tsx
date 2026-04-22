/**
 * Component coverage for the m6-backup-publish feature's
 * PublishBackupModal — exercises every validation + dispatch rule in
 * isolation (jsdom) without booting the real AppStateProvider.
 *
 * Assertions mapped to validation-contract IDs:
 *   - VAL-BACKUP-001: modal opens with password + confirm prompt
 *   - VAL-BACKUP-002: password ≥ 8 chars with matching confirm enables Publish
 *   - VAL-BACKUP-005: success state surfaces "Backup published to N relays"
 *   - VAL-BACKUP-007: no-relay → inline error, Publish disabled, no dispatch
 *   - VAL-BACKUP-024: confirm-mismatch → inline error, Publish disabled, no dispatch
 *   - VAL-BACKUP-025: strength meter fill reflects input entropy
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLISH_BACKUP_MIN_PASSWORD_LENGTH,
  PUBLISH_BACKUP_MISMATCH_ERROR,
  PUBLISH_BACKUP_NO_RELAYS_ERROR,
  PUBLISH_BACKUP_TOO_SHORT_ERROR,
  PublishBackupModal,
  publishBackupPasswordStrength,
  type PublishBackupResult,
} from "../PublishBackupModal";

const mockPublish = vi.fn<
  (password: string) => Promise<PublishBackupResult>
>();

function renderModal(
  props?: Partial<React.ComponentProps<typeof PublishBackupModal>>,
) {
  const merged: React.ComponentProps<typeof PublishBackupModal> = {
    groupName: "My Signing Key",
    shareIdx: 0,
    relayCount: 3,
    onCancel: () => {},
    onPublish: mockPublish,
    ...props,
  };
  return render(<PublishBackupModal {...merged} />);
}

beforeEach(() => {
  mockPublish.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublishBackupModal — validation + dispatch (VAL-BACKUP-001/002/005/007/024/025)", () => {
  it("renders the password + confirm prompt with Publish disabled (VAL-BACKUP-001)", () => {
    renderModal();
    expect(
      screen.getByRole("dialog", { name: /Publish Backup to Relay/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Backup Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(
      screen.getByTestId("publish-backup-submit"),
    ).toBeDisabled();
  });

  it("enables Publish when password ≥ 8 chars and confirm matches (VAL-BACKUP-002)", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "aLongPassword1" },
    });
    expect(
      screen.getByTestId("publish-backup-submit"),
    ).toBeEnabled();
  });

  it("keeps Publish disabled when the password is too short (VAL-BACKUP-002)", () => {
    renderModal();
    const tooShort = "a".repeat(PUBLISH_BACKUP_MIN_PASSWORD_LENGTH - 1);
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: tooShort },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: tooShort },
    });
    expect(
      screen.getByTestId("publish-backup-submit"),
    ).toBeDisabled();
    expect(screen.getByTestId("publish-backup-error").textContent).toBe(
      PUBLISH_BACKUP_TOO_SHORT_ERROR,
    );
  });

  it("blocks submit on confirm mismatch and surfaces the canonical error (VAL-BACKUP-024)", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "correcthorsebattery" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "mismatchedentry" },
    });
    expect(
      screen.getByTestId("publish-backup-submit"),
    ).toBeDisabled();
    expect(screen.getByTestId("publish-backup-error").textContent).toBe(
      PUBLISH_BACKUP_MISMATCH_ERROR,
    );
    // Click the disabled Publish button — nothing should dispatch
    // (belt-and-braces alongside the disabled attribute).
    fireEvent.click(screen.getByTestId("publish-backup-submit"));
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("renders a visible no-relay error and blocks Publish when relayCount === 0 (VAL-BACKUP-007)", () => {
    renderModal({ relayCount: 0 });
    // Type a valid password — should still be blocked by the no-relay
    // error since we cannot publish from this state at all.
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "aLongPassword1" },
    });
    expect(screen.getByTestId("publish-backup-error").textContent).toBe(
      PUBLISH_BACKUP_NO_RELAYS_ERROR,
    );
    expect(
      screen.getByTestId("publish-backup-submit"),
    ).toBeDisabled();
    fireEvent.click(screen.getByTestId("publish-backup-submit"));
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("dispatches publishProfileBackup with the entered password on submit", async () => {
    mockPublish.mockResolvedValue({
      reached: ["wss://relay.primal.net", "wss://relay.damus.io"],
      eventId: "eventid",
      createdAt: 1_700_000_000,
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.click(screen.getByTestId("publish-backup-submit"));
    await waitFor(() => {
      expect(mockPublish).toHaveBeenCalledWith("aLongPassword1");
    });
  });

  it("advances to the completion state after a successful publish (VAL-BACKUP-005)", async () => {
    mockPublish.mockResolvedValue({
      reached: ["wss://relay.primal.net", "wss://nos.lol"],
      eventId: "eventid",
      createdAt: 1_700_000_000,
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.click(screen.getByTestId("publish-backup-submit"));
    await waitFor(() => {
      expect(
        screen.getByTestId("publish-backup-modal-success"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Backup published to 2 relays/)).toBeInTheDocument();
    expect(screen.getByTestId("publish-backup-reached-list").textContent)
      .toBe("wss://relay.primal.net · wss://nos.lol");
  });

  it("surfaces mutator errors inline without advancing to success", async () => {
    mockPublish.mockRejectedValue(
      new Error("No relays available to publish to."),
    );
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "aLongPassword1" },
    });
    fireEvent.click(screen.getByTestId("publish-backup-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("publish-backup-error").textContent).toBe(
        "No relays available to publish to.",
      );
    });
    expect(
      screen.queryByTestId("publish-backup-modal-success"),
    ).not.toBeInTheDocument();
  });
});

describe("PublishBackupModal — strength meter (VAL-BACKUP-025)", () => {
  it("renders 0 filled segments for empty input", () => {
    renderModal();
    const bar = screen.getByTestId("publish-backup-strength-bar");
    expect(bar.getAttribute("data-strength")).toBe("0");
    for (let i = 0; i < 3; i++) {
      expect(
        screen
          .getByTestId(`publish-backup-strength-segment-${i}`)
          .getAttribute("data-filled"),
      ).toBe("false");
    }
  });

  it("renders 1 filled segment for a short low-entropy password (weak)", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "abcdefg" }, // 7 chars, no mixed class, >=6 → score 1
    });
    expect(
      screen.getByTestId("publish-backup-strength-bar").getAttribute("data-strength"),
    ).toBe("1");
  });

  it("renders 2 filled segments for a ≥10 char password without mixed class (medium)", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "abcdefghij" }, // 10 chars
    });
    expect(
      screen.getByTestId("publish-backup-strength-bar").getAttribute("data-strength"),
    ).toBe("2");
  });

  it("renders 3 filled segments for a ≥10 char password with mixed class (strong)", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Backup Password"), {
      target: { value: "Abcdef1234" },
    });
    expect(
      screen.getByTestId("publish-backup-strength-bar").getAttribute("data-strength"),
    ).toBe("3");
  });

  it("publishBackupPasswordStrength mapping is deterministic", () => {
    expect(publishBackupPasswordStrength("")).toBe(0);
    expect(publishBackupPasswordStrength("ab")).toBe(0);
    expect(publishBackupPasswordStrength("abcdef")).toBe(1);
    expect(publishBackupPasswordStrength("abcdefghij")).toBe(2);
    expect(publishBackupPasswordStrength("Abcdef1234")).toBe(3);
  });
});
