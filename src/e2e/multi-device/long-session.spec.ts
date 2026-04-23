import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device long-session perf/leak e2e for feature
 * `m7-clock-skew-and-leak`.
 *
 * Feature description:
 *   "Long-running session: 30 minutes of periodic activity (sign/ECDH
 *    /ping every minute). WS count stays ≤ relays.length;
 *    RuntimeEventLog stays ≤ 500; JS heap bounded (no monotonic
 *    growth beyond ring caps)."
 *
 * Approach:
 *   A literal 30 minute wall-clock test is not viable in CI — this
 *   spec COMPRESSES the same shape of activity into a shorter run by
 *   driving N sign+ECDH+ping cycles back-to-back at accelerated
 *   cadence. Each cycle is a full 2-of-3 round-trip that exercises
 *   every drain path (drainCompletions, drainRuntimeEvents,
 *   drainFailures) the 30-minute scenario would exercise in series,
 *   plus synthetic pressure on the event-log ring buffer to prove
 *   the bounded-500 cap actually evicts. The assertions the feature
 *   fulfils — bounded WS count, bounded RuntimeEventLog, bounded
 *   heap — are orthogonal to the real-time duration; what matters is
 *   that enough iterations exercise each ring-buffer and relay
 *   lifecycle path that any monotonic leak would have surfaced.
 *
 * Invariants under test:
 *
 *   (I1) `runtimeRelays.length` on each page remains bounded by the
 *        configured relay count for the entire run (never drops, never
 *        exceeds). No phantom duplicate entries accumulate.
 *
 *   (I2) The dev-only `__debug.relayHistory` ring on each page shows
 *        exactly ONE `open` event for the single configured real
 *        relay across the whole run — i.e. no socket churn beyond
 *        the initial connect. Any leaked WebSocket would produce a
 *        second `open` entry.
 *
 *   (I3) Per-page `runtimeEventLog.length` stays ≤ 500 throughout
 *        the run, even after a deliberate 600-entry synthetic
 *        injection via `__iglooTestInjectEventLogEntries` mid-run.
 *        This exercises the same FIFO eviction path used by
 *        VAL-EVENTLOG-014.
 *
 *   (I5) EVERY iteration's sign AND ECDH complete successfully (no
 *        partial tolerance). A real long-running session does not
 *        get to silently skip individual op completions — if one
 *        cycle's sign or ECDH fails or times out that is a
 *        regression that must fail the spec. Tightened in
 *        `fix-m7-scrutiny-r1-long-session-and-clock-skew-criteria`
 *        after m7 scrutiny R1 flagged the original "≥1 successful
 *        sign / ≥1 successful ECDH across all iterations" gate as
 *        too permissive.
 *
 *   (I6) Every iteration's ECDH completion carries a well-formed
 *        `shared_secret_hex32` (64-hex). Verifies the ECDH happy
 *        path produces real, usable shared-secret material on each
 *        iteration rather than just arriving as an empty completion
 *        envelope.
 *
 *   (I4) Best-effort JS-heap bounds: when
 *        `performance.memory?.usedJSHeapSize` is available (Chrome
 *        only), baseline and post-run heap are sampled; the spec
 *        asserts the final heap is not more than 3× the baseline.
 *        The factor is intentionally generous — React dev-mode and
 *        ring-buffer retention make a tight ±10% bound infeasible in
 *        this shortened harness — but it still fails loudly on
 *        genuine monotonic leaks (e.g. subscriptions accumulating
 *        unbounded closures). When `performance.memory` is absent
 *        (non-Chrome test runners, or when the browser does not
 *        expose it in headless mode) the heap bound is silently
 *        skipped with a log line so the rest of the invariants still
 *        validate.
 *
 * Cycle shape per iteration:
 *   1. A dispatches a sign with a fresh 32-byte message; wait for
 *      `Sign` completion on A.
 *   2. A dispatches an ECDH targeting B's pubkey; wait for `Ecdh`
 *      completion on A.
 *   3. A dispatches `refresh_all_peers` (equivalent to a manual
 *      ping sweep). One cycle = one "minute" of activity in the
 *      30-minute scenario.
 *
 * Tuning: the spec runs `ITERATIONS = 6` cycles by default. At 3-6
 * seconds per cycle over loopback this fits inside a ~60-90 s
 * window; with the synthetic 600-entry event-log injection it
 * exercises the eviction path well past the 500-entry cap. Increase
 * via `LONG_SESSION_ITERATIONS` env var to stress further (e.g. for
 * investigating a suspected leak).
 *
 * To run manually:
 *   1. bash .factory/init.sh                  # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/long-session.spec.ts \
 *        --project=desktop --workers 1
 *   3. Optional: LONG_SESSION_ITERATIONS=30 npx playwright test ...
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
const SIGN_READY_TIMEOUT_MS = 120_000;
const PEERS_ONLINE_TIMEOUT_MS = 60_000;
// Per-op completion budgets. Tight enough that a stuck sign surfaces
// as a test failure rather than a hang, but generous enough that the
// ordinary retry loop can recover.
const OP_COMPLETION_TIMEOUT_MS = 45_000;

const ITERATIONS = Number.parseInt(
  process.env.LONG_SESSION_ITERATIONS ?? "6",
  10,
);
// 500 is `RUNTIME_EVENT_LOG_MAX` in `src/app/AppStateTypes.ts`. We
// intentionally inject MORE than the cap to exercise FIFO eviction;
// the 600 figure matches VAL-EVENTLOG-014's pattern.
const EVENT_LOG_CAP = 500;
const EVENT_LOG_INJECT_COUNT = 600;

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

test.describe("multi-device long-session (m7-clock-skew-and-leak)", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  // Seeding + N cycles + injection sweep + final assertions. 5 minutes
  // is plenty for ITERATIONS=6 and leaves headroom for the env-var
  // override to bump iteration count by ~3x without re-tuning.
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

  test(
    `periodic sign/ECDH/ping (ITERATIONS=${ITERATIONS}) keeps WS count, event log, and heap bounded`,
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
                  __iglooTestInjectEventLogEntries?: unknown;
                  __debug?: unknown;
                };
                return (
                  typeof w.__appState === "object" &&
                  typeof w.__iglooTestSeedRuntime === "function" &&
                  typeof w.__iglooTestCreateKeysetBundle === "function" &&
                  typeof w.__iglooTestMemberPubkey32 === "function" &&
                  typeof w.__iglooTestInjectEventLogEntries === "function" &&
                  typeof w.__debug === "object"
                );
              },
              undefined,
              { timeout: 15_000, polling: 100 },
            )
            .catch((err) => {
              throw new Error(
                `Dev-only test hooks never attached on page ${label}. (${err})`,
              );
            });
        await Promise.all([
          waitForHooks(pageA, "A"),
          waitForHooks(pageB, "B"),
        ]);

        // 2-of-3 keyset — threshold=2 means A+B suffice for sign.
        const keyset: SpecKeyset = await pageA.evaluate(async () => {
          const w = window as unknown as {
            __iglooTestCreateKeysetBundle: (params: {
              groupName: string;
              threshold: number;
              count: number;
            }) => Promise<SpecKeyset>;
          };
          return w.__iglooTestCreateKeysetBundle({
            groupName: "Long Session E2E",
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

        // Seed both runtimes against the SAME single configured relay
        // — one relay makes (I1) and (I2) trivially legible:
        // runtimeRelays.length must stay 1, relayHistory opens must
        // stay 1.
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

        const waitForRelayOnline = async (page: Page, label: string) =>
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
                `Relay never reached "online" on page ${label}: ${err}`,
              );
            });
        await Promise.all([
          waitForRelayOnline(pageA, "A"),
          waitForRelayOnline(pageB, "B"),
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
              { timeout: SIGN_READY_TIMEOUT_MS, polling: 250 },
            )
            .catch((err) => {
              throw new Error(
                `sign_ready never became true on ${label} within ` +
                  `${SIGN_READY_TIMEOUT_MS}ms. (${err})`,
              );
            });
        await Promise.all([
          waitForSignReady(pageA, "A"),
          waitForSignReady(pageB, "B"),
        ]);

        const waitForPeerOnline = async (
          page: Page,
          peerHex: string,
          label: string,
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
                `Peer ${peerHex} never became online on page ${label} ` +
                  `within ${PEERS_ONLINE_TIMEOUT_MS}ms. (${err})`,
              );
            });
        await Promise.all([
          waitForPeerOnline(pageA, peerBPubkey32, "A"),
          waitForPeerOnline(pageB, peerAPubkey32, "B"),
        ]);

        // ----------------------------------------------------------
        // BASELINE snapshot
        // ----------------------------------------------------------
        const snapshotPage = async (page: Page) =>
          page.evaluate((url: string) => {
            const w = window as unknown as {
              __appState?: {
                runtimeRelays?: Array<{ url: string; state: string }>;
                runtimeEventLog?: Array<{ seq: number }>;
              };
              __debug?: {
                relayHistory: Array<{ type: string; url: string }>;
                runtimeEventLog: Array<{ seq: number }>;
              };
              performance?: {
                memory?: {
                  usedJSHeapSize?: number;
                };
              };
            };
            const appState = w.__appState;
            const debug = w.__debug;
            const relayHistory = debug?.relayHistory ?? [];
            const opensForUrl = relayHistory.filter(
              (entry) => entry.type === "open" && entry.url === url,
            ).length;
            const totalOpens = relayHistory.filter(
              (entry) => entry.type === "open",
            ).length;
            const memory = w.performance?.memory;
            return {
              runtimeRelaysLength: appState?.runtimeRelays?.length ?? 0,
              runtimeEventLogLength:
                appState?.runtimeEventLog?.length ?? 0,
              debugRuntimeEventLogLength:
                debug?.runtimeEventLog?.length ?? 0,
              relayOpensForUrl: opensForUrl,
              relayTotalOpens: totalOpens,
              usedJSHeapSize:
                typeof memory?.usedJSHeapSize === "number"
                  ? memory.usedJSHeapSize
                  : null,
            };
          }, RELAY_URL);

        const baselineA = await snapshotPage(pageA);
        const baselineB = await snapshotPage(pageB);

        // (I1) baseline: exactly one runtimeRelays entry on each page
        // — the single configured relay.
        expect(baselineA.runtimeRelaysLength).toBe(1);
        expect(baselineB.runtimeRelaysLength).toBe(1);
        // (I2) baseline: exactly one `open` entry for the real relay
        // on each page (one socket was opened on connect, nothing
        // else).
        expect(baselineA.relayOpensForUrl).toBe(1);
        expect(baselineB.relayOpensForUrl).toBe(1);
        expect(baselineA.relayTotalOpens).toBe(1);
        expect(baselineB.relayTotalOpens).toBe(1);

        // ----------------------------------------------------------
        // Cycle loop — N iterations of sign, ECDH, ping.
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

        const dispatchSignOnce = async (
          messageHex: string,
        ): Promise<{ requestId: string; completed: boolean }> => {
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
          const requestId = dispatch.requestId;
          if (!requestId) {
            return { requestId: "", completed: false };
          }
          const completed = await pageA
            .waitForFunction(
              (rid: string) => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeCompletions?: Array<Record<string, unknown>>;
                    runtimeFailures?: Array<{
                      op_type?: string;
                      request_id?: string;
                    }>;
                  };
                };
                const completions =
                  w.__appState?.runtimeCompletions ?? [];
                for (const entry of completions) {
                  const sign = (
                    entry as { Sign?: { request_id?: string } }
                  ).Sign;
                  if (sign?.request_id === rid) return "completed";
                }
                const failures = w.__appState?.runtimeFailures ?? [];
                const failure = failures.find(
                  (f) =>
                    typeof f.op_type === "string" &&
                    f.op_type.toLowerCase() === "sign" &&
                    f.request_id === rid,
                );
                if (failure) return "failed";
                return null;
              },
              requestId,
              { timeout: OP_COMPLETION_TIMEOUT_MS, polling: 200 },
            )
            .then((h) => h.jsonValue() as Promise<string>)
            .catch(() => "timeout");
          return { requestId, completed: completed === "completed" };
        };

        const dispatchEcdhOnce = async (): Promise<{
          requestId: string;
          completed: boolean;
          sharedSecretHex: string | null;
        }> => {
          // Snapshot the set of ECDH completion request_ids that
          // already exist on page A BEFORE dispatch. Under loopback
          // the runtime occasionally processes an ECDH within a
          // single tick — fast enough that the
          // `handleRuntimeCommand` synchronous snapshot of
          // `pending_operations` no longer contains the new op by
          // the time `runtimeStatus()` is read (the completion has
          // already drained into `runtimeCompletions`). In that case
          // `dispatch.requestId` is `null` but the completion DOES
          // arrive; `correlatePendingOperations` and the unmatched-
          // dispatch queue surface the Ecdh envelope on the next
          // tick.
          //
          // To keep (I5) tight without false-failing on this
          // benign race, we correlate by "new ECDH completion that
          // was NOT present pre-dispatch" rather than by the exact
          // synchronous request_id. Each completion carries its own
          // `request_id`, so whichever request_id turns up first
          // after dispatch is the one we dispatched.
          const baselineEcdhRequestIds: string[] = await pageA.evaluate(
            () => {
              const w = window as unknown as {
                __appState?: {
                  runtimeCompletions?: Array<Record<string, unknown>>;
                };
              };
              const completions =
                w.__appState?.runtimeCompletions ?? [];
              const ids: string[] = [];
              for (const entry of completions) {
                const ecdh = (
                  entry as { Ecdh?: { request_id?: string } }
                ).Ecdh;
                if (ecdh?.request_id) ids.push(ecdh.request_id);
              }
              return ids;
            },
          );

          const dispatch = await pageA.evaluate(
            async (peerHex: string) => {
              const w = window as unknown as {
                __appState: {
                  handleRuntimeCommand: (cmd: {
                    type: "ecdh";
                    pubkey32_hex: string;
                  }) => Promise<{
                    requestId: string | null;
                    debounced: boolean;
                  }>;
                };
              };
              return w.__appState.handleRuntimeCommand({
                type: "ecdh",
                pubkey32_hex: peerHex,
              });
            },
            peerBPubkey32,
          );
          // If the dispatcher was able to capture a synchronous
          // request_id, prefer it (exact correlation). Otherwise
          // fall back to "first new ECDH completion after the
          // baseline snapshot" correlation.
          const syncRequestId = dispatch.requestId;

          const newRequestIdRaw = await pageA
            .waitForFunction(
              ({
                baseline,
                targetRid,
              }: {
                baseline: string[];
                targetRid: string | null;
              }) => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeCompletions?: Array<Record<string, unknown>>;
                  };
                };
                const completions =
                  w.__appState?.runtimeCompletions ?? [];
                // Exact-match path when the sync capture succeeded.
                if (targetRid) {
                  for (const entry of completions) {
                    const ecdh = (
                      entry as { Ecdh?: { request_id?: string } }
                    ).Ecdh;
                    if (ecdh?.request_id === targetRid) {
                      return targetRid;
                    }
                  }
                  return null;
                }
                // New-completion path when the sync capture missed.
                const baselineSet = new Set(baseline);
                for (const entry of completions) {
                  const ecdh = (
                    entry as { Ecdh?: { request_id?: string } }
                  ).Ecdh;
                  if (ecdh?.request_id && !baselineSet.has(ecdh.request_id)) {
                    return ecdh.request_id;
                  }
                }
                return null;
              },
              {
                baseline: baselineEcdhRequestIds,
                targetRid: syncRequestId,
              },
              { timeout: OP_COMPLETION_TIMEOUT_MS, polling: 200 },
            )
            .then((h) => h.jsonValue() as Promise<string | null>)
            .catch(() => null);

          const requestId = newRequestIdRaw ?? syncRequestId ?? "";
          const completed = Boolean(newRequestIdRaw);
          // Extract `shared_secret_hex32` from the matching
          // completion so callers can verify (I6) — every ECDH
          // returns real 64-hex shared-secret material, not an
          // empty/partial envelope.
          const sharedSecretHex = completed
            ? await pageA.evaluate((rid: string) => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeCompletions?: Array<Record<string, unknown>>;
                  };
                };
                const completions =
                  w.__appState?.runtimeCompletions ?? [];
                const hit = completions.find((entry) => {
                  const ecdh = (
                    entry as { Ecdh?: { request_id?: string } }
                  ).Ecdh;
                  return !!ecdh && ecdh.request_id === rid;
                });
                return (
                  (
                    hit as
                      | {
                          Ecdh?: {
                            request_id: string;
                            shared_secret_hex32: string;
                          };
                        }
                      | undefined
                  )?.Ecdh?.shared_secret_hex32 ?? null
                );
              }, requestId)
            : null;
          return { requestId, completed, sharedSecretHex };
        };

        const dispatchPingOnce = async (): Promise<void> => {
          // `refresh_all_peers` is the runtime-level equivalent of a
          // manual "ping every known peer" sweep. It does not produce
          // a per-command completion row, so we only dispatch and
          // let the next cycle's peer-online observation confirm the
          // peer was reachable.
          await pageA.evaluate(async () => {
            const w = window as unknown as {
              __appState: {
                handleRuntimeCommand: (cmd: {
                  type: "refresh_all_peers";
                }) => Promise<{
                  requestId: string | null;
                  debounced: boolean;
                }>;
              };
            };
            await w.__appState.handleRuntimeCommand({
              type: "refresh_all_peers",
            });
          });
        };

        // During the loop, each iteration asserts (I1), (I2), (I5),
        // and (I6) hold mid-flight so a regression is caught before
        // the final snapshot. Tightened in
        // `fix-m7-scrutiny-r1-long-session-and-clock-skew-criteria`:
        // EVERY iteration's sign AND ECDH must complete successfully,
        // and every ECDH must carry a 64-hex shared_secret_hex32 —
        // no partial tolerance. Previously the spec only required
        // `≥ 1` successful sign and `≥ 1` successful ECDH across the
        // whole run, which let a regression that broke 5 of 6
        // iterations pass silently.
        for (let i = 0; i < ITERATIONS; i += 1) {
          const sign = await dispatchSignOnce(nextMessageHex());
          // (I5) — every iteration's sign must complete. Any
          // timeout/failure under loopback is a regression.
          expect(
            sign.completed,
            `iteration ${i}: sign must complete successfully ` +
              `(requestId=${sign.requestId || "<none>"})`,
          ).toBe(true);

          const ecdh = await dispatchEcdhOnce();
          // (I5) — every iteration's ECDH must complete.
          expect(
            ecdh.completed,
            `iteration ${i}: ECDH must complete successfully ` +
              `(requestId=${ecdh.requestId || "<none>"})`,
          ).toBe(true);
          // (I6) — every ECDH completion must carry 64-hex shared
          // secret material.
          expect(
            ecdh.sharedSecretHex,
            `iteration ${i}: ECDH shared_secret_hex32 must be present ` +
              `on the completion envelope`,
          ).not.toBeNull();
          expect(
            ecdh.sharedSecretHex,
            `iteration ${i}: ECDH shared_secret_hex32 must be 64 ` +
              `lowercase-hex chars (got ${JSON.stringify(ecdh.sharedSecretHex)})`,
          ).toMatch(/^[0-9a-f]{64}$/);

          await dispatchPingOnce();
          // Brief pause so the refresh tick can land before the next
          // iteration dispatches — mirrors the 1-minute cadence of
          // the feature description, compressed to the minimum useful
          // delta.
          await pageA.waitForTimeout(500);

          // Mid-loop invariant check on page A.
          const mid = await snapshotPage(pageA);
          expect(
            mid.runtimeRelaysLength,
            `iteration ${i}: runtimeRelays.length on A must stay == 1`,
          ).toBe(1);
          expect(
            mid.relayOpensForUrl,
            `iteration ${i}: real-relay opens on A must stay == 1`,
          ).toBe(1);
          expect(
            mid.runtimeEventLogLength,
            `iteration ${i}: runtimeEventLog on A must stay ≤ ${EVENT_LOG_CAP}`,
          ).toBeLessThanOrEqual(EVENT_LOG_CAP);
        }

        // ----------------------------------------------------------
        // (I3) Synthetic injection sweep — inject 600 entries on
        // page A's event log (deliberately above the 500 cap) and
        // verify the FIFO eviction keeps the buffer exactly at the
        // cap. Mirrors the assertion pattern from VAL-EVENTLOG-014.
        // ----------------------------------------------------------
        await pageA.evaluate((count: number) => {
          const w = window as unknown as {
            __iglooTestInjectEventLogEntries: (
              entries: Array<{
                badge: string;
                source?: string;
                payload?: unknown;
                at?: number;
              }>,
            ) => void;
          };
          const entries = [] as Array<{
            badge: string;
            source: string;
            payload: unknown;
            at: number;
          }>;
          for (let i = 0; i < count; i += 1) {
            entries.push({
              badge: "INFO",
              source: "runtime_event",
              payload: { seq: i },
              at: Date.now(),
            });
          }
          w.__iglooTestInjectEventLogEntries(entries);
        }, EVENT_LOG_INJECT_COUNT);

        // The injection dispatches `setRuntimeEventLog` through React
        // — the `__appState.runtimeEventLog` view only reflects the
        // post-injection state after the next commit cycle, which
        // lands asynchronously. Poll until the buffer reports AT the
        // cap before snapshotting. If React never commits a buffer
        // that reaches the cap, this fails loudly via the timeout.
        await pageA
          .waitForFunction(
            (cap: number) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeEventLog?: Array<unknown>;
                };
              };
              return (w.__appState?.runtimeEventLog?.length ?? 0) === cap;
            },
            EVENT_LOG_CAP,
            { timeout: 5_000, polling: 50 },
          )
          .catch((err) => {
            throw new Error(
              `runtimeEventLog never reached cap=${EVENT_LOG_CAP} after ` +
                `injecting ${EVENT_LOG_INJECT_COUNT} entries. (${err})`,
            );
          });

        const postInjection = await snapshotPage(pageA);
        expect(
          postInjection.runtimeEventLogLength,
          `post-injection: runtimeEventLog must be ≤ ${EVENT_LOG_CAP} (ring cap)`,
        ).toBeLessThanOrEqual(EVENT_LOG_CAP);
        // After a 600-count inject the ring must sit AT the cap —
        // anything smaller indicates entries silently dropped BEFORE
        // hitting the cap-enforcement helper.
        expect(
          postInjection.runtimeEventLogLength,
          `post-injection: runtimeEventLog should be AT cap (=${EVENT_LOG_CAP}) ` +
            `after 600-entry inject`,
        ).toBe(EVENT_LOG_CAP);
        // `__debug.runtimeEventLog` mirrors the slice; it must agree
        // with the AppState view (VAL-EVENTLOG-024's observability
        // invariant).
        expect(
          postInjection.debugRuntimeEventLogLength,
          `post-injection: __debug.runtimeEventLog length must match AppState`,
        ).toBe(postInjection.runtimeEventLogLength);

        // ----------------------------------------------------------
        // Final invariant snapshot across BOTH pages after the full
        // run.
        // ----------------------------------------------------------
        const finalA = await snapshotPage(pageA);
        const finalB = await snapshotPage(pageB);

        // (I1) — runtimeRelays bounded
        expect(
          finalA.runtimeRelaysLength,
          "final: runtimeRelays.length on A must be 1",
        ).toBe(1);
        expect(
          finalB.runtimeRelaysLength,
          "final: runtimeRelays.length on B must be 1",
        ).toBe(1);

        // (I2) — WS count bounded across the whole run
        expect(
          finalA.relayOpensForUrl,
          "final: relayHistory opens for real relay on A must be 1",
        ).toBe(1);
        expect(
          finalB.relayOpensForUrl,
          "final: relayHistory opens for real relay on B must be 1",
        ).toBe(1);
        // No OTHER relay URLs should have been opened over the run —
        // any leaked subscription would surface as an unfamiliar
        // URL in relayHistory.
        expect(
          finalA.relayTotalOpens,
          "final: relayHistory total opens on A must be 1 (single configured relay)",
        ).toBe(1);
        expect(
          finalB.relayTotalOpens,
          "final: relayHistory total opens on B must be 1",
        ).toBe(1);

        // (I3) — event log remains bounded
        expect(
          finalA.runtimeEventLogLength,
          `final: runtimeEventLog on A must be ≤ ${EVENT_LOG_CAP}`,
        ).toBeLessThanOrEqual(EVENT_LOG_CAP);
        expect(
          finalB.runtimeEventLogLength,
          `final: runtimeEventLog on B must be ≤ ${EVENT_LOG_CAP}`,
        ).toBeLessThanOrEqual(EVENT_LOG_CAP);

        // (I4) — heap bounded (best-effort; only when
        // `performance.memory` is available). Some Chromium builds
        // expose this only when `--enable-precise-memory-info` is
        // passed; when absent, skip the assertion with a log line so
        // the other invariants still gate the spec.
        if (
          typeof baselineA.usedJSHeapSize === "number" &&
          typeof finalA.usedJSHeapSize === "number"
        ) {
          const ratio =
            finalA.usedJSHeapSize / Math.max(baselineA.usedJSHeapSize, 1);
          expect(
            ratio,
            `final: JS heap on A grew ${ratio.toFixed(2)}x baseline ` +
              `(baseline=${baselineA.usedJSHeapSize}, final=${finalA.usedJSHeapSize})`,
          ).toBeLessThan(3);
        } else {
          // eslint-disable-next-line no-console
          console.log(
            "[long-session] performance.memory not available on this " +
              "browser — skipping heap-bound assertion. Other " +
              "invariants (WS, event log, runtimeRelays) still gate " +
              "the spec.",
          );
        }
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
      }
    },
  );
});
