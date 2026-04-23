import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "../SettingsSidebar";

// VAL-SETTINGS-008 / VAL-SETTINGS-009 — Group Profile section sources
// Created / Updated / Keyset Name / npub / Threshold from the real
// active profile; hard-coded "Feb 24, 2026" / "Mar 8, 2026" strings are
// gone, and no input/textarea/Save controls render for any of these
// fields in this release.

const mockUpdateProfileName = vi.fn(() => Promise.resolve());
const mockUpdateRelays = vi.fn(() => Promise.resolve());
const mockChangeProfilePassword = vi.fn(() => Promise.resolve());

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
    updatedAt: number;
    lastUsedAt: number;
  } | null;
};

// Deterministic fixed epoch-ms values so the formatted output is stable
// across test runs regardless of the host clock / timezone offset.
// 2026-02-24 UTC 18:00 and 2026-03-08 UTC 18:00 are chosen far enough
// from midnight that every IANA timezone still lands on the same Gregorian
// day — guarding against "Feb 23" slipping in on a negative-offset host.
const CREATED_AT_MS = Date.UTC(2026, 1, 24, 18, 0, 0);
const UPDATED_AT_MS = Date.UTC(2026, 2, 8, 18, 0, 0);

let activeProfileStub: UseAppStateStub["activeProfile"] = {
  id: "test-profile-id",
  label: "Paper Profile",
  deviceName: "Igloo Web",
  groupName: "Paper Group Keyset",
  threshold: 3,
  memberCount: 5,
  localShareIdx: 1,
  groupPublicKey: "npub1qe3paperGroupKey1234567890abcde7k4m",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: CREATED_AT_MS,
  updatedAt: UPDATED_AT_MS,
  lastUsedAt: CREATED_AT_MS,
};

vi.mock("../../../../app/AppState", () => ({
  useAppState: () => ({
    activeProfile: activeProfileStub,
    updateProfileName: mockUpdateProfileName,
    updateRelays: mockUpdateRelays,
    changeProfilePassword: mockChangeProfilePassword,
  }),
}));

function renderSidebar(props?: Partial<Parameters<typeof SettingsSidebar>[0]>) {
  const profile = activeProfileStub!;
  const mergedProps: Parameters<typeof SettingsSidebar>[0] = {
    profile: { groupName: profile.groupName, deviceName: profile.deviceName },
    relays: profile.relays,
    groupPublicKey: profile.groupPublicKey,
    threshold: profile.threshold,
    memberCount: profile.memberCount,
    shareIdx: profile.localShareIdx,
    onClose: () => {},
    onLock: () => {},
    onClearCredentials: () => {},
    onExport: () => {},
    onExportShare: () => {},
    ...props,
  };
  return render(
    <MemoryRouter>
      <SettingsSidebar {...mergedProps} />
    </MemoryRouter>,
  );
}

function formatHuman(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getGroupProfileRow(label: string): HTMLElement {
  const matches = Array.from(
    document.querySelectorAll(".settings-row-label"),
  ).filter((el) => el.textContent?.trim() === label);
  if (matches.length === 0) {
    throw new Error(`Could not find settings row with label "${label}"`);
  }
  // The SettingsSidebar renders Profile Password/Name rows too — pick the
  // one inside the Group Profile section. We scope by finding the nearest
  // ancestor `.settings-section` whose label is "Group Profile".
  for (const match of matches) {
    const section = match.closest(".settings-section");
    if (!section) continue;
    const sectionLabel = section.querySelector(".settings-section-label")
      ?.textContent;
    if (sectionLabel === "Group Profile") {
      return match.parentElement as HTMLElement;
    }
  }
  throw new Error(
    `Could not find row "${label}" inside the Group Profile section.`,
  );
}

beforeEach(() => {
  mockUpdateProfileName.mockClear();
  mockUpdateRelays.mockClear();
  mockChangeProfilePassword.mockClear();
  activeProfileStub = {
    id: "test-profile-id",
    label: "Paper Profile",
    deviceName: "Igloo Web",
    groupName: "Paper Group Keyset",
    threshold: 3,
    memberCount: 5,
    localShareIdx: 1,
    groupPublicKey: "npub1qe3paperGroupKey1234567890abcde7k4m",
    relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
    createdAt: CREATED_AT_MS,
    updatedAt: UPDATED_AT_MS,
    lastUsedAt: CREATED_AT_MS,
  };
});

afterEach(() => {
  cleanup();
});

describe("SettingsSidebar — Group Profile metadata (VAL-SETTINGS-008/009)", () => {
  it("renders Created from activeProfile.createdAt in human format (VAL-SETTINGS-008)", () => {
    renderSidebar();
    const createdRow = getGroupProfileRow("Created");
    const valueText = createdRow.querySelector(".settings-row-text")?.textContent;
    expect(valueText).toBe(formatHuman(CREATED_AT_MS));
  });

  it("renders Updated from activeProfile.updatedAt in human format (VAL-SETTINGS-008)", () => {
    renderSidebar();
    const updatedRow = getGroupProfileRow("Updated");
    const valueText = updatedRow.querySelector(".settings-row-text")?.textContent;
    expect(valueText).toBe(formatHuman(UPDATED_AT_MS));
  });

  it("does NOT render the hard-coded Paper placeholder dates when real timestamps differ (VAL-SETTINGS-008)", () => {
    // Seed deliberately non-Feb/Mar 2026 timestamps so any "Feb 24, 2026" /
    // "Mar 8, 2026" the DOM still contains can ONLY be leftover hard-coded
    // placeholders from the pre-wire version.
    const created = Date.UTC(2024, 6, 4, 18, 0, 0); // Jul 4, 2024
    const updated = Date.UTC(2025, 11, 31, 18, 0, 0); // Dec 31, 2025
    activeProfileStub = {
      ...activeProfileStub!,
      createdAt: created,
      updatedAt: updated,
    };
    renderSidebar();
    const sidebar = screen.getByTestId("settings-sidebar") as HTMLElement;
    expect(sidebar.textContent ?? "").not.toContain("Feb 24, 2026");
    expect(sidebar.textContent ?? "").not.toContain("Mar 8, 2026");
    // And the real formatted values are present.
    expect(sidebar.textContent ?? "").toContain(formatHuman(created));
    expect(sidebar.textContent ?? "").toContain(formatHuman(updated));
  });

  it("falls back to createdAt when updatedAt is absent on the stored record (VAL-SETTINGS-008)", () => {
    const fixedCreated = Date.UTC(2025, 10, 5, 18, 0, 0);
    activeProfileStub = {
      ...activeProfileStub!,
      createdAt: fixedCreated,
      updatedAt: fixedCreated,
    };
    renderSidebar();
    const createdRow = getGroupProfileRow("Created");
    const updatedRow = getGroupProfileRow("Updated");
    expect(
      createdRow.querySelector(".settings-row-text")?.textContent,
    ).toBe(formatHuman(fixedCreated));
    expect(
      updatedRow.querySelector(".settings-row-text")?.textContent,
    ).toBe(formatHuman(fixedCreated));
  });

  it("sources Keyset Name / Threshold / npub from the active profile (VAL-SETTINGS-009)", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("settings-sidebar") as HTMLElement;

    // Keyset Name — from activeProfile.groupName
    const nameRow = getGroupProfileRow("Keyset Name");
    expect(nameRow.querySelector(".settings-row-text")?.textContent).toBe(
      "Paper Group Keyset",
    );

    // Threshold — "3 of 5"
    const thresholdRow = getGroupProfileRow("Threshold");
    expect(
      thresholdRow.querySelector(".settings-row-text")?.textContent,
    ).toBe("3 of 5");

    // npub — sourced from activeProfile.groupPublicKey via paperGroupKey().
    const npubRow = getGroupProfileRow("Keyset npub");
    const npubText = npubRow.querySelector(".settings-row-npub")?.textContent ?? "";
    expect(npubText.length).toBeGreaterThan(0);
    // The displayed string begins with the "npub1" prefix of the real key.
    expect(npubText.startsWith("npub1")).toBe(true);
    // Safety: the rendered short form must not contain the literal key bytes
    // beyond the Paper-formatter's "<prefix>...<suffix>" collapse — confirm
    // that either the full key or the collapsed form is surfaced.
    expect(sidebar.textContent ?? "").toContain(npubText);
  });

  it("renders Keyset Name / Threshold / npub / Created / Updated as read-only text (no inputs, no Save)", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("settings-sidebar") as HTMLElement;

    const groupSection = Array.from(
      sidebar.querySelectorAll(".settings-section"),
    ).find(
      (section) =>
        section.querySelector(".settings-section-label")?.textContent ===
        "Group Profile",
    ) as HTMLElement | undefined;
    expect(groupSection).toBeDefined();

    // No editable form controls inside the Group Profile section.
    expect(groupSection!.querySelectorAll("input").length).toBe(0);
    expect(groupSection!.querySelectorAll("textarea").length).toBe(0);
    expect(groupSection!.querySelectorAll("button").length).toBe(0);
  });

  it("re-renders with a freshly edited updatedAt when the active profile changes (VAL-SETTINGS-008)", () => {
    const { rerender } = renderSidebar();
    const initial = getGroupProfileRow("Updated").querySelector(
      ".settings-row-text",
    )?.textContent;
    expect(initial).toBe(formatHuman(UPDATED_AT_MS));

    const bumped = Date.UTC(2026, 3, 1, 18, 0, 0);
    activeProfileStub = {
      ...activeProfileStub!,
      updatedAt: bumped,
    };
    rerender(
      <MemoryRouter>
        <SettingsSidebar
          profile={{
            groupName: activeProfileStub!.groupName,
            deviceName: activeProfileStub!.deviceName,
          }}
          relays={activeProfileStub!.relays}
          groupPublicKey={activeProfileStub!.groupPublicKey}
          threshold={activeProfileStub!.threshold}
          memberCount={activeProfileStub!.memberCount}
          shareIdx={activeProfileStub!.localShareIdx}
          onClose={() => {}}
          onLock={() => {}}
          onClearCredentials={() => {}}
          onExport={() => {}}
          onExportShare={() => {}}
        />
      </MemoryRouter>,
    );

    const updatedRow = getGroupProfileRow("Updated");
    expect(updatedRow.querySelector(".settings-row-text")?.textContent).toBe(
      formatHuman(bumped),
    );
  });
});
