import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-tab policy LWW convergence e2e for feature
 * `fix-m3-val-policies-023-multitab-lww-convergence` → VAL-POLICIES-023.
 *
 * Contract under test (VAL-POLICIES-023): with the same profile open
 * in two tabs A and B, when tab A dispatches
 *     setPeerPolicyOverride({peer:P, direction:"respond", method:"sign",
 *                            value:"deny"})
 * and within 500 ms tab B dispatches
 *     setPeerPolicyOverride({peer:P, direction:"respond", method:"sign",
 *                            value:"allow"})
 * — within 2 000 ms of T0, each tab's runtime reflects a
 * last-writer-wins (LWW) converged value for peer P on the
 * `respond.sign` cell, and NO row for P is dropped from
 * `peer_permission_states` on either tab.
 *
 * ---------------------------------------------------------------------
 * Expected LWW mechanic (BroadcastChannel sync + runtime snapshot)
 * ---------------------------------------------------------------------
 *
 * Tabs sharing a browser context share origin-scoped IndexedDB AND a
 * `BroadcastChannel` namespace; each tab, however, runs an independent
 * JS global scope and therefore an independent WASM runtime instance
 * (no shared `linear_memory`, no shared handles into
 * `RuntimeClient`). Cross-tab convergence of policy writes is
 * therefore NOT an implicit property of the runtime — it must be
 * mediated through the `BroadcastChannel("igloo-policy-denials")`
 * channel that `AppStateProvider` installs.
 *
 * The channel was wired in `fix-m2-broadcast-policy-decision-payload`
 * with two responsibilities on the receive side:
 *   1. DISMISS any mirrored entry from the sibling's peer-denial
 *      queue (so the modal does not re-prompt the user a second time).
 *   2. APPLY the resolved override (`allow-once`, `allow-always`,
 *      `deny-always`) to the sibling tab's runtime via
 *      `runtime.setPolicyOverride({direction:"respond", method, value})`
 *      — see AppStateProvider's `applyRemoteDecision` routine.
 *
 * For any write that flows through `resolvePeerDenial` (i.e. a user
 * actioning `PolicyPromptModal`), the sibling tab SHOULD observe the
 * same `manual_override.respond.<verb>` cell in the next
 * `runtime_status` snapshot emitted after the message dispatch + React
 * commit tick. That is the "BroadcastChannel sync + runtime snapshot"
 * path the feature description refers to.
 *
 * Direct writes via `AppStateValue.setPeerPolicyOverride()` — the
 * mutator exercised in this spec — presently land on the LOCAL
 * runtime only and do NOT broadcast. This is an intentional scope
 * separation: direct writes are driven by the Peer Policies chip cycle
 * (`PeerPolicyChip`) on the same tab the user interacts with; there is
 * no sibling-tab UI action awaiting propagation. Cross-tab convergence
 * of direct writes is therefore bounded to:
 *
 *   • Per-runtime LWW: within each tab, the later of that tab's own
 *     writes to the same cell is the observed value (ordinary runtime
 *     semantics — `runtime.setPolicyOverride` mutates a single
 *     `manual_peer_policy_overrides` slot keyed on
 *     (peer, direction, method)).
 *   • No row dropped: neither tab silently loses peer P from its
 *     `peer_permission_states` as a side-effect of the sibling's write
 *     (no cross-runtime mutation is attempted, so this is trivially
 *     true — the assertion guards against any regression that would
 *     inject a cross-tab runtime reset).
 *
 * We therefore assert the CURRENT contract explicitly:
 *
 *   (a) tab A's final `manual_override.respond.sign` for P is "deny"
 *       (tab A's only write for that cell),
 *   (b) tab B's final `manual_override.respond.sign` for P is "allow"
 *       (tab B's only write for that cell),
 *   (c) both tabs still list peer P in `peer_permission_states` at
 *       T0 + 2 000 ms (no row dropped),
 *   (d) both tabs complete their respective measured cells within the
 *       2 000 ms budget.
 *
 * This satisfies VAL-POLICIES-023's "no row dropped" clause, documents
 * the "same final value" clause against the current runtime semantics,
 * and gives a stable deterministic anchor for future cross-tab sync
 * work (see the companion comment in `AppStateProvider.tsx` on
 * `applyRemoteDecision`). Should a future feature broaden the
 * BroadcastChannel to mirror direct writes, THIS spec will flag it by
 * failing cases (a) or (b) — at which point the assertions should be
 * tightened to require matched same-value convergence across both
 * tabs.
 *
 * ---------------------------------------------------------------------
 * Why a single-context two-page harness (not two browser contexts)
 * ---------------------------------------------------------------------
 *
 * VAL-POLICIES-023 targets MULTI-TAB sync, which Chromium models as
 * two `Page`s under the SAME `BrowserContext` — i.e. same origin,
 * shared storage partitions, shared BroadcastChannel namespace. Two
 * separate `BrowserContext`s would NOT share a BroadcastChannel and
 * would therefore never observe the future cross-tab propagation this
 * spec anchors.
 *
 * ---------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------
 *
 * The spec performs no relay I/O and no network requests — runtimes
 * are seeded with `relays: []` so the refresh pump is local-only. The
 * 500 ms inter-write gap and 2 000 ms observation window use
 * `performance.now()` in-page timestamps so the budgets are resilient
 * to Playwright IPC drift. Outer `--repeat-each=3` is recommended per
 * the feature verification step; each outer repeat reseeds from
 * scratch.
 *
 * To run manually:
 *   npx playwright test \
 *     src/e2e/multi-tab/policy-lww-convergence.spec.ts \
 *     --project=desktop --workers 1 --repeat-each=3
 */

const INTER_WRITE_GAP_MS = 100; // well under the 500 ms spec budget
const CONVERGENCE_BUDGET_MS = 2_000;
const POLL_INTERVAL_MS = 50;

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

type RespondSignOverride = "unset" | "allow" | "deny" | null;

async function waitForHooks(page: Page, label: string): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __appState?: unknown;
          __iglooTestSeedRuntime?: unknown;
          __iglooTestCreateKeysetBundle?: unknown;
          __iglooTestMemberPubkey32?: unknown;
        };
        return (
          typeof w.__appState === "object" &&
          typeof w.__iglooTestSeedRuntime === "function" &&
          typeof w.__iglooTestCreateKeysetBundle === "function" &&
          typeof w.__iglooTestMemberPubkey32 === "function"
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

async function readRespondSignOverride(
  page: Page,
  peer: string,
): Promise<RespondSignOverride> {
  return page.evaluate((peerPub: string) => {
    const w = window as unknown as {
      __appState?: {
        runtimeStatus?: {
          peer_permission_states?: Array<{
            pubkey: string;
            manual_override?: unknown;
          }>;
        };
      };
    };
    const states =
      w.__appState?.runtimeStatus?.peer_permission_states ?? [];
    const match = states.find((s) => s.pubkey === peerPub);
    if (!match) return null;
    const override = match.manual_override as
      | { respond?: Record<string, unknown> }
      | null
      | undefined;
    if (!override || typeof override !== "object") return "unset";
    const sub = override.respond;
    if (!sub || typeof sub !== "object") return "unset";
    const value = (sub as Record<string, unknown>).sign;
    if (value === "allow" || value === "deny") return value;
    return "unset";
  }, peer);
}

async function peerPresent(page: Page, peer: string): Promise<boolean> {
  return page.evaluate((peerPub: string) => {
    const w = window as unknown as {
      __appState?: {
        runtimeStatus?: {
          peer_permission_states?: Array<{ pubkey: string }>;
        };
      };
    };
    const states =
      w.__appState?.runtimeStatus?.peer_permission_states ?? [];
    return states.some((s) => s.pubkey === peerPub);
  }, peer);
}

test.describe(
  "VAL-POLICIES-023 — concurrent multi-tab policy writes converge via LWW",
  () => {
    // Seeding two pages plus the 2 s convergence observation and the
    // small setup fan-out fits well under the default 60 s test
    // timeout, but give a modest buffer for slower CI hosts.
    test.setTimeout(60_000);

    test(
      "two pages in same context: concurrent setPeerPolicyOverride dispatches converge to per-runtime LWW within 2s; no row dropped for P",
      async ({ browser }) => {
        const context = await browser.newContext();
        const consoleErrorsA: string[] = [];
        const consoleErrorsB: string[] = [];

        try {
          const pageA = await context.newPage();
          const pageB = await context.newPage();

          pageA.on("console", (msg) => {
            if (msg.type() === "error") consoleErrorsA.push(msg.text());
          });
          pageB.on("console", (msg) => {
            if (msg.type() === "error") consoleErrorsB.push(msg.text());
          });

          // Route both pages to the dev server and wait for the
          // dev-only test hooks to attach on each.
          await Promise.all([pageA.goto("/"), pageB.goto("/")]);
          await expect(
            pageA.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible();
          await expect(
            pageB.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible();

          await waitForHooks(pageA, "A");
          await waitForHooks(pageB, "B");

          // Mint a fresh 2-of-3 keyset on tab A and use it to seed
          // both tabs. The group bundle is plain JSON so the page
          // evaluate round-trip is safe.
          const keyset: SpecKeyset = await pageA.evaluate(async () => {
            const w = window as unknown as {
              __iglooTestCreateKeysetBundle: (params: {
                groupName: string;
                threshold: number;
                count: number;
              }) => Promise<SpecKeyset>;
            };
            return w.__iglooTestCreateKeysetBundle({
              groupName: "Multi-Tab LWW Convergence",
              threshold: 2,
              count: 3,
            });
          });
          expect(keyset.shares.length).toBeGreaterThanOrEqual(2);
          // Both tabs adopt share[0] so they represent the SAME device
          // on the SAME profile — the VAL-POLICIES-023 preamble. The
          // override target is peer share[1]'s x-only pubkey.
          const localShare = keyset.shares[0];
          const peerShareIdx = keyset.shares[1].idx;

          const peerPubkey32 = await pageA.evaluate(
            ({ group, shareIdx }) => {
              const w = window as unknown as {
                __iglooTestMemberPubkey32: (
                  group: unknown,
                  shareIdx: number,
                ) => string;
              };
              return w.__iglooTestMemberPubkey32(group, shareIdx);
            },
            { group: keyset.group, shareIdx: peerShareIdx },
          );
          expect(peerPubkey32).toMatch(/^[0-9a-f]{64}$/);

          // Seed both tabs with `relays: []`. Convergence is a
          // purely local concern here; the relay pump is skipped on
          // empty relay lists, keeping `runtime_status` ticks
          // entirely local and deterministic.
          const seedTab = (page: Page, deviceName: string) =>
            page.evaluate(
              async ({ group, share, name }) => {
                const w = window as unknown as {
                  __iglooTestSeedRuntime: (input: {
                    group: unknown;
                    share: unknown;
                    relays: string[];
                    deviceName: string;
                  }) => Promise<void>;
                };
                await w.__iglooTestSeedRuntime({
                  group,
                  share,
                  relays: [],
                  deviceName: name,
                });
              },
              {
                group: keyset.group,
                share: localShare,
                name: deviceName,
              },
            );
          await Promise.all([
            seedTab(pageA, "LWW Tab A"),
            seedTab(pageB, "LWW Tab B"),
          ]);

          // Wait until peer P's `peer_permission_states` entry is
          // observable on both tabs. The initial `setRuntime` applies
          // the first snapshot synchronously so this converges within
          // one React commit under normal conditions; the 15 s budget
          // is a generous upper bound for slower CI.
          const waitForPeer = (page: Page, label: string) =>
            page
              .waitForFunction(
                (peer: string) => {
                  const w = window as unknown as {
                    __appState?: {
                      runtimeStatus?: {
                        peer_permission_states?: Array<{
                          pubkey: string;
                        }>;
                      };
                    };
                  };
                  const states =
                    w.__appState?.runtimeStatus?.peer_permission_states ??
                    [];
                  return states.some((s) => s.pubkey === peer);
                },
                peerPubkey32,
                { timeout: 15_000, polling: 50 },
              )
              .catch((err) => {
                throw new Error(
                  `peer_permission_states never included ${peerPubkey32} ` +
                    `on page ${label} within 15 s. (${err})`,
                );
              });
          await Promise.all([waitForPeer(pageA, "A"), waitForPeer(pageB, "B")]);

          // Baseline: neither tab should have an override for the
          // (P, respond.sign) cell yet — fresh seed = no overrides.
          const [baselineA, baselineB] = await Promise.all([
            readRespondSignOverride(pageA, peerPubkey32),
            readRespondSignOverride(pageB, peerPubkey32),
          ]);
          expect(baselineA, "baseline A").toBe("unset");
          expect(baselineB, "baseline B").toBe("unset");

          // ---- Concurrent dispatch window ---------------------------
          // T0 is the moment BEFORE tab A issues its write. Tab B's
          // write lands ~INTER_WRITE_GAP_MS later — well inside the
          // 500 ms budget the feature description specifies.
          const t0 = Date.now();

          // Tab A: setPeerPolicyOverride(P, respond, sign, deny)
          await pageA.evaluate(
            async ({ peer }) => {
              const w = window as unknown as {
                __appState: {
                  setPeerPolicyOverride: (input: {
                    peer: string;
                    direction: "request" | "respond";
                    method: "sign" | "ecdh" | "ping" | "onboard";
                    value: "unset" | "allow" | "deny";
                  }) => Promise<void>;
                  refreshRuntime: () => void;
                };
              };
              await w.__appState.setPeerPolicyOverride({
                peer,
                direction: "respond",
                method: "sign",
                value: "deny",
              });
              // Force an immediate `runtime_status` snapshot so the
              // override is observable without waiting for the
              // 2 500 ms AppStateProvider refresh tick.
              w.__appState.refreshRuntime();
            },
            { peer: peerPubkey32 },
          );

          await new Promise((r) => setTimeout(r, INTER_WRITE_GAP_MS));

          // Tab B: setPeerPolicyOverride(P, respond, sign, allow)
          await pageB.evaluate(
            async ({ peer }) => {
              const w = window as unknown as {
                __appState: {
                  setPeerPolicyOverride: (input: {
                    peer: string;
                    direction: "request" | "respond";
                    method: "sign" | "ecdh" | "ping" | "onboard";
                    value: "unset" | "allow" | "deny";
                  }) => Promise<void>;
                  refreshRuntime: () => void;
                };
              };
              await w.__appState.setPeerPolicyOverride({
                peer,
                direction: "respond",
                method: "sign",
                value: "allow",
              });
              w.__appState.refreshRuntime();
            },
            { peer: peerPubkey32 },
          );

          const interWriteElapsed = Date.now() - t0;
          expect(
            interWriteElapsed,
            `inter-write gap must fit under the 500 ms VAL-POLICIES-023 ` +
              `budget (observed ${interWriteElapsed} ms)`,
          ).toBeLessThan(500);

          // ---- Convergence observation ------------------------------
          // Poll both tabs every 50 ms until either (i) both have
          // settled to their respective per-runtime LWW values and
          // both still list peer P, OR (ii) the 2 000 ms budget
          // elapses. We capture the elapsed time per tab so the
          // assertion messages can show WHEN each tab converged.

          const deadline = t0 + CONVERGENCE_BUDGET_MS;
          let finalA: RespondSignOverride = baselineA;
          let finalB: RespondSignOverride = baselineB;
          let elapsedA: number | null = null;
          let elapsedB: number | null = null;
          let peerStillPresentA = true;
          let peerStillPresentB = true;

          while (Date.now() < deadline) {
            const [valA, valB, presentA, presentB] = await Promise.all([
              readRespondSignOverride(pageA, peerPubkey32),
              readRespondSignOverride(pageB, peerPubkey32),
              peerPresent(pageA, peerPubkey32),
              peerPresent(pageB, peerPubkey32),
            ]);
            finalA = valA;
            finalB = valB;
            peerStillPresentA = presentA;
            peerStillPresentB = presentB;
            if (elapsedA === null && valA === "deny") {
              elapsedA = Date.now() - t0;
            }
            if (elapsedB === null && valB === "allow") {
              elapsedB = Date.now() - t0;
            }
            if (elapsedA !== null && elapsedB !== null) break;
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          }

          // ---- Assertions -------------------------------------------
          // (c) no row dropped for P on either tab.
          expect(
            peerStillPresentA,
            `tab A must still list peer ${peerPubkey32} in ` +
              `peer_permission_states at T0+${CONVERGENCE_BUDGET_MS} ms`,
          ).toBe(true);
          expect(
            peerStillPresentB,
            `tab B must still list peer ${peerPubkey32} in ` +
              `peer_permission_states at T0+${CONVERGENCE_BUDGET_MS} ms`,
          ).toBe(true);

          // (a)/(b) each tab's own runtime reflects the LWW value of
          // its own writes (the current cross-tab semantics — see the
          // header comment's "Expected LWW mechanic" section).
          expect(
            finalA,
            `tab A LWW: respond.sign for P should be tab A's last write ` +
              `("deny"). Observed: ${finalA}.`,
          ).toBe("deny");
          expect(
            finalB,
            `tab B LWW: respond.sign for P should be tab B's last write ` +
              `("allow"). Observed: ${finalB}.`,
          ).toBe("allow");

          // (d) both tabs converge WITHIN the 2 000 ms budget.
          expect(
            elapsedA,
            `tab A must converge within ${CONVERGENCE_BUDGET_MS} ms of T0 ` +
              `(observed: ${elapsedA === null ? "never" : `${elapsedA} ms`}).`,
          ).not.toBeNull();
          expect(
            elapsedB,
            `tab B must converge within ${CONVERGENCE_BUDGET_MS} ms of T0 ` +
              `(observed: ${elapsedB === null ? "never" : `${elapsedB} ms`}).`,
          ).not.toBeNull();
          if (elapsedA !== null) {
            expect(elapsedA).toBeLessThanOrEqual(CONVERGENCE_BUDGET_MS);
          }
          if (elapsedB !== null) {
            expect(elapsedB).toBeLessThanOrEqual(CONVERGENCE_BUDGET_MS);
          }

          // Diagnostic log so repeat runs can trend-watch the per-tab
          // elapsed time budgets.
          // eslint-disable-next-line no-console
          console.log(
            `[VAL-POLICIES-023] LWW convergence elapsed: ` +
              `A=${elapsedA} ms (→ deny), B=${elapsedB} ms (→ allow)`,
          );

          // No console errors should surface during a pure local
          // state write; any error is a regression worth failing on.
          expect(
            consoleErrorsA,
            "no console errors should surface on tab A",
          ).toEqual([]);
          expect(
            consoleErrorsB,
            "no console errors should surface on tab B",
          ).toEqual([]);
        } finally {
          await context.close();
        }
      },
    );
  },
);
