import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { MockAppStateProvider } from "../../app/AppState";
import { CoreRoutes } from "../../app/CoreRoutes";
import { demoScenarios } from "../../demo/scenarios";

/**
 * DashboardRefactorRegression — final regression pass confirming the
 * DashboardScreen refactor (M8) preserves every audit-flagged detail from
 * the validation contract after M8/M9 dashboard fidelity work landed
 * (feature: `dashboard-refactor-preserves-audit-details`, VAL-DSH-101).
 *
 * Each test below renders one dashboard scenario via `MockAppStateProvider`
 * (the same provider used by `DemoScenarioPage` at
 * `/demo/{scenario-id}`) and asserts a distinct audit-gap detail.
 *
 * Coverage map (topic → actual VAL ID per validation-contract.md):
 *   1. Running Stop-only CTA              → VAL-DSH-002  (AUDIT GAP)
 *   2. Start/Stop swap                    → VAL-DSH-007 / VAL-DSH-019
 *   3. Peer pill set on Running           → VAL-DSH-001  (audit-fix via refactor)
 *   4. Settings mono typography           → VAL-DSH-012  (AUDIT GAP)
 *   5. Policy prompt detail rows          → VAL-DSH-017
 *   6. Signing Failed exact copy          → VAL-DSH-018
 *
 * NOTE: the feature description lists `VAL-DSH-020`/`VAL-DSH-021`/
 * `VAL-DSH-022`/`VAL-DSH-023` against these topic labels, but the
 * validation contract's actual assertion IDs for the "peer pill set",
 * "mono typography", "policy prompt detail rows", and "signing-failed
 * exact copy" audit gaps are VAL-DSH-001, VAL-DSH-012, VAL-DSH-017, and
 * VAL-DSH-018 respectively. The test names below reference the contract
 * IDs (single source of truth) so that validators navigating by VAL ID
 * can find each audit-gap regression.
 */

afterEach(cleanup);

function scenarioByIdOrThrow(id: string) {
  const scenario = demoScenarios.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Expected demoScenarios to contain "${id}" for regression coverage`);
  }
  return scenario;
}

function renderScenario(id: string) {
  const scenario = scenarioByIdOrThrow(id);
  return render(
    <MemoryRouter>
      <MockAppStateProvider value={scenario.appState}>
        <CoreRoutes location={scenario.location} />
      </MockAppStateProvider>
    </MemoryRouter>
  );
}

describe("DashboardRefactorRegression — audit-gap details preserved after refactor (VAL-DSH-101)", () => {
  it("VAL-DSH-002 — Running status card exposes ONLY Stop Signer CTA (no inline Lock)", () => {
    renderScenario("dashboard-running");
    const statusCard = document.querySelector(".dash-status-card");
    expect(statusCard, "status card should render on dashboard-running").not.toBeNull();
    expect(statusCard!.textContent).toContain("Stop Signer");
    // No Lock / Lock Profile button inside the status card's inline action row.
    const locksInStatus = Array.from(statusCard!.querySelectorAll("button")).filter((btn) => {
      const label = btn.textContent?.trim() ?? "";
      return label === "Lock" || label === "Lock Profile";
    });
    expect(locksInStatus.length, "status card must not expose a Lock CTA alongside Stop Signer").toBe(0);
  });

  it("VAL-DSH-007 / VAL-DSH-019 — Stopped state swaps to Start Signer CTA (no Stop Signer)", () => {
    renderScenario("dashboard-stopped");
    expect(screen.getByText("Signer Stopped")).toBeInTheDocument();
    expect(screen.getByText("Start Signer")).toBeInTheDocument();
    expect(screen.queryByText("Stop Signer")).not.toBeInTheDocument();
  });

  it("VAL-DSH-001 — Running dashboard peer pill set (2 online · 3 total · ~186 ready · Avg: 31ms)", () => {
    renderScenario("dashboard-running");
    // Peer chips in the Peers panel header.
    expect(screen.getByText("2 online")).toBeInTheDocument();
    expect(screen.getByText("3 total")).toBeInTheDocument();
    expect(screen.getByText("~186 ready")).toBeInTheDocument();
    expect(screen.getByText("Avg: 31ms")).toBeInTheDocument();
    // Per-peer permission pills still render for online peers.
    const peerRows = Array.from(document.querySelectorAll(".peer-row"));
    expect(peerRows.length, "running dashboard should render exactly 3 peer rows").toBe(3);
    const pills0 = Array.from(peerRows[0].querySelectorAll(".permission-badge")).map((el) =>
      el.textContent?.trim()
    );
    expect(pills0).toContain("SIGN");
    expect(pills0).toContain("ECDH");
  });

  it("VAL-DSH-012 — Settings sidebar header uses Share Tech Mono typography", () => {
    renderScenario("dashboard-settings-lock-profile");
    const sidebar = screen.getByTestId("settings-sidebar");
    const title = sidebar.querySelector(".settings-title") as HTMLElement | null;
    expect(title, "settings-title element should exist").not.toBeNull();
    expect(title!.textContent).toBe("Settings");
    // jsdom does not resolve external stylesheets, but the SettingsSidebar
    // component applies an inline `font-family` mirror of the global.css
    // rule. Normalise quotes/underscores before asserting so that either
    // `"Share Tech Mono"` or `Share_Tech_Mono` is accepted.
    const fontFamily = window.getComputedStyle(title!).fontFamily;
    expect(fontFamily.replace(/['"]/g, "").replace(/_/g, " ")).toMatch(/Share Tech Mono/i);
  });

  it("VAL-DSH-017 — Signer Policy Prompt modal renders detail rows (EVENT KIND, CONTENT, PUBKEY, DOMAIN) with exact paper copy and peer-level CTAs (scoped variants hidden per VAL-APPROVALS-013 deviation)", () => {
    renderScenario("dashboard-policy-prompt");
    // Title + subtitle
    expect(screen.getByRole("heading", { name: "Signer Policy" })).toBeInTheDocument();
    expect(
      screen.getByText(/requesting permission to sign on your behalf/)
    ).toBeInTheDocument();
    // Every detail-row label is present
    expect(screen.getByText("EVENT KIND")).toBeInTheDocument();
    expect(screen.getByText("CONTENT")).toBeInTheDocument();
    expect(screen.getByText("PUBKEY")).toBeInTheDocument();
    expect(screen.getByText("DOMAIN")).toBeInTheDocument();
    // Detail values in order: kind:1 label, quoted content preview, short pubkey, domain
    expect(screen.getByText("kind:1 (Short Text Note)")).toBeInTheDocument();
    expect(screen.getByText(/gm nostr, anyone up for a coffee meetup/)).toBeInTheDocument();
    // The short pubkey renders twice (request header + PUBKEY detail row);
    // the short domain also appears both in the request header suffix and in
    // the DOMAIN detail row. Assert via the detail-row scope rather than
    // ambiguous getByText.
    const detailRows = Array.from(document.querySelectorAll(".policy-detail-row"));
    expect(detailRows.length, "policy prompt should expose 4 detail rows").toBe(4);
    const detailLabels = detailRows.map((row) =>
      row.querySelector(".policy-detail-label")?.textContent?.trim()
    );
    const detailValues = detailRows.map((row) =>
      row.querySelector(".policy-detail-value")?.textContent?.trim()
    );
    expect(detailLabels).toEqual(["EVENT KIND", "CONTENT", "PUBKEY", "DOMAIN"]);
    expect(detailValues[2]).toBe("029c4a...1f5e");
    expect(detailValues[3]).toBe("primal.net");
    // Countdown visible (live timer; the exact "42s" prefix is Paper-era
    // copy superseded by the reactive denial surface's client-side
    // countdown).
    expect(screen.getByText(/Expires in/)).toBeInTheDocument();
    // Peer-level CTAs remain present; Paper fixture mode also renders
    // the scoped action row for screenshot parity.
    for (const label of ["Deny", "Allow once", "Always allow", "Always deny"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Always for kind:1")).toBeInTheDocument();
    expect(screen.getByText("Always deny for primal.net")).toBeInTheDocument();
  });

  it("VAL-DSH-018 — Signing Failed modal renders neutral fallback copy (no synthesized peer-response ratio) + Dismiss/Retry", () => {
    renderScenario("dashboard-signing-failed");
    expect(screen.getByRole("heading", { name: "Signing Failed" })).toBeInTheDocument();
    // `fix-m1-signing-failed-modal-real-peer-response` (VAL-OPS-006):
    // when the modal is opened without a real OperationFailure payload
    // (Paper-only demo entry, no runtimeFailures correlation), the summary
    // renders a neutral fallback that does NOT fabricate a peer-response
    // ratio, denominator, or the old hard-coded "insufficient partial
    // signatures" copy.
    expect(
      screen.getByText(/failure details are unavailable/i),
    ).toBeInTheDocument();
    const codeBox = screen.getByTestId("signing-failed-code-text");
    expect(codeBox.textContent).toMatch(/failure details unavailable/i);
    expect(codeBox.textContent).not.toContain("Peers responded");
    expect(codeBox.textContent).not.toContain("no peers responded");
    expect(codeBox.textContent).not.toContain("1/2");
    expect(codeBox.textContent).not.toContain("r-0x4f2a");
    expect(codeBox.textContent).not.toContain(
      "insufficient partial signatures",
    );
    // Dual action CTAs preserved unchanged.
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });
});
