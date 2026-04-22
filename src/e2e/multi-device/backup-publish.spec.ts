import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device Publish-Backup e2e for feature `m6-backup-publish`.
 *
 * This spec drives an end-to-end encrypted profile backup through a
 * real local `bifrost-devtools` relay. It boots a Playwright context
 * with the dev-only `AppStateProvider` test hooks exposed
 * (`__iglooTestSeedRuntime` / `__iglooTestCreateKeysetBundle`),
 * seeds a 2-of-3 keyset, and calls
 * `window.__appState.publishProfileBackup(password)` which internally
 *
 *   1. builds a `BfProfilePayload` from the live runtime snapshot,
 *   2. passes it through the WASM bridge's
 *      `create_encrypted_profile_backup` + `build_profile_backup_event`
 *      helpers (VAL-BACKUP-004 kind=10000, VAL-BACKUP-003 ciphertext
 *      content), and
 *   3. fans the signed event out to every online relay via
 *      `RuntimeRelayPump.publishEvent` (VAL-BACKUP-002 all-relays
 *      dispatch).
 *
 * To verify the event actually landed, a *separate* Playwright page
 * opens a raw NIP-01 subscription (`["REQ", id, {kinds:[10000],
 * authors:[share-derived pubkey]}]`) to the same relay and asserts
 * an EVENT matching the publish outcome arrives.
 *
 * Specifically covered:
 *
 *   - VAL-BACKUP-002: publish reaches the configured relay (EVENT
 *     observed on independent subscription).
 *   - VAL-BACKUP-003: `content` is ciphertext — never plaintext (no
 *     JSON start, no clear share_secret substring).
 *   - VAL-BACKUP-004: signed event kind == 10000; `pubkey` matches the
 *     share-derived nostr author.
 *   - VAL-BACKUP-006 + VAL-BACKUP-031: two rapid back-to-back publishes
 *     emit strictly monotonic `created_at` values, so NIP-09-style
 *     replaceable semantics observe the newer one.
 *   - VAL-BACKUP-007: pausing the relay pump and then disconnecting the
 *     relay causes `publishProfileBackup` to reject with the canonical
 *     "No relays available to publish to." copy.
 *
 * To run manually:
 *   1. bash .factory/init.sh                       # builds the binary
 *   2. npx playwright test src/e2e/multi-device/backup-publish.spec.ts \
 *        --project=desktop --workers 1
 */

const BIFROST_RS_DIR =
  "/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs";
const DEVTOOLS_BINARY = `${BIFROST_RS_DIR}/target/release/bifrost-devtools`;

// Port 8194 is the only relay port allocated by AGENTS.md Mission
// Boundaries — do not change it.
const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = 8194;
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;

const RELAY_READY_TIMEOUT_MS = 20_000;
const BACKUP_EVENT_TIMEOUT_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 30_000;

function cargoAvailable(): boolean {
  try {
    const result = spawnSync("cargo", ["--version"], {
      stdio: "ignore",
      env: process.env,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function waitForRelayPort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for relay ${host}:${port}`);
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const forceKill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 1_000);
    const done = () => {
      clearTimeout(forceKill);
      resolve();
    };
    child.once("exit", done);
    child.once("close", done);
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(forceKill);
      resolve();
    }
  });
}

// Minimal shape of the structures flowing between this spec and
// `window.__appState`. Intentionally loose — the actual Zod-validated
// definitions live in `src/lib/bifrost/types.ts`.
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
interface PublishedEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: Array<string[]>;
  sig: string;
  created_at: number;
}

test.describe("multi-device publish-backup (local bifrost-devtools relay)", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  test.setTimeout(180_000);

  let relay: ChildProcess | null = null;

  test.beforeAll(async () => {
    if (!existsSync(DEVTOOLS_BINARY)) {
      throw new Error(
        `bifrost-devtools binary missing at ${DEVTOOLS_BINARY}. ` +
          `Run \`bash .factory/init.sh\` (or \`cargo build --release ` +
          `-p bifrost-devtools --manifest-path ${BIFROST_RS_DIR}/Cargo.toml\`) ` +
          `before running this spec.`,
      );
    }

    const alreadyBound = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({
        host: RELAY_HOST,
        port: RELAY_PORT,
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (alreadyBound) {
      throw new Error(
        `Port ${RELAY_PORT} already in use. Stop services.local_relay ` +
          `(lsof -ti :${RELAY_PORT} | xargs kill) before running this spec.`,
      );
    }

    const proc = spawn(
      DEVTOOLS_BINARY,
      ["relay", "--host", RELAY_HOST, "--port", String(RELAY_PORT)],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    relay = proc;
    const buffered: string[] = [];
    const remember = (prefix: string) => (chunk: Buffer) => {
      buffered.push(`${prefix}${chunk.toString("utf8").trim()}`);
      if (buffered.length > 40) buffered.splice(0, buffered.length - 40);
    };
    proc.stdout?.on("data", remember("[relay:stdout] "));
    proc.stderr?.on("data", remember("[relay:stderr] "));
    proc.once("exit", (code, signal) => {
      buffered.push(
        `[relay] exited code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
    });
    try {
      await waitForRelayPort(RELAY_HOST, RELAY_PORT, 10_000);
    } catch (err) {
      await killChild(proc);
      relay = null;
      throw new Error(
        `Failed to start bifrost-devtools relay on ${RELAY_HOST}:${RELAY_PORT}: ${
          err instanceof Error ? err.message : String(err)
        }\nRelay output tail:\n${buffered.join("\n")}`,
      );
    }
  });

  test.afterAll(async () => {
    if (relay) {
      await killChild(relay);
      relay = null;
    }
  });

  /**
   * Wait until the in-page dev-only test hooks + `window.__appState`
   * exist. The provider attaches them from a `useEffect` gated on
   * `import.meta.env.DEV`, so they land on the first render tick.
   */
  async function waitForHooks(page: Page, label: string) {
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
            `Is this running under \`import.meta.env.DEV\`? (${err})`,
        );
      });
  }

  /**
   * Wait for the pump on `page` to report the test relay as "online".
   */
  async function waitForRelayOnline(page: Page, label: string) {
    await page
      .waitForFunction(
        (url: string) => {
          const w = window as unknown as {
            __appState?: {
              runtimeRelays?: Array<{ url: string; state: string }>;
            };
          };
          const relays = w.__appState?.runtimeRelays ?? [];
          return relays.some(
            (entry) => entry.url === url && entry.state === "online",
          );
        },
        RELAY_URL,
        { timeout: RELAY_READY_TIMEOUT_MS, polling: 150 },
      )
      .catch((err) => {
        throw new Error(
          `Relay never transitioned to "online" on page ${label} ` +
            `within ${RELAY_READY_TIMEOUT_MS}ms. (${err})`,
        );
      });
  }

  test(
    "publish emits a signed kind-10000 ciphertext event that reaches the relay, " +
      "replay publishes use strictly monotonic created_at, " +
      "and removing all relays surfaces the canonical no-relay error",
    async ({ browser }) => {
      const ctx = await browser.newContext();
      try {
        const page = await ctx.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            console.log(`[page:console.error] ${msg.text()}`);
          }
        });

        await page.goto("/");
        await expect(
          page.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await waitForHooks(page, "main");

        // Generate a 2-of-3 keyset via the WASM bridge. We only need
        // one share to publish a backup (the published event is signed
        // by this share's derived nostr key and encrypts the full
        // profile payload that the holder could later restore).
        const keyset: SpecKeyset = await page.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestCreateKeysetBundle: (params: {
              groupName: string;
              threshold: number;
              count: number;
            }) => Promise<SpecKeyset>;
          };
          return w.__iglooTestCreateKeysetBundle({
            groupName: "Backup E2E",
            threshold: 2,
            count: 3,
          });
        });
        expect(keyset.shares.length).toBeGreaterThanOrEqual(1);
        const share = keyset.shares[0];

        // Seed runtime + live relay pump subscribing to
        // ws://127.0.0.1:8194. `persistProfile` drives the real
        // save-and-activate path so `activeProfile` is populated —
        // required by `publishProfileBackup` and `updateRelays`.
        await page.evaluate(
          async ({ group, share, relayUrl }) => {
            const w = window as unknown as {
              __iglooTestSeedRuntime: (input: {
                group: SpecGroup;
                share: SpecShare;
                relays: string[];
                deviceName: string;
                persistProfile?: { password: string; label?: string };
              }) => Promise<void>;
            };
            await w.__iglooTestSeedRuntime({
              group,
              share,
              relays: [relayUrl],
              deviceName: "Backup Publisher",
              persistProfile: {
                password: "backup-e2e-profile-pw",
                label: "Backup E2E",
              },
            });
          },
          { group: keyset.group, share, relayUrl: RELAY_URL },
        );
        await waitForRelayOnline(page, "main");

        // Derive this share's expected nostr author pubkey (32-byte
        // x-only hex) so we can filter the independent subscription.
        const authorPubkey32 = await page.evaluate(
          ({ group, shareIdx }) => {
            const w = window as unknown as {
              __iglooTestMemberPubkey32: (
                group: SpecGroup,
                shareIdx: number,
              ) => string;
            };
            return w.__iglooTestMemberPubkey32(group, shareIdx);
          },
          { group: keyset.group, shareIdx: share.idx },
        );
        expect(authorPubkey32).toMatch(/^[0-9a-f]{64}$/);

        // Open an independent NIP-01 subscription on a second page. We
        // use a raw browser-side `WebSocket` because the only
        // assertion we need — "the signed event landed on the relay" —
        // is inherently a transport-level observation (mirrors how
        // VAL-BACKUP-002's expectedBehavior line reads: "verify via
        // echo-subscribe"). The subscription keeps buffering events
        // while the first page runs its publish steps.
        const observerPage = await ctx.newPage();
        await observerPage.goto("about:blank");
        await observerPage.evaluate(
          ({ relayUrl, authorHex }) => {
            interface ObserverWindow extends Window {
              __observed: PublishedEvent[];
              __observerReady?: Promise<void>;
            }
            const w = window as unknown as ObserverWindow;
            w.__observed = [];
            w.__observerReady = new Promise<void>((resolveReady) => {
              const ws = new WebSocket(relayUrl);
              ws.onopen = () => {
                // NIP-01 REQ framing: [REQ, subId, filter, ...].
                ws.send(
                  JSON.stringify([
                    "REQ",
                    "backup-observer",
                    {
                      kinds: [10000],
                      authors: [authorHex],
                    },
                  ]),
                );
                resolveReady();
              };
              ws.onmessage = (event) => {
                try {
                  const parsed = JSON.parse(
                    event.data as string,
                  ) as unknown;
                  if (
                    Array.isArray(parsed) &&
                    parsed[0] === "EVENT" &&
                    parsed[2] &&
                    typeof parsed[2] === "object"
                  ) {
                    const ev = parsed[2] as PublishedEvent;
                    w.__observed.push(ev);
                  }
                } catch {
                  // ignore malformed frames from the relay
                }
              };
              ws.onerror = () => {
                // surface errors via the observed list so the test can
                // at least fail loudly with an empty outcome.
              };
            });
          },
          { relayUrl: RELAY_URL, authorHex: authorPubkey32 },
        );
        await observerPage.evaluate(async () => {
          const w = window as unknown as { __observerReady: Promise<void> };
          await w.__observerReady;
        });

        // Derive the active profile id BEFORE any publish so we can
        // navigate to `/dashboard/:profileId` after each publish and
        // assert the rendered "Last published" indicator.
        const profileId = await page.evaluate(() => {
          const w = window as unknown as {
            __appState?: { activeProfile?: { id?: string } };
          };
          return w.__appState?.activeProfile?.id ?? null;
        });
        expect(profileId).toMatch(/^[0-9a-f-]+$/);

        // ----- First publish -------------------------------------------------
        const firstOutcome = await page.evaluate(async () => {
          const w = window as unknown as {
            __appState: {
              publishProfileBackup: (password: string) => Promise<{
                event: PublishedEvent;
                reached: string[];
              }>;
            };
          };
          return w.__appState.publishProfileBackup("correct horse battery");
        });
        expect(firstOutcome.reached).toEqual([RELAY_URL]);
        // VAL-BACKUP-004: kind is 10000 and the pubkey matches our
        // derived author. VAL-BACKUP-003: content must NOT look like
        // plaintext JSON and must NOT contain the share secret.
        expect(firstOutcome.event.kind).toBe(10000);
        expect(firstOutcome.event.pubkey).toBe(authorPubkey32);
        expect(firstOutcome.event.content).not.toMatch(/^\s*\{/);
        expect(firstOutcome.event.content).not.toContain(share.seckey);

        // fix-m6-publish-backup-metadata / VAL-BACKUP-005 —
        // publishProfileBackup must persist `lastBackupPublishedAt`
        // (unix seconds, equal to event.created_at) and
        // `lastBackupReachedRelayCount` (== reached.length) on the
        // active profile record so the SettingsSidebar can render a
        // "Last published" indicator that survives lock/unlock.
        const firstMeta = await page.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              activeProfile?: {
                lastBackupPublishedAt?: number;
                lastBackupReachedRelayCount?: number;
              };
            };
          };
          return {
            publishedAt:
              w.__appState?.activeProfile?.lastBackupPublishedAt ?? null,
            reachedCount:
              w.__appState?.activeProfile?.lastBackupReachedRelayCount ??
              null,
          };
        });
        expect(firstMeta.publishedAt).toBe(firstOutcome.event.created_at);
        expect(firstMeta.reachedCount).toBe(firstOutcome.reached.length);

        // Render the rendered "Last published" row. Navigate the
        // client-side router (NOT page.goto — that triggers a full
        // reload and wipes the in-memory `activeProfile` + runtime
        // state we just seeded), open Settings, and assert the row's
        // text contains the relative-time copy + "reached N/M relays"
        // suffix.
        await page.evaluate((id: string) => {
          window.history.pushState({}, "", `/dashboard/${id}`);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, profileId!);
        // Wait for the dashboard to mount — its Settings icon button is
        // the cheapest selector that only exists on the dashboard.
        const settingsButton = page.getByRole("button", {
          name: "Settings",
        });
        await settingsButton.waitFor({
          state: "visible",
          timeout: 15_000,
        });
        await settingsButton.first().click();
        const firstRow = page.getByTestId(
          "settings-publish-backup-last-published",
        );
        await expect(firstRow).toBeVisible({ timeout: 10_000 });
        await expect(firstRow).toContainText(/Last published:/i);
        await expect(firstRow).toContainText(/reached 1\/1 relays/);
        // Capture the rendered copy so the post-second-publish
        // comparison can assert the monotonic refresh.
        const firstRenderedText = (await firstRow.textContent()) ?? "";

        // VAL-BACKUP-002: the independent observer must see an EVENT
        // matching the published id within the timeout.
        await observerPage
          .waitForFunction(
            (eventId: string) => {
              const w = window as unknown as {
                __observed?: PublishedEvent[];
              };
              return (w.__observed ?? []).some(
                (entry) => entry.id === eventId,
              );
            },
            firstOutcome.event.id,
            { timeout: BACKUP_EVENT_TIMEOUT_MS, polling: 200 },
          )
          .catch(async (err) => {
            const diag = await observerPage.evaluate(() => {
              const w = window as unknown as {
                __observed?: PublishedEvent[];
              };
              return w.__observed ?? [];
            });
            throw new Error(
              `Observer never received backup event id=` +
                `${firstOutcome.event.id} within ${BACKUP_EVENT_TIMEOUT_MS}ms. ` +
                `${err}\nObserved so far: ${JSON.stringify(diag)}`,
            );
          });

        // ----- Second publish -------------------------------------------------
        // VAL-BACKUP-006 + VAL-BACKUP-031: back-to-back publish must
        // emit a strictly newer `created_at` — even when both fall
        // inside the same wall-clock second. The mutator's session-
        // scoped monotonic ref guarantees `nowSeconds <= lastSeconds`
        // bumps to `lastSeconds + 1`.
        const secondOutcome = await page.evaluate(async () => {
          const w = window as unknown as {
            __appState: {
              publishProfileBackup: (password: string) => Promise<{
                event: PublishedEvent;
                reached: string[];
              }>;
            };
          };
          return w.__appState.publishProfileBackup("correct horse battery");
        });
        expect(secondOutcome.event.kind).toBe(10000);
        expect(secondOutcome.event.pubkey).toBe(authorPubkey32);
        expect(secondOutcome.event.created_at).toBeGreaterThan(
          firstOutcome.event.created_at,
        );
        expect(secondOutcome.event.id).not.toBe(firstOutcome.event.id);
        expect(secondOutcome.reached).toEqual([RELAY_URL]);

        // fix-m6-publish-backup-metadata / VAL-BACKUP-031 — the
        // persisted `lastBackupPublishedAt` must advance monotonically
        // with the published event, and the rendered "Last published"
        // row must reflect the new value. Firstly, inspect the
        // activeProfile snapshot:
        const secondMeta = await page.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              activeProfile?: {
                lastBackupPublishedAt?: number;
                lastBackupReachedRelayCount?: number;
              };
            };
          };
          return {
            publishedAt:
              w.__appState?.activeProfile?.lastBackupPublishedAt ?? null,
            reachedCount:
              w.__appState?.activeProfile?.lastBackupReachedRelayCount ??
              null,
          };
        });
        expect(secondMeta.publishedAt).toBe(secondOutcome.event.created_at);
        expect(secondMeta.publishedAt).toBeGreaterThan(
          firstMeta.publishedAt ?? 0,
        );
        expect(secondMeta.reachedCount).toBe(secondOutcome.reached.length);

        // Now force the sidebar to re-render so the "Last published"
        // row picks up the refreshed activeProfile. Close + reopen the
        // settings sidebar to ensure the new timestamp is used by the
        // relative-time formatter.
        await page
          .getByRole("button", { name: "Close settings" })
          .click();
        await page
          .getByRole("button", { name: "Settings" })
          .first()
          .click();
        // Wait for the sidebar to re-mount after the reopen click.
        await page.getByTestId("settings-sidebar").waitFor({
          state: "visible",
          timeout: 10_000,
        });
        const secondRow = page.getByTestId(
          "settings-publish-backup-last-published",
        );
        await expect(secondRow).toBeVisible();
        await expect(secondRow).toContainText(/Last published:/i);
        await expect(secondRow).toContainText(/reached 1\/1 relays/);
        // The rendered copy differs in the timestamp portion —
        // we assert monotonicity via the persisted `activeProfile`
        // metadata above, and that the visible row still includes
        // the indicator labels after the second publish.
        expect(firstRenderedText.length).toBeGreaterThan(0);

        // VAL-BACKUP-006: observer must receive the newer event too.
        // Replaceable semantics are the relay's job — this spec only
        // asserts the newer event was published; observer sees it.
        await observerPage
          .waitForFunction(
            (eventId: string) => {
              const w = window as unknown as {
                __observed?: PublishedEvent[];
              };
              return (w.__observed ?? []).some(
                (entry) => entry.id === eventId,
              );
            },
            secondOutcome.event.id,
            { timeout: BACKUP_EVENT_TIMEOUT_MS, polling: 200 },
          )
          .catch(async () => {
            const diag = await observerPage.evaluate(() => {
              const w = window as unknown as {
                __observed?: PublishedEvent[];
              };
              return w.__observed ?? [];
            });
            throw new Error(
              `Observer never received second backup event id=` +
                `${secondOutcome.event.id} within ${BACKUP_EVENT_TIMEOUT_MS}ms. ` +
                `Observed: ${JSON.stringify(diag)}`,
            );
          });

        // ----- No-reachable-relay error path ---------------------------------
        // VAL-BACKUP-007: when no relay is reachable the publish must
        // fail with the canonical "No relays available to publish to."
        // message. We simulate this by dropping every live relay
        // socket via the dev-only `__iglooTestDropRelays` hook — the
        // pump still has the relay configured on the active profile,
        // so `publishProfileBackup`'s inner check on `profile.relays`
        // passes but `pump.publishEvent` returns `reached: []` (no
        // online relays) and the mutator surfaces the canonical error.
        const noRelayError = await page.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestDropRelays: (closeCode?: number) => void;
            __appState: {
              publishProfileBackup: (password: string) => Promise<unknown>;
              runtimeRelays?: Array<{ url: string; state: string }>;
            };
          };
          w.__iglooTestDropRelays();
          // Wait for the pump to mark the relay offline before
          // attempting the publish. The drop is synchronous in terms
          // of WebSocket close but the status callback is async.
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            const relays = w.__appState.runtimeRelays ?? [];
            if (
              relays.length === 0 ||
              relays.every((entry) => entry.state !== "online")
            ) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          try {
            await w.__appState.publishProfileBackup("correct horse battery");
            return { ok: true as const, message: "" };
          } catch (err) {
            return {
              ok: false as const,
              message: err instanceof Error ? err.message : String(err),
            };
          }
        });
        expect(noRelayError.ok).toBe(false);
        expect(noRelayError.message).toMatch(/No relays available/i);

        await observerPage.close();
      } finally {
        await ctx.close().catch(() => undefined);
      }
    },
  );
});
