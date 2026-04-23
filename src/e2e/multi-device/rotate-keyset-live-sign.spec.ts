import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Multi-device rotate-keyset-live-sign regression gate.
 *
 * Originally tracked under feature `m7-rotate-keyset-live-sign`. Strengthened
 * by `fix-m7-scrutiny-r1-rotate-regression-full-flow` to close two scrutiny
 * gaps called out in the m7 r1 review:
 *
 *   1. The previous version bypassed the UI entirely by calling a
 *      DEV-only `rotateKeysetBundle` test hook and seeding tabs
 *      A / B / C directly with rotated share bundles (that hook has
 *      since been removed — see `polish-2nd-pass-code-tests`). That
 *      regressed nothing
 *      in the rotate pipeline itself — only the pure-WASM
 *      `rotate_keyset_bundle` primitive. The pipeline tab A users
 *      actually drive (Form → Review/Generate → Progress → Profile
 *      → Distribute → Completion, backed by
 *      `AppStateValue.validateRotateKeysetSources`,
 *      `generateRotatedKeyset`, `createRotatedProfile`,
 *      `updateRotatePackageState`, and
 *      `finishRotateDistribution`) was not exercised end-to-end.
 *      The updated spec now walks tab A through every RotateKeyset
 *      sub-route via real user-visible actions (typing into inputs,
 *      clicking buttons, awaiting route transitions) and asserts that
 *      (a) after Finish Distribution the dashboard loads with
 *      `activeProfile.groupPublicKey` matching the original
 *      pre-rotation `group_pk`, and (b) B and C adopt the sponsor's
 *      bfonboard adoption packages through the round-trip
 *      `encode_bfonboard_package` → `decode_bfonboard_package`
 *      bridge calls (the same packaging surface the production
 *      onboard flow uses).
 *
 *   2. The previous version inferred "old share no longer valid"
 *      from the fact that rotated share secrets / member pubkeys
 *      differed from the originals — a structural assertion that
 *      does NOT directly prove the runtime rejects a protocol
 *      message signed by an old share. The updated spec adds a
 *      fourth tab ("ctxOld") seeded with the ORIGINAL (pre-rotation)
 *      group + share material; that tab dispatches a `sign` command
 *      and the spec waits for `drainFailures` on that tab to emit
 *      an `OperationFailure` (i.e. NO `Sign` completion lands for
 *      the dispatched `request_id`). That is the direct assertion
 *      the scrutiny review asked for: the old share cannot complete
 *      a sign post-rotation because the rotated peers subscribe on
 *      NEW member pubkeys and reject traffic keyed to OLD member
 *      pubkeys.
 *
 * Existing assertions that `rotated_material !== original_material`
 * and `sign on rotated shares still completes` are preserved —
 * scrutiny asked for the direct old-share failure to be ADDED, not
 * to replace the structural distinctness check.
 *
 * Skip gate: identical to every other spec in this folder — skip
 * only when `cargo --version` fails, hard-fail on every other
 * environmental mishap so regressions never hide.
 *
 * To run manually:
 *   1. bash .factory/init.sh                              # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/rotate-keyset-live-sign.spec.ts \
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

const HOOKS_READY_TIMEOUT_MS = 15_000;
const RELAY_READY_TIMEOUT_MS = 20_000;
// Natural ping/pong convergence populates the outgoing / incoming
// nonce pools in lock-step. On a three-tab loopback the convergence
// can take meaningfully longer than a two-tab spec because the pump
// has to broadcast to every online peer on each refresh cycle. Give
// it the same ceiling the `policy-denial-allow-once-retry.spec.ts`
// uses (120 s) to avoid stressed-host flakes.
const SIGN_READY_TIMEOUT_MS = 120_000;
const PEERS_ONLINE_TIMEOUT_MS = 90_000;
// Full FROST sign round-trip across the loopback relay with three
// tabs: empirically under 20 s on a healthy host — 90 s ceiling
// leaves ample headroom for CPU-loaded CI.
const SIGN_COMPLETION_TIMEOUT_MS = 90_000;
// bifrost-rs default `sign_timeout_secs` is 30 s — an old-share
// dispatch that never receives a valid partial must be surfaced as
// an OperationFailure within that window. Pad generously for CI.
const SIGN_FAILURE_TIMEOUT_MS = 75_000;
const RELAY_PROCESS_START_TIMEOUT_MS = 10_000;
// UI-driven rotate flow per step. Each transition is either user
// input (millisecond-scale) or a WASM-bridge invocation (sub-second
// on a healthy host). Generous per-step ceilings keep the failure
// signal locally attributable if one screen regresses.
const ROTATE_UI_STEP_TIMEOUT_MS = 30_000;
// Padding for the auto-advance on `/rotate-keyset/progress` — its
// internal `seedRotatePhases` driver advances every 800 ms over four
// phases, plus a 600 ms settle delay before navigation.
const ROTATE_PROGRESS_TIMEOUT_MS = 20_000;

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
interface SpecOnboardingPackage {
  idx: number;
  packageText: string;
  password: string;
}

test.describe("multi-device rotate-keyset-live-sign regression gate", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  // Budget: ~2 min natural sign-ready convergence (3 tabs) +
  // ~90 s for the sign round-trip + ~75 s old-share TTL expiry wait +
  // ~60 s UI rotate flow + ~30 s of setup/teardown. Padded
  // generously for stressed CI.
  test.setTimeout(480_000);

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
      await waitForRelayPort(
        RELAY_HOST,
        RELAY_PORT,
        RELAY_PROCESS_START_TIMEOUT_MS,
      );
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
    "UI-driven rotate flow: group_pk preserved, rotated shares sign successfully, old share sign fails",
    async ({ browser }) => {
      // Grant clipboard permissions to every context up-front so the
      // RotateKeyset DistributeScreen's Copy Package / Copy Password
      // buttons flip the package state flags that the "Continue to
      // Completion" CTA depends on (the UI's Copy handlers call
      // `navigator.clipboard.writeText` inside `copySecret` and only
      // record copied=true on success — see
      // `src/screens/RotateKeysetScreen/utils.ts`). Without explicit
      // grants, Chromium in ephemeral contexts denies clipboard-write
      // and the CTA stays disabled, hanging the spec.
      const CTX_OPTIONS: { permissions: string[] } = {
        permissions: ["clipboard-read", "clipboard-write"],
      };
      const ctxA: BrowserContext = await browser.newContext(CTX_OPTIONS);
      const ctxB: BrowserContext = await browser.newContext(CTX_OPTIONS);
      const ctxC: BrowserContext = await browser.newContext(CTX_OPTIONS);
      const ctxOld: BrowserContext = await browser.newContext(CTX_OPTIONS);
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const pageC = await ctxC.newPage();
        const pageOld = await ctxOld.newPage();

        const wirePageConsole = (page: Page, label: string) =>
          page.on("console", (msg) => {
            if (msg.type() === "error") {
              // eslint-disable-next-line no-console
              console.log(`[${label}:console.error] ${msg.text()}`);
            }
          });
        wirePageConsole(pageA, "A");
        wirePageConsole(pageB, "B");
        wirePageConsole(pageC, "C");
        wirePageConsole(pageOld, "OLD");

        await Promise.all([
          pageA.goto("/"),
          pageB.goto("/"),
          pageC.goto("/"),
          pageOld.goto("/"),
        ]);
        await Promise.all([
          expect(
            pageA.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible(),
          expect(
            pageB.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible(),
          expect(
            pageC.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible(),
          expect(
            pageOld.getByRole("heading", { name: "Igloo Web" }),
          ).toBeVisible(),
        ]);

        const waitForHooks = async (page: Page, label: string) =>
          page
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: unknown;
                  __iglooTestSeedRuntime?: unknown;
                  __iglooTestCreateKeysetBundle?: unknown;
                  __iglooTestMemberPubkey32?: unknown;
                  __iglooTestEncodeBfshare?: unknown;
                  __iglooTestDecodeBfonboardPackage?: unknown;
                };
                return (
                  typeof w.__appState === "object" &&
                  typeof w.__iglooTestSeedRuntime === "function" &&
                  typeof w.__iglooTestCreateKeysetBundle === "function" &&
                  typeof w.__iglooTestMemberPubkey32 === "function" &&
                  typeof w.__iglooTestEncodeBfshare === "function" &&
                  typeof w.__iglooTestDecodeBfonboardPackage === "function"
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
        await Promise.all([
          waitForHooks(pageA, "A"),
          waitForHooks(pageB, "B"),
          waitForHooks(pageC, "C"),
          waitForHooks(pageOld, "OLD"),
        ]);

        // === Step 1: Generate the ORIGINAL 2-of-3 keyset on tab A ===
        // Threshold=2 / count=3 is the sweet spot for this spec: the
        // rotate flow collects (threshold - 1) external bfshare
        // packages plus the saved profile's local share, so exactly
        // ONE bfshare needs to be encoded and pasted into the UI.
        // Share idx 0 becomes A's saved profile; idx 1 is encoded as
        // a bfshare for the UI paste; idx 2 stays unused until the
        // old-share failure phase below (it acts as "the pre-rotation
        // share nobody rotated").
        const originalKeyset: SpecKeyset = await pageA.evaluate(async () => {
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
            groupName: "Rotate Keyset E2E",
            threshold: 2,
            count: 3,
          });
        });
        expect(originalKeyset.shares.length).toBe(3);
        expect(originalKeyset.group.members.length).toBe(3);
        expect(originalKeyset.group.threshold).toBe(2);
        expect(originalKeyset.group.group_pk).toMatch(/^[0-9a-f]+$/);

        // bifrost-rs assigns member indexes starting from 1 (see
        // `crates/bifrost-core/src/group.rs`) — don't hard-code idx
        // values; reference shares by array position instead.
        const originalShareA = originalKeyset.shares[0];
        const originalShareExternal = originalKeyset.shares[1];
        const originalShareUnused = originalKeyset.shares[2];
        expect(originalShareA).toBeTruthy();
        expect(originalShareExternal).toBeTruthy();
        expect(originalShareUnused).toBeTruthy();
        expect(originalShareA.idx).not.toBe(originalShareExternal.idx);
        expect(originalShareA.idx).not.toBe(originalShareUnused.idx);
        expect(originalShareExternal.idx).not.toBe(originalShareUnused.idx);

        // === Step 2: Seed tab A with a PERSISTED profile holding share 0 ===
        // `persistProfile` drives the real `savePayloadAsProfile`
        // path so IndexedDB contains an encrypted profile and
        // `setActiveProfile` is populated. The RotateKeyset FormScreen
        // reads `profileId` + `profilePassword` from location state
        // and `validateRotateKeysetSources` loads the encrypted
        // profile from IndexedDB — both require a real persisted
        // record, not the fast-path `startRuntimeFromPayload` seed.
        const PROFILE_PASSWORD = "profile-password-1234";
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
              deviceName: "Alice Source",
              persistProfile: {
                password,
                label: "Alice Source Profile",
              },
            });
          },
          {
            group: originalKeyset.group,
            share: originalShareA,
            relayUrl: RELAY_URL,
            password: PROFILE_PASSWORD,
          },
        );

        const waitForActiveProfileId = async (page: Page, label: string) =>
          page
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: { activeProfile?: { id?: string } | null };
                };
                return w.__appState?.activeProfile?.id ?? null;
              },
              undefined,
              { timeout: 20_000, polling: 150 },
            )
            .then((handle) => handle.jsonValue() as Promise<string>)
            .catch((err) => {
              throw new Error(
                `activeProfile.id never populated on page ${label} (${err})`,
              );
            });
        const sourceProfileId = await waitForActiveProfileId(pageA, "A");
        expect(sourceProfileId).toBeTruthy();

        // === Step 3: Encode the second source share as a bfshare package ===
        // The RotateKeyset FormScreen collects (threshold - 1)
        // external sources. For 2-of-3 that's exactly one additional
        // bfshare. Encoded via the same `encode_bfshare_package`
        // primitive the production create flow uses.
        const EXTERNAL_SHARE_PASSWORD = "external-share-pw-1234";
        const externalSharePackage: string = await pageA.evaluate(
          async ({ share, relayUrl, password }) => {
            const w = window as unknown as {
              __iglooTestEncodeBfshare: (input: {
                shareSecret: string;
                relays: string[];
                password: string;
              }) => Promise<string>;
            };
            return w.__iglooTestEncodeBfshare({
              shareSecret: share.seckey,
              relays: [relayUrl],
              password,
            });
          },
          {
            share: originalShareExternal,
            relayUrl: RELAY_URL,
            password: EXTERNAL_SHARE_PASSWORD,
          },
        );
        expect(externalSharePackage.startsWith("bfshare1")).toBe(true);

        // === Step 4: UI-driven rotate on tab A ===
        // (4a) Navigate from the WelcomeScreen's "Rotate" button so
        //      `location.state.profileId` is populated the same way a
        //      real user would experience it. A profile card for the
        //      seeded profile becomes visible within one render tick
        //      because `setActiveProfile` +
        //      `reloadProfiles` inside the seed hook triggers a
        //      re-render.
        await expect(
          pageA.getByRole("button", { name: "Rotate" }),
        ).toBeVisible({ timeout: ROTATE_UI_STEP_TIMEOUT_MS });
        await pageA.getByRole("button", { name: "Rotate" }).click();
        await expect(pageA).toHaveURL(/\/rotate-keyset$/, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });

        // (4b) RotateKeysetFormScreen — enter the saved profile
        //      password + paste the external bfshare package + its
        //      encryption password, then click Validate & Continue.
        await pageA
          .getByPlaceholder("Enter saved profile password")
          .fill(PROFILE_PASSWORD);
        await pageA
          .getByPlaceholder("Paste bfshare from another device or backup...")
          .fill(externalSharePackage);
        await pageA
          .getByPlaceholder("Enter password to decrypt")
          .fill(EXTERNAL_SHARE_PASSWORD);
        await pageA
          .getByRole("button", { name: /validate & continue/i })
          .click();
        await expect(pageA).toHaveURL(/\/rotate-keyset\/review$/, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });

        // (4c) ReviewGenerateScreen — enter matching distribution
        //      passwords, then click "Rotate & Generate Keyset". The
        //      generateRotatedKeyset mutator produces the
        //      `rotateKeysetSession.rotated.next` KeysetBundle
        //      (group_pk preserved) and navigates to the progress
        //      screen.
        const DIST_PASSWORD = "distribution-password-1234";
        const reviewPasswordLocators = pageA.locator(
          "input.password-input[placeholder='Enter password']",
        );
        const reviewConfirmLocators = pageA.locator(
          "input.password-input[placeholder='Re-enter password']",
        );
        await reviewPasswordLocators.first().fill(DIST_PASSWORD);
        await reviewConfirmLocators.first().fill(DIST_PASSWORD);
        await pageA
          .getByRole("button", { name: /rotate & generate keyset/i })
          .click();
        await expect(pageA).toHaveURL(/\/rotate-keyset\/progress$/, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });

        // (4d) Progress screen auto-advances four phases at ~800 ms
        //      cadence then navigates to `/rotate-keyset/profile`.
        //      Give it ROTATE_PROGRESS_TIMEOUT_MS to be safe.
        await expect(pageA).toHaveURL(/\/rotate-keyset\/profile$/, {
          timeout: ROTATE_PROGRESS_TIMEOUT_MS,
        });

        // (4e) RotateCreateProfileScreen — fill device name + new
        //      profile password (twice), then click "Continue to
        //      Distribute Shares". `createRotatedProfile` derives
        //      the new profileId from the rotated local share's
        //      seckey and persists the profile.
        const ROTATED_PROFILE_PASSWORD = "rotated-profile-pw-1234";
        await pageA.getByLabel("Profile Name").fill("Alice Rotated");
        // Use class-narrowed locators so we target the password
        // fields regardless of minor label copy drift. First two
        // password inputs on this screen are the profile password
        // and its confirmation (in that order, as rendered by
        // `ProfileScreen.tsx`).
        const profilePasswordLocators = pageA.locator(
          "input.password-input",
        );
        await profilePasswordLocators
          .nth(0)
          .fill(ROTATED_PROFILE_PASSWORD);
        await profilePasswordLocators
          .nth(1)
          .fill(ROTATED_PROFILE_PASSWORD);
        await pageA
          .getByRole("button", { name: /continue to distribute shares/i })
          .click();
        await expect(pageA).toHaveURL(/\/rotate-keyset\/distribute$/, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });

        // (4f) DistributeScreen — click Copy Package and Copy Password
        //      on EVERY remote package row. Each successful click
        //      calls `updateRotatePackageState(idx, ...)` on
        //      AppState, flipping `packageCopied` / `passwordCopied`.
        //      When every remote package is marked distributed the
        //      screen's `completionReady` predicate flips and
        //      "Continue to Completion" becomes clickable.
        //
        // Wait for onboardingPackages to actually populate. The
        // screen renders the moment the profile-create navigation
        // lands, but `createRotatedProfile` populates
        // `rotateKeysetSession.onboardingPackages` asynchronously.
        await pageA.waitForFunction(
          () => {
            const w = window as unknown as {
              __appState?: {
                rotateKeysetSession?: {
                  onboardingPackages?: Array<unknown>;
                } | null;
              };
            };
            return (
              (w.__appState?.rotateKeysetSession?.onboardingPackages?.length ??
                0) >= 2
            );
          },
          undefined,
          { timeout: ROTATE_UI_STEP_TIMEOUT_MS },
        );
        const copyPackageButtons = pageA.getByRole("button", {
          name: /copy package/i,
        });
        const copyPasswordButtons = pageA.getByRole("button", {
          name: /copy password/i,
        });
        // Wait for the Copy Package rows to render (2 remote packages
        // in a 2-of-3 with one local share).
        await expect(copyPackageButtons).toHaveCount(2, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });
        const remotePackageCount = await copyPackageButtons.count();
        expect(remotePackageCount).toBe(2);
        for (let i = 0; i < remotePackageCount; i += 1) {
          await copyPackageButtons.nth(i).click();
          await copyPasswordButtons.nth(i).click();
        }

        // (4g) Capture the rotated material BEFORE clicking "Finish
        //      Distribution" — `finishRotateDistribution` sets
        //      `rotateKeysetSession = null`, which clears the
        //      rotated group + onboarding packages from AppState.
        //      B and C need both to adopt via the bfonboard decoder.
        const rotatedCaptured = await pageA.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              rotateKeysetSession?: {
                rotated?: {
                  next?: {
                    group: {
                      group_name: string;
                      group_pk: string;
                      threshold: number;
                      members: Array<{ idx: number; pubkey: string }>;
                    };
                    shares: Array<{ idx: number; seckey: string }>;
                  };
                };
                onboardingPackages?: Array<{
                  idx: number;
                  packageText: string;
                  password: string;
                }>;
                localShare?: { idx: number; seckey: string };
              } | null;
            };
          };
          const session = w.__appState?.rotateKeysetSession ?? null;
          if (!session || !session.rotated?.next || !session.onboardingPackages) {
            return null;
          }
          return {
            group: session.rotated.next.group,
            shares: session.rotated.next.shares,
            onboardingPackages: session.onboardingPackages.map((p) => ({
              idx: p.idx,
              packageText: p.packageText,
              password: p.password,
            })),
            localShareIdx: session.localShare?.idx ?? 0,
          };
        });
        expect(rotatedCaptured).not.toBeNull();
        const rotatedGroup: SpecGroup = rotatedCaptured!.group;
        const rotatedShares: SpecShare[] = rotatedCaptured!.shares;
        const rotatedOnboardingPackages: SpecOnboardingPackage[] =
          rotatedCaptured!.onboardingPackages;
        const rotatedLocalShareIdx: number = rotatedCaptured!.localShareIdx;
        expect(rotatedShares.length).toBe(3);
        expect(rotatedOnboardingPackages.length).toBe(2);

        // (4h) Navigate to CompletionScreen and click Finish
        //      Distribution — lands on `/dashboard/:newProfileId`.
        await pageA
          .getByRole("button", { name: /continue to completion/i })
          .click();
        await expect(pageA).toHaveURL(/\/rotate-keyset\/complete$/, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });
        await pageA
          .getByRole("button", { name: /finish distribution/i })
          .click();
        await expect(pageA).toHaveURL(/\/dashboard\//, {
          timeout: ROTATE_UI_STEP_TIMEOUT_MS,
        });

        // === Step 5: group_pk invariant ===
        // The core rotation invariant: the new profile's
        // `activeProfile.groupPublicKey` must equal the original
        // pre-rotation `group_pk`. This is enforced inside
        // `generateRotatedKeyset` — any regression that changes the
        // group pk breaks every downstream consumer of the existing
        // profile record and is caught here directly from the UI.
        const finalGroupPk = await pageA.evaluate(() => {
          const w = window as unknown as {
            __appState?: { activeProfile?: { groupPublicKey?: string } };
          };
          return w.__appState?.activeProfile?.groupPublicKey ?? null;
        });
        expect(finalGroupPk?.toLowerCase()).toBe(
          originalKeyset.group.group_pk.toLowerCase(),
        );
        expect(rotatedGroup.group_pk.toLowerCase()).toBe(
          originalKeyset.group.group_pk.toLowerCase(),
        );

        // === Step 6: Rotated material MUST differ from original ===
        // (carried over from the scrutiny r0 gate — keeps the
        // structural distinctness assertion alongside the newly-added
        // direct old-share failure assertion in Step 10 below).
        const originalShareByIdx = new Map(
          originalKeyset.shares.map((s) => [s.idx, s.seckey.toLowerCase()]),
        );
        const originalMemberByIdx = new Map(
          originalKeyset.group.members.map((m) => [
            m.idx,
            m.pubkey.toLowerCase(),
          ]),
        );
        for (const rotatedShare of rotatedShares) {
          const originalSeckey = originalShareByIdx.get(rotatedShare.idx);
          expect(
            originalSeckey,
            `original keyset missing share ${rotatedShare.idx}`,
          ).toBeTruthy();
          expect(
            rotatedShare.seckey.toLowerCase(),
            `rotated share ${rotatedShare.idx} seckey MUST differ from original`,
          ).not.toBe(originalSeckey);
        }
        for (const rotatedMember of rotatedGroup.members) {
          const originalPubkey = originalMemberByIdx.get(rotatedMember.idx);
          expect(
            originalPubkey,
            `original keyset missing member idx ${rotatedMember.idx}`,
          ).toBeTruthy();
          expect(
            rotatedMember.pubkey.toLowerCase(),
            `rotated member ${rotatedMember.idx} pubkey MUST differ from original`,
          ).not.toBe(originalPubkey);
        }

        // === Step 7: Tabs B and C adopt via bfonboard decode ===
        // Each peer tab decodes the sponsor's adoption package with
        // the distribution password (the exact same round-trip the
        // production requester-side onboard flow performs) and seeds
        // its runtime with the rotated group + decoded share secret.
        // The rotated group_pk + member list are propagated from A
        // via the Playwright test bridge — in a real onboarding
        // ceremony the sponsor publishes this metadata on relay; the
        // handshake mechanics are covered by the dedicated
        // `onboard-sponsorship.spec.ts`.
        const peerPackageB = rotatedOnboardingPackages[0];
        const peerPackageC = rotatedOnboardingPackages[1];
        expect(peerPackageB.idx).not.toBe(rotatedLocalShareIdx);
        expect(peerPackageC.idx).not.toBe(rotatedLocalShareIdx);
        expect(peerPackageB.idx).not.toBe(peerPackageC.idx);

        const adoptViaBfonboard = async (
          page: Page,
          spec: SpecOnboardingPackage,
          label: string,
        ): Promise<SpecShare> =>
          page.evaluate(
            async (input: { packageText: string; password: string; idx: number; label: string }) => {
              const w = window as unknown as {
                __iglooTestDecodeBfonboardPackage: (
                  packageText: string,
                  password: string,
                ) => Promise<{
                  share_secret: string;
                  relays: string[];
                  peer_pk: string;
                }>;
              };
              const decoded = await w.__iglooTestDecodeBfonboardPackage(
                input.packageText,
                input.password,
              );
              if (!/^[0-9a-f]{64}$/.test(decoded.share_secret)) {
                throw new Error(
                  `${input.label}: decoded share_secret is not 64 hex chars`,
                );
              }
              return { idx: input.idx, seckey: decoded.share_secret };
            },
            {
              packageText: spec.packageText,
              password: spec.password,
              idx: spec.idx,
              label,
            },
          );
        const adoptedB: SpecShare = await adoptViaBfonboard(
          pageB,
          peerPackageB,
          "B",
        );
        const adoptedC: SpecShare = await adoptViaBfonboard(
          pageC,
          peerPackageC,
          "C",
        );

        // Cross-check: each adopted share matches the rotated share
        // that A generated for the same idx (belt-and-braces
        // assertion that the bfonboard encode/decode round-trip
        // preserves share material integrity).
        const rotatedShareByIdx = new Map(
          rotatedShares.map((s) => [s.idx, s.seckey.toLowerCase()]),
        );
        expect(adoptedB.seckey.toLowerCase()).toBe(
          rotatedShareByIdx.get(adoptedB.idx),
        );
        expect(adoptedC.seckey.toLowerCase()).toBe(
          rotatedShareByIdx.get(adoptedC.idx),
        );

        // === Step 8: Seed B and C runtimes with the rotated material ===
        const seedPeer = async (
          page: Page,
          share: SpecShare,
          deviceName: string,
        ) =>
          page.evaluate(
            async ({ group, share, relayUrl, deviceName }) => {
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
                relays: [relayUrl],
                deviceName,
              });
            },
            {
              group: rotatedGroup,
              share,
              relayUrl: RELAY_URL,
              deviceName,
            },
          );
        await Promise.all([
          seedPeer(pageB, adoptedB, "Bob Rotated"),
          seedPeer(pageC, adoptedC, "Carol Rotated"),
        ]);

        // === Step 9: Relay / sign readiness / peer convergence on A ===
        const waitForRelayOnline = async (page: Page, label: string) =>
          page
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
        await Promise.all([
          waitForRelayOnline(pageA, "A"),
          waitForRelayOnline(pageB, "B"),
          waitForRelayOnline(pageC, "C"),
        ]);

        const waitForSignReady = async (page: Page, label: string) =>
          page
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeStatus?: {
                      readiness?: { sign_ready?: boolean };
                    };
                  };
                };
                return Boolean(
                  w.__appState?.runtimeStatus?.readiness?.sign_ready,
                );
              },
              undefined,
              { timeout: SIGN_READY_TIMEOUT_MS, polling: 200 },
            )
            .catch((err) => {
              throw new Error(
                `runtime_status.readiness.sign_ready never became true ` +
                  `on page ${label} within ${SIGN_READY_TIMEOUT_MS}ms. (${err})`,
              );
            });
        await Promise.all([
          waitForSignReady(pageA, "A"),
          waitForSignReady(pageB, "B"),
          waitForSignReady(pageC, "C"),
        ]);

        const peerBPubkey32 = await pageA.evaluate(
          ({ group, shareIdx }) => {
            const w = window as unknown as {
              __iglooTestMemberPubkey32: (
                group: unknown,
                shareIdx: number,
              ) => string;
            };
            return w.__iglooTestMemberPubkey32(group, shareIdx);
          },
          { group: rotatedGroup, shareIdx: adoptedB.idx },
        );
        const peerCPubkey32 = await pageA.evaluate(
          ({ group, shareIdx }) => {
            const w = window as unknown as {
              __iglooTestMemberPubkey32: (
                group: unknown,
                shareIdx: number,
              ) => string;
            };
            return w.__iglooTestMemberPubkey32(group, shareIdx);
          },
          { group: rotatedGroup, shareIdx: adoptedC.idx },
        );
        expect(peerBPubkey32).toMatch(/^[0-9a-f]{64}$/);
        expect(peerCPubkey32).toMatch(/^[0-9a-f]{64}$/);

        await pageA
          .waitForFunction(
            ({ b, c }: { b: string; c: string }) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeStatus?: {
                    peers?: Array<{
                      pubkey: string;
                      online: boolean;
                      last_seen: number | null;
                    }>;
                  };
                };
              };
              const peers = w.__appState?.runtimeStatus?.peers ?? [];
              const matches = peers.filter(
                (p) =>
                  (p.pubkey === b || p.pubkey === c) &&
                  p.online &&
                  (p.last_seen ?? 0) > 0,
              );
              return matches.length > 0;
            },
            { b: peerBPubkey32, c: peerCPubkey32 },
            { timeout: PEERS_ONLINE_TIMEOUT_MS, polling: 200 },
          )
          .catch((err) => {
            throw new Error(
              `A never observed any rotated responder (B or C) as online ` +
                `within ${PEERS_ONLINE_TIMEOUT_MS}ms — the underlying ` +
                `ping/pong round-trip did not converge. (${err})`,
            );
          });

        // === Step 10: Sign on rotated shares completes ===
        const signMessageHex = "7".repeat(64);
        const dispatch = await pageA.evaluate(async (msg: string) => {
          const w = window as unknown as {
            __appState: {
              handleRuntimeCommand: (cmd: {
                type: "sign";
                message_hex_32: string;
              }) => Promise<{ requestId: string | null; debounced: boolean }>;
            };
          };
          return w.__appState.handleRuntimeCommand({
            type: "sign",
            message_hex_32: msg,
          });
        }, signMessageHex);
        expect(dispatch.debounced).toBe(false);

        let signRequestId: string | null = dispatch.requestId;
        if (!signRequestId) {
          signRequestId = await pageA
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeStatus?: {
                      pending_operations?: Array<{
                        op_type?: string;
                        request_id?: string;
                      }>;
                    };
                    runtimeCompletions?: Array<Record<string, unknown>>;
                  };
                };
                const pending =
                  w.__appState?.runtimeStatus?.pending_operations ?? [];
                const signPending = pending.find(
                  (op) =>
                    typeof op.op_type === "string" &&
                    op.op_type.toLowerCase() === "sign" &&
                    typeof op.request_id === "string",
                );
                if (signPending?.request_id) return signPending.request_id;
                const completions = w.__appState?.runtimeCompletions ?? [];
                for (const entry of completions) {
                  const sign = (entry as { Sign?: { request_id?: string } })
                    .Sign;
                  if (sign?.request_id) return sign.request_id;
                }
                return null;
              },
              undefined,
              { timeout: 15_000, polling: 150 },
            )
            .then((handle) => handle.jsonValue() as Promise<string>);
        }
        expect(signRequestId).toBeTruthy();
        const signRequestIdStr: string = signRequestId!;

        await pageA
          .waitForFunction(
            (rid: string) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeCompletions?: Array<Record<string, unknown>>;
                };
              };
              const completions = w.__appState?.runtimeCompletions ?? [];
              return completions.some((entry) => {
                const sign = (entry as { Sign?: { request_id?: string } })
                  .Sign;
                return !!sign && sign.request_id === rid;
              });
            },
            signRequestIdStr,
            { timeout: SIGN_COMPLETION_TIMEOUT_MS, polling: 250 },
          )
          .catch(async (err) => {
            const diag = await pageA.evaluate(() => {
              const w = window as unknown as {
                __appState?: {
                  runtimeStatus?: unknown;
                  runtimeCompletions?: unknown;
                  runtimeFailures?: unknown;
                };
              };
              return {
                runtimeStatus: w.__appState?.runtimeStatus,
                runtimeCompletions: w.__appState?.runtimeCompletions,
                runtimeFailures: w.__appState?.runtimeFailures,
              };
            });
            throw new Error(
              `Sign completion never observed on page A within ` +
                `${SIGN_COMPLETION_TIMEOUT_MS}ms (request_id=` +
                `${signRequestIdStr}). This is the primary regression ` +
                `signal for the rotate-keyset flow: the rotated keyset ` +
                `FAILED to produce a valid FROST sign round-trip. ${err}\n` +
                `Page A state:\n${JSON.stringify(diag, null, 2)}`,
            );
          });

        const signatures = await pageA.evaluate((rid: string) => {
          const w = window as unknown as {
            __appState?: {
              runtimeCompletions?: Array<Record<string, unknown>>;
            };
          };
          const completions = w.__appState?.runtimeCompletions ?? [];
          const hit = completions.find((entry) => {
            const sign = (entry as { Sign?: { request_id?: string } }).Sign;
            return !!sign && sign.request_id === rid;
          });
          return (
            hit as
              | {
                  Sign?: {
                    request_id: string;
                    signatures_hex64: string[];
                  };
                }
              | undefined
          )?.Sign?.signatures_hex64 ?? null;
        }, signRequestIdStr);
        expect(signatures).not.toBeNull();
        expect(Array.isArray(signatures)).toBe(true);
        expect(signatures!.length).toBeGreaterThan(0);
        for (const sig of signatures!) {
          expect(sig).toMatch(/^[0-9a-f]{128}$/);
        }

        // === Step 11: Direct old-share rejection (the new assertion) ===
        // Seed a FOURTH tab with the PRE-ROTATION group + PRE-ROTATION
        // share (idx 2 was never used as a source in the rotate flow
        // above, so it's unambiguously "the old share nobody rotated").
        // Dispatch a sign on that tab and wait for drainFailures to
        // emit an OperationFailure — the runtime MUST NOT produce a
        // `Sign` completion for this dispatch because every rotated
        // peer subscribes on NEW member pubkeys and will ignore
        // envelopes signed under OLD pubkeys. This is the direct
        // runtime-level "old share rejected" signal that scrutiny r1
        // asked for.
        await pageOld.evaluate(
          async ({ group, share, relayUrl }) => {
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
              relays: [relayUrl],
              deviceName: "Stale Old Device",
            });
          },
          {
            group: originalKeyset.group,
            share: originalShareUnused,
            relayUrl: RELAY_URL,
          },
        );
        await waitForRelayOnline(pageOld, "OLD");

        // The old runtime never converges `sign_ready` because its
        // ping/pong targets (OLD member pubkeys) have no online
        // subscribers — the rotated peers are subscribed on NEW
        // pubkeys. That's the expected state; we dispatch anyway
        // because `handleRuntimeCommand` does not gate on
        // `sign_ready` and the bifrost runtime will queue the sign
        // pending_op until `sign_timeout_secs` (default 30 s) elapses
        // with no valid partials.
        const oldDispatch = await pageOld.evaluate(async (msg: string) => {
          const w = window as unknown as {
            __appState: {
              handleRuntimeCommand: (cmd: {
                type: "sign";
                message_hex_32: string;
              }) => Promise<{ requestId: string | null; debounced: boolean }>;
            };
          };
          return w.__appState.handleRuntimeCommand({
            type: "sign",
            message_hex_32: msg,
          });
        }, signMessageHex);
        expect(oldDispatch.debounced).toBe(false);

        let oldRequestId: string | null = oldDispatch.requestId;
        if (!oldRequestId) {
          oldRequestId = await pageOld
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeStatus?: {
                      pending_operations?: Array<{
                        op_type?: string;
                        request_id?: string;
                      }>;
                    };
                    runtimeFailures?: Array<{
                      op_type?: string;
                      request_id?: string;
                    }>;
                  };
                };
                const pending =
                  w.__appState?.runtimeStatus?.pending_operations ?? [];
                const signPending = pending.find(
                  (op) =>
                    typeof op.op_type === "string" &&
                    op.op_type.toLowerCase() === "sign" &&
                    typeof op.request_id === "string",
                );
                if (signPending?.request_id) return signPending.request_id;
                const failures = w.__appState?.runtimeFailures ?? [];
                const failSign = failures.find(
                  (f) =>
                    typeof f.op_type === "string" &&
                    f.op_type.toLowerCase() === "sign" &&
                    typeof f.request_id === "string",
                );
                return failSign?.request_id ?? null;
              },
              undefined,
              { timeout: 15_000, polling: 150 },
            )
            .then((handle) => handle.jsonValue() as Promise<string>);
        }
        expect(oldRequestId).toBeTruthy();
        const oldRequestIdStr: string = oldRequestId!;

        // Wait for the sign failure drain (OperationFailure).
        await pageOld
          .waitForFunction(
            (rid: string) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeFailures?: Array<{
                    request_id?: string;
                    op_type?: string;
                  }>;
                };
              };
              const failures = w.__appState?.runtimeFailures ?? [];
              return failures.some(
                (f) =>
                  f.request_id === rid &&
                  typeof f.op_type === "string" &&
                  f.op_type.toLowerCase() === "sign",
              );
            },
            oldRequestIdStr,
            { timeout: SIGN_FAILURE_TIMEOUT_MS, polling: 300 },
          )
          .catch(async (err) => {
            const diag = await pageOld.evaluate(() => {
              const w = window as unknown as {
                __appState?: {
                  runtimeStatus?: unknown;
                  runtimeCompletions?: unknown;
                  runtimeFailures?: unknown;
                };
              };
              return {
                runtimeStatus: w.__appState?.runtimeStatus,
                runtimeCompletions: w.__appState?.runtimeCompletions,
                runtimeFailures: w.__appState?.runtimeFailures,
              };
            });
            throw new Error(
              `Old-share sign attempt never produced an OperationFailure ` +
                `within ${SIGN_FAILURE_TIMEOUT_MS}ms (request_id=` +
                `${oldRequestIdStr}). Direct old-share rejection assertion ` +
                `failed — the rotated keyset allowed an old share to sign, ` +
                `which is the core regression this spec guards against. ${err}\n` +
                `Page OLD state:\n${JSON.stringify(diag, null, 2)}`,
            );
          });

        // Assert the old-share sign did NOT complete: no Sign
        // completion entry with this request_id should be present in
        // `runtimeCompletions` after the failure drain landed.
        const oldCompletionsForRequest = await pageOld.evaluate(
          (rid: string) => {
            const w = window as unknown as {
              __appState?: {
                runtimeCompletions?: Array<Record<string, unknown>>;
              };
            };
            const completions = w.__appState?.runtimeCompletions ?? [];
            return completions.filter((entry) => {
              const sign = (entry as { Sign?: { request_id?: string } }).Sign;
              return !!sign && sign.request_id === rid;
            }).length;
          },
          oldRequestIdStr,
        );
        expect(
          oldCompletionsForRequest,
          "Old-share sign unexpectedly produced a Sign completion — the rotated keyset did NOT reject the old share.",
        ).toBe(0);
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
        await ctxC.close().catch(() => undefined);
        await ctxOld.close().catch(() => undefined);
      }
    },
  );
});
