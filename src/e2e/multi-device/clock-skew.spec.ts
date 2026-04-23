import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device clock-skew e2e for feature `m7-clock-skew-and-leak`.
 *
 * Feature description:
 *   "Clock skew: device B ±120s clock vs A still completes sign+ECDH
 *    round-trips."
 *
 * --- Protocol constraint discovered during implementation ---
 *
 * bifrost-signer hard-codes `max_future_skew_secs: 30` (see
 * `bifrost-rs/crates/bifrost-signer/src/lib.rs:243`) and refuses any
 * inbound request whose `sent_at` is more than 30 s past the local
 * wall clock (`lib.rs:2263`). This cap is NOT mutable via the bridge's
 * `update_config` surface — `update_config` only patches
 * `sign_timeout_secs`, `ping_timeout_secs`, `request_ttl_secs`, etc.
 * (`lib.rs:620`). Because `bifrost-rs/` is read-only reference
 * material for this mission (see AGENTS.md), widening this tolerance
 * is out of scope.
 *
 * The feature description's ±120 s magnitude therefore CANNOT be
 * tested as "B's relative clock differs from A's by 120 s" — any such
 * configuration would deterministically fail the signer's own
 * inbound-request gate on the receiving side, regardless of whether
 * the app layer did anything wrong. The relevant deviation entry
 * lives in `docs/runtime-deviations-from-paper.md` under
 * "Clock skew magnitude bounded by bifrost-signer
 * max_future_skew_secs=30".
 *
 * Two scenarios remain meaningful at the ±120 s magnitude AND
 * preserve the spirit of the feature description:
 *
 *   (A) SYMMETRIC — both pages skew Date.now by the same ±120 s
 *       offset from the real host wall clock. Peer-to-peer relative
 *       skew is 0 s (within the 30 s cap), so the FROST round-trip
 *       actually runs; what's validated is that the runtime works
 *       when the browser's own clock is badly wrong compared to
 *       reality (the common "broken NTP / battery replaced / VM
 *       suspended" failure mode).
 *
 *   (B) ASYMMETRIC — page B is skewed by ±25 s relative to page A
 *       (well inside the 30 s cap, close to the tolerance edge).
 *       Validates that bifrost's native tolerance actually covers
 *       moderate peer-to-peer divergence — i.e. that the runtime
 *       doesn't fail under a realistic-but-non-trivial inter-peer
 *       clock offset.
 *
 * Both scenarios run sign + ECDH round-trips end-to-end under the
 * skew; either timing out on `sign_ready` or surfacing a
 * skew/clock-tagged console.error fails the spec.
 *
 * Why addInitScript (not `page.clock.install`): the Playwright clock
 * emulation freezes or fast-forwards the page's timing, which would
 * also gate setTimeout / requestAnimationFrame — our 2.5 s refresh
 * loop depends on real timers. A pure `Date` override leaves timers
 * untouched and just shifts the wall-clock source the WASM
 * `created_at` field reads from.
 *
 * Why the local relay (not public): AGENTS.md allocates port 8194 to
 * this mission exclusively; using public relays would add flakiness
 * from `created_at` tolerance variance across operators.
 *
 * To run manually:
 *   1. bash .factory/init.sh                    # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/clock-skew.spec.ts \
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

// ±120 s is the magnitude called out by the feature description.
// Used for the symmetric scenario (both devices shifted equally — this
// shifts their shared view of wall-clock time without changing the
// 0 s peer-to-peer relative skew that the 30 s cap guards).
const CLOCK_SKEW_MS = 120_000;
// ±25 s is the asymmetric-scenario magnitude — inside the 30 s
// `max_future_skew_secs` cap with comfortable headroom for local-
// relay publish jitter so the receiver's `record_request` check
// (`sent_at <= now + 30 s`) still passes across round-trip latency.
const ASYMMETRIC_SKEW_MS = 25_000;

const RELAY_READY_TIMEOUT_MS = 20_000;
// Natural sign-readiness convergence (matches the pattern used in
// `ecdh-roundtrip.spec.ts` and `relay-churn.spec.ts`). Over loopback
// the ping/pong handshake reliably reaches `sign_ready = true` well
// inside ~60 s; the ceiling is padded for loaded CI hosts.
const SIGN_READY_TIMEOUT_MS = 120_000;
const PEERS_ONLINE_TIMEOUT_MS = 60_000;
// Per-attempt budgets. A healthy loopback sign completes in 2-4 s and
// ECDH in well under 10 s; the ceilings protect against stray
// `"locked peer response timeout"` cycles driven by a stale
// remote_scoped_policies view.
const SIGN_COMPLETION_TIMEOUT_MS = 60_000;
const ECDH_COMPLETION_TIMEOUT_MS = 60_000;
// Bound for one full skew round — dispatch + retries. One extra retry
// window is left so the end-to-end round-trip can recover if the
// first attempt hits the locked-peer timeout.
const ROUND_TIMEOUT_MS = 180_000;

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

/**
 * Install a `Date`/`Date.now` override on a page such that any JS
 * (including WASM glue) that reads wall-clock time observes a fixed
 * `skewMs` offset from the real host clock. The override is installed
 * via `page.addInitScript`, which fires once per frame BEFORE the
 * first script tag — essential because the vendored
 * `bifrost_bridge_wasm.js` calls `Date.now()` during its module
 * initialisation, and we need to poison that path too.
 *
 * Both `Date.now()` and the parameterless `new Date()` are
 * overridden; any caller passing explicit arguments (`new Date(ms)`,
 * `new Date(iso)`) gets the original behaviour so fixture-driven
 * timestamps are preserved.
 */
async function installClockSkew(
  page: Page,
  skewMs: number,
): Promise<void> {
  await page.addInitScript((skew: number) => {
    const RealDate = Date;
    const realNow = Date.now.bind(Date);
    const skewedNow = (): number => realNow() + skew;

    // Replace `Date.now` first so any consumer calling it directly
    // (the WASM glue does) observes the skew immediately.
    Date.now = skewedNow;

    // Wrap the Date constructor. Called with no args, return a
    // skewed instance; with args, defer to the original constructor
    // so fixture dates (`new Date("2026-01-01")`) still parse
    // correctly.
    function SkewedDate(this: unknown, ...args: unknown[]) {
      if (!new.target) {
        // Date() called without `new` — stringify the current skewed
        // instant to match native behavior.
        return new RealDate(skewedNow()).toString();
      }
      if (args.length === 0) {
        return new RealDate(skewedNow());
      }
      // Delegate to native overloads without re-typing; the runtime
      // Date constructor validates each shape itself.
      return new (RealDate as unknown as new (
        ...a: unknown[]
      ) => Date)(...args);
    }
    // Copy static members.
    SkewedDate.now = skewedNow;
    SkewedDate.parse = RealDate.parse;
    SkewedDate.UTC = RealDate.UTC;
    // Preserve prototype chain so `instanceof Date` continues to
    // work for SkewedDate instances AND any pre-existing Date
    // objects, and `Date.prototype.*` methods resolve correctly.
    (SkewedDate as unknown as { prototype: Date }).prototype =
      RealDate.prototype;
    Object.setPrototypeOf(SkewedDate, RealDate);

    // Install the skewed constructor globally. `globalThis.Date` is
    // the single reference every JS realm on the page reads from.
    (globalThis as unknown as { Date: unknown }).Date =
      SkewedDate as unknown;
  }, skewMs);
}

test.describe("multi-device clock skew ±120s (m7-clock-skew-and-leak)", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  // Two skew directions × sign + ECDH round-trip each; generous budget
  // so a worst-case sign_ready stall still fails loudly rather than
  // timing out the whole spec.
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
   * Single scenario: seed 2-of-3 runtime on both pages (pages skewed
   * per `skewAMs` / `skewBMs`), complete one sign and one ECDH from
   * A targeting B. Returns nothing — any deviation throws.
   */
  const runSkewScenario = async (options: {
    browser: import("@playwright/test").Browser;
    skewAMs: number;
    skewBMs: number;
    label: string;
  }): Promise<void> => {
    const { browser, skewAMs, skewBMs, label } = options;
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Skew-related console errors would indicate the runtime did
      // not tolerate the shifted clock — we capture everything and
      // fail if the regex matches post-run.
      const consoleErrors: Array<{ page: string; text: string }> = [];
      const wirePageConsole = (
        page: Page,
        pageLabel: string,
      ): void => {
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            consoleErrors.push({ page: pageLabel, text: msg.text() });
          }
        });
      };
      wirePageConsole(pageA, "A");
      wirePageConsole(pageB, "B");

      // Install the Date overrides BEFORE navigation. `0` means
      // "use the real host clock" — no override is installed in
      // that case so the production Date object is observed verbatim.
      if (skewAMs !== 0) {
        await installClockSkew(pageA, skewAMs);
      }
      if (skewBMs !== 0) {
        await installClockSkew(pageB, skewBMs);
      }

      await pageA.goto("/");
      await pageB.goto("/");
      await expect(
        pageA.getByRole("heading", { name: "Igloo Web" }),
      ).toBeVisible();
      await expect(
        pageB.getByRole("heading", { name: "Igloo Web" }),
      ).toBeVisible();

      // Confirm the clock overrides actually took effect. If they
      // did not, there is no point running the rest of the
      // scenario — the test would degrade into a plain round-trip
      // without any skew assertion.
      const verifySkew = async (
        page: Page,
        expectedSkew: number,
        pageLabel: string,
      ): Promise<void> => {
        const pageNow = await page.evaluate(() => Date.now());
        const hostNow = Date.now();
        const observed = pageNow - hostNow;
        // 5 s slack covers the RPC round-trip between the test
        // runner and the page; tiny compared to the skew magnitudes
        // at play here.
        expect(
          Math.abs(observed - expectedSkew),
          `page ${pageLabel} skew check for ${label}: expected ~${expectedSkew}ms, got ${observed}ms`,
        ).toBeLessThan(5_000);
      };
      await verifySkew(pageA, skewAMs, "A");
      await verifySkew(pageB, skewBMs, "B");

      const waitForHooks = async (page: Page, hookLabel: string) =>
        page
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
              `Dev-only test hooks never attached on page ${hookLabel}. (${err})`,
            );
          });
      await Promise.all([waitForHooks(pageA, "A"), waitForHooks(pageB, "B")]);

      const keyset: SpecKeyset = await pageA.evaluate(async () => {
        const w = window as unknown as {
          __iglooTestCreateKeysetBundle: (params: {
            groupName: string;
            threshold: number;
            count: number;
          }) => Promise<SpecKeyset>;
        };
        return w.__iglooTestCreateKeysetBundle({
          groupName: "Clock Skew E2E",
          threshold: 2,
          count: 3,
        });
      });
      expect(keyset.shares.length).toBeGreaterThanOrEqual(2);
      const shareA = keyset.shares[0];
      const shareB = keyset.shares[1];
      expect(shareA.idx).not.toBe(shareB.idx);

      const [peerAPubkey32, peerBPubkey32] = await pageA.evaluate(
        ({ group, idxA, idxB }) => {
          const w = window as unknown as {
            __iglooTestMemberPubkey32: (
              group: unknown,
              shareIdx: number,
            ) => string;
          };
          return [
            w.__iglooTestMemberPubkey32(group, idxA),
            w.__iglooTestMemberPubkey32(group, idxB),
          ];
        },
        { group: keyset.group, idxA: shareA.idx, idxB: shareB.idx },
      );
      expect(peerAPubkey32).toMatch(/^[0-9a-f]{64}$/);
      expect(peerBPubkey32).toMatch(/^[0-9a-f]{64}$/);

      const seed = async (
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
            group: keyset.group,
            share,
            relayUrl: RELAY_URL,
            deviceName,
          },
        );
      await seed(pageA, shareA, "Alice");
      await seed(pageB, shareB, "Bob");

      const waitForRealRelayOnline = async (page: Page, pageLabel: string) =>
        page
          .waitForFunction(
            (url: string) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeRelays?: Array<{
                    url: string;
                    state: string;
                  }>;
                };
              };
              const relays = w.__appState?.runtimeRelays ?? [];
              return relays.some(
                (entry) =>
                  entry.url === url && entry.state === "online",
              );
            },
            RELAY_URL,
            { timeout: RELAY_READY_TIMEOUT_MS, polling: 150 },
          )
          .catch((err) => {
            throw new Error(
              `Relay never reached "online" on page ${pageLabel}: ${err}`,
            );
          });
      await Promise.all([
        waitForRealRelayOnline(pageA, "A"),
        waitForRealRelayOnline(pageB, "B"),
      ]);

      // Wait for natural ping/pong convergence under the skewed
      // clock. If the skew truly broke anything, `sign_ready` would
      // never flip and this timeout would fire.
      const waitForSignReady = async (page: Page, pageLabel: string) =>
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
            { timeout: SIGN_READY_TIMEOUT_MS, polling: 250 },
          )
          .catch((err) => {
            throw new Error(
              `sign_ready never became true on page ${pageLabel} under ` +
                `skew=${label} within ${SIGN_READY_TIMEOUT_MS}ms. (${err})`,
            );
          });
      await Promise.all([
        waitForSignReady(pageA, "A"),
        waitForSignReady(pageB, "B"),
      ]);

      const waitForEcdhReady = async (page: Page, pageLabel: string) =>
        page
          .waitForFunction(
            () => {
              const w = window as unknown as {
                __appState?: {
                  runtimeStatus?: {
                    readiness?: { ecdh_ready?: boolean };
                  };
                };
              };
              return Boolean(
                w.__appState?.runtimeStatus?.readiness?.ecdh_ready,
              );
            },
            undefined,
            { timeout: SIGN_READY_TIMEOUT_MS, polling: 250 },
          )
          .catch((err) => {
            throw new Error(
              `ecdh_ready never became true on page ${pageLabel} under ` +
                `skew=${label}. (${err})`,
            );
          });
      await Promise.all([
        waitForEcdhReady(pageA, "A"),
        waitForEcdhReady(pageB, "B"),
      ]);

      const waitForPeerOnline = async (
        page: Page,
        peerHex: string,
        pageLabel: string,
      ) =>
        page
          .waitForFunction(
            (expected: string) => {
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
              const match = peers.find((p) => p.pubkey === expected);
              return Boolean(
                match?.online && (match?.last_seen ?? 0) > 0,
              );
            },
            peerHex,
            { timeout: PEERS_ONLINE_TIMEOUT_MS, polling: 250 },
          )
          .catch((err) => {
            throw new Error(
              `Peer ${peerHex} never became online on page ${pageLabel} ` +
                `under skew=${label}. (${err})`,
            );
          });
      await Promise.all([
        waitForPeerOnline(pageA, peerBPubkey32, "A"),
        waitForPeerOnline(pageB, peerAPubkey32, "B"),
      ]);

      // ----------------------------------------------------------
      // Sign round-trip: A initiates, B (skewed clock) must respond
      // ----------------------------------------------------------
      let messageCounter = 0;
      const nextMessageHex = (): string => {
        messageCounter += 1;
        const seed = Date.now().toString(16).padStart(12, "0");
        return (
          seed.repeat(6).slice(0, 62) +
          messageCounter.toString(16).padStart(2, "0")
        ).slice(0, 64);
      };

      const attemptOneSign = async (
        messageHex: string,
      ): Promise<{
        requestId: string;
        outcome: "completed" | "failed" | "timeout";
        reason?: string;
      }> => {
        const dispatch = await pageA.evaluate(async (msg: string) => {
          const w = window as unknown as {
            __appState: {
              handleRuntimeCommand: (cmd: {
                type: "sign";
                message_hex_32: string;
              }) => Promise<{
                requestId: string | null;
                debounced: boolean;
              }>;
            };
          };
          return w.__appState.handleRuntimeCommand({
            type: "sign",
            message_hex_32: msg,
          });
        }, messageHex);
        expect(dispatch.debounced).toBe(false);
        const rid = dispatch.requestId;
        expect(rid).toBeTruthy();
        const requestId: string = rid!;

        const outcomeRaw = await pageA
          .waitForFunction(
            (id: string) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeCompletions?: Array<Record<string, unknown>>;
                  runtimeFailures?: Array<{
                    op_type?: string;
                    request_id?: string;
                    message?: string;
                    code?: string;
                  }>;
                };
              };
              const completions =
                w.__appState?.runtimeCompletions ?? [];
              for (const entry of completions) {
                const sign = (
                  entry as { Sign?: { request_id?: string } }
                ).Sign;
                if (sign?.request_id === id) {
                  return { kind: "completed" as const };
                }
              }
              const failures = w.__appState?.runtimeFailures ?? [];
              const failure = failures.find(
                (f) =>
                  typeof f.op_type === "string" &&
                  f.op_type.toLowerCase() === "sign" &&
                  f.request_id === id,
              );
              if (failure) {
                return {
                  kind: "failed" as const,
                  reason: `${failure.code ?? ""} ${
                    failure.message ?? ""
                  }`.trim(),
                };
              }
              return null;
            },
            requestId,
            {
              timeout: SIGN_COMPLETION_TIMEOUT_MS,
              polling: 200,
            },
          )
          .then((h) =>
            h.jsonValue() as Promise<
              | { kind: "completed" }
              | { kind: "failed"; reason?: string }
            >,
          )
          .catch(() => ({ kind: "timeout" as const }));

        if (outcomeRaw.kind === "completed") {
          return { requestId, outcome: "completed" };
        }
        if (outcomeRaw.kind === "failed") {
          return {
            requestId,
            outcome: "failed",
            reason: outcomeRaw.reason,
          };
        }
        return { requestId, outcome: "timeout" };
      };

      const signRoundDeadline = Date.now() + ROUND_TIMEOUT_MS;
      const signAttempts: Array<{
        requestId: string;
        outcome: string;
        reason?: string;
      }> = [];
      let completedSignRequestId: string | null = null;
      while (
        !completedSignRequestId &&
        Date.now() < signRoundDeadline &&
        signAttempts.length < 5
      ) {
        const attempt = await attemptOneSign(nextMessageHex());
        signAttempts.push({
          requestId: attempt.requestId,
          outcome: attempt.outcome,
          reason: attempt.reason,
        });
        if (attempt.outcome === "completed") {
          completedSignRequestId = attempt.requestId;
          break;
        }
        // Retry recipe: have A refresh all peers so B (skewed) re-
        // advertises fresh nonces / policy, then retry with a new
        // message.
        await pageA.evaluate(async () => {
          const w = window as unknown as {
            __appState: {
              handleRuntimeCommand: (cmd: {
                type: "refresh_all_peers";
              }) => Promise<{ requestId: string | null; debounced: boolean }>;
            };
          };
          await w.__appState.handleRuntimeCommand({
            type: "refresh_all_peers",
          });
        });
        await pageA.waitForTimeout(1_500);
      }
      if (!completedSignRequestId) {
        throw new Error(
          `Sign round-trip never completed under skew=${label} ` +
            `within ${ROUND_TIMEOUT_MS}ms; attempts=` +
            `${JSON.stringify(signAttempts, null, 2)}`,
        );
      }

      // ----------------------------------------------------------
      // ECDH round-trip: A initiates targeting B's pubkey
      // ----------------------------------------------------------
      const ecdhDispatch = await pageA.evaluate(async (peerHex: string) => {
        const w = window as unknown as {
          __appState: {
            handleRuntimeCommand: (cmd: {
              type: "ecdh";
              pubkey32_hex: string;
            }) => Promise<{ requestId: string | null; debounced: boolean }>;
          };
        };
        return w.__appState.handleRuntimeCommand({
          type: "ecdh",
          pubkey32_hex: peerHex,
        });
      }, peerBPubkey32);
      expect(ecdhDispatch.debounced).toBe(false);
      expect(ecdhDispatch.requestId).toBeTruthy();
      const ecdhRequestId: string = ecdhDispatch.requestId!;

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
              const ecdh = (
                entry as { Ecdh?: { request_id?: string } }
              ).Ecdh;
              return !!ecdh && ecdh.request_id === rid;
            });
          },
          ecdhRequestId,
          { timeout: ECDH_COMPLETION_TIMEOUT_MS, polling: 250 },
        )
        .catch(async (err) => {
          throw new Error(
            `ECDH round-trip never completed under skew=${label} ` +
              `within ${ECDH_COMPLETION_TIMEOUT_MS}ms. ${err}`,
          );
        });

      const secret = await pageA.evaluate((rid: string) => {
        const w = window as unknown as {
          __appState?: {
            runtimeCompletions?: Array<Record<string, unknown>>;
          };
        };
        const completions = w.__appState?.runtimeCompletions ?? [];
        const hit = completions.find((entry) => {
          const ecdh = (entry as { Ecdh?: { request_id?: string } }).Ecdh;
          return !!ecdh && ecdh.request_id === rid;
        });
        return (
          hit as
            | {
                Ecdh?: {
                  request_id: string;
                  shared_secret_hex32: string;
                };
              }
            | undefined
        )?.Ecdh?.shared_secret_hex32 ?? null;
      }, ecdhRequestId);
      expect(
        secret,
        `ECDH shared secret missing under skew=${label}`,
      ).toMatch(/^[0-9a-f]{64}$/);

      // ----------------------------------------------------------
      // Console-clean guard for skew-specific regressions. Any
      // console.error matching /skew|clock|time.*invalid|out of range/
      // indicates the runtime complained about the skewed timestamps;
      // other console errors (e.g. the documented nested-button
      // warning) are allowed because they are unrelated to this
      // feature.
      // ----------------------------------------------------------
      const skewPattern = /skew|clock|invalid.*time|out[- ]of[- ]range/i;
      const skewErrors = consoleErrors.filter((entry) =>
        skewPattern.test(entry.text),
      );
      expect(
        skewErrors,
        `Unexpected skew-related console errors under ${label}: ` +
          `${JSON.stringify(skewErrors, null, 2)}`,
      ).toEqual([]);
    } finally {
      await ctxA.close().catch(() => undefined);
      await ctxB.close().catch(() => undefined);
    }
  };

  // Scenario A: symmetric ±120 s — both devices skewed equally from
  // real wall time. Relative peer skew = 0 s (inside bifrost's 30 s
  // cap), so the round-trip runs. Validates the runtime works when
  // the host clock is badly wrong relative to reality — the common
  // "broken NTP / VM suspended / battery replaced" failure mode.
  test(
    "sign + ECDH round-trip survives both devices +120s off wall clock (symmetric)",
    async ({ browser }) => {
      await runSkewScenario({
        browser,
        skewAMs: CLOCK_SKEW_MS,
        skewBMs: CLOCK_SKEW_MS,
        label: "symmetric +120s",
      });
    },
  );

  test(
    "sign + ECDH round-trip survives both devices -120s off wall clock (symmetric)",
    async ({ browser }) => {
      await runSkewScenario({
        browser,
        skewAMs: -CLOCK_SKEW_MS,
        skewBMs: -CLOCK_SKEW_MS,
        label: "symmetric -120s",
      });
    },
  );

  // Scenario B: asymmetric ±25 s — only device B is skewed, within
  // bifrost-signer's `max_future_skew_secs=30` tolerance. Validates
  // the runtime tolerates realistic inter-peer clock divergence at
  // the edge of the documented protocol window.
  test(
    "sign + ECDH round-trip survives device B +25s ahead of device A (asymmetric, within 30s cap)",
    async ({ browser }) => {
      await runSkewScenario({
        browser,
        skewAMs: 0,
        skewBMs: ASYMMETRIC_SKEW_MS,
        label: "asymmetric B +25s",
      });
    },
  );

  test(
    "sign + ECDH round-trip survives device B -25s behind device A (asymmetric, within 30s cap)",
    async ({ browser }) => {
      await runSkewScenario({
        browser,
        skewAMs: 0,
        skewBMs: -ASYMMETRIC_SKEW_MS,
        label: "asymmetric B -25s",
      });
    },
  );

  // ---------------------------------------------------------------
  // Scenario C: asymmetric ±120s — PHYSICALLY IMPOSSIBLE
  // ---------------------------------------------------------------
  //
  // Added in `fix-m7-scrutiny-r1-long-session-and-clock-skew-criteria`
  // to make the protocol constraint explicit rather than implicit.
  //
  // The feature description ("Clock skew: device B ±120s clock vs A
  // still completes sign+ECDH round-trips") and contract
  // VAL-CROSS-027's "±5 min from relay wall time" clause nominally
  // require a test where one device's clock is 120 s / 300 s ahead
  // of the other. This cannot be validated end-to-end without
  // violating bifrost-signer's security model:
  //
  //   • `bifrost-signer` hard-codes `max_future_skew_secs: 30`
  //     (`bifrost-rs/crates/bifrost-signer/src/lib.rs:243`) and
  //     rejects any inbound peer request whose `sent_at` exceeds
  //     the local wall clock by more than 30 s (`lib.rs:2263`).
  //   • The cap is NOT patchable via `DeviceConfigPatch`'s
  //     `update_config` surface (`lib.rs:620`) — it only exposes
  //     `sign_timeout_secs`, `ping_timeout_secs`,
  //     `request_ttl_secs`, etc.
  //   • `bifrost-rs/` is read-only reference material for this
  //     mission (AGENTS.md > Off-Limits Paths), so widening the
  //     cap is out of scope.
  //
  // Therefore the ±120 s asymmetric scenario is documented as a
  // DEVIATION from the feature description and VAL-CROSS-027 in
  // `docs/runtime-deviations-from-paper.md` ("Clock skew magnitude
  // bounded by bifrost-signer `max_future_skew_secs=30`"). The
  // validation achieved by the real tests above —
  //
  //   • symmetric ±120 s (both devices equally offset; peer-to-peer
  //     relative skew = 0 s), and
  //   • asymmetric ±25 s (within the 30 s protocol cap, close to
  //     the tolerance edge) —
  //
  // together covers the real-world failure modes: (1) local wall
  // clock badly wrong vs reality ("broken NTP / VM suspended /
  // battery replaced"), and (2) moderate inter-peer clock drift at
  // the edge of the protocol's documented tolerance.
  //
  // We gate the describe with a capability-style `test.skip(...)`
  // that (a) documents the protocol constraint in the skip reason
  // (visible in Playwright reporter output), and (b) emits a
  // console.log in `beforeAll` so the rationale is also visible in
  // stdout during CI runs. The body of the (skipped) test still
  // contains the scenario call that WOULD run if the cap were
  // lifted — kept as executable documentation of what the full
  // coverage would look like.
  test.describe("asymmetric ±120s (SKIPPED — physically impossible under bifrost-signer max_future_skew_secs=30)", () => {
    // `CLOCK_SKEW_MS` is 120_000 and bifrost-signer's
    // `max_future_skew_secs` is 30; the ratio makes the scenario
    // protocol-impossible today. Retain as a variable so that if a
    // future bifrost-rs release lifts the cap and we bump the
    // constant here, the describe automatically flips live.
    const ASYMMETRIC_120_SKEW_EXCEEDS_PROTOCOL_CAP =
      CLOCK_SKEW_MS / 1000 > /* bifrost-signer max_future_skew_secs */ 30;

    test.skip(
      () => ASYMMETRIC_120_SKEW_EXCEEDS_PROTOCOL_CAP,
      "Asymmetric peer-to-peer skew of 120s (≫ bifrost-signer's " +
        "hard-coded max_future_skew_secs=30, bifrost-rs/crates/" +
        "bifrost-signer/src/lib.rs:243) deterministically fails the " +
        "signer's `record_request` gate — any inbound request with " +
        "sent_at > now + 30s is rejected (lib.rs:2263). The cap is " +
        "not patchable via DeviceConfigPatch and bifrost-rs is " +
        "read-only reference material for this mission. See " +
        "docs/runtime-deviations-from-paper.md > 'Clock skew " +
        "magnitude bounded by bifrost-signer max_future_skew_secs=30'. " +
        "Real validation is provided by the symmetric ±120s and " +
        "asymmetric ±25s scenarios above; together they cover the " +
        "real-world failure modes (broken NTP vs reality, moderate " +
        "inter-peer clock drift within the protocol tolerance).",
    );

    test.beforeAll(() => {
      // eslint-disable-next-line no-console
      console.log(
        "[clock-skew] Skipping asymmetric ±120s scenario: peer-to-peer " +
          "skew exceeds bifrost-signer's hard-coded max_future_skew_secs=30 " +
          "(bifrost-rs/crates/bifrost-signer/src/lib.rs:243). See " +
          "docs/runtime-deviations-from-paper.md > 'Clock skew magnitude " +
          "bounded by bifrost-signer max_future_skew_secs=30' for the " +
          "full rationale. Validation union: symmetric ±120s + " +
          "asymmetric ±25s covers the real-world failure modes.",
      );
    });

    test(
      "[would-run-if-cap-lifted] sign + ECDH round-trip with device B +120s ahead of device A",
      async ({ browser }) => {
        // Intentional: this body is executable documentation. The
        // describe-level `test.skip` above prevents it from ever
        // running against the real runtime — if the protocol cap is
        // ever raised, the gate flips and this becomes a live test.
        await runSkewScenario({
          browser,
          skewAMs: 0,
          skewBMs: CLOCK_SKEW_MS,
          label: "asymmetric B +120s (protocol-impossible)",
        });
      },
    );

    test(
      "[would-run-if-cap-lifted] sign + ECDH round-trip with device B -120s behind device A",
      async ({ browser }) => {
        await runSkewScenario({
          browser,
          skewAMs: 0,
          skewBMs: -CLOCK_SKEW_MS,
          label: "asymmetric B -120s (protocol-impossible)",
        });
      },
    );
  });
});
