import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAppStateProvider } from "../../../../app/AppState";
import type {
  AppStateValue,
  PolicyOverrideEntry,
} from "../../../../app/AppStateTypes";
import { CoreRoutes } from "../../../../app/CoreRoutes";
import { demoScenarios } from "../../../../demo/scenarios";

/**
 * fix-m2-peer-policies-view-persistence-and-remove — component-level
 * coverage for the Peer Policies view's "Active overrides" section.
 *
 *  - (a) For a seeded persistent allow override, the row renders the
 *    peer label, verb, "Allow" effect, a "Persistent" chip, and a
 *    Remove button.
 *  - (b) Clicking Remove invokes `removePolicyOverride` with the matching
 *    (peer, direction, method) tuple.
 *  - (c) Session-scoped entries render with a "Session" chip distinct
 *    from the "Persistent" chip so the user can tell them apart.
 */

afterEach(cleanup);

function scenarioByIdOrThrow(id: string) {
  const scenario = demoScenarios.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Expected demoScenarios to contain "${id}"`);
  }
  return scenario;
}

function renderPoliciesWithOverrides(
  overrides: PolicyOverrideEntry[],
  removeSpy?: AppStateValue["removePolicyOverride"],
) {
  const scenario = scenarioByIdOrThrow("dashboard-policies");
  const baseState = scenario.appState;
  const seededState: AppStateValue = {
    ...baseState,
    policyOverrides: overrides,
    removePolicyOverride: removeSpy ?? baseState.removePolicyOverride,
  };
  return render(
    <MemoryRouter>
      <MockAppStateProvider value={seededState} bridge={false}>
        <CoreRoutes location={scenario.location} />
      </MockAppStateProvider>
    </MemoryRouter>,
  );
}

describe("PoliciesState — active peer-policy overrides subsection", () => {
  it("renders a Persistent row with peer label, verb, Allow effect, and Remove control for a persistent allow", () => {
    const peerPubkey =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    renderPoliciesWithOverrides([
      {
        peer: peerPubkey,
        direction: "respond",
        method: "sign",
        value: "allow",
        source: "persistent",
        createdAt: Date.now(),
      },
    ]);

    const rows = screen.getAllByTestId("policy-override-row");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.getAttribute("data-override-peer")).toBe(peerPubkey);
    expect(row.getAttribute("data-override-method")).toBe("sign");
    expect(row.getAttribute("data-override-direction")).toBe("respond");
    expect(row.getAttribute("data-override-source")).toBe("persistent");
    expect(row.getAttribute("data-override-value")).toBe("allow");
    // Verb is rendered upper-case inside the row.
    expect(row.textContent).toContain("SIGN");
    // Effect shows "Allow" (not the raw "allow" token).
    expect(row.textContent).toContain("Allow");
    // Persistence chip reads "Persistent".
    const persistenceChip = row.querySelector(
      "[data-testid='policy-override-persistence']",
    );
    expect(persistenceChip?.textContent).toBe("Persistent");
    // Remove control present and accessibly labelled.
    const removeButton = row.querySelector("button.policies-override-remove");
    expect(removeButton).toBeTruthy();
    expect(removeButton?.getAttribute("aria-label")).toMatch(/Remove/i);
  });

  it("clicking Remove invokes removePolicyOverride with the row's (peer, direction, method) tuple", async () => {
    const peerPubkey =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const removeSpy = vi.fn<AppStateValue["removePolicyOverride"]>(
      async () => undefined,
    );
    renderPoliciesWithOverrides(
      [
        {
          peer: peerPubkey,
          direction: "respond",
          method: "ecdh",
          value: "deny",
          source: "persistent",
          createdAt: Date.now(),
        },
      ],
      removeSpy,
    );

    const row = screen.getByTestId("policy-override-row");
    const removeButton = row.querySelector(
      "button.policies-override-remove",
    ) as HTMLButtonElement;
    expect(removeButton).toBeTruthy();

    fireEvent.click(removeButton);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith({
      peer: peerPubkey,
      direction: "respond",
      method: "ecdh",
    });
  });

  it("session-scoped entries render with a 'Session' chip (distinguishable from 'Persistent')", () => {
    const peerPubkey =
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    renderPoliciesWithOverrides([
      {
        peer: peerPubkey,
        direction: "respond",
        method: "sign",
        value: "allow",
        source: "session",
        createdAt: Date.now(),
      },
    ]);
    const row = screen.getByTestId("policy-override-row");
    expect(row.getAttribute("data-override-source")).toBe("session");
    const chip = row.querySelector(
      "[data-testid='policy-override-persistence']",
    );
    expect(chip?.textContent).toBe("Session");
  });
});
