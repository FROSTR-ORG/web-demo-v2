import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device relay-churn e2e for feature
 * `fix-m5-relay-churn-multidevice-spec` — VAL-CROSS-005.
 *
 * Contract under test (VAL-CROSS-005, narrowed to the inside-runtime
 * surface we can actually exercise today):
 *
 *   1. Two browser contexts (A, B) each seed a real `RuntimeClient`
 *      against a local `bifrost-devtools` relay on 127.0.0.1:8194 AND
 *      an unreachable "decoy" relay URL (ws://127.0.0.1:18194 — no
 *      listener, fails the initial connect and sits in `offline`).
 *   2. A sign is initiated on one page so it's "in-flight" on the real
 *      relay transport.
 *   3. Mid-sign, the OTHER page hot-reloads its relay list through the
 *      `RuntimeRelayPump.updateRelays(...)` diff path (exposed to the
 *      test via `window.__iglooTestUpdateRelays`). In the first half of
 *      the test A removes the decoy while B signs; in the second half
 *      (symmetry check) B adds a new decoy while A signs.
 *   4. The sign must complete successfully (Sign CompletedOperation
 *      drained on the initiator) — silent hangs fail.
 *   5. No duplicate REQ subscriptions accumulate on the real relay:
 *      `__debug.relayHistory` must show exactly one `open` event for
 *      the real relay URL across the whole test (the pump's add/remove
 *      diff must NOT tear down and re-open untouched relays). The real
 *      relay's `reconnectCount` must remain 0 throughout.
 *   6. Deterministic across 3 repeats (run under `--repeat-each=3`).
 *
 * Why a decoy URL instead of a second live relay: AGENTS.md allocates
 * a single port (8194) to this mission for e2e relays. A decoy that
 * never accepts a connection is sufficient for exercising the pump's
 * add/remove diff because `RuntimeRelayPump.updateRelays` behaves
 * identically whether the dropped entry was connected or offline —
 * the assertion target is "untouched entries keep their socket",
 * which does not require the churned entry to have been live.
 *
 * Why natural convergence (no nonce prepopulation): prepopulating
 * `initial_peer_nonces` lands nonces in the local pool but does NOT
 * populate `remote_scoped_policies[peer]`, which bifrost-signer's
 * `select_signing_peers` consults. Over a real relay the result is a
 * `"locked peer response timeout"` on the first sign attempt. This
 * spec instead relies on the pump's 2.5 s ping/pong cadence and
 * gates the signing rounds on `sign_ready === true` AND `peer
 * last_seen > 0`, then wraps each round in a retry loop that calls
 * `refresh_all_peers` on the churner between attempts (the same
 * pattern as `policy-denial-allow-once-retry.spec.ts`).
 *
 * To run manually:
 *   1. bash .factory/init.sh                                 # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/relay-churn.spec.ts \
 *        --project=desktop --workers 1 --repeat-each=3
 */

const BIFROST_RS_DIR =
  "/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs";
const DEVTOOLS_BINARY = `${BIFROST_RS_DIR}/target/release/bifrost-devtools`;

// Port 8194 is the only relay port allocated by AGENTS.md Mission
// Boundaries for this mission — do not change it. The decoy URLs below
// target unused loopback ports that the spec does NOT listen on; the
// WebSocket client observes ECONNREFUSED and marks them offline without
// any side effect on the host.
const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = 8194;
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;
const DECOY_URL_A = `ws://${RELAY_HOST}:18194`;
const DECOY_URL_B = `ws://${RELAY_HOST}:28194`;

const RELAY_READY_TIMEOUT_MS = 20_000;
// Natural sign-readiness convergence (no nonce prepopulation). The
// pump's 2.5 s refresh interval fan-outs ping/pong which populates the
// outgoing/incoming nonce pools on BOTH sides; `sign_ready` flips once
// each side has observed enough commitments from the other. Budget
// matches the pattern in `policy-denial-allow-once-retry.spec.ts`
// where a naturally-converged 2-of-3 keyset reliably reaches
// `sign_ready = true` inside ~30 s, with 120 s reserved for worst-
// case CI contention.
const SIGN_READY_TIMEOUT_MS = 120_000;
// Budget for the per-page "peer is observably online" wait. Once
// `sign_ready` is true the ping/pong loop is typically already at the
// first stable round; this bound is the ceiling for B to observe A's
// first `last_seen > 0` tick on the refresh cadence.
const PEERS_ONLINE_TIMEOUT_MS = 60_000;
// Budget for ONE sign attempt to either complete or fail. Over local
// loopback a successful round-trip resolves in 1-3 s; when the sign
// pipeline hits a stale `remote_scoped_policies[peer]` view the op
// times out after ~15 s with `"locked peer response timeout"`. The
// outer retry loop treats either outcome as "runtime made progress"
// and re-dispatches with a fresh message until it sees a completion.
const SIGN_ATTEMPT_TIMEOUT_MS = 30_000;
// Overall budget for one churn round — dispatch + churn + as many
// sign retries as needed — bounded so a real regression (e.g. pump
// updateRelays tearing down the real subscription) surfaces as a
// failure rather than an infinite hang.
const CHURN_ROUND_TIMEOUT_MS = 120_000;

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

test.describe(
  "multi-device relay churn mid-sign (VAL-CROSS-005)",
  () => {
    test.skip(
      () => !cargoAvailable(),
      "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
        "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
        "(https://rustup.rs) or run in an environment with cargo to unskip.",
    );

    // Seeding + two measured churn runs fits well under 4 minutes even
    // on heavily-loaded CI; the budget guards against a worst-case
    // sign_ready stall that the SIGN_READY_TIMEOUT_MS poller would
    // already fail-fast on.
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

    test(
      "relay list add/remove mid-sign preserves untouched sockets and the sign completes",
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
                    __iglooTestCreatePeerNonces?: unknown;
                    __iglooTestUpdateRelays?: unknown;
                    __debug?: unknown;
                  };
                  return (
                    typeof w.__appState === "object" &&
                    typeof w.__iglooTestSeedRuntime === "function" &&
                    typeof w.__iglooTestCreateKeysetBundle === "function" &&
                    typeof w.__iglooTestMemberPubkey32 === "function" &&
                    typeof w.__iglooTestCreatePeerNonces === "function" &&
                    typeof w.__iglooTestUpdateRelays === "function" &&
                    typeof w.__debug === "object"
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
          await waitForHooks(pageA, "A");
          await waitForHooks(pageB, "B");

          // Mint a shared 2-of-3 keyset. Threshold=2 means A + B alone
          // satisfy the signing quorum, so the sign round-trip does not
          // depend on the third share being seeded anywhere.
          const keyset: SpecKeyset = await pageA.evaluate(async () => {
            const w = window as unknown as {
              __iglooTestCreateKeysetBundle: (params: {
                groupName: string;
                threshold: number;
                count: number;
              }) => Promise<SpecKeyset>;
            };
            return w.__iglooTestCreateKeysetBundle({
              groupName: "Relay Churn E2E",
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

          // Each page seeds its runtime with BOTH the real relay and
          // the decoy URL. The decoy never connects (ECONNREFUSED on
          // ws://127.0.0.1:18194) so it sits in `offline`; the pump's
          // add/remove diff still treats it as a bona-fide entry in
          // `this.connections`, which is exactly what we need to
          // exercise — removing the decoy must not touch the real
          // relay's socket or subscription.
          //
          // We deliberately seed WITHOUT `initial_peer_nonces`. The
          // sign round-trip depends not just on the local nonce pool
          // but also on each peer's `remote_scoped_policies[peer]`
          // view, which only gets populated via the natural ping/pong
          // convergence. Pattern matches
          // `policy-denial-allow-once-retry.spec.ts` which requires the
          // same behavior to land a successful sign across the policy
          // flip. Convergence takes 30-60 s over loopback; the budget
          // for `sign_ready` is set to 120 s to accommodate stressed
          // CI hosts.
          const seed = async (
            page: Page,
            share: SpecShare,
            deviceName: string,
            relays: string[],
          ) =>
            page.evaluate(
              async ({ group, share, relays, deviceName }) => {
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
                  relays,
                  deviceName,
                });
              },
              {
                group: keyset.group,
                share,
                relays,
                deviceName,
              },
            );
          await seed(pageA, shareA, "Alice", [RELAY_URL, DECOY_URL_A]);
          await seed(pageB, shareB, "Bob", [RELAY_URL, DECOY_URL_A]);

          // Wait for the REAL relay to reach `online` on both pages.
          // We deliberately do NOT wait on the decoy — it will remain
          // offline, which is fine and is part of what we want to diff
          // out below.
          const waitForRealRelayOnline = async (
            page: Page,
            label: string,
          ) =>
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
                  `Real relay ${RELAY_URL} never reached "online" on page ${label}: ${err}`,
                );
              });
          await Promise.all([
            waitForRealRelayOnline(pageA, "A"),
            waitForRealRelayOnline(pageB, "B"),
          ]);

          // Wait for natural ping/pong convergence: sign_ready flips
          // to true once each side has received enough advertised
          // commitments from the other via the 2.5 s refresh cadence.
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
                  `sign_ready never became true on page ${label} within ` +
                    `${SIGN_READY_TIMEOUT_MS}ms. (${err})`,
                );
              });
          await Promise.all([
            waitForSignReady(pageA, "A"),
            waitForSignReady(pageB, "B"),
          ]);

          // Additional gate: each side must observe its counterpart as
          // `online` with `last_seen > 0`. This proves the ping/pong
          // exchange has completed at least one full cycle in BOTH
          // directions — needed so `remote_scoped_policies[peer]`
          // reflects the live partner's policy profile and
          // `select_signing_peers` does not short-circuit on a stale
          // view (exactly the trap documented in
          // `policy-denial-allow-once-retry.spec.ts`).
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
                    `within ${PEERS_ONLINE_TIMEOUT_MS}ms — the ping/pong ` +
                    `round-trip did not converge. (${err})`,
                );
              });
          await Promise.all([
            waitForPeerOnline(pageA, peerBPubkey32, "A"),
            waitForPeerOnline(pageB, peerAPubkey32, "B"),
          ]);

          // ----------------------------------------------------------
          // Helper: run one churn-mid-sign round.
          //
          // `signer` dispatches the sign; `churner` hot-reloads its
          // relay list via `__iglooTestUpdateRelays`. Returns the
          // observed Sign completion's `request_id` for the caller's
          // sanity assertions, plus the pre- and post-run counts of
          // "open" events in the churner's relayHistory for the real
          // relay URL (the central duplicate-subscription invariant).
          // ----------------------------------------------------------
          // Small helper: produce a fresh 32-byte message hex so every
          // sign dispatch within a run (first attempt + any retries)
          // has a distinct `message_hex_32` — a stale retry using the
          // same message could trip WASM runtime de-dup logic and
          // never register a new pending op.
          let messageCounter = 0;
          const nextMessageHex = (): string => {
            messageCounter += 1;
            const seed = Date.now().toString(16).padStart(12, "0");
            return (
              seed.repeat(6).slice(0, 62) +
              messageCounter.toString(16).padStart(2, "0")
            ).slice(0, 64);
          };

          const runChurnScenario = async (options: {
            signer: Page;
            signerLabel: string;
            churner: Page;
            churnerLabel: string;
            nextRelays: string[];
          }): Promise<{ requestId: string; realOpenCount: number }> => {
            // Snapshot churner's relayHistory opens for the real URL
            // and reconnectCount BEFORE churn so we can later prove
            // both invariants held across the whole run.
            const churnerBaseline = await options.churner.evaluate(
              (url: string) => {
                const w = window as unknown as {
                  __debug?: {
                    relayHistory: Array<{
                      type: string;
                      url: string;
                    }>;
                  };
                  __appState?: {
                    runtimeRelays?: Array<{
                      url: string;
                      reconnectCount?: number;
                    }>;
                  };
                };
                const history = w.__debug?.relayHistory ?? [];
                const opens = history.filter(
                  (entry) =>
                    entry.type === "open" && entry.url === url,
                ).length;
                const relay = (w.__appState?.runtimeRelays ?? []).find(
                  (entry) => entry.url === url,
                );
                return {
                  realOpenCount: opens,
                  realReconnectCount: relay?.reconnectCount ?? 0,
                };
              },
              RELAY_URL,
            );
            // Baseline invariant: the real relay has connected exactly
            // once (one `open` entry) and has not yet reconnected.
            expect(
              churnerBaseline.realOpenCount,
              `${options.churnerLabel} baseline: real relay should have ` +
                `exactly one "open" entry before churn`,
            ).toBe(1);
            expect(
              churnerBaseline.realReconnectCount,
              `${options.churnerLabel} baseline: real relay ` +
                `reconnectCount should be 0 before churn`,
            ).toBe(0);

            // Helper: dispatch ONE sign attempt and wait for either
            // completion OR failure. Returns `{ requestId, outcome }`
            // so the outer loop can decide whether to retry on
            // failure. We do NOT throw on failure — bifrost-signer's
            // `select_signing_peers` can short-circuit on a stale
            // `remote_scoped_policies` view and produce a
            // `"locked peer response timeout"` even when the runtime
            // and relay are otherwise healthy, exactly as documented
            // in `policy-denial-allow-once-retry.spec.ts`. The retry
            // path asks A to `refresh_all_peers` between attempts so
            // B's remote view re-syncs.
            const attemptOneSign = async (
              messageHex: string,
            ): Promise<{
              requestId: string;
              outcome: "completed" | "failed" | "timeout";
              failureReason?: string;
            }> => {
              const dispatch = await options.signer.evaluate(
                async (msg: string) => {
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
                },
                messageHex,
              );
              expect(dispatch.debounced).toBe(false);

              let requestId: string | null = dispatch.requestId;
              if (!requestId) {
                requestId = await options.signer
                  .waitForFunction(
                    (msg: string) => {
                      const w = window as unknown as {
                        __appState?: {
                          runtimeStatus?: {
                            pending_operations?: Array<{
                              op_type?: string;
                              request_id?: string;
                              message_hex_32?: string;
                            }>;
                          };
                          signDispatchLog?: Record<string, string>;
                        };
                      };
                      const pending =
                        w.__appState?.runtimeStatus?.pending_operations ??
                        [];
                      const match = pending.find(
                        (op) =>
                          typeof op.op_type === "string" &&
                          op.op_type.toLowerCase() === "sign" &&
                          typeof op.request_id === "string",
                      );
                      if (match?.request_id) return match.request_id;
                      const log = w.__appState?.signDispatchLog ?? {};
                      for (const [rid, m] of Object.entries(log)) {
                        if (m === msg) return rid;
                      }
                      return null;
                    },
                    messageHex,
                    { timeout: 5_000, polling: 50 },
                  )
                  .then((h) => h.jsonValue() as Promise<string>);
              }
              expect(requestId).toBeTruthy();
              const rid: string = requestId as string;

              // Poll for completion OR failure. Uses
              // SIGN_ATTEMPT_TIMEOUT_MS as the per-attempt budget —
              // the runtime's own locked-peer TTL is ~15 s, so a
              // failing attempt surfaces well within this window.
              const outcomeRaw = await options.signer
                .waitForFunction(
                  (id: string) => {
                    const w = window as unknown as {
                      __appState?: {
                        runtimeCompletions?: Array<
                          Record<string, unknown>
                        >;
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
                  rid,
                  {
                    timeout: SIGN_ATTEMPT_TIMEOUT_MS,
                    polling: 150,
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
                return { requestId: rid, outcome: "completed" };
              }
              if (outcomeRaw.kind === "failed") {
                return {
                  requestId: rid,
                  outcome: "failed",
                  failureReason: outcomeRaw.reason,
                };
              }
              return { requestId: rid, outcome: "timeout" };
            };

            // First attempt: dispatch WITH the churn happening
            // concurrently. This is the canonical "mid-sign churn"
            // assertion — the pump must not break the running sign's
            // subscription on the real relay.
            const firstMessage = nextMessageHex();
            const firstAttemptPromise = attemptOneSign(firstMessage);
            // Fire churn immediately after dispatch so the pump's
            // add/remove diff runs while REQ traffic may still be in
            // flight. updateRelays resolves once newly-added sockets
            // are opened and removed sockets closed cleanly;
            // untouched sockets are untouched synchronously.
            const churnPromise = options.churner.evaluate(
              async (nextRelays: string[]) => {
                const w = window as unknown as {
                  __iglooTestUpdateRelays: (
                    nextRelays: string[],
                  ) => Promise<void>;
                };
                await w.__iglooTestUpdateRelays(nextRelays);
              },
              options.nextRelays,
            );
            const [firstAttempt] = await Promise.all([
              firstAttemptPromise,
              churnPromise,
            ]);

            let successfulRequestId: string | null =
              firstAttempt.outcome === "completed"
                ? firstAttempt.requestId
                : null;
            const attempts: Array<{
              requestId: string;
              outcome: string;
              reason?: string;
            }> = [
              {
                requestId: firstAttempt.requestId,
                outcome: firstAttempt.outcome,
                reason: firstAttempt.failureReason,
              },
            ];

            // Retry loop: if the first attempt didn't complete, drive
            // `refresh_all_peers` on the churner (which re-broadcasts
            // its current policy profile to the signer, refreshing
            // the signer's `remote_scoped_policies`) and dispatch a
            // new sign with a distinct message. Bounded by
            // `CHURN_ROUND_TIMEOUT_MS` so a genuine regression (e.g.
            // updateRelays tore down the real subscription) surfaces
            // as a failure instead of an infinite retry.
            const roundDeadline = Date.now() + CHURN_ROUND_TIMEOUT_MS;
            while (
              !successfulRequestId &&
              Date.now() < roundDeadline &&
              attempts.length < 5
            ) {
              await options.churner.evaluate(async () => {
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
              // Give the ping round-trip a moment to land on the
              // signer's side before retrying.
              await options.signer.waitForTimeout(1_500);
              const retryAttempt = await attemptOneSign(nextMessageHex());
              attempts.push({
                requestId: retryAttempt.requestId,
                outcome: retryAttempt.outcome,
                reason: retryAttempt.failureReason,
              });
              if (retryAttempt.outcome === "completed") {
                successfulRequestId = retryAttempt.requestId;
                break;
              }
            }

            if (!successfulRequestId) {
              throw new Error(
                `No sign attempt completed successfully within ` +
                  `${CHURN_ROUND_TIMEOUT_MS}ms on ${options.signerLabel}; ` +
                  `attempts=${JSON.stringify(attempts, null, 2)}`,
              );
            }
            const resolvedRequestId: string = successfulRequestId;

            // Pull the churner's final real-relay metrics so the test
            // can assert the invariants.
            const churnerFinal = await options.churner.evaluate(
              (url: string) => {
                const w = window as unknown as {
                  __debug?: {
                    relayHistory: Array<{
                      type: string;
                      url: string;
                    }>;
                  };
                  __appState?: {
                    runtimeRelays?: Array<{
                      url: string;
                      reconnectCount?: number;
                    }>;
                  };
                };
                const history = w.__debug?.relayHistory ?? [];
                const opens = history.filter(
                  (entry) =>
                    entry.type === "open" && entry.url === url,
                ).length;
                const relay = (w.__appState?.runtimeRelays ?? []).find(
                  (entry) => entry.url === url,
                );
                return {
                  realOpenCount: opens,
                  realReconnectCount: relay?.reconnectCount ?? 0,
                };
              },
              RELAY_URL,
            );
            // INVARIANT 1: the churn must NOT have re-opened the real
            // relay's socket. Pump.updateRelays only touches the
            // add/remove delta — untouched URLs keep their existing
            // subscription and therefore their single `open` entry.
            expect(
              churnerFinal.realOpenCount,
              `${options.churnerLabel}: churn must not add a new "open" ` +
                `entry for the untouched real relay (baseline=` +
                `${churnerBaseline.realOpenCount}, ` +
                `final=${churnerFinal.realOpenCount})`,
            ).toBe(1);
            // INVARIANT 2: reconnectCount for the real relay must
            // stay at 0 for the same reason — updateRelays does not
            // tear down the existing connection.
            expect(
              churnerFinal.realReconnectCount,
              `${options.churnerLabel}: real relay reconnectCount must ` +
                `remain 0 across churn (was ${churnerBaseline.realReconnectCount}, ` +
                `now ${churnerFinal.realReconnectCount})`,
            ).toBe(0);

            return {
              requestId: resolvedRequestId,
              realOpenCount: churnerFinal.realOpenCount,
            };
          };

          // --------------------------------------------------------
          // Round 1: B signs; A removes the decoy from its relay list.
          // --------------------------------------------------------
          const round1 = await runChurnScenario({
            signer: pageB,
            signerLabel: "B",
            churner: pageA,
            churnerLabel: "A",
            nextRelays: [RELAY_URL],
          });
          expect(round1.requestId).toMatch(/^[0-9a-f-]{8,}$/);

          // --------------------------------------------------------
          // Round 2 (symmetry): A signs; B adds a second decoy to
          // its relay list. The pump must open the new decoy (which
          // fails quickly with ECONNREFUSED) without tearing down
          // the real relay's subscription.
          // --------------------------------------------------------
          const round2 = await runChurnScenario({
            signer: pageA,
            signerLabel: "A",
            churner: pageB,
            churnerLabel: "B",
            nextRelays: [RELAY_URL, DECOY_URL_A, DECOY_URL_B],
          });
          expect(round2.requestId).toMatch(/^[0-9a-f-]{8,}$/);
          expect(round2.requestId).not.toBe(round1.requestId);

          // Final belt-and-braces snapshot across both pages: the
          // real relay must have exactly ONE `open` entry on each
          // page's relayHistory for the entire test run, proving
          // the pump never tore it down during either round of
          // churn.
          const finalOpens = await Promise.all([
            pageA.evaluate((url: string) => {
              const w = window as unknown as {
                __debug?: {
                  relayHistory: Array<{ type: string; url: string }>;
                };
              };
              return (w.__debug?.relayHistory ?? []).filter(
                (entry) =>
                  entry.type === "open" && entry.url === url,
              ).length;
            }, RELAY_URL),
            pageB.evaluate((url: string) => {
              const w = window as unknown as {
                __debug?: {
                  relayHistory: Array<{ type: string; url: string }>;
                };
              };
              return (w.__debug?.relayHistory ?? []).filter(
                (entry) =>
                  entry.type === "open" && entry.url === url,
              ).length;
            }, RELAY_URL),
          ]);
          expect(
            finalOpens[0],
            "page A must have exactly one real-relay open across both churn rounds",
          ).toBe(1);
          expect(
            finalOpens[1],
            "page B must have exactly one real-relay open across both churn rounds",
          ).toBe(1);
        } finally {
          await ctxA.close().catch(() => undefined);
          await ctxB.close().catch(() => undefined);
        }
      },
    );
  },
);
