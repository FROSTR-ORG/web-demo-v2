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
 * m3-signer-policies-crud — component-level coverage for the Signer
 * Policies rule list. Covers VAL-POLICIES-014 (pill semantics +
 * Remove dispatches unset) and VAL-POLICIES-018 (empty state surfaces
 * when last rule removed).
 *
 * The Signer Policies rule list now reads from the active peer-policy
 * overrides (no MOCK_SIGNER_RULES). Decision pill mapping:
 *   - persistent + allow → "Always"
 *   - session    + allow → "Allow once"
 *   - persistent + deny  → "Deny"
 *
 * Remove dispatches `removePolicyOverride` (which in turn calls
 * `set_policy_override({value: "unset"})` for the targeted
 * `(direction, method, peer)` triple — VAL-POLICIES-014 remove leg).
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

describe("PoliciesState — Signer Policies rule list (VAL-POLICIES-014/018)", () => {
  it("renders an 'Always' pill for a persistent allow override", () => {
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
    // The rule row carries the Paper-spec `.policies-rule-row` class
    // so CSS parity holds.
    expect(row.classList.contains("policies-rule-row")).toBe(true);
    expect(row.getAttribute("data-override-peer")).toBe(peerPubkey);
    expect(row.getAttribute("data-override-direction")).toBe("respond");
    expect(row.getAttribute("data-override-method")).toBe("sign");
    expect(row.getAttribute("data-override-source")).toBe("persistent");
    expect(row.getAttribute("data-override-value")).toBe("allow");

    // method rendered upper-case in the `.policies-method` span so the
    // rule list distinguishes SIGN / ECDH / PING / ONBOARD at a glance.
    const method = row.querySelector(".policies-method");
    expect(method?.textContent).toBe("SIGN");

    // Peer identity rendered in the `.policies-domain` span, truncated
    // via shortHex so long pubkeys stay readable.
    const domain = row.querySelector(".policies-domain");
    expect(domain?.textContent).toMatch(/aaaaaaaa\.\.\.aaaa/);

    // Decision pill reads "Always" for a persistent allow.
    const pill = row.querySelector(".policies-permission-badge");
    expect(pill?.textContent).toBe("Always");
    expect(pill?.classList.contains("always")).toBe(true);

    // Remove control is present and accessibly labelled.
    const removeButton = row.querySelector("button.policies-remove-btn");
    expect(removeButton).toBeTruthy();
    expect(removeButton?.getAttribute("aria-label")).toMatch(/Remove/i);
  });

  it("renders an 'Allow once' pill for a session allow override", () => {
    const peerPubkey =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    renderPoliciesWithOverrides([
      {
        peer: peerPubkey,
        direction: "respond",
        method: "ecdh",
        value: "allow",
        source: "session",
        createdAt: Date.now(),
      },
    ]);

    const row = screen.getByTestId("policy-override-row");
    expect(row.getAttribute("data-override-source")).toBe("session");
    expect(row.getAttribute("data-override-value")).toBe("allow");
    const pill = row.querySelector(".policies-permission-badge");
    expect(pill?.textContent).toBe("Allow once");
    expect(pill?.classList.contains("allow-once")).toBe(true);
    const method = row.querySelector(".policies-method");
    expect(method?.textContent).toBe("ECDH");
  });

  it("renders a 'Deny' pill for a persistent deny override", () => {
    const peerPubkey =
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    renderPoliciesWithOverrides([
      {
        peer: peerPubkey,
        direction: "respond",
        method: "sign",
        value: "deny",
        source: "persistent",
        createdAt: Date.now(),
      },
    ]);

    const row = screen.getByTestId("policy-override-row");
    expect(row.getAttribute("data-override-value")).toBe("deny");
    const pill = row.querySelector(".policies-permission-badge");
    expect(pill?.textContent).toBe("Deny");
    expect(pill?.classList.contains("deny")).toBe(true);
  });

  it("renders one rule row per override and sorts newest first", () => {
    const peerA =
      "1111111111111111111111111111111111111111111111111111111111111111";
    const peerB =
      "2222222222222222222222222222222222222222222222222222222222222222";
    renderPoliciesWithOverrides([
      {
        peer: peerA,
        direction: "respond",
        method: "sign",
        value: "allow",
        source: "persistent",
        createdAt: 1000,
      },
      {
        peer: peerB,
        direction: "respond",
        method: "ecdh",
        value: "deny",
        source: "persistent",
        createdAt: 2000,
      },
    ]);
    const rows = screen.getAllByTestId("policy-override-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-override-peer")).toBe(peerB);
    expect(rows[1].getAttribute("data-override-peer")).toBe(peerA);
  });

  it("clicking Remove dispatches removePolicyOverride with the row's (peer, direction, method) tuple (VAL-POLICIES-014 remove leg)", () => {
    const peerPubkey =
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const removeSpy = vi.fn<AppStateValue["removePolicyOverride"]>(
      async () => undefined,
    );
    renderPoliciesWithOverrides(
      [
        {
          peer: peerPubkey,
          direction: "respond",
          method: "onboard",
          value: "allow",
          source: "persistent",
          createdAt: Date.now(),
        },
      ],
      removeSpy,
    );

    const row = screen.getByTestId("policy-override-row");
    const removeButton = row.querySelector(
      "button.policies-remove-btn",
    ) as HTMLButtonElement;
    expect(removeButton).toBeTruthy();

    fireEvent.click(removeButton);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith({
      peer: peerPubkey,
      direction: "respond",
      method: "onboard",
    });
  });

  it("surfaces the Paper-spec empty state when there are no overrides (VAL-POLICIES-018)", () => {
    renderPoliciesWithOverrides([]);
    expect(screen.queryAllByTestId("policy-override-row")).toHaveLength(0);
    expect(
      screen.getByText(
        "No explicit signer policies. Default policy applies to new requests.",
      ),
    ).toBeTruthy();
  });

  it("does NOT render from the legacy MOCK_SIGNER_RULES fixture in runtime mode", () => {
    // With zero overrides seeded, the legacy three-row MOCK_SIGNER_RULES
    // (sign_event:1, nip44_encrypt, get_public_key) must NOT appear.
    renderPoliciesWithOverrides([]);
    expect(screen.queryByText("sign_event:1")).toBeNull();
    expect(screen.queryByText("nip44_encrypt")).toBeNull();
    expect(screen.queryByText("get_public_key")).toBeNull();
  });
});
