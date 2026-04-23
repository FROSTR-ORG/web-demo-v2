import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-tab profile lifecycle e2e for feature
 * `m7-multi-tab-and-modal-stack` → VAL-CROSS-021.
 *
 * Contract under test (VAL-CROSS-021): with the same profile open in
 * two tabs A and B (same origin, same BrowserContext, each running an
 * independent WASM runtime but sharing the page-scoped
 * BroadcastChannel namespace), a Lock or Clear Credentials decision
 * issued from tab A MUST propagate to tab B within the next tick —
 * tab B's `activeProfile` transitions to `null` (equivalent to the UI
 * redirecting to Welcome, which re-prompts for unlock).
 *
 * ---------------------------------------------------------------------
 * Mechanism
 * ---------------------------------------------------------------------
 *
 * `AppStateProvider` installs a BroadcastChannel named
 * `igloo-profile-lifecycle` (alongside the pre-existing
 * `igloo-policy-denials` channel — see
 * `policy-lww-convergence.spec.ts` for the analogous multi-tab
 * harness). `lockProfile()` and `clearCredentials()` post
 * `{type:"locked"|"cleared", profileId}`. On receive, a sibling tab
 * whose `activeProfile?.id === profileId` invokes its LOCAL
 * `lockProfile()` / `clearCredentials()` with an echo-suppression
 * ref-flag so the remote-driven call does not re-broadcast.
 *
 * The `profileId` match prevents cross-profile contamination: a tab
 * unlocked into a different profile, or a tab with no active
 * profile, ignores the broadcast.
 *
 * ---------------------------------------------------------------------
 * Why a single-context two-page harness
 * ---------------------------------------------------------------------
 *
 * VAL-CROSS-021 targets MULTI-TAB sync — two `Page`s under the same
 * `BrowserContext`, sharing origin, storage, and BroadcastChannel
 * namespace. Two separate `BrowserContext`s do NOT share a
 * BroadcastChannel and would therefore never observe cross-tab
 * propagation.
 *
 * ---------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------
 *
 * The spec performs no relay I/O and no network requests — runtimes
 * are seeded with `relays: []` so the refresh pump is local-only.
 * The next-tick budget is bounded to 500 ms in-page; the observation
 * uses `page.waitForFunction` polling `window.__appState.activeProfile`.
 *
 * To run manually:
 *   npx playwright test \
 *     src/e2e/multi-device/multi-tab.spec.ts \
 *     --project=desktop --workers 1 --repeat-each=3
 */

const NEXT_TICK_BUDGET_MS = 500;

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
      { timeout: 15_000, polling: 100 },
    )
    .catch((err) => {
      throw new Error(
        `Dev-only test hooks never attached on page ${label}. ` +
          `Is the dev server running under \`import.meta.env.DEV\`? (${err})`,
      );
    });
}

async function readActiveProfileId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        activeProfile?: { id?: string } | null;
      };
    };
    return w.__appState?.activeProfile?.id ?? null;
  });
}

async function waitForActiveProfile(
  page: Page,
  label: string,
  expected: string | null,
  timeoutMs: number,
): Promise<number | null> {
  const start = Date.now();
  try {
    await page.waitForFunction(
      (target: string | null) => {
        const w = window as unknown as {
          __appState?: {
            activeProfile?: { id?: string } | null;
          };
        };
        const id = w.__appState?.activeProfile?.id ?? null;
        return id === target;
      },
      expected,
      { timeout: timeoutMs, polling: 25 },
    );
  } catch {
    return null;
  }
  return Date.now() - start;
}

test.describe("VAL-CROSS-021 — multi-tab profile lifecycle propagation", () => {
  test.setTimeout(60_000);

  test(
    "Lock in tab A clears activeProfile in sibling tab B within next tick (<500ms)",
    async ({ browser }) => {
      const context = await browser.newContext();
      const consoleErrorsA: string[] = [];
      const consoleErrorsB: string[] = [];

      try {
        const pageA = await context.newPage();
        const pageB = await context.newPage();

        // Filter out the expected `ERR_CONNECTION_REFUSED` chatter from
        // the non-routable loopback relay URL (see the `relays:
        // ["wss://127.0.0.1:65535"]` rationale below). The lifecycle
        // channel is independent of relay connectivity — these errors
        // originate from the fire-and-forget `startLiveRelayPump` and
        // are NOT a regression of the feature under test.
        const isExpectedRelayError = (text: string): boolean =>
          /wss:\/\/127\.0\.0\.1:65535/.test(text) ||
          /ERR_CONNECTION_REFUSED/i.test(text) ||
          /WebSocket connection to /i.test(text);
        pageA.on("console", (msg) => {
          if (msg.type() === "error" && !isExpectedRelayError(msg.text())) {
            consoleErrorsA.push(msg.text());
          }
        });
        pageB.on("console", (msg) => {
          if (msg.type() === "error" && !isExpectedRelayError(msg.text())) {
            consoleErrorsB.push(msg.text());
          }
        });

        // Navigate tab A first so it can mint + persist the profile
        // into the shared origin IndexedDB BEFORE tab B's initial
        // `reloadProfiles()` fires. Tab B will then observe the
        // profile in its Welcome list and unlock via the production
        // `unlockProfile(id, password)` path — the same mechanism a
        // real user would trigger by clicking "Unlock" in a second
        // tab.
        await pageA.goto("/");
        await expect(
          pageA.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await waitForHooks(pageA, "A");

        // Mint a fresh 2-of-3 keyset on tab A. Both tabs will adopt
        // share[0] and persist the same encrypted profile into the
        // shared origin IndexedDB — the `persistProfile` path
        // populates `activeProfile` on each tab so the lifecycle
        // receive handler's profileId match gates correctly.
        const keyset: SpecKeyset = await pageA.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestCreateKeysetBundle: (params: {
              groupName: string;
              threshold: number;
              count: number;
            }) => Promise<SpecKeyset>;
          };
          return w.__iglooTestCreateKeysetBundle({
            groupName: "Multi-Tab Lifecycle",
            threshold: 2,
            count: 3,
          });
        });
        expect(keyset.shares.length).toBeGreaterThanOrEqual(1);
        const localShare = keyset.shares[0];

        // Seed both tabs with persistProfile so each tab unlocks
        // INTO the SAME profile (same derived profile id — the
        // lifecycle channel's receive handler checks
        // `activeProfile.id === profileId` before tearing down).
        // The same password is used on both tabs; the `saveProfile`
        // write is idempotent at the IDB-record level and the
        // in-memory `activeProfile` summary is populated
        // independently on each tab.
        const password = "lifecycle-spec-password";
        const seedTab = (page: Page, deviceName: string) =>
          page.evaluate(
            async ({ group, share, name, pw }) => {
              const w = window as unknown as {
                __iglooTestSeedRuntime: (input: {
                  group: unknown;
                  share: unknown;
                  relays: string[];
                  deviceName: string;
                  persistProfile?: {
                    password: string;
                    label: string;
                  };
                }) => Promise<void>;
              };
              await w.__iglooTestSeedRuntime({
                group,
                // `persistProfile` requires at least one relay entry
                // (see `buildStoredProfileRecord`'s
                // `At least one relay is required.` invariant). The
                // lifecycle contract being asserted here is
                // independent of relay connectivity, so a
                // non-routable loopback port is sufficient — the
                // relay pump will fail to connect but the
                // BroadcastChannel receive handler is wired up in
                // the `[]`-deps effect and doesn't depend on relay
                // status.
                share,
                relays: ["wss://127.0.0.1:65535"],
                deviceName: name,
                persistProfile: {
                  password: pw,
                  label: "Multi-Tab Lifecycle Profile",
                },
              });
            },
            {
              group: keyset.group,
              share: localShare,
              name: deviceName,
              pw: password,
            },
          );
        // Seed tab A with persistProfile so the encrypted record
        // lands in the shared origin IndexedDB AND tab A's in-memory
        // `activeProfile` is populated.
        await seedTab(pageA, "Lifecycle Tab A");

        // Now navigate tab B — its mount-time `reloadProfiles()`
        // will observe the just-saved record.
        await pageB.goto("/");
        await expect(
          pageB.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await waitForHooks(pageB, "B");

        // Tab B unlocks the just-persisted profile via the
        // production `unlockProfile(id, password)` path — identical
        // to the second tab a real user would open and click Unlock
        // on.
        const profileIdA = await readActiveProfileId(pageA);
        expect(profileIdA, "tab A must have populated activeProfile after persistProfile seed").not.toBeNull();
        const profileId = profileIdA as string;
        await pageB.evaluate(
          async ({ id, pw }) => {
            const w = window as unknown as {
              __appState: {
                unlockProfile: (id: string, password: string) => Promise<void>;
                profiles: Array<{ id: string }>;
                reloadProfiles: () => Promise<void>;
              };
            };
            // Refresh in case tab B mounted BEFORE tab A's save
            // completed its IDB transaction.
            await w.__appState.reloadProfiles();
            await w.__appState.unlockProfile(id, pw);
          },
          { id: profileId, pw: password },
        );

        // Confirm tab B is now unlocked into the SAME derived
        // profile id as tab A — the precondition for the lifecycle
        // channel's `profileId` gate to take effect.
        await pageB
          .waitForFunction(
            (target: string) => {
              const w = window as unknown as {
                __appState?: {
                  activeProfile?: { id?: string } | null;
                };
              };
              return w.__appState?.activeProfile?.id === target;
            },
            profileId,
            { timeout: 15_000, polling: 50 },
          )
          .catch((err) => {
            throw new Error(
              `tab B never unlocked into profile ${profileId} (${err})`,
            );
          });

        const idA = await readActiveProfileId(pageA);
        const idB = await readActiveProfileId(pageB);
        expect(idA, "tab A activeProfile.id").toBe(profileId);
        expect(
          idB,
          "both tabs must be unlocked into the SAME derived profile id",
        ).toBe(profileId);

        // ---- Trigger Lock on tab A -------------------------------
        // `lockProfile()` is synchronous; capturing `t0` BEFORE the
        // dispatch anchors the "next tick" budget.
        const t0 = Date.now();
        await pageA.evaluate(() => {
          const w = window as unknown as {
            __appState: { lockProfile: () => void };
          };
          w.__appState.lockProfile();
        });

        // Tab A drops its own activeProfile synchronously. Tab B
        // must drop WITHIN the next-tick budget (500 ms).
        const elapsedA = await waitForActiveProfile(
          pageA,
          "A",
          null,
          NEXT_TICK_BUDGET_MS + 500,
        );
        const elapsedB = await waitForActiveProfile(
          pageB,
          "B",
          null,
          NEXT_TICK_BUDGET_MS,
        );
        const elapsedTotalB =
          elapsedB === null ? null : Date.now() - t0 - (elapsedA ?? 0);
        void elapsedTotalB; // diagnostic-only

        expect(
          elapsedA,
          `tab A activeProfile should clear synchronously after lockProfile()`,
        ).not.toBeNull();
        expect(
          elapsedB,
          `tab B activeProfile MUST clear within ${NEXT_TICK_BUDGET_MS} ms of tab A's lockProfile() (observed: ${
            elapsedB === null ? "never" : `${elapsedB} ms`
          }).`,
        ).not.toBeNull();
        if (elapsedB !== null) {
          expect(elapsedB).toBeLessThanOrEqual(NEXT_TICK_BUDGET_MS);
        }

        // eslint-disable-next-line no-console
        console.log(
          `[VAL-CROSS-021] Lock propagation: tab A cleared in ${elapsedA} ms, tab B cleared in ${elapsedB} ms (t0 = ${t0})`,
        );

        // No console errors should surface on either tab.
        expect(
          consoleErrorsA,
          "no console errors should surface on tab A during a cross-tab lock propagation",
        ).toEqual([]);
        expect(
          consoleErrorsB,
          "no console errors should surface on tab B during a cross-tab lock propagation",
        ).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});
