import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device Restore-Backup e2e for feature `m6-backup-restore`
 * (VAL-CROSS-007 export + restore round-trip).
 *
 * Flow:
 *   1. Page A seeds a keyset, persists a profile, and publishes an
 *      encrypted profile backup event (kind 10000) to a local
 *      `bifrost-devtools` relay.
 *   2. Page B (fresh browser context — no IndexedDB entries) calls
 *      `window.__appState.restoreProfileFromRelay({ bfshare,
 *      bfsharePassword, backupPassword, relays })` pointing at the
 *      same relay. The bfshare is produced via the dev-only
 *      `__iglooTestEncodeBfshare` hook using the share secret that
 *      page A published from.
 *   3. Asserts a new profile shows up in `profiles`, the
 *      `groupPublicKey` / membership match what A published, and a
 *      duplicate restore produces exactly one entry (VAL-BACKUP-030).
 */

const BIFROST_RS_DIR =
  "/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs";
const DEVTOOLS_BINARY = `${BIFROST_RS_DIR}/target/release/bifrost-devtools`;

const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = 8194;
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;

const RELAY_READY_TIMEOUT_MS = 20_000;

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

test.describe("multi-device restore-backup (local bifrost-devtools relay)", () => {
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
          `Run \`bash .factory/init.sh\` before running this spec.`,
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
    await waitForRelayPort(RELAY_HOST, RELAY_PORT, 10_000);
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
            `Is this running under import.meta.env.DEV? (${err})`,
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
          `Relay never transitioned to online on page ${label}. (${err})`,
        );
      });
  }

  test(
    "publisher A publishes a backup; fresh context B restores the backup and a duplicate restore is idempotent",
    async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        await pageA.goto("/");
        await expect(
          pageA.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await waitForHooks(pageA, "A");

        // Generate a 2-of-3 keyset on page A and seed its runtime.
        const keyset: SpecKeyset = await pageA.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestCreateKeysetBundle: (params: {
              groupName: string;
              threshold: number;
              count: number;
            }) => Promise<SpecKeyset>;
          };
          return w.__iglooTestCreateKeysetBundle({
            groupName: "Restore E2E",
            threshold: 2,
            count: 3,
          });
        });
        const share = keyset.shares[0];

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
              deviceName: "Restore Publisher",
              persistProfile: {
                password: "restore-e2e-password",
                label: "Restore E2E",
              },
            });
          },
          { group: keyset.group, share, relayUrl: RELAY_URL },
        );
        await waitForRelayOnline(pageA, "A");

        // Publish a backup event.
        const publishOutcome = await pageA.evaluate(async () => {
          const w = window as unknown as {
            __appState: {
              publishProfileBackup: (password: string) => Promise<{
                reached: string[];
              }>;
            };
          };
          return w.__appState.publishProfileBackup("restore-e2e-password");
        });
        expect(publishOutcome.reached).toEqual([RELAY_URL]);

        // Encode the bfshare string for page B.
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
              password: "restore-e2e-password",
            });
          },
          { seckey: share.seckey, relayUrl: RELAY_URL },
        );
        expect(bfshare).toMatch(/^bfshare1/);

        // Open page B (fresh context — no IndexedDB, no saved profile)
        // and restore using the bfshare + password.
        const pageB = await ctxB.newPage();
        await pageB.goto("/");
        await expect(
          pageB.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await waitForHooks(pageB, "B");

        // fix-m6-restore-relay-wss-and-parallel:
        // restoreProfileFromRelay validates every supplied relay URL
        // via validateRelayUrl (wss:// only), which matches the
        // Settings sidebar contract for real users. This e2e talks to
        // a local bifrost-devtools relay over plain ws://, so we
        // opt-in to the DEV-only bypass on the restore page BEFORE
        // invoking the mutator. The toggle is scoped to this mutator
        // only — Settings UI and updateRelays stay strict.
        await pageB.evaluate(() => {
          (window as unknown as {
            __iglooTestAllowInsecureRelayForRestore?: boolean;
          }).__iglooTestAllowInsecureRelayForRestore = true;
        });

        // Precondition: page B has no saved profiles.
        const preRestoreProfiles = await pageB.evaluate(() => {
          const w = window as unknown as {
            __appState: {
              profiles: Array<{ id: string }>;
            };
          };
          return w.__appState.profiles;
        });
        expect(preRestoreProfiles).toEqual([]);

        const firstRestore = await pageB.evaluate(
          async ({ bfshare, relayUrl }) => {
            const w = window as unknown as {
              __appState: {
                restoreProfileFromRelay: (input: {
                  bfshare: string;
                  bfsharePassword: string;
                  backupPassword: string;
                  relays: string[];
                }) => Promise<{
                  profile: { id: string; groupPublicKey: string };
                  alreadyExisted: boolean;
                }>;
              };
            };
            return w.__appState.restoreProfileFromRelay({
              bfshare,
              bfsharePassword: "restore-e2e-password",
              backupPassword: "restore-e2e-password",
              relays: [relayUrl],
            });
          },
          { bfshare, relayUrl: RELAY_URL },
        );
        // VAL-BACKUP-010: the profile is present after restore.
        expect(firstRestore.alreadyExisted).toBe(false);
        // VAL-CROSS-007: restored group pubkey matches pre-export.
        expect(firstRestore.profile.groupPublicKey).toBe(
          keyset.group.group_pk,
        );

        await pageB.waitForFunction(
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

        // VAL-BACKUP-030: duplicate restore is idempotent — profiles
        // length stays at 1 and the same id is returned.
        const secondRestore = await pageB.evaluate(
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
              bfsharePassword: "restore-e2e-password",
              backupPassword: "restore-e2e-password",
              relays: [relayUrl],
            });
          },
          { bfshare, relayUrl: RELAY_URL },
        );
        expect(secondRestore.profile.id).toBe(firstRestore.profile.id);
        expect(secondRestore.alreadyExisted).toBe(true);

        const finalProfiles = await pageB.evaluate(() => {
          const w = window as unknown as {
            __appState: { profiles: Array<{ id: string }> };
          };
          return w.__appState.profiles;
        });
        expect(finalProfiles.length).toBe(1);
        expect(finalProfiles[0]?.id).toBe(firstRestore.profile.id);

        // VAL-BACKUP-011: wrong password surfaces the canonical error.
        const wrongPwError = await pageB.evaluate(
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
                bfsharePassword: "wrong-password-123",
                backupPassword: "wrong-password-123",
                relays: [relayUrl],
              });
              return { ok: true as const, message: "" };
            } catch (err) {
              return {
                ok: false as const,
                message: err instanceof Error ? err.message : String(err),
              };
            }
          },
          { bfshare, relayUrl: RELAY_URL },
        );
        expect(wrongPwError.ok).toBe(false);
        expect(wrongPwError.message).toMatch(/Invalid password/i);

        await pageB.close();
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
      }
    },
  );
});
