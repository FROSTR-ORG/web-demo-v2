import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Validator harness for m6-backup "live" assertions that the
 * user-testing validator could not exercise reliably against the
 * local `bifrost-devtools` relay in round 1.
 *
 * Assertions covered in this single spec (run under
 * `--project=desktop --workers 1`):
 *
 *   - VAL-BACKUP-006 — duplicate publish behaviour: two publishes
 *     from the same share produce two events whose `created_at`
 *     values are non-decreasing. The VALIDATION CONTRACT's strict
 *     single-winner clause ("relays retain only the newer") is a
 *     RELAY-LEVEL NIP-16/33 property; the local devtools relay is
 *     transport-only and does NOT enforce replaceable semantics, so
 *     a raw `REQ` on the same relay returns BOTH events. This spec
 *     records that observation explicitly — the app-side contract
 *     (monotonic created_at, distinct event ids, same author pubkey)
 *     is the only portion exercisable against the devtools relay.
 *     See `docs/runtime-deviations-from-paper.md` for the full entry.
 *
 *   - VAL-BACKUP-031 — back-to-back publishes must emit strictly
 *     monotonic `created_at` even when both fall inside the same
 *     wall-clock second; the session-scoped monotonic ref in
 *     `publishProfileBackup` guarantees this. Asserted here as a
 *     strict `>` on `second.created_at` vs `first.created_at`.
 *
 *   - VAL-BACKUP-010 — decrypt on correct password appends a new
 *     `SavedProfile` to `profiles` on a fresh context B that has
 *     never seen the published share.
 *
 *   - VAL-BACKUP-013 — the restored profile unlocks and boots a
 *     runtime; `runtimeStatus.metadata.group_public_key` after
 *     unlock matches the source keyset's `group.group_pk`.
 *
 *   - VAL-BACKUP-030 — duplicate restore (same bfshare, same
 *     password) is idempotent; `profiles.length` stays at 1 and the
 *     second call reports `alreadyExisted: true`.
 *
 *   - Bonus: VAL-BACKUP-011 wrong-password surfaces the canonical
 *     inline error copy without mutating `profiles`.
 *
 * The two phases share a single local `bifrost-devtools` relay
 * (ws://127.0.0.1:8194, the only relay port allocated per
 * `AGENTS.md > Mission Boundaries > Ports`). Phase 1 opens the raw
 * NIP-01 subscription from an independent browser context B
 * (separate page) so the query path is isolated from context A's
 * `RuntimeRelayPump`. Phase 2 opens a third fresh context with no
 * IndexedDB entries and drives `restoreProfileFromRelay` + unlock.
 *
 * To run manually:
 *   1. bash .factory/init.sh                       # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/backup-publish-restore-live.spec.ts \
 *        --project=desktop --workers 1
 */

const BIFROST_RS_DIR =
  "/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs";
const DEVTOOLS_BINARY = `${BIFROST_RS_DIR}/target/release/bifrost-devtools`;

const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = 8194;
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;

const RELAY_READY_TIMEOUT_MS = 20_000;
const RAW_SUB_COLLECT_WINDOW_MS = 5_000;

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

// Minimal shapes matching the window.__appState / test-hook surface.
// Matches the typing used in `backup-publish.spec.ts` and
// `backup-restore.spec.ts`.
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

test.describe(
  "m6 validator harness: publish + raw query + restore + unlock (live local relay)",
  () => {
    test.skip(
      () => !cargoAvailable(),
      "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
        "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
        "(https://rustup.rs) or run in an environment with cargo to unskip.",
    );

    test.setTimeout(240_000);

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

    async function waitForHooks(page: Page, label: string) {
      await page
        .waitForFunction(
          () => {
            const w = window as unknown as {
              __appState?: unknown;
              __iglooTestSeedRuntime?: unknown;
              __iglooTestCreateKeysetBundle?: unknown;
              __iglooTestMemberPubkey32?: unknown;
              __iglooTestEncodeBfshare?: unknown;
            };
            return (
              typeof w.__appState === "object" &&
              typeof w.__iglooTestSeedRuntime === "function" &&
              typeof w.__iglooTestCreateKeysetBundle === "function" &&
              typeof w.__iglooTestMemberPubkey32 === "function" &&
              typeof w.__iglooTestEncodeBfshare === "function"
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
      "validator-runnable: two publishes produce monotonic created_at " +
        "observable via raw NIP-01 REQ (VAL-BACKUP-006 deviation + " +
        "VAL-BACKUP-031); restore on a fresh context adds a single " +
        "profile that unlocks with matching group pubkey, duplicate " +
        "restore is idempotent, wrong password is rejected " +
        "(VAL-BACKUP-010 + VAL-BACKUP-013 + VAL-BACKUP-030 + VAL-BACKUP-011)",
      async ({ browser }) => {
        // ============================================================
        // PHASE 1 — Publish twice on context A; raw NIP-01 REQ on a
        // second context B queries the SAME relay URL on the SAME port
        // (no TLS proxy) and confirms both events land with monotonic
        // created_at + distinct event ids. The local bifrost-devtools
        // relay is transport-only and does NOT enforce NIP-16/33
        // replaceable semantics — this phase EXPECTS both events to
        // be returned to the raw REQ, which is the documented local-
        // relay deviation for VAL-BACKUP-006 (see
        // docs/runtime-deviations-from-paper.md).
        // ============================================================
        const ctxA = await browser.newContext();
        const ctxObserver = await browser.newContext();
        const ctxRestore = await browser.newContext();
        try {
          const pageA = await ctxA.newPage();
          pageA.on("console", (msg) => {
            if (msg.type() === "error") {
              console.log(`[pageA:console.error] ${msg.text()}`);
            }
          });
          await pageA.goto("/");
          await expect(
            pageA.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible();
          await waitForHooks(pageA, "A");

          // Generate a 2-of-3 keyset. Share #0 will publish + be the
          // restore target.
          const keyset: SpecKeyset = await pageA.evaluate(async () => {
            const w = window as unknown as {
              __iglooTestCreateKeysetBundle: (params: {
                groupName: string;
                threshold: number;
                count: number;
              }) => Promise<SpecKeyset>;
            };
            return w.__iglooTestCreateKeysetBundle({
              groupName: "Live Harness",
              threshold: 2,
              count: 3,
            });
          });
          expect(keyset.shares.length).toBe(3);
          const share = keyset.shares[0];

          // Seed runtime on A against the local relay; persist a real
          // profile so `publishProfileBackup` sees an `activeProfile`.
          await pageA.evaluate(
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
                deviceName: "Live Harness A",
                persistProfile: {
                  password: "live-harness-password",
                  label: "Live Harness",
                },
              });
            },
            { group: keyset.group, share, relayUrl: RELAY_URL },
          );
          await waitForRelayOnline(pageA, "A");

          // Derive the share-scoped nostr author pubkey so the raw
          // REQ filter is precise.
          const authorPubkey32 = await pageA.evaluate(
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

          // Open a raw NIP-01 subscription from ctxObserver (separate
          // browser context — NOT page A) to prove the query path is
          // independent of A's RuntimeRelayPump.
          const observerPage = await ctxObserver.newPage();
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
                  ws.send(
                    JSON.stringify([
                      "REQ",
                      "live-harness-observer",
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
                    // ignore malformed frames
                  }
                };
              });
            },
            { relayUrl: RELAY_URL, authorHex: authorPubkey32 },
          );
          await observerPage.evaluate(async () => {
            const w = window as unknown as {
              __observerReady: Promise<void>;
            };
            await w.__observerReady;
          });

          // First publish.
          const firstOutcome = await pageA.evaluate(async () => {
            const w = window as unknown as {
              __appState: {
                publishProfileBackup: (password: string) => Promise<{
                  event: PublishedEvent;
                  reached: string[];
                }>;
              };
            };
            return w.__appState.publishProfileBackup(
              "live-harness-password",
            );
          });
          expect(firstOutcome.reached).toEqual([RELAY_URL]);
          expect(firstOutcome.event.kind).toBe(10000);
          expect(firstOutcome.event.pubkey).toBe(authorPubkey32);
          expect(firstOutcome.event.content).not.toMatch(/^\s*\{/);
          expect(firstOutcome.event.content).not.toContain(share.seckey);

          // Second publish (back-to-back).
          const secondOutcome = await pageA.evaluate(async () => {
            const w = window as unknown as {
              __appState: {
                publishProfileBackup: (password: string) => Promise<{
                  event: PublishedEvent;
                  reached: string[];
                }>;
              };
            };
            return w.__appState.publishProfileBackup(
              "live-harness-password",
            );
          });
          expect(secondOutcome.reached).toEqual([RELAY_URL]);
          expect(secondOutcome.event.kind).toBe(10000);
          expect(secondOutcome.event.pubkey).toBe(authorPubkey32);

          // VAL-BACKUP-031: strict monotonic created_at across two
          // publishes from the same share.
          expect(secondOutcome.event.created_at).toBeGreaterThan(
            firstOutcome.event.created_at,
          );
          expect(secondOutcome.event.id).not.toBe(firstOutcome.event.id);

          // Wait for the observer to have seen BOTH events on its
          // independent subscription. Local `bifrost-devtools` relay is
          // transport-only and does NOT enforce NIP-16/33 replaceable
          // semantics, so a raw `REQ` returns both.
          await observerPage
            .waitForFunction(
              ({ firstId, secondId }: { firstId: string; secondId: string }) => {
                const w = window as unknown as {
                  __observed?: PublishedEvent[];
                };
                const observed = w.__observed ?? [];
                return (
                  observed.some((entry) => entry.id === firstId) &&
                  observed.some((entry) => entry.id === secondId)
                );
              },
              {
                firstId: firstOutcome.event.id,
                secondId: secondOutcome.event.id,
              },
              { timeout: RAW_SUB_COLLECT_WINDOW_MS + 10_000, polling: 200 },
            )
            .catch(async (err) => {
              const diag = await observerPage.evaluate(() => {
                const w = window as unknown as {
                  __observed?: PublishedEvent[];
                };
                return (w.__observed ?? []).map((entry) => ({
                  id: entry.id,
                  created_at: entry.created_at,
                  kind: entry.kind,
                }));
              });
              throw new Error(
                `Raw NIP-01 REQ never received both published events ` +
                  `within ${RAW_SUB_COLLECT_WINDOW_MS + 10_000}ms. ` +
                  `first=${firstOutcome.event.id} ` +
                  `second=${secondOutcome.event.id}. ` +
                  `Observed: ${JSON.stringify(diag)}. (${err})`,
              );
            });

          // Drain the observer buffer after a short settle window so
          // late frames are counted. Confirms the local relay returned
          // BOTH events for the same (kind, author) query — i.e. the
          // documented NIP-16/33 deviation.
          await new Promise((resolve) =>
            setTimeout(resolve, RAW_SUB_COLLECT_WINDOW_MS),
          );
          const observedEvents = await observerPage.evaluate(() => {
            const w = window as unknown as {
              __observed?: PublishedEvent[];
            };
            return (w.__observed ?? []).map((entry) => ({
              id: entry.id,
              created_at: entry.created_at,
              kind: entry.kind,
              pubkey: entry.pubkey,
            }));
          });
          const observedByEventId = new Map<string, (typeof observedEvents)[number]>();
          for (const entry of observedEvents) {
            observedByEventId.set(entry.id, entry);
          }
          // Same author + same kind + both event ids must be present
          // on the raw subscription. This is the VAL-BACKUP-006 local-
          // relay deviation observation.
          expect(observedByEventId.get(firstOutcome.event.id)).toBeDefined();
          expect(observedByEventId.get(secondOutcome.event.id)).toBeDefined();
          expect(
            observedByEventId.get(firstOutcome.event.id)?.kind,
          ).toBe(10000);
          expect(
            observedByEventId.get(secondOutcome.event.id)?.kind,
          ).toBe(10000);
          expect(
            observedByEventId.get(firstOutcome.event.id)?.pubkey,
          ).toBe(authorPubkey32);
          expect(
            observedByEventId.get(secondOutcome.event.id)?.pubkey,
          ).toBe(authorPubkey32);

          // Explicit assertion of the deviation: the raw query
          // returned >= 2 events for (kind=10000, author=<share>)
          // because the local relay does NOT apply replaceable
          // semantics. Capture-and-annotate so future validator
          // reruns treat this as the designed-for observation.
          const matchingEvents = observedEvents.filter(
            (entry) =>
              entry.pubkey === authorPubkey32 && entry.kind === 10000,
          );
          expect(matchingEvents.length).toBeGreaterThanOrEqual(2);
          // created_at values for the two publish outcomes are
          // strictly monotonic (VAL-BACKUP-031), AND they both show
          // up in the raw subscription (VAL-BACKUP-006 local relay
          // deviation).
          const observedCreatedAtPairs = matchingEvents
            .filter(
              (entry) =>
                entry.id === firstOutcome.event.id ||
                entry.id === secondOutcome.event.id,
            )
            .sort((a, b) => a.created_at - b.created_at);
          expect(observedCreatedAtPairs.length).toBe(2);
          expect(observedCreatedAtPairs[1].created_at).toBeGreaterThan(
            observedCreatedAtPairs[0].created_at,
          );

          // Close the phase-1 observer subscription before moving to
          // phase 2. Phase 2 doesn't touch this context.
          await observerPage.evaluate(() => {
            // No direct API to close a stray WebSocket — the context
            // teardown in finally {} handles it cleanly.
          });

          // ============================================================
          // PHASE 2 — Fresh context ctxRestore (no IndexedDB entries)
          // runs the full restore path against the SAME local relay.
          // Uses the DEV-only `__iglooTestAllowInsecureRelayForRestore`
          // flag because `restoreProfileFromRelay`'s strict wss://
          // validator would otherwise reject the ws:// URL. See the
          // `restoreProfileFromRelay — DEV-only ws:// opt-in` entry in
          // `docs/runtime-deviations-from-paper.md`.
          // ============================================================
          // Encode the bfshare that context B will paste/restore with.
          const bfshare = await pageA.evaluate(
            async ({ seckey, relayUrl }) => {
              const w = window as unknown as {
                __iglooTestEncodeBfshare: (input: {
                  shareSecret: string;
                  relays: string[];
                  password: string;
                }) => Promise<string>;
              };
              return w.__iglooTestEncodeBfshare({
                shareSecret: seckey,
                relays: [relayUrl],
                password: "live-harness-password",
              });
            },
            { seckey: share.seckey, relayUrl: RELAY_URL },
          );
          expect(bfshare).toMatch(/^bfshare1/);

          const pageRestore = await ctxRestore.newPage();
          pageRestore.on("console", (msg) => {
            if (msg.type() === "error") {
              console.log(`[pageRestore:console.error] ${msg.text()}`);
            }
          });
          await pageRestore.goto("/");
          await expect(
            pageRestore.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible();
          await waitForHooks(pageRestore, "restore");

          // Flip the DEV-only opt-in before invoking the mutator.
          await pageRestore.evaluate(() => {
            (
              window as unknown as {
                __iglooTestAllowInsecureRelayForRestore?: boolean;
              }
            ).__iglooTestAllowInsecureRelayForRestore = true;
          });

          // Precondition: no saved profiles on the fresh context.
          const preRestore = await pageRestore.evaluate(() => {
            const w = window as unknown as {
              __appState: { profiles: Array<{ id: string }> };
            };
            return w.__appState.profiles;
          });
          expect(preRestore).toEqual([]);

          // VAL-BACKUP-010: first restore adds a profile and returns
          // `alreadyExisted: false` + `groupPublicKey === group.group_pk`.
          const firstRestore = await pageRestore.evaluate(
            async ({ bfshare, relayUrl }) => {
              const w = window as unknown as {
                __appState: {
                  restoreProfileFromRelay: (input: {
                    bfshare: string;
                    bfsharePassword: string;
                    backupPassword: string;
                    relays: string[];
                  }) => Promise<{
                    profile: {
                      id: string;
                      groupPublicKey: string;
                      localShareIdx?: number;
                    };
                    alreadyExisted: boolean;
                  }>;
                };
              };
              return w.__appState.restoreProfileFromRelay({
                bfshare,
                bfsharePassword: "live-harness-password",
                backupPassword: "live-harness-password",
                relays: [relayUrl],
              });
            },
            { bfshare, relayUrl: RELAY_URL },
          );
          expect(firstRestore.alreadyExisted).toBe(false);
          expect(firstRestore.profile.groupPublicKey).toBe(
            keyset.group.group_pk,
          );

          await pageRestore.waitForFunction(
            (expectedId: string) => {
              const w = window as unknown as {
                __appState: { profiles: Array<{ id: string }> };
              };
              return w.__appState.profiles.some(
                (entry) => entry.id === expectedId,
              );
            },
            firstRestore.profile.id,
            { timeout: 5_000, polling: 100 },
          );

          // VAL-BACKUP-030: duplicate restore is idempotent. Second
          // call reports `alreadyExisted: true`, `profiles.length`
          // stays at 1, same profile id.
          const secondRestore = await pageRestore.evaluate(
            async ({ bfshare, relayUrl }) => {
              const w = window as unknown as {
                __appState: {
                  restoreProfileFromRelay: (input: {
                    bfshare: string;
                    bfsharePassword: string;
                    backupPassword: string;
                    relays: string[];
                  }) => Promise<{
                    profile: { id: string };
                    alreadyExisted: boolean;
                  }>;
                };
              };
              return w.__appState.restoreProfileFromRelay({
                bfshare,
                bfsharePassword: "live-harness-password",
                backupPassword: "live-harness-password",
                relays: [relayUrl],
              });
            },
            { bfshare, relayUrl: RELAY_URL },
          );
          expect(secondRestore.profile.id).toBe(firstRestore.profile.id);
          expect(secondRestore.alreadyExisted).toBe(true);
          const postDuplicateProfiles = await pageRestore.evaluate(() => {
            const w = window as unknown as {
              __appState: { profiles: Array<{ id: string }> };
            };
            return w.__appState.profiles;
          });
          expect(postDuplicateProfiles.length).toBe(1);
          expect(postDuplicateProfiles[0]?.id).toBe(firstRestore.profile.id);

          // VAL-BACKUP-013: restored profile unlocks and boots a
          // runtime whose status metadata exposes the same group
          // pubkey the source keyset published with.
          await pageRestore.evaluate(
            async ({ profileId }) => {
              const w = window as unknown as {
                __appState: {
                  unlockProfile: (
                    id: string,
                    password: string,
                  ) => Promise<void>;
                };
              };
              await w.__appState.unlockProfile(
                profileId,
                "live-harness-password",
              );
            },
            { profileId: firstRestore.profile.id },
          );

          // Wait for the post-unlock runtime_status poll to produce a
          // metadata block with the group_public_key in it.
          const groupPkAfterUnlock = await pageRestore
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeStatus?: {
                      metadata?: { group_public_key?: string };
                    };
                  };
                };
                const gpk =
                  w.__appState?.runtimeStatus?.metadata?.group_public_key;
                return typeof gpk === "string" && gpk.length > 0
                  ? gpk
                  : null;
              },
              undefined,
              { timeout: 15_000, polling: 200 },
            )
            .then((handle) => handle.jsonValue() as Promise<string | null>);
          expect(groupPkAfterUnlock).toBe(keyset.group.group_pk);

          // And `activeProfile` now points to the restored entry.
          const activeProfileIdAfterUnlock = await pageRestore.evaluate(
            () => {
              const w = window as unknown as {
                __appState?: { activeProfile?: { id?: string } };
              };
              return w.__appState?.activeProfile?.id ?? null;
            },
          );
          expect(activeProfileIdAfterUnlock).toBe(firstRestore.profile.id);

          // VAL-BACKUP-011 (bonus): wrong password returns the
          // canonical inline error copy without touching profiles.
          const wrongPwError = await pageRestore.evaluate(
            async ({ bfshare, relayUrl }) => {
              const w = window as unknown as {
                __appState: {
                  restoreProfileFromRelay: (input: {
                    bfshare: string;
                    bfsharePassword: string;
                    backupPassword: string;
                    relays: string[];
                  }) => Promise<unknown>;
                };
              };
              try {
                await w.__appState.restoreProfileFromRelay({
                  bfshare,
                  bfsharePassword: "wrong-password-xyz",
                  backupPassword: "wrong-password-xyz",
                  relays: [relayUrl],
                });
                return { ok: true as const, message: "" };
              } catch (err) {
                return {
                  ok: false as const,
                  message:
                    err instanceof Error ? err.message : String(err),
                };
              }
            },
            { bfshare, relayUrl: RELAY_URL },
          );
          expect(wrongPwError.ok).toBe(false);
          expect(wrongPwError.message).toMatch(/Invalid password/i);

          // Profile list unchanged by the wrong-password attempt.
          const finalProfiles = await pageRestore.evaluate(() => {
            const w = window as unknown as {
              __appState: { profiles: Array<{ id: string }> };
            };
            return w.__appState.profiles;
          });
          expect(finalProfiles.length).toBe(1);
          expect(finalProfiles[0]?.id).toBe(firstRestore.profile.id);

          await observerPage.close().catch(() => undefined);
          await pageRestore.close().catch(() => undefined);
          await pageA.close().catch(() => undefined);
        } finally {
          await ctxA.close().catch(() => undefined);
          await ctxObserver.close().catch(() => undefined);
          await ctxRestore.close().catch(() => undefined);
        }
      },
    );
  },
);
