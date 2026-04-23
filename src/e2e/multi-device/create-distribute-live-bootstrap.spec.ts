import net from "node:net";
import { existsSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device Playwright spec for feature
 * `fix-followup-distribute-per-share-onboard-dispatch-and-echo-wire`
 * and its scrutiny r1 follow-up
 * `fix-scrutiny-r1-onboard-dispatch-requestid-hygiene-and-real-onboard-e2e`.
 *
 * Happy path (VAL-FOLLOWUP — Device B adopts via the REAL /onboard
 * UI, Device A auto-flips chip via echo):
 *   1. Device A runs through /create → /create/profile on the REAL
 *      AppStateProvider with a 2-of-2 keyset and
 *      ws://127.0.0.1:8194 as its only relay (DEV
 *      `__iglooTestAllowInsecureRelayForRestore` opt-in bypasses
 *      the wss://-only Settings-parity validator at
 *      `AppStateProvider.createProfile`).
 *   2. Device A lands on /create/distribute (Paper 8GU-0).
 *   3. Device A types a password into the per-share Password input
 *      for the single remote share (idx=1) and clicks "Create
 *      package". This drives `encodeDistributionPackage(idx,
 *      password)` which atomically:
 *        - encrypts the bfonboard1… package with the typed
 *          password,
 *        - dispatches `handleRuntimeCommand({type: "onboard",
 *          peer_pubkey32_hex})` for the share's target member,
 *        - stashes the returned `requestId` on the share's
 *          `pendingDispatchRequestId` field.
 *   4. Device B, in a SEPARATE BrowserContext, drives the REAL
 *      /onboard UI end-to-end (scrutiny r1 blocker #3). It
 *      navigates to `/onboard`, pastes the bfonboard1 string into
 *      the Onboarding Package textarea, types the package password,
 *      clicks "Begin Onboarding", waits for the handshake screen
 *      to settle at /onboard/complete, fills in the profile
 *      Password + Confirm Password fields, clicks
 *      "Save & Launch Signer" and finally lands on /dashboard/:id.
 *      This exercises the production decode → handshake →
 *      saveOnboardedProfile pipeline THROUGH THE UI contract surface,
 *      not the `__iglooTestAdoptOnboardPackage` DEV hook.
 *   5. Within 10 seconds Device A's share idx=1 status chip
 *      auto-flips from "Ready to distribute" → "Distributed" via
 *      the Onboard completion drained through
 *      `AppStateProvider.absorbDrains` — NO manual "Mark
 *      distributed" click required.
 *
 * OperationFailure path (VAL-FOLLOWUP — Device B aborts
 * mid-handshake → Device A surfaces inline retry copy + Mark
 * distributed stays enabled):
 *   The live-abort path is slow to converge deterministically
 *   (TTL-driven timeout ≥ 60s). To keep the spec stable on
 *   `--repeat-each=3 --workers=1`, we use the DEV-only
 *   `__iglooTestAbsorbDrains` hook to inject an `OperationFailure
 *   { op_type: "onboard", request_id }` that matches the share's
 *   `pendingDispatchRequestId`. `absorbDrains` then surfaces the
 *   canonical inline copy ("Peer adoption failed — retry or mark
 *   distributed manually") on that share's card, and the
 *   Mark-distributed button remains enabled so the user can still
 *   proceed via the manual fallback. This deliberate DEV-hook
 *   carve-out is documented in `docs/runtime-deviations-from-paper.md`
 *   (see the 2026-04-23 entry
 *   "create-distribute-live-bootstrap OperationFailure path uses
 *   __iglooTestAbsorbDrains").
 *
 * Skip gate matches every other multi-device spec in this folder —
 * skip only when `cargo --version` fails; hard-fail on every other
 * environmental mishap so regressions never hide.
 *
 * To run manually:
 *   bash .factory/init.sh
 *   npx playwright test \
 *     src/e2e/multi-device/create-distribute-live-bootstrap.spec.ts \
 *     --project=desktop --workers 1 --repeat-each=3
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
const RUNTIME_READY_TIMEOUT_MS = 25_000;
const DISTRIBUTE_CHIP_TIMEOUT_MS = 10_000;
const ADOPTION_TIMEOUT_MS = 90_000;

const PROFILE_PASSWORD_A = "alice-profile-pw-1234";
const PACKAGE_PASSWORD = "per-share-package-pw-1234";
const PROFILE_PASSWORD_B = "bob-profile-pw-1234";

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

async function waitForAppStateHooks(page: Page, label: string): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __appState?: unknown;
          __iglooTestAdoptOnboardPackage?: unknown;
          __iglooTestAbsorbDrains?: unknown;
        };
        return (
          typeof w.__appState === "object" &&
          typeof w.__iglooTestAdoptOnboardPackage === "function" &&
          typeof w.__iglooTestAbsorbDrains === "function"
        );
      },
      undefined,
      { timeout: HOOKS_READY_TIMEOUT_MS, polling: 100 },
    )
    .catch((err) => {
      throw new Error(
        `DEV test hooks never attached on page ${label} (${err}). ` +
          "Is this running under import.meta.env.DEV?",
      );
    });
}

/**
 * Drive Device A through /create → /create/profile → /create/distribute
 * with a 2-of-2 keyset and the single-local-relay override. Lands on
 * /create/distribute with the Paper 8GU-0 "How this step works" panel
 * visible. Returns the remote share's idx so the caller can target its
 * per-share card.
 */
async function bootstrapDeviceACreateDistribute(page: Page): Promise<number> {
  await page.goto("/");
  // Activate the DEV-only allow-insecure opt-in BEFORE the form
  // validates its relay list, so AppStateProvider.createProfile's
  // wss://-only validator whitelists ws://127.0.0.1:*.
  await page.evaluate(() => {
    (window as typeof window & {
      __iglooTestAllowInsecureRelayForRestore?: boolean;
    }).__iglooTestAllowInsecureRelayForRestore = true;
  });

  await page.getByRole("button", { name: "Create New Keyset" }).click();
  await page.getByLabel("Keyset Name").fill("Live Bootstrap Key");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  // Dial the keyset down from the default 2-of-3 → 2-of-2 so there is
  // exactly one remote share to drive the per-share onboard dispatch.
  await page.getByRole("button", { name: "Decrease Total Shares" }).click();
  await page.getByRole("button", { name: "Create Keyset" }).click();

  await expect(
    page.getByRole("heading", { name: "Create Profile" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Profile Name").fill("Alice (Device A)");
  // Replace every default relay with the single ws://127.0.0.1:8194
  // entry. The DEV opt-in above lets it pass createProfile's
  // wss://-only validator.
  const removeRelayButtons = page.getByRole("button", {
    name: /^Remove wss:\/\//,
  });
  const removeCount = await removeRelayButtons.count();
  for (let i = 0; i < removeCount; i += 1) {
    // Always click the first one — the list collapses as we remove.
    await removeRelayButtons.first().click();
  }
  await page
    .getByRole("textbox", { name: "", exact: true })
    .last()
    .fill(RELAY_URL)
    .catch(async () => {
      // Fallback: target the relay-add-row input by its placeholder
      // if the unnamed textbox query diverges from the DOM shape.
      const input = page.locator("input.input").last();
      await input.fill(RELAY_URL);
    });
  await page.getByRole("button", { name: "Add" }).click();

  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(PROFILE_PASSWORD_A);
  await page
    .getByRole("textbox", { name: "Confirm Password", exact: true })
    .fill(PROFILE_PASSWORD_A);
  await page
    .getByRole("button", { name: "Continue to Distribute Shares" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Distribute Shares" }),
  ).toBeVisible({ timeout: 30_000 });
  // Paper 8GU-0 info panel is visible on the distribute screen.
  await expect(page.getByText("How this step works")).toBeVisible();

  // Wait for the runtime relay pump to attach against ws://127.0.0.1:8194.
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __iglooTestGetRuntimeSource?: () =>
            | "relay_pump"
            | "simulator"
            | null;
        };
        return w.__iglooTestGetRuntimeSource?.() === "relay_pump";
      },
      undefined,
      { timeout: RUNTIME_READY_TIMEOUT_MS, polling: 200 },
    )
    .catch((err) => {
      throw new Error(
        `RuntimeRelayPump never attached after createProfile (${err})`,
      );
    });

  // Identify the remote share idx by reading the createSession.
  const remoteIdx = await page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        createSession?: {
          localShare?: { idx: number };
          onboardingPackages?: { idx: number }[];
        };
      };
    };
    const packages = w.__appState?.createSession?.onboardingPackages ?? [];
    if (packages.length === 0) {
      throw new Error("createSession.onboardingPackages is empty.");
    }
    return packages[0].idx;
  });
  return remoteIdx;
}

test.describe(
  "VAL-FOLLOWUP — /create/distribute live bootstrap: per-share onboard dispatch + echo auto-flip",
  () => {
    test.skip(
      () => !cargoAvailable(),
      "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
        "cannot build bifrost-devtools for multi-device e2e.",
    );
    test.setTimeout(300_000);

    let relay: ChildProcess | null = null;

    test.beforeAll(async () => {
      if (!existsSync(DEVTOOLS_BINARY)) {
        throw new Error(
          `bifrost-devtools binary missing at ${DEVTOOLS_BINARY}. ` +
            "Run `bash .factory/init.sh` first.",
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
          RELAY_READY_TIMEOUT_MS,
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
      "Device A /create/distribute click → Device B adopts via /onboard → Device A idx=1 chip auto-flips to 'Distributed' within 10s (VAL-FOLLOWUP happy path)",
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

          const remoteIdx = await bootstrapDeviceACreateDistribute(pageA);
          await waitForAppStateHooks(pageA, "A");

          // === Type the per-share password + click Create package ===
          const passwordInput = pageA.getByLabel(
            `Package password for share ${remoteIdx + 1}`,
          );
          await passwordInput.fill(PACKAGE_PASSWORD);
          await pageA
            .getByRole("button", { name: /Create package/i })
            .first()
            .click();

          // After encodeDistributionPackage lands:
          //   - the redacted bfonboard1… preview appears
          //   - the chip transitions from "Package not created" → "Ready
          //     to distribute" (info tone)
          //   - the share's pendingDispatchRequestId is populated
          await expect(
            pageA.locator(".status-pill.info", {
              hasText: "Ready to distribute",
            }),
          ).toHaveCount(1, { timeout: 10_000 });

          const { packageText, requestId } = await pageA.evaluate(
            (idx) => {
              const w = window as unknown as {
                __appState: {
                  getCreateSessionPackageSecret: (
                    idx: number,
                  ) => { packageText: string; password: string } | null;
                  createSession: {
                    onboardingPackages: {
                      idx: number;
                      pendingDispatchRequestId?: string;
                    }[];
                  } | null;
                };
              };
              const secret = w.__appState.getCreateSessionPackageSecret(idx);
              const entry = w.__appState.createSession?.onboardingPackages.find(
                (p) => p.idx === idx,
              );
              return {
                packageText: secret?.packageText ?? "",
                requestId: entry?.pendingDispatchRequestId ?? null,
              };
            },
            remoteIdx,
          );
          expect(packageText.startsWith("bfonboard1")).toBe(true);
          expect(typeof requestId).toBe("string");
          expect(requestId!.length).toBeGreaterThan(0);

          // === Device B adopts the bfonboard package via the REAL
          // /onboard UI (scrutiny r1 blocker #3) ===
          //
          // Navigate directly to /onboard (no welcome-screen click
          // needed) and drive the three Paper screens end-to-end:
          //   (1) /onboard — paste bfonboard1…, type package
          //       password, click Begin Onboarding
          //   (2) /onboard/handshake — auto-runs startOnboardHandshake
          //       which publishes the OnboardRequest on
          //       ws://127.0.0.1:8194 (same relay the sponsor's pump
          //       is subscribed to) and on success navigates to
          //       /onboard/complete
          //   (3) /onboard/complete — type profile Password +
          //       Confirm Password, click Save & Launch Signer which
          //       calls saveOnboardedProfile and navigates to
          //       /dashboard/:id
          //
          // We wait for the appState hooks so test-only console
          // errors do not trip the spec's error capture; the hooks
          // are also a cheap readiness signal that the provider
          // has mounted on Device B.
          await pageB.goto("/onboard");
          await waitForAppStateHooks(pageB, "B");
          await expect(
            pageB.getByRole("heading", { name: "Enter Onboarding Package" }),
          ).toBeVisible({ timeout: 10_000 });

          // (1) Paste the bfonboard1… package text + package
          // password, then click Begin Onboarding. We fill the
          // textarea via `fill()` on the labelled id (the Paper
          // screen uses <label htmlFor="onboard-package-input">).
          await pageB.locator("#onboard-package-input").fill(packageText);
          await pageB
            .getByLabel("Package Password", { exact: true })
            .fill(PACKAGE_PASSWORD);
          await pageB
            .getByRole("button", { name: "Begin Onboarding" })
            .click();

          // (2) /onboard/handshake — mount auto-runs
          // startOnboardHandshake. On success the screen replaces
          // itself with /onboard/complete (Onboarding Complete).
          // Wait for the terminal success heading before proceeding
          // so we do not race the handshake.
          await expect(
            pageB.getByRole("heading", { name: "Onboarding Complete" }),
          ).toBeVisible({ timeout: ADOPTION_TIMEOUT_MS });

          // (3) Set the profile Password + Confirm Password and
          // click Save & Launch Signer. The Paper /onboard/complete
          // screen renders two PasswordField components
          // (label "Password" and "Confirm Password"). Save calls
          // `saveOnboardedProfile` which persists the profile and
          // navigates to `/dashboard/:id`.
          await pageB
            .getByLabel("Password", { exact: true })
            .fill(PROFILE_PASSWORD_B);
          await pageB
            .getByLabel("Confirm Password", { exact: true })
            .fill(PROFILE_PASSWORD_B);
          await pageB
            .getByRole("button", { name: "Save & Launch Signer" })
            .click();

          // Device B reaches the dashboard (URL changes AND
          // activeProfile populated).
          await pageB.waitForURL(/\/dashboard\//, {
            timeout: ADOPTION_TIMEOUT_MS,
          });
          await pageB
            .waitForFunction(
              () => {
                const w = window as unknown as {
                  __appState?: { activeProfile?: { groupPublicKey?: string } };
                };
                return Boolean(w.__appState?.activeProfile?.groupPublicKey);
              },
              undefined,
              { timeout: ADOPTION_TIMEOUT_MS, polling: 200 },
            )
            .catch((err) => {
              throw new Error(
                `Device B never reached an active profile within ${ADOPTION_TIMEOUT_MS}ms (${err})`,
              );
            });

          // === Device A's share idx=1 chip auto-flips to "Distributed" ===
          // Wait for the provider's absorbDrains correlation to flip
          // peerOnline=true on the matching onboardingPackage, which
          // advances the DistributeSharesScreen chip from "Ready to
          // distribute" to "Distributed" without a manual click. The
          // feature contract requires this to land within 10s of the
          // Onboard completion drained on Device A.
          await pageA
            .waitForFunction(
              (input: { idx: number }) => {
                const w = window as unknown as {
                  __appState?: {
                    createSession?: {
                      onboardingPackages?: Array<{
                        idx: number;
                        peerOnline: boolean;
                      }>;
                    };
                  };
                };
                const packages =
                  w.__appState?.createSession?.onboardingPackages ?? [];
                const entry = packages.find((p) => p.idx === input.idx);
                return entry?.peerOnline === true;
              },
              { idx: remoteIdx },
              {
                timeout: ADOPTION_TIMEOUT_MS,
                polling: 200,
              },
            )
            .catch((err) => {
              throw new Error(
                `Device A share idx=${remoteIdx} peerOnline never flipped to true (${err})`,
              );
            });
          // The chip visible in the DOM reflects the flipped state within
          // the feature's 10s budget measured from the peerOnline flip.
          // Target the success status-pill specifically to avoid strict-
          // mode matches against the info-panel copy and "Mark
          // distributed" button that always render on this screen.
          await expect(
            pageA.locator(".status-pill.success", { hasText: "Distributed" }),
          ).toHaveCount(1, { timeout: DISTRIBUTE_CHIP_TIMEOUT_MS });
        } finally {
          await ctxA.close().catch(() => undefined);
          await ctxB.close().catch(() => undefined);
        }
      },
    );

    test(
      "Device B aborts mid-handshake → Device A surfaces 'Peer adoption failed — retry or mark distributed manually' inline + Mark distributed remains enabled (VAL-FOLLOWUP OperationFailure path)",
      async ({ browser }) => {
        const ctxA = await browser.newContext();
        try {
          const pageA = await ctxA.newPage();
          pageA.on("console", (msg) => {
            if (msg.type() === "error") {
              // eslint-disable-next-line no-console
              console.log(`[A:console.error] ${msg.text()}`);
            }
          });

          const remoteIdx = await bootstrapDeviceACreateDistribute(pageA);
          await waitForAppStateHooks(pageA, "A");

          await pageA
            .getByLabel(`Package password for share ${remoteIdx + 1}`)
            .fill(PACKAGE_PASSWORD);
          await pageA
            .getByRole("button", { name: /Create package/i })
            .first()
            .click();
          await expect(
            pageA.locator(".status-pill.info", {
              hasText: "Ready to distribute",
            }),
          ).toHaveCount(1, { timeout: 10_000 });

          const requestId = await pageA.evaluate((idx) => {
            const w = window as unknown as {
              __appState: {
                createSession: {
                  onboardingPackages: Array<{
                    idx: number;
                    pendingDispatchRequestId?: string;
                  }>;
                };
              };
            };
            const entry = w.__appState.createSession.onboardingPackages.find(
              (p) => p.idx === idx,
            );
            return entry?.pendingDispatchRequestId ?? null;
          }, remoteIdx);
          expect(typeof requestId).toBe("string");
          expect(requestId!.length).toBeGreaterThan(0);
          const requestIdStr: string = requestId as string;

          // Simulate Device B aborting mid-handshake by feeding an
          // OperationFailure envelope with op_type:"onboard" matching
          // the share's pendingDispatchRequestId directly into the
          // provider's drain handler. The user-visible behaviour
          // (inline retry copy + Mark distributed still enabled) is
          // identical to what the runtime would surface when the
          // requester's in-flight OnboardRequest is abandoned and the
          // sponsor-side request times out / rejects.
          await pageA.evaluate((id) => {
            const w = window as unknown as {
              __iglooTestAbsorbDrains: (drains: {
                completions: [];
                failures: Array<{
                  request_id: string;
                  op_type: "onboard";
                  code: string;
                  message: string;
                  failed_peer: null;
                }>;
                events: [];
              }) => void;
            };
            w.__iglooTestAbsorbDrains({
              completions: [],
              failures: [
                {
                  request_id: id,
                  op_type: "onboard",
                  code: "peer_rejected",
                  message: "requester aborted handshake",
                  failed_peer: null,
                },
              ],
              events: [],
            });
          }, requestIdStr);

          await expect(
            pageA.getByText(
              "Peer adoption failed — retry or mark distributed manually",
            ),
          ).toBeVisible({ timeout: 5_000 });
          // Mark distributed remains enabled — the manual fallback
          // is still reachable.
          const markButton = pageA
            .getByRole("button", { name: /^Mark distributed$/ })
            .first();
          await expect(markButton).toBeEnabled();
          // The chip has NOT flipped to "Distributed" (peerOnline is
          // still false); the pre-fallback chip remains "Ready to
          // distribute".
          await expect(
            pageA.locator(".status-pill.info", { hasText: "Ready to distribute" }),
          ).toHaveCount(1);

          // Manual fallback still works end-to-end — manual
          // markPackageDistributed flips the chip to success even
          // while adoptionError is still surfaced.
          await markButton.click();
          await expect(
            pageA.locator(".status-pill.success", { hasText: "Distributed" }),
          ).toHaveCount(1, { timeout: 5_000 });
        } finally {
          await ctxA.close().catch(() => undefined);
        }
      },
    );
  },
);
