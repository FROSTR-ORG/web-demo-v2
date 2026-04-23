import { test, expect, type Page } from "@playwright/test";

/**
 * Browser-back behaviour for feature
 * `fix-m7-ut-r1-direct-evidence-and-deviations` → VAL-CROSS-023.
 *
 * Contract (VAL-CROSS-023): from a deep route (e.g. `/dashboard/:id`
 * → `/onboard-sponsor`), pressing the browser Back button returns to
 * the previous in-session route without re-prompting for passphrase,
 * without forcing Welcome, and without losing pending_operations or
 * runtimeEventLog state.
 *
 * The production app does not expose a `/dashboard/:id/settings`
 * sub-route — Settings is a sidebar overlay over `/dashboard/:id`.
 * The closest "deep route" the user can reach from the dashboard is
 * `/onboard-sponsor`, which the Settings sidebar navigates to via
 * `navigate("/onboard-sponsor")`. This spec exercises the contract
 * on that deep route: observe dashboard state snapshot → navigate to
 * `/onboard-sponsor` → `page.goBack()` → assert the dashboard route
 * is restored AND the pending_operations / runtimeEventLog
 * observables did not regress.
 *
 * To run manually:
 *   npx playwright test \
 *     src/e2e/browser-back/dashboard-back.spec.ts \
 *     --project=desktop --workers 1 --repeat-each=3
 */

const HOOKS_READY_TIMEOUT_MS = 15_000;
const RUNTIME_READY_TIMEOUT_MS = 20_000;

interface SpecGroup {
  group_name: string;
  group_pk: string;
  threshold: number;
  members: Array<{ idx: number; pubkey: string }>;
}
interface SpecShare {
  idx: number;
  seckey: string;
}
interface SpecKeyset {
  group: SpecGroup;
  shares: SpecShare[];
}

async function waitForHooks(page: Page, label: string): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __appState?: unknown;
          __iglooTestSeedRuntime?: unknown;
          __iglooTestCreateKeysetBundle?: unknown;
        };
        return (
          typeof w.__appState === "object" &&
          typeof w.__iglooTestSeedRuntime === "function" &&
          typeof w.__iglooTestCreateKeysetBundle === "function"
        );
      },
      undefined,
      { timeout: HOOKS_READY_TIMEOUT_MS, polling: 100 },
    )
    .catch((err) => {
      throw new Error(
        `Dev-only test hooks never attached on page ${label}. ` +
          `Is the dev server running under import.meta.env.DEV? (${err})`,
      );
    });
}

test.describe("VAL-CROSS-023 — browser Back from a deep dashboard route", () => {
  test.setTimeout(60_000);

  test(
    "pressing Back after navigating to /onboard-sponsor returns to /dashboard/:id with unchanged runtime state + no passphrase prompt",
    async ({ browser }) => {
      const context = await browser.newContext();
      const consoleErrors: string[] = [];
      try {
        const page = await context.newPage();

        // Filter relay-connection chatter (transport-only, not part of
        // the routing contract under test).
        const isExpectedRelayError = (text: string): boolean =>
          /wss:\/\/127\.0\.0\.1:65535/.test(text) ||
          /ERR_CONNECTION_REFUSED/i.test(text) ||
          /WebSocket connection to /i.test(text);
        page.on("console", (msg) => {
          if (msg.type() === "error" && !isExpectedRelayError(msg.text())) {
            consoleErrors.push(msg.text());
          }
        });

        await page.goto("/");
        await expect(
          page.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await waitForHooks(page, "A");

        // Seed a fresh 2-of-3 keyset + persist a profile so the
        // dashboard route is valid.
        const keyset: SpecKeyset = await page.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestCreateKeysetBundle: (params: {
              groupName: string;
              threshold: number;
              count: number;
            }) => Promise<SpecKeyset>;
          };
          return w.__iglooTestCreateKeysetBundle({
            groupName: "Back Button Regression",
            threshold: 2,
            count: 3,
          });
        });

        const password = "back-spec-password-1";
        await page.evaluate(
          async ({ group, share, pw }) => {
            const w = window as unknown as {
              __iglooTestSeedRuntime: (input: {
                group: unknown;
                share: unknown;
                relays: string[];
                deviceName: string;
                persistProfile: { password: string; label: string };
              }) => Promise<void>;
            };
            await w.__iglooTestSeedRuntime({
              group,
              share,
              // non-routable relay — the routing contract does not
              // depend on relay connectivity.
              relays: ["wss://127.0.0.1:65535"],
              deviceName: "Back Regression",
              persistProfile: { password: pw, label: "Back Regression Profile" },
            });
          },
          {
            group: keyset.group,
            share: keyset.shares[0],
            pw: password,
          },
        );

        // Wait until activeProfile is populated.
        await page
          .waitForFunction(
            () => {
              const w = window as unknown as {
                __appState?: { activeProfile?: { id?: string } | null };
              };
              return Boolean(w.__appState?.activeProfile?.id);
            },
            undefined,
            { timeout: RUNTIME_READY_TIMEOUT_MS, polling: 100 },
          )
          .catch((err) => {
            throw new Error(
              `activeProfile never populated (${err})`,
            );
          });

        const profileId = await page.evaluate(() => {
          const w = window as unknown as {
            __appState: { activeProfile: { id: string } };
          };
          return w.__appState.activeProfile.id;
        });
        expect(profileId).toBeTruthy();

        // Navigate in-page to the dashboard deep link — a hard
        // `page.goto` would discard the seeded in-memory AppState and
        // trigger the cold-boot passphrase prompt. The routing
        // contract under test applies to client-side navigation only.
        await page.evaluate((target) => {
          window.history.pushState({}, "", target);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/dashboard/${profileId}`);
        await page.waitForURL(`**/dashboard/${profileId}`);

        // Snapshot pendingOperations + runtimeEventLog length BEFORE
        // the deep-route navigation + Back.
        const snapshotBefore = await page.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              runtimeStatus?: {
                pending_operations?: unknown[];
              } | null;
              runtimeEventLog?: unknown[];
            };
          };
          return {
            pendingOps: w.__appState?.runtimeStatus?.pending_operations?.length ?? 0,
            eventLogLen: w.__appState?.runtimeEventLog?.length ?? 0,
          };
        });

        // Navigate to the deep route via client-side history (again:
        // hard `page.goto` would discard the in-memory AppState and
        // break the return-Back assertion). `/onboard-sponsor` is
        // reachable from the Dashboard Settings sidebar in the
        // production app.
        await page.evaluate(() => {
          window.history.pushState({}, "", "/onboard-sponsor");
          window.dispatchEvent(new PopStateEvent("popstate"));
        });
        await page.waitForURL("**/onboard-sponsor");
        // Confirm the onboard sponsor surface mounted (no error
        // boundary, no Welcome redirect).
        await expect(
          page.getByRole("heading", { name: /onboard a device/i }),
        ).toBeVisible();

        // Browser Back — the contract requires returning to the
        // previous in-session route (the dashboard).
        await page.goBack();
        await page.waitForURL(`**/dashboard/${profileId}`);

        const pathnameAfter = await page.evaluate(() => window.location.pathname);
        expect(pathnameAfter).toBe(`/dashboard/${profileId}`);

        // Assertion 1: no passphrase-prompt screen. Welcome's Unlock
        // passphrase input uses an `input[type="password"]` with
        // `aria-label="Profile passphrase"` on a
        // `/welcome` or `/` route — after Back we MUST still be on
        // the dashboard, so no passphrase input is in the DOM.
        const passphraseInputs = await page.$$('input[type="password"]');
        expect(passphraseInputs.length).toBe(0);

        // Assertion 2: runtime state identical to the pre-Back
        // snapshot (no pending_operations lost, no event log regression).
        const snapshotAfter = await page.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              runtimeStatus?: {
                pending_operations?: unknown[];
              } | null;
              runtimeEventLog?: unknown[];
              activeProfile?: { id?: string } | null;
            };
          };
          return {
            pendingOps: w.__appState?.runtimeStatus?.pending_operations?.length ?? 0,
            eventLogLen: w.__appState?.runtimeEventLog?.length ?? 0,
            activeProfileId: w.__appState?.activeProfile?.id ?? null,
          };
        });
        // activeProfile must survive the round-trip — no
        // re-unlock prompt.
        expect(snapshotAfter.activeProfileId).toBe(profileId);
        // pending_operations should be >= pre-Back (navigation does
        // not consume pending ops). Use >= rather than === to allow
        // for the next tick's completion pump without flaking.
        expect(snapshotAfter.pendingOps).toBeGreaterThanOrEqual(snapshotBefore.pendingOps);
        expect(snapshotAfter.eventLogLen).toBeGreaterThanOrEqual(
          snapshotBefore.eventLogLen,
        );

        // Finally: no non-relay console errors during the round-trip.
        expect(consoleErrors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});
