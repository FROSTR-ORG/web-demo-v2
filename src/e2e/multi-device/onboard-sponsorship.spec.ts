import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device onboard-sponsorship e2e for feature
 * `fix-m7-scrutiny-r1-onboard-distinct-share-full-handshake`.
 *
 * Background (scrutiny m7 r1): the previous version of this spec
 * SIMULATED adoption by seeding tab B with the allocated share
 * directly, only asserting the sponsor's session entered
 * `"awaiting_adoption"` and that tab B's adopted `group_pk` matched
 * tab A's. That does NOT prove a full sponsor→requester handshake
 * completes — `drain_completions()` on the sponsor side was never
 * exercised, the sponsor's `onboardSponsorSession.status` never
 * transitioned to `"completed"`, and no ONBOARD runtime-event-log
 * entry was asserted on either side.
 *
 * Additionally the pre-fix spec was inconsistent with the pool-gated
 * preconditions introduced by
 * `fix-m7-onboard-distinct-share-allocation`:
 *   - `createOnboardSponsorPackage` requires an encrypted
 *     `unadoptedSharesCiphertext` on the stored profile record, but
 *     the test relied on `__iglooTestSeedRuntime({persistProfile})`
 *     which calls `savePayloadAsProfile` (no pool seeding).
 *   - The profile password persisted by `persistProfile` differed
 *     from the `profilePassword` the mutator uses to decrypt the
 *     pool.
 * The happy-path dispatch would therefore throw
 * `UNADOPTED_POOL_EXHAUSTED_ERROR` as soon as the mutator tried to
 * decrypt the pool.
 *
 * This spec rewrites the e2e around two new DEV-only hooks:
 *   - `__iglooTestSeedUnadoptedSharesPool({profileId, password, shares})`
 *     encrypts the supplied shares under the profile password and
 *     writes the resulting ciphertext to the stored profile record.
 *   - `__iglooTestAdoptOnboardPackage({packageText, packagePassword,
 *     profilePassword})` drives the requester-side `/onboard` path
 *     programmatically (decodeOnboardPackage → startOnboardHandshake
 *     → saveOnboardedProfile) so tab B completes a REAL FROST
 *     handshake against the sponsor (not a `__iglooTestSeedRuntime`
 *     shortcut).
 *
 * The spec asserts, end-to-end across two browser contexts on the
 * local `bifrost-devtools` relay:
 *
 *   1. Tab A creates a 2-of-2 keyset, persists a profile with
 *      password P, seeds its unadopted shares pool (encrypted under
 *      P) with the non-self share, then dispatches
 *      `createOnboardSponsorPackage({profilePassword: P})`.
 *   2. Tab A's `onboardSponsorSession.status` transitions through
 *      `"awaiting_adoption"`.
 *   3. Tab B adopts the `bfonboard1…` package programmatically via
 *      `__iglooTestAdoptOnboardPackage`. This exercises the real
 *      `runOnboardingRelayHandshake` → sponsor publishes
 *      `OnboardResponse` → requester `saveOnboardedProfile`
 *      pipeline.
 *   4. Tab A's `drainCompletions()` yields a
 *      `CompletedOperation::Onboard` matching the sponsor session's
 *      `requestId`; the session status transitions to
 *      `"completed"`.
 *   5. Tab A's `runtimeCompletions` slice contains the Onboard
 *      completion with `group_member_count === keyset.members.length`.
 *   6. BOTH tabs' `runtimeEventLog` expose an ONBOARD-tagged entry
 *      for the ceremony (sponsor: completion-side local_mutation;
 *      requester: `saveOnboardedProfile`-emitted local_mutation).
 *
 * Skip gate matches every other spec in this folder — skip only
 * when `cargo --version` fails, hard-fail on every other
 * environmental mishap so regressions never hide.
 *
 * To run manually:
 *   1. bash .factory/init.sh
 *   2. npx playwright test src/e2e/multi-device/onboard-sponsorship.spec.ts \
 *        --project=desktop --workers 1
 */

const BIFROST_RS_DIR =
  "/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs";
const DEVTOOLS_BINARY = `${BIFROST_RS_DIR}/target/release/bifrost-devtools`;

// Port 8194 is the only relay port allocated by AGENTS.md Mission
// Boundaries for this mission — do not change it.
const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = 8194;
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;

const RELAY_READY_TIMEOUT_MS = 20_000;
const HOOKS_READY_TIMEOUT_MS = 15_000;
const RUNTIME_READY_TIMEOUT_MS = 20_000;
// Full FROST onboard handshake: requester publishes OnboardRequest,
// sponsor runtime processes it + publishes OnboardResponse, requester
// applies it and saves. End-to-end under ~20s on a healthy host; 90s
// ceiling leaves ample headroom for CPU-loaded CI.
const ONBOARD_HANDSHAKE_TIMEOUT_MS = 90_000;
const COMPLETION_DRAIN_TIMEOUT_MS = 45_000;

// Profile password shared by the sponsor's stored profile AND its
// encrypted unadopted shares pool. `createOnboardSponsorPackage`
// decrypts the pool with this password; if it differs from the
// profile-persist password the mutator throws
// UNADOPTED_POOL_WRONG_PASSWORD_ERROR.
const SPONSOR_PROFILE_PASSWORD = "sponsor-profile-pw-1234";

// Separate password on the bfonboard1… package itself (the code the
// sponsor shares with the requester). Decrypted on tab B.
const ONBOARD_PACKAGE_PASSWORD = "onboard-package-pw-1234";

// Tab B's new profile password (saved after adoption).
const REQUESTER_PROFILE_PASSWORD = "requester-profile-pw-1234";

// `createOnboardSponsorPackage` validates every supplied relay URL via
// `validateRelayUrl` (wss://-only, same contract as the Settings
// sidebar's relay editor — see AppStateProvider.tsx). The local
// bifrost-devtools relay speaks plain ws://, so we hand the mutator a
// placeholder wss:// URL inside the package's `relays` field; the
// sponsor's runtime still publishes/subscribes via the REAL ws:// URL
// wired on seed time. Tab B's handshake uses the real ws:// URL
// provided out-of-band through `relayOverride`.
const SPONSOR_PKG_RELAY = "wss://relay.example.invalid";

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

test.describe("multi-device onboard sponsorship (fix-m7-scrutiny-r1-onboard-distinct-share-full-handshake)", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  test.setTimeout(300_000);

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
      await waitForRelayPort(RELAY_HOST, RELAY_PORT, RELAY_READY_TIMEOUT_MS);
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

  test(
    "source→requester handshake completes, both sides emit ONBOARD event-log entries",
    async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        const wirePageConsole = (page: Page, label: string) =>
          page.on("console", (msg) => {
            if (msg.type() === "error") {
              // eslint-disable-next-line no-console
              console.log(`[${label}:console.error] ${msg.text()}`);
            }
          });
        wirePageConsole(pageA, "A");
        wirePageConsole(pageB, "B");

        await pageA.goto("/");
        await pageB.goto("/");
        await expect(
          pageA.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();
        await expect(
          pageB.getByRole("heading", { name: "Igloo Web" }),
        ).toBeVisible();

        const waitForHooks = async (page: Page, label: string) =>
          page
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: unknown;
                  __iglooTestSeedRuntime?: unknown;
                  __iglooTestCreateKeysetBundle?: unknown;
                  __iglooTestMemberPubkey32?: unknown;
                  __iglooTestSeedUnadoptedSharesPool?: unknown;
                  __iglooTestAdoptOnboardPackage?: unknown;
                  __iglooTestEncodeBfonboardPackage?: unknown;
                };
                return (
                  typeof w.__appState === "object" &&
                  typeof w.__iglooTestSeedRuntime === "function" &&
                  typeof w.__iglooTestCreateKeysetBundle === "function" &&
                  typeof w.__iglooTestMemberPubkey32 === "function" &&
                  typeof w.__iglooTestSeedUnadoptedSharesPool === "function" &&
                  typeof w.__iglooTestAdoptOnboardPackage === "function" &&
                  typeof w.__iglooTestEncodeBfonboardPackage === "function"
                );
              },
              undefined,
              { timeout: HOOKS_READY_TIMEOUT_MS, polling: 100 },
            )
            .catch((err) => {
              throw new Error(
                `Dev-only test hooks never attached on page ${label}. ` +
                  `Is this running under \`import.meta.env.DEV\`? (${err})`,
              );
            });
        await waitForHooks(pageA, "A");
        await waitForHooks(pageB, "B");

        // 2-of-2 keyset generated on tab A. Share 0 → tab A (sponsor),
        // share 1 → unadopted pool (destined for tab B via bfonboard).
        const keyset: SpecKeyset = await pageA.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestCreateKeysetBundle: (params: {
              groupName: string;
              threshold: number;
              count: number;
            }) => Promise<{
              group: {
                group_name: string;
                group_pk: string;
                threshold: number;
                members: Array<{ idx: number; pubkey: string }>;
              };
              shares: Array<{ idx: number; seckey: string }>;
            }>;
          };
          return w.__iglooTestCreateKeysetBundle({
            groupName: "Sponsor E2E",
            threshold: 2,
            count: 2,
          });
        });
        expect(keyset.shares.length).toBe(2);
        const shareA = keyset.shares[0];
        const shareB = keyset.shares[1];

        // === Step 1: seed tab A with a persisted profile ===
        await pageA.evaluate(
          async ({ group, share, relayUrl, password }) => {
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
              relays: [relayUrl],
              deviceName: "Alice Sponsor",
              persistProfile: {
                password,
                label: "Alice Sponsor",
              },
            });
          },
          {
            group: keyset.group,
            share: shareA,
            relayUrl: RELAY_URL,
            password: SPONSOR_PROFILE_PASSWORD,
          },
        );

        const waitForActiveProfile = async (page: Page, label: string) =>
          page
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: { activeProfile?: unknown };
                };
                return Boolean(w.__appState?.activeProfile);
              },
              undefined,
              { timeout: RUNTIME_READY_TIMEOUT_MS, polling: 150 },
            )
            .catch((err) => {
              throw new Error(
                `activeProfile never populated on page ${label} within ` +
                  `${RUNTIME_READY_TIMEOUT_MS}ms (${err})`,
              );
            });
        await waitForActiveProfile(pageA, "A");

        // === Step 2: seed tab A's unadopted shares pool with share 1 ===
        // The pool MUST be encrypted under the same password as the
        // persisted profile so `createOnboardSponsorPackage` can decrypt
        // it with `profilePassword: SPONSOR_PROFILE_PASSWORD`.
        const peerBPubkey32Hex = await pageA.evaluate(
          ({ group, shareIdx }) => {
            const w = window as unknown as {
              __iglooTestMemberPubkey32: (
                group: unknown,
                shareIdx: number,
              ) => string;
            };
            return w.__iglooTestMemberPubkey32(group, shareIdx);
          },
          { group: keyset.group, shareIdx: shareB.idx },
        );
        expect(peerBPubkey32Hex).toMatch(/^[0-9a-f]{64}$/);

        await pageA.evaluate(
          async ({ password, share, pubkey32 }) => {
            const w = window as unknown as {
              __iglooTestSeedUnadoptedSharesPool: (input: {
                profileId?: string;
                password: string;
                shares: Array<{
                  idx: number;
                  share_secret: string;
                  member_pubkey_x_only: string;
                }>;
              }) => Promise<void>;
            };
            await w.__iglooTestSeedUnadoptedSharesPool({
              password,
              shares: [
                {
                  idx: share.idx,
                  share_secret: share.seckey,
                  member_pubkey_x_only: pubkey32,
                },
              ],
            });
          },
          {
            password: SPONSOR_PROFILE_PASSWORD,
            share: shareB,
            pubkey32: peerBPubkey32Hex,
          },
        );

        // Sponsor's self x-only pubkey — used later to verify the
        // sponsor did NOT target itself in the pending Onboard op.
        const selfPubkeyA = await pageA.evaluate(
          ({ group, shareIdx }) => {
            const w = window as unknown as {
              __iglooTestMemberPubkey32: (
                group: unknown,
                shareIdx: number,
              ) => string;
            };
            return w.__iglooTestMemberPubkey32(group, shareIdx);
          },
          { group: keyset.group, shareIdx: shareA.idx },
        );
        expect(selfPubkeyA).toMatch(/^[0-9a-f]{64}$/);

        // === Step 3: dispatch createOnboardSponsorPackage ===
        // Real mutator: decrypts the pool, allocates share 1, encodes
        // the bfonboard package, dispatches onboard command. The
        // returned package text is what tab B needs to adopt.
        const packageText = await pageA.evaluate(
          async ({ pkgRelay, password, profilePassword }) => {
            const w = window as unknown as {
              __appState: {
                createOnboardSponsorPackage: (input: {
                  deviceLabel: string;
                  password: string;
                  relays: string[];
                  profilePassword: string;
                }) => Promise<string>;
              };
            };
            return w.__appState.createOnboardSponsorPackage({
              deviceLabel: "Bob Laptop",
              password,
              relays: [pkgRelay],
              profilePassword,
            });
          },
          {
            pkgRelay: SPONSOR_PKG_RELAY,
            password: ONBOARD_PACKAGE_PASSWORD,
            profilePassword: SPONSOR_PROFILE_PASSWORD,
          },
        );
        expect(packageText.startsWith("bfonboard1")).toBe(true);

        // === Step 4: sponsor session awaits adoption ===
        const awaitingSession = await pageA
          .waitForFunction(
            () => {
              const w = window as unknown as {
                __appState?: {
                  onboardSponsorSession?: unknown;
                };
              };
              return w.__appState?.onboardSponsorSession ?? null;
            },
            undefined,
            { timeout: 10_000, polling: 100 },
          )
          .then(
            (handle) =>
              handle.jsonValue() as Promise<{
                status: string;
                targetPeerPubkey: string | null;
                packageText: string;
                requestId: string | null;
                failureReason?: string;
              } | null>,
          );
        expect(awaitingSession).not.toBeNull();
        expect(awaitingSession?.status).toBe("awaiting_adoption");
        expect(awaitingSession?.targetPeerPubkey?.toLowerCase()).toBe(
          peerBPubkey32Hex.toLowerCase(),
        );
        // Core fix-m7-onboard-self-peer-rejection regression: target
        // MUST NOT be the sponsor's own x-only pubkey.
        expect(awaitingSession?.targetPeerPubkey?.toLowerCase()).not.toBe(
          selfPubkeyA.toLowerCase(),
        );
        expect(awaitingSession?.packageText).toBe(packageText);
        const sponsorRequestId = awaitingSession!.requestId!;
        expect(sponsorRequestId).toBeTruthy();

        // Build the package tab B will adopt using the real ws://
        // local relay URL. `createOnboardSponsorPackage` above
        // exercised the production mutator (pool decrypt, ledger
        // upsert, runtime dispatch, session bookkeeping) — it's the
        // source of truth for the sponsor's pending Onboard op +
        // session. But its `encodeOnboardPackage` call embeds the
        // wss:// placeholder because the mutator's relay validator is
        // wss://-only (matches the Settings-sidebar contract). The
        // requester's handshake needs the real ws://127.0.0.1:8194
        // so it can publish OnboardRequest on the same relay the
        // sponsor's pump is subscribed to. We encode a separate
        // package with the same allocated share secret via the
        // validation-bypassing dev hook.
        const handshakePackageText = await pageA.evaluate(
          async ({ shareSecret, peerPk, relayUrl, password }) => {
            const w = window as unknown as {
              __iglooTestEncodeBfonboardPackage: (input: {
                shareSecret: string;
                relays: string[];
                peerPk: string;
                password: string;
              }) => Promise<string>;
            };
            return w.__iglooTestEncodeBfonboardPackage({
              shareSecret,
              relays: [relayUrl],
              peerPk,
              password,
            });
          },
          {
            shareSecret: shareB.seckey,
            peerPk: selfPubkeyA,
            relayUrl: RELAY_URL,
            password: ONBOARD_PACKAGE_PASSWORD,
          },
        );
        expect(handshakePackageText.startsWith("bfonboard1")).toBe(true);

        // Capture pre-completion count of Onboard completions on A so
        // we can assert exactly one new one drains.
        const preCompletionCount = await pageA.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              runtimeCompletions?: Array<unknown>;
            };
          };
          const completions = w.__appState?.runtimeCompletions ?? [];
          return completions.filter(
            (c) => typeof c === "object" && c !== null && "Onboard" in c,
          ).length;
        });
        expect(preCompletionCount).toBe(0);

        // === Step 5: tab B adopts the bfonboard package ===
        // Drives decodeOnboardPackage → startOnboardHandshake →
        // saveOnboardedProfile via the production AppState mutators.
        // This is a FULL FROST handshake against the sponsor's
        // runtime (which is listening on the same ws://127.0.0.1:8194
        // relay).
        const adoptedProfileId = await pageB.evaluate(
          async ({ pkg, packagePassword, profilePassword }) => {
            const w = window as unknown as {
              __iglooTestAdoptOnboardPackage: (input: {
                packageText: string;
                packagePassword: string;
                profilePassword: string;
              }) => Promise<string>;
            };
            return w.__iglooTestAdoptOnboardPackage({
              packageText: pkg,
              packagePassword,
              profilePassword,
            });
          },
          {
            pkg: handshakePackageText,
            packagePassword: ONBOARD_PACKAGE_PASSWORD,
            profilePassword: REQUESTER_PROFILE_PASSWORD,
          },
        );
        expect(adoptedProfileId).toMatch(/^[0-9a-f-]+$/);

        // Tab B's active profile reflects the adopted group.
        await waitForActiveProfile(pageB, "B");
        const adoptedGroupPk = await pageB.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              activeProfile?: { groupPublicKey?: string };
            };
          };
          return w.__appState?.activeProfile?.groupPublicKey ?? null;
        });
        expect(adoptedGroupPk?.toLowerCase()).toBe(
          keyset.group.group_pk.toLowerCase(),
        );

        // === Step 6: sponsor session transitions to 'completed' ===
        // The sponsor's runtime must drain a `CompletedOperation::Onboard`
        // matching `sponsorRequestId`; `absorbDrains` then flips the
        // session's `status` to "completed".
        await pageA
          .waitForFunction(
            (input: { requestId: string }) => {
              const w = window as unknown as {
                __appState?: {
                  onboardSponsorSessions?: Record<
                    string,
                    { status?: string } | undefined
                  >;
                };
              };
              const sessions = w.__appState?.onboardSponsorSessions ?? {};
              const session = sessions[input.requestId];
              return session?.status === "completed";
            },
            { requestId: sponsorRequestId },
            {
              timeout: ONBOARD_HANDSHAKE_TIMEOUT_MS,
              polling: 200,
            },
          )
          .catch((err) => {
            throw new Error(
              `Sponsor session ${sponsorRequestId} never transitioned ` +
                `to 'completed' within ${ONBOARD_HANDSHAKE_TIMEOUT_MS}ms. ` +
                `Full sponsor→requester handshake did not reach drainCompletions. ` +
                `(${err})`,
            );
          });

        // === Step 7: sponsor's runtimeCompletions contains the Onboard ===
        // Independent evidence (not just session state): the drained
        // `CompletedOperation::Onboard` is present in the sponsor's
        // completions slice with `group_member_count` matching the
        // keyset's member count.
        const onboardCompletion = await pageA
          .waitForFunction(
            (input: { requestId: string }) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeCompletions?: Array<Record<string, unknown>>;
                };
              };
              const completions = w.__appState?.runtimeCompletions ?? [];
              const found = completions.find((entry) => {
                if (
                  typeof entry !== "object" ||
                  entry === null ||
                  !("Onboard" in entry)
                ) {
                  return false;
                }
                const onboard = (entry as { Onboard: { request_id?: string } })
                  .Onboard;
                return onboard?.request_id === input.requestId;
              });
              return found ?? null;
            },
            { requestId: sponsorRequestId },
            {
              timeout: COMPLETION_DRAIN_TIMEOUT_MS,
              polling: 200,
            },
          )
          .then((handle) => handle.jsonValue() as Promise<Record<string, unknown>>);
        expect(onboardCompletion).toBeTruthy();
        const onboardPayload = (onboardCompletion as {
          Onboard: {
            request_id: string;
            group_member_count: number;
            group: { group_pk: string };
          };
        }).Onboard;
        expect(onboardPayload.request_id).toBe(sponsorRequestId);
        expect(onboardPayload.group_member_count).toBe(
          keyset.group.members.length,
        );
        expect(onboardPayload.group.group_pk.toLowerCase()).toBe(
          keyset.group.group_pk.toLowerCase(),
        );

        // === Step 8: ONBOARD event-log entry on BOTH tabs ===
        const sponsorOnboardEntry = await pageA
          .waitForFunction(
            () => {
              const w = window as unknown as {
                __debug?: {
                  runtimeEventLog?: Array<{
                    badge?: string;
                    source?: string;
                    payload?: Record<string, unknown> | null;
                  }>;
                };
              };
              const log = w.__debug?.runtimeEventLog ?? [];
              return (
                log.find((entry) => entry?.badge === "ONBOARD") ?? null
              );
            },
            undefined,
            { timeout: COMPLETION_DRAIN_TIMEOUT_MS, polling: 200 },
          )
          .then(
            (handle) =>
              handle.jsonValue() as Promise<{
                badge?: string;
                source?: string;
                payload?: Record<string, unknown> | null;
              }>,
          );
        expect(sponsorOnboardEntry.badge).toBe("ONBOARD");

        const requesterOnboardEntry = await pageB
          .waitForFunction(
            () => {
              const w = window as unknown as {
                __debug?: {
                  runtimeEventLog?: Array<{
                    badge?: string;
                    source?: string;
                    payload?: Record<string, unknown> | null;
                  }>;
                };
              };
              const log = w.__debug?.runtimeEventLog ?? [];
              return (
                log.find((entry) => entry?.badge === "ONBOARD") ?? null
              );
            },
            undefined,
            { timeout: COMPLETION_DRAIN_TIMEOUT_MS, polling: 200 },
          )
          .then(
            (handle) =>
              handle.jsonValue() as Promise<{
                badge?: string;
                source?: string;
                payload?: Record<string, unknown> | null;
              }>,
          );
        expect(requesterOnboardEntry.badge).toBe("ONBOARD");

        // Final session snapshot — confirms the sponsor's session
        // surface remains on "completed" (never regresses to
        // "awaiting_adoption" / "failed").
        const finalSession = await pageA.evaluate(
          (input: { requestId: string }) => {
            const w = window as unknown as {
              __appState?: {
                onboardSponsorSessions?: Record<string, unknown>;
              };
            };
            const sessions = w.__appState?.onboardSponsorSessions ?? {};
            return sessions[input.requestId] ?? null;
          },
          { requestId: sponsorRequestId },
        );
        expect(finalSession).toBeTruthy();
        expect(
          (finalSession as { status?: string } | null)?.status,
        ).toBe("completed");
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
      }
    },
  );
});
