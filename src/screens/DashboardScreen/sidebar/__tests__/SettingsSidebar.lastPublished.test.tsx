/**
 * fix-m6-publish-backup-metadata — SettingsSidebar renders a
 * "Last published" indicator below the Publish Backup row whenever the
 * active profile has a stored `lastBackupPublishedAt` value, and
 * renders NOTHING when the field is absent.
 *
 * VAL-BACKUP-005 / VAL-BACKUP-031 require the indicator to survive
 * lock/unlock, so the render path reads from `activeProfile` (the
 * AppState mirror of the IndexedDB record) — this suite pins both the
 * null-case (first-time user) and the non-null case (published profile)
 * plus the underlying `formatLastBackupPublishedRelative` helper.
 */

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatLastBackupPublishedRelative,
  SettingsSidebar,
} from "../SettingsSidebar";
import type { StoredProfileSummary } from "../../../../lib/bifrost/types";

const baseSummary: StoredProfileSummary = {
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

let mockActiveProfile: StoredProfileSummary = baseSummary;

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: mockActiveProfile,
    updateProfileName: async () => undefined,
    changeProfilePassword: async () => undefined,
    updateRelays: async () => undefined,
  }),
}));

function renderSidebar(
  summary: StoredProfileSummary,
  props?: Partial<Parameters<typeof SettingsSidebar>[0]>,
) {
  mockActiveProfile = summary;
  return render(
    <MemoryRouter>
      <SettingsSidebar
        profile={{
          groupName: summary.groupName,
          deviceName: summary.deviceName,
        }}
        relays={summary.relays}
        groupPublicKey={summary.groupPublicKey}
        threshold={summary.threshold}
        memberCount={summary.memberCount}
        shareIdx={summary.localShareIdx}
        onClose={() => {}}
        onLock={() => {}}
        onClearCredentials={() => {}}
        onExport={() => {}}
        onExportShare={() => {}}
        onPublishBackup={() => undefined}
        {...props}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mockActiveProfile = baseSummary;
});

describe("SettingsSidebar — Last-published indicator (VAL-BACKUP-005 / VAL-BACKUP-031)", () => {
  it("renders nothing when lastBackupPublishedAt is undefined", () => {
    renderSidebar({
      ...baseSummary,
      lastBackupPublishedAt: undefined,
      lastBackupReachedRelayCount: undefined,
    });
    // The Publish Backup row itself should still render.
    expect(
      screen.getByTestId("settings-publish-backup-btn"),
    ).toBeInTheDocument();
    // But the last-published indicator should NOT render.
    expect(
      screen.queryByTestId("settings-publish-backup-last-published"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Last published:/i)).not.toBeInTheDocument();
  });

  it(
    "renders 'Last published: <relative> — reached N/M relays' when " +
      "lastBackupPublishedAt is set",
    () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      renderSidebar({
        ...baseSummary,
        relays: [
          "wss://relay.primal.net",
          "wss://relay.damus.io",
          "wss://nos.lol",
        ],
        lastBackupPublishedAt: nowSeconds - 5, // 5s ago
        lastBackupReachedRelayCount: 2,
      });
      const row = screen.getByTestId(
        "settings-publish-backup-last-published",
      );
      expect(row).toBeInTheDocument();
      // Copy must name the reach count AND the configured relay count
      // ("M" = configured) so the user can see partial delivery.
      expect(row.textContent).toMatch(/Last published:.*ago.*reached 2\/3/);
    },
  );

  it("omits indicator when onPublishBackup handler is not supplied", () => {
    renderSidebar(
      {
        ...baseSummary,
        lastBackupPublishedAt: Math.floor(Date.now() / 1000),
        lastBackupReachedRelayCount: 2,
      },
      { onPublishBackup: undefined },
    );
    // The feature gate is the action row. If the parent never wires
    // the Publish button the whole section is hidden.
    expect(
      screen.queryByTestId("settings-publish-backup-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-publish-backup-last-published"),
    ).not.toBeInTheDocument();
  });
});

describe("formatLastBackupPublishedRelative", () => {
  const now = 1_700_000_000_000; // fixed epoch-ms

  it("returns null for undefined / non-finite input", () => {
    expect(formatLastBackupPublishedRelative(undefined, now)).toBeNull();
    expect(
      formatLastBackupPublishedRelative(Number.NaN, now),
    ).toBeNull();
    expect(
      formatLastBackupPublishedRelative(Number.POSITIVE_INFINITY, now),
    ).toBeNull();
  });

  it("renders 'just now' for deltas <= 1 second", () => {
    const seconds = Math.floor(now / 1000);
    expect(formatLastBackupPublishedRelative(seconds, now)).toBe("just now");
    expect(formatLastBackupPublishedRelative(seconds - 1, now)).toBe(
      "just now",
    );
  });

  it("renders 'Ns ago' under one minute", () => {
    const seconds = Math.floor(now / 1000) - 15;
    expect(formatLastBackupPublishedRelative(seconds, now)).toBe(
      "15s ago",
    );
  });

  it("renders 'Nm ago' between one minute and one hour", () => {
    const seconds = Math.floor(now / 1000) - 5 * 60;
    expect(formatLastBackupPublishedRelative(seconds, now)).toBe(
      "5m ago",
    );
  });

  it("renders 'Nh ago' under a day", () => {
    const seconds = Math.floor(now / 1000) - 3 * 3600;
    expect(formatLastBackupPublishedRelative(seconds, now)).toBe(
      "3h ago",
    );
  });

  it("renders 'Nd ago' at a day or more", () => {
    const seconds = Math.floor(now / 1000) - 2 * 86400;
    expect(formatLastBackupPublishedRelative(seconds, now)).toBe(
      "2d ago",
    );
  });
});
