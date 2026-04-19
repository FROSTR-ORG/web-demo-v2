import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { demoScenarioById } from "../scenarios";
import { DEMO_PROFILE_ID } from "../fixtures";

/*
 * Regression tests for the 5 user-testing failures discovered in the
 * `create-and-shared-create` milestone (round 1 synthesis). Each test pins the
 * narrow behavioral contract that the fix introduces so future refactors can't
 * silently re-break the demo → real-app navigation boundary.
 *
 * Failures addressed:
 *   - VAL-CRT-007 / VAL-CRT-012: /demo/create-keyset → /create/progress
 *   - VAL-SHR-005:              /demo/shared-create-profile → /create/distribute
 *   - VAL-SHR-008:              .package-actions.locked Copy/QR @ opacity 0.4
 *   - VAL-SHR-011:              /demo/shared-distribution-completion → /dashboard/{id}
 */

describe("demo scenario bridge continuity — VAL-CRT-007 / VAL-CRT-012", () => {
  it("create-keyset scenario primes createSession.keyset so GenerationProgressScreen renders after hand-off", () => {
    const scenario = demoScenarioById.get("create-keyset");
    expect(scenario).toBeDefined();
    // Without a seeded createSession, navigating to /create/progress would
    // cause the real AppStateProvider to redirect back to /create because
    // GenerationProgressScreen's guard fires on missing keyset.
    expect(scenario!.appState.createSession).toBeTruthy();
    expect(scenario!.appState.createSession?.keyset).toBeTruthy();
    expect(scenario!.appState.createSession?.localShare).toBeTruthy();
  });
});

describe("demo scenario bridge continuity — VAL-SHR-005", () => {
  it("shared-create-profile scenario carries createdProfileId so DistributeSharesScreen renders after hand-off", () => {
    const scenario = demoScenarioById.get("shared-create-profile");
    expect(scenario).toBeDefined();
    expect(scenario!.appState.createSession?.keyset).toBeTruthy();
    expect(scenario!.appState.createSession?.localShare).toBeTruthy();
    // DistributeSharesScreen guards on `!createSession.createdProfileId`.
    expect(scenario!.appState.createSession?.createdProfileId).toBe(DEMO_PROFILE_ID);
  });
});

describe("demo scenario bridge continuity — VAL-SHR-011", () => {
  it("shared-distribution-completion scenario carries runtimeStatus so DashboardScreen does not redirect to /", () => {
    const scenario = demoScenarioById.get("shared-distribution-completion");
    expect(scenario).toBeDefined();
    // DashboardScreen guard: `!activeProfile || activeProfile.id !== profileId || !runtimeStatus`
    expect(scenario!.appState.activeProfile?.id).toBe(DEMO_PROFILE_ID);
    expect(scenario!.appState.runtimeStatus).toBeTruthy();
    expect(scenario!.appState.createSession?.createdProfileId).toBe(DEMO_PROFILE_ID);
  });
});

describe("CSS regression — VAL-SHR-008", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");

  it("locked package-actions disabled chips render at exactly 0.4 opacity (not the default 0.45)", () => {
    // The container itself should NOT cascade a 0.4 opacity anymore — that
    // would multiply with the per-button rule and break the expected
    // computed opacity of 0.4 measured by agent-browser.
    expect(css).toMatch(/\.package-actions\.locked\s*\{[^}]*opacity:\s*1\b[^}]*\}/);

    // Per-button override restores the 0.4 computed opacity.
    expect(css).toMatch(
      /\.package-actions\.locked\s+button:disabled[\s\S]*?\{[^}]*opacity:\s*0\.4\b[^}]*\}/
    );
  });

  it("retains the global button:disabled 0.45 opacity for unrelated disabled buttons", () => {
    expect(css).toMatch(/button:disabled[\s\S]{0,200}opacity:\s*0\.45/);
  });
});
