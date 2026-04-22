/**
 * m7-onboard-sponsor-ui — SettingsSidebar renders the
 * "Onboard a Device" entry (VAL-ONBOARD-001 / VAL-ONBOARD-002) and
 * disables it when the signer is paused (VAL-ONBOARD-024).
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "../SettingsSidebar";

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

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: baseProfile,
    updateProfileName: async () => undefined,
    changeProfilePassword: async () => undefined,
    updateRelays: async () => undefined,
  }),
}));

function renderSidebar(
  props?: Partial<Parameters<typeof SettingsSidebar>[0]>,
) {
  return render(
    <MemoryRouter>
      <SettingsSidebar
        profile={{
          groupName: baseProfile.groupName,
          deviceName: baseProfile.deviceName,
        }}
        relays={baseProfile.relays}
        groupPublicKey={baseProfile.groupPublicKey}
        threshold={baseProfile.threshold}
        memberCount={baseProfile.memberCount}
        shareIdx={baseProfile.localShareIdx}
        onClose={() => {}}
        onLock={() => {}}
        onClearCredentials={() => {}}
        onExport={() => {}}
        onExportShare={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("SettingsSidebar — Onboard a Device entry (VAL-ONBOARD-001 / 002 / 024)", () => {
  it("renders the Onboard a Device action row with the blue CTA", () => {
    renderSidebar();
    expect(screen.getByText("Sponsor a new device to join this keyset")).toBeInTheDocument();
    const btn = screen.getByTestId("settings-onboard-sponsor-btn");
    expect(btn).toBeInTheDocument();
    expect(btn.classList.contains("settings-btn-blue")).toBe(true);
  });

  it("button has an accessible name containing 'Onboard' (VAL-ONBOARD-002)", () => {
    renderSidebar();
    const btn = screen.getByRole("button", { name: /onboard/i });
    expect(btn).toBe(screen.getByTestId("settings-onboard-sponsor-btn"));
  });

  it("disables the button + surfaces paused hint when signerPaused=true (VAL-ONBOARD-024)", () => {
    renderSidebar({ signerPaused: true });
    const btn = screen.getByTestId(
      "settings-onboard-sponsor-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(
      screen.getByTestId("settings-onboard-sponsor-paused-hint"),
    ).toHaveTextContent(
      "Signer is paused. Resume the signer to sponsor a new device.",
    );
  });

  it("does not render a duplicate Onboard entry on the dashboard (VAL-ONBOARD-002: 'No duplicate affordance')", () => {
    renderSidebar();
    const matches = screen.getAllByRole("button", { name: /onboard/i });
    expect(matches).toHaveLength(1);
  });
});
