/**
 * m6-backup-publish — SettingsSidebar renders the
 * "Publish Backup to Relay" action row and wires its click handler
 * (VAL-BACKUP-001). The row is only present when the parent supplies
 * `onPublishBackup` so demo/test callers that predate the feature
 * keep working unchanged.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {});

afterEach(() => {
  cleanup();
});

describe("SettingsSidebar — Publish Backup action row (VAL-BACKUP-001)", () => {
  it("renders the Publish Backup row when onPublishBackup is supplied", () => {
    renderSidebar({ onPublishBackup: () => undefined });
    expect(
      screen.getByText("Publish Backup to Relay"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-publish-backup-btn"),
    ).toBeInTheDocument();
  });

  it("omits the Publish Backup row when no handler is supplied", () => {
    renderSidebar();
    expect(
      screen.queryByText("Publish Backup to Relay"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-publish-backup-btn"),
    ).not.toBeInTheDocument();
  });

  it("fires onPublishBackup when the Publish button is clicked", () => {
    const spy = vi.fn();
    renderSidebar({ onPublishBackup: spy });
    fireEvent.click(screen.getByTestId("settings-publish-backup-btn"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
