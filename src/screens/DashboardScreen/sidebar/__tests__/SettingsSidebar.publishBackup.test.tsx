import {
  cleanup,
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

describe("SettingsSidebar — relay backup publish removal", () => {
  it("does not render the Publish Backup to Relay action or last-published indicator", () => {
    renderSidebar();
    expect(
      screen.queryByText("Publish Backup to Relay"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-publish-backup-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-publish-backup-last-published"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Last published:/i)).not.toBeInTheDocument();
  });
});
