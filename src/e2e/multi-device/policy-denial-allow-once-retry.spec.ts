import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device policy-denial → allow-once → retry-success end-to-end
 * for VAL-CROSS-003 (feature
 * `fix-m3-val-cross-003-allow-once-retry-success`).
 *
 * This is the sibling spec to `policy-denial-roundtrip.spec.ts`, which
 * covers the narrowed VAL-POLICIES-010 contract (denial alone, no
 * retry). This spec exercises the full VAL-CROSS-003 arc:
 *
 *   (1) A sets `respond.sign = deny` for B's x-only pubkey via
 *       `__appState.setPeerPolicyOverride`.
 *   (2) B dispatches `{ type: "sign", message_hex_32 }`.
 *   (3) B observes an `OperationFailure` whose `code`/`message` matches
 *       `/denied|policy/i` within 15 s of dispatch — the same bound as
 *       the denial-only round-trip.
 *   (4) [DEVIATION, see below] In the Paper UX A would now surface a
 *       PolicyPromptModal driven by a `peer_denied` `RuntimeEvent`;
 *       upstream bifrost-rs does NOT emit such an event (see
 *       `docs/runtime-deviations-from-paper.md` §
 *       "PolicyPromptModal — reactive denial surface via synthetic
 *       peer_denied events"). So we programmatically simulate the user
 *       choosing "Allow once" from the modal: we push a synthetic
 *       `PeerDeniedEvent` through `__appState.enqueuePeerDenial` and
 *       resolve it via `__appState.resolvePeerDenial(id, {action:
 *       "allow-once"})`. This is the SAME code path the modal's
 *       "Allow once" button drives (see
 *       `src/screens/DashboardScreen/modals/PolicyPromptModal.tsx` →
 *       `resolvePeerDenial`), so the assertions about `allow-once`
 *       semantics (runtime override flip + `sessionAllowOnceRef`
 *       tracking + `policyOverrides` slice `source:"session"`) are
 *       exactly those of the production button click.
 *   (5) We verify A's runtime `effective_policy.respond.sign` for peer
 *       B flipped to `true` post allow-once.
 *   (6) B retries the sign with a fresh message — observable as a
 *       distinct `request_id` from the first failed attempt.
 *   (7) B's `runtimeCompletions` surfaces a `Sign` entry keyed by the
 *       retry's `request_id` (the protocol-layer `sign_completed`
 *       signal) within `SIGN_COMPLETION_TIMEOUT_MS`.
 *   (8) We verify one-shot persistence semantics on A:
 *         (a) `policyOverrides` slice contains exactly one entry for
 *             `(peer=B, direction=respond, method=sign)` with
 *             `source: "session"` — proves the override WAS recorded at
 *             the AppState layer (so `sessionAllowOnceRef` is
 *             authoritative for the one-shot) but was NOT escalated to
 *             a persistent profile write. `source: "persistent"` would
 *             indicate a profile persistence leak.
 *         (b) `policyOverrides` contains NO persistent entry for this
 *             triple — re-asserting the invariant from (a) as a
 *             direct invariant on the persistence discriminator.
 *
 * NOTE on "A's persisted profile still shows respond.sign=deny":
 * the feature description requests asserting this directly against the
 * stored profile. The `__iglooTestSeedRuntime` bootstrap used by this
 * spec does NOT create an IndexedDB-backed profile (it boots a
 * `RuntimeClient` from a synthesised `RuntimeBootstrapInput`), so
 * there is no stored profile to read back. The equivalent AppState
 * invariant — "the override the runtime holds now did NOT go through
 * `persistPolicyOverrideToProfile`" — is captured by checking
 * `policyOverrides` source discriminator, which is the exact signal
 * the profile-persistence layer keys on (see the
 * `allow-once → source: "session"` → `allow-always → source:
 * "persistent"` dispatcher in `resolvePeerDenial` in
 * `AppStateProvider.tsx`). Worker session logged this limitation in
 * its handoff.
 *
 * To run manually:
 *   1. bash .factory/init.sh                    # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/policy-denial-allow-once-retry.spec.ts \
 *        --project=desktop --workers 1 --repeat-each=3
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
// VAL-CROSS-003 requires a FULL FROST sign round-trip on the retry,
// which in turn requires A's outgoing nonce pool toward B to hold the
// secrets matching the commitments B uses in its sign session. The
// only protocol path that populates A's outgoing pool in lock-step
// with B's incoming pool is the natural ping/pong handshake (ping
// advertises fresh `outgoing` commitments via
// `advertised_nonces_for_peer`). `__iglooTestSeedRuntime({initial_peer_nonces})`
// ONLY seeds the receiving side's `incoming` pool — A never learns the
// corresponding secrets and would fail the retry with
// `NonceUnavailable` when attempting `take_outgoing_signing_nonces_many`.
// Therefore this spec intentionally does NOT use `initial_peer_nonces`
// and instead lets the 2.5 s refresh cadence drive natural sign_ready
// convergence on both pages. The tradeoff is a longer warmup window —
// the existing `policy-denial-roundtrip.spec.ts` test documents 30–90 s
// typical convergence on a healthy loopback, so the ceiling here is
// padded accordingly.
const SIGN_READY_TIMEOUT_MS = 120_000;
// Peer discovery via natural ping/pong — waits for A to observe B as
// `online` and vice versa. Without at least one ping round the
// signer's `select_signing_peers` can pick the wrong peer.
const PEERS_ONLINE_TIMEOUT_MS = 60_000;
// VAL-POLICIES-010 — same strict 15 s bound as
// `policy-denial-roundtrip.spec.ts`.
const SIGN_FAILURE_TIMEOUT_MS = 15_000;
// Post-allow-once retry completion — generous window. Convergence
// requires: (a) A's next 2.5 s refresh tick broadcasting its updated
// `respond.sign=allow` profile, (b) B ingesting the ping and updating
// its `remote_scoped_policies[A]`, (c) B's retry dispatch, (d) A's
// acceptance, partial sig, and return envelope to B. Empirically the
// end-to-end path fits in under 30 s on a healthy loopback; the 90 s
// ceiling leaves ample headroom for CPU-loaded CI hosts.
const SIGN_COMPLETION_TIMEOUT_MS = 90_000;

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

test.describe("multi-device denial → allow-once → retry-success (VAL-CROSS-003)", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  // Budget: 15 s deny + ~5 s policy propagation + ~30 s sign
  // round-trip + prep/setup time. Padded to 5 minutes for stressed CI
  // hosts and `--repeat-each=3` headroom per-test.
  test.setTimeout(300_000);

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
    "A.respond.sign=deny → B deny → A allow-once → B retry → B sign_completed; allow-once did not persist",
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
                `Dev-only test hooks never attached on page ${label}. (${err})`,
              );
            });
        await waitForHooks(pageA, "A");
        await waitForHooks(pageB, "B");

        // Produce a 2-of-3 keyset on A (shares distributed below).
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
            groupName: "Allow Once Retry E2E",
            threshold: 2,
            count: 3,
          });
        });
        expect(keyset.shares.length).toBeGreaterThanOrEqual(2);
        const shareA = keyset.shares[0];
        const shareB = keyset.shares[1];
        expect(shareA.idx).not.toBe(shareB.idx);

        // Derive 32-byte x-only peer pubkeys up-front (derivable from
        // group metadata alone; no runtime required on either page).
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

        // Seed each runtime WITHOUT `initial_peer_nonces` — see the
        // `SIGN_READY_TIMEOUT_MS` comment for why natural convergence
        // is required by this spec. Both runtimes will exchange pings
        // on the 2.5 s refresh cadence and populate their outgoing /
        // incoming nonce pools in lock-step; `sign_ready` flips when
        // each side has received enough advertised commitments from
        // the other.
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
                  (entry) => entry.url === url && entry.state === "online",
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
              { timeout: SIGN_READY_TIMEOUT_MS, polling: 100 },
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
        ]);

        // Wait for each page to observe its counterpart as `online` in
        // `runtime_status.peers` — proves the underlying ping/pong
        // exchange has completed at least one successful round and
        // that both runtimes have populated their outgoing / incoming
        // nonce pools from the other side's advertised commitments,
        // which is required for the retry sign round-trip to succeed.
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
              { timeout: PEERS_ONLINE_TIMEOUT_MS, polling: 200 },
            )
            .catch((err) => {
              throw new Error(
                `Peer ${peerHex} never became online on page ${label} ` +
                  `within ${PEERS_ONLINE_TIMEOUT_MS}ms — the underlying ` +
                  `ping/pong round-trip did not converge. (${err})`,
              );
            });
        await Promise.all([
          waitForPeerOnline(pageA, peerBPubkey32, "A"),
          waitForPeerOnline(pageB, peerAPubkey32, "B"),
        ]);

        // === Step 1: A installs `respond.sign = deny` for peer B ===
        await pageA.evaluate(async (peerBHex: string) => {
          const w = window as unknown as {
            __appState: {
              setPeerPolicyOverride: (input: {
                peer: string;
                direction: "request" | "respond";
                method: "sign" | "ecdh" | "ping" | "onboard";
                value: "unset" | "allow" | "deny";
              }) => Promise<void>;
            };
          };
          await w.__appState.setPeerPolicyOverride({
            peer: peerBHex,
            direction: "respond",
            method: "sign",
            value: "deny",
          });
        }, peerBPubkey32);

        // === Step 2: B dispatches sign — SAME timing invariants as
        // policy-denial-roundtrip: dispatch immediately, do NOT wait on
        // A's runtimeStatus to re-surface the override (the 2.5 s poll
        // tick would race against A's broadcast of the new policy to
        // B's remote_scoped_policies and cause B to short-circuit with
        // "nonce unavailable" rather than reaching A's peer_denied
        // path).
        const failedMessageHex = "a".repeat(64);
        const dispatchStart = Date.now();
        const dispatchB = await pageB.evaluate(async (msg: string) => {
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
        }, failedMessageHex);
        expect(dispatchB.debounced).toBe(false);
        const remainingBudget = (): number =>
          SIGN_FAILURE_TIMEOUT_MS - (Date.now() - dispatchStart);

        let failedSignRequestId: string | null = dispatchB.requestId;
        if (!failedSignRequestId) {
          const discoveryBudget = remainingBudget();
          if (discoveryBudget <= 0) {
            throw new Error(
              `request_id discovery exceeded VAL-POLICIES-010 budget.`,
            );
          }
          failedSignRequestId = await pageB
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
                    op.op_type.toLowerCase() === "sign",
                );
                if (signPending?.request_id) return signPending.request_id;
                const failures = w.__appState?.runtimeFailures ?? [];
                const signFailure = failures.find(
                  (f) =>
                    typeof f.op_type === "string" &&
                    f.op_type.toLowerCase() === "sign",
                );
                return signFailure?.request_id ?? null;
              },
              undefined,
              { timeout: discoveryBudget, polling: 100 },
            )
            .then((handle) => handle.jsonValue() as Promise<string>);
        }
        expect(failedSignRequestId).toBeTruthy();
        const failedSignRequestIdStr: string = failedSignRequestId!;

        // === Step 3: B observes OperationFailure matching /denied|policy/
        // within the strict VAL-POLICIES-010 15 s bound (measured from
        // dispatch, shared with request_id discovery above).
        const failureBudget = remainingBudget();
        if (failureBudget <= 0) {
          throw new Error(
            `VAL-POLICIES-010 15 s bound exhausted before failure wait.`,
          );
        }
        await pageB.waitForFunction(
          (rid: string) => {
            const w = window as unknown as {
              __appState?: {
                runtimeFailures?: Array<{
                  request_id?: string;
                  message?: string;
                  code?: string;
                }>;
              };
            };
            const failures = w.__appState?.runtimeFailures ?? [];
            return failures.some((entry) => {
              if (entry.request_id !== rid) return false;
              const text = `${entry.code ?? ""} ${entry.message ?? ""}`;
              return /denied|policy/i.test(text);
            });
          },
          failedSignRequestIdStr,
          { timeout: failureBudget, polling: 100 },
        );

        // === Step 4: [DEVIATION] Upstream bifrost-rs does NOT emit a
        // `peer_denied` RuntimeEvent, so A's PolicyPromptModal does not
        // auto-open from the denial. Per the feature description, we
        // assert the denial was recorded via B's event log (the
        // `runtimeFailures` entry observed in step 3 — already asserted
        // above), then programmatically simulate the "Allow once"
        // button click by pushing a synthetic `PeerDeniedEvent` through
        // A's `enqueuePeerDenial` and resolving via `resolvePeerDenial`
        // with `{action:"allow-once"}`. This drives the SAME
        // `resolvePeerDenial` code path the modal's button would —
        // meaning `sessionAllowOnceRef.current.add(overrideKey)` and
        // `policyOverrides` slice upsert with `source:"session"`
        // execute verbatim (VAL-APPROVALS-009).
        // `enqueuePeerDenial` uses React state + a mirror ref updated via
        // a `useEffect`, so the ref observed by `resolvePeerDenial`
        // (`peerDenialQueueRef`) only catches up AFTER the next render
        // commit — resolving in the same `page.evaluate` would therefore
        // hit the `!pending` no-op guard in `resolvePeerDenial` and skip
        // the allow-once runtime mutation entirely. Split into two
        // evaluations and wait for the queue entry to become visible on
        // the `__appState` snapshot so we exercise the production code
        // path verbatim.
        const denialId = `test-denial-${Date.now()}`;
        await pageA.evaluate(
          ({ denialId, peerBHex }) => {
            const w = window as unknown as {
              __appState: {
                enqueuePeerDenial: (event: {
                  id: string;
                  peer_pubkey: string;
                  verb: "sign" | "ecdh" | "ping" | "onboard";
                  denied_at: number;
                }) => void;
              };
            };
            w.__appState.enqueuePeerDenial({
              id: denialId,
              peer_pubkey: peerBHex,
              verb: "sign",
              denied_at: Date.now(),
            });
          },
          { denialId, peerBHex: peerBPubkey32 },
        );
        await pageA.waitForFunction(
          (id: string) => {
            const w = window as unknown as {
              __appState?: {
                peerDenialQueue?: Array<{ id?: string }>;
              };
            };
            const queue = w.__appState?.peerDenialQueue ?? [];
            return queue.some((entry) => entry.id === id);
          },
          denialId,
          { timeout: 5_000, polling: 50 },
        );
        await pageA.evaluate(async (denialId: string) => {
          const w = window as unknown as {
            __appState: {
              resolvePeerDenial: (
                id: string,
                decision: { action: "allow-once" },
              ) => Promise<void>;
            };
          };
          await w.__appState.resolvePeerDenial(denialId, {
            action: "allow-once",
          });
        }, denialId);

        // Force A to broadcast its updated profile (now respond.sign=allow
        // for B) to all peers via `refresh_all_peers`. Without this, B's
        // `remote_scoped_policies[A]` still holds the stale `respond.sign
        // = deny` view from the denial round — and B's
        // `select_signing_peers` logic ANDs its local nonce gate with
        // that remote view, filtering A out of the candidate set before
        // ever putting the sign_request on the wire. The retry would
        // then time out with "locked peer response timeout" even though
        // A's runtime is now willing to sign. `refresh_all_peers`
        // fan-outs pings that re-advertise A's current
        // `PeerScopedPolicyProfile`, which B ingests into
        // `remote_scoped_policies[A]`. We then wait for B's
        // `runtime_status.peers[A].last_seen` to advance past a
        // pre-refresh baseline — observable evidence B has ingested a
        // fresh ping from A (which carries the new policy profile) on
        // the wire, not just from cache. This bridges the async gap
        // between A's broadcast and B's remote-view update without a
        // brittle `setTimeout`.
        const bPeerALastSeenBaseline = await pageB.evaluate(
          (peerAHex: string) => {
            const w = window as unknown as {
              __appState?: {
                runtimeStatus?: {
                  peers?: Array<{
                    pubkey: string;
                    last_seen: number | null;
                  }>;
                };
              };
            };
            const peers = w.__appState?.runtimeStatus?.peers ?? [];
            const match = peers.find((p) => p.pubkey === peerAHex);
            return match?.last_seen ?? 0;
          },
          peerAPubkey32,
        );
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
        await pageB
          .waitForFunction(
            ({ peerAHex, baseline }) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeStatus?: {
                    peers?: Array<{
                      pubkey: string;
                      last_seen: number | null;
                    }>;
                  };
                };
              };
              const peers = w.__appState?.runtimeStatus?.peers ?? [];
              const match = peers.find((p) => p.pubkey === peerAHex);
              const seen = match?.last_seen ?? 0;
              return seen > baseline;
            },
            { peerAHex: peerAPubkey32, baseline: bPeerALastSeenBaseline },
            { timeout: 30_000, polling: 200 },
          )
          .catch((err) => {
            throw new Error(
              `B never observed a fresh ping from A after A's ` +
                `refresh_all_peers (baseline=${bPeerALastSeenBaseline}): ${err}`,
            );
          });

        // === Step 5: Verify A's runtime `effective_policy.respond.sign`
        // for peer B flipped to true (allow). `resolvePeerDenial` calls
        // `runtime.setPolicyOverride(..., value:"allow")` synchronously,
        // so the underlying WASM state is updated immediately; this
        // wait just bridges the JS `runtimeStatus` snapshot catching up
        // on its next 2.5 s poll.
        await pageA.waitForFunction(
          (peerBHex: string) => {
            const w = window as unknown as {
              __appState?: {
                runtimeStatus?: {
                  peer_permission_states?: Array<
                    Record<string, unknown>
                  >;
                };
              };
            };
            const rows =
              w.__appState?.runtimeStatus?.peer_permission_states ?? [];
            return rows.some((row) => {
              const pub =
                (row.peer_pubkey as string | undefined) ??
                (row.peer as string | undefined) ??
                (row.pubkey as string | undefined);
              const effective = row.effective_policy as
                | { respond?: { sign?: boolean } }
                | undefined;
              return (
                typeof pub === "string" &&
                pub === peerBHex &&
                effective?.respond?.sign === true
              );
            });
          },
          peerBPubkey32,
          { timeout: 15_000, polling: 200 },
        );

        // === Step 6 + 7: B retries the sign — but because B's view of
        // A's policy (`remote_scoped_policies[A].respond.sign`) only
        // updates when A's next ping/pong cycle reaches B carrying the
        // new profile, the first retry attempt can still observe the
        // stale `deny` and short-circuit to timeout. Dispatch a retry,
        // wait on B's `runtimeCompletions` for a matching Sign entry OR
        // on `runtimeFailures` for a timeout; if the attempt fails,
        // drive another `refresh_all_peers` round on A and dispatch
        // again. Bounded by the overall `SIGN_COMPLETION_TIMEOUT_MS`
        // budget so a real regression still surfaces as a failure.
        const retryDeadline = Date.now() + SIGN_COMPLETION_TIMEOUT_MS;
        const attemptedRequestIds: string[] = [];
        let successfulRetryRequestId: string | null = null;
        let successfulSignatures: string[] | null = null;
        let retryIndex = 0;
        // Use distinct messages so each attempt is observably distinct
        // from its predecessors AND from the failed-deny dispatch
        // (which used "a".repeat(64)).
        const retryMessages = [
          "b".repeat(64),
          "c".repeat(64),
          "d".repeat(64),
          "e".repeat(64),
          "f".repeat(64),
        ];
        while (
          Date.now() < retryDeadline &&
          retryIndex < retryMessages.length
        ) {
          const retryMsg = retryMessages[retryIndex];
          retryIndex += 1;
          const dispatch = await pageB.evaluate(async (msg: string) => {
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
          }, retryMsg);
          expect(dispatch.debounced).toBe(false);

          let thisRequestId: string | null = dispatch.requestId;
          if (!thisRequestId) {
            thisRequestId = await pageB
              .waitForFunction(
                (prior: string[]) => {
                  const w = window as unknown as {
                    __appState?: {
                      runtimeStatus?: {
                        pending_operations?: Array<{
                          op_type?: string;
                          request_id?: string;
                        }>;
                      };
                      runtimeCompletions?: Array<Record<string, unknown>>;
                      runtimeFailures?: Array<{
                        op_type?: string;
                        request_id?: string;
                      }>;
                    };
                  };
                  const knownIds = new Set(prior);
                  const pending =
                    w.__appState?.runtimeStatus?.pending_operations ?? [];
                  const signPending = pending.find(
                    (op) =>
                      typeof op.op_type === "string" &&
                      op.op_type.toLowerCase() === "sign" &&
                      typeof op.request_id === "string" &&
                      !knownIds.has(op.request_id),
                  );
                  if (signPending?.request_id) return signPending.request_id;
                  const completions = w.__appState?.runtimeCompletions ?? [];
                  for (const entry of completions) {
                    const sign = (
                      entry as { Sign?: { request_id?: string } }
                    ).Sign;
                    if (sign?.request_id && !knownIds.has(sign.request_id)) {
                      return sign.request_id;
                    }
                  }
                  return null;
                },
                [failedSignRequestIdStr, ...attemptedRequestIds],
                { timeout: 10_000, polling: 100 },
              )
              .then((handle) => handle.jsonValue() as Promise<string>);
          }
          expect(thisRequestId).toBeTruthy();
          expect(thisRequestId).not.toBe(failedSignRequestIdStr);
          for (const known of attemptedRequestIds) {
            expect(thisRequestId).not.toBe(known);
          }
          const thisRequestIdStr: string = thisRequestId!;
          attemptedRequestIds.push(thisRequestIdStr);

          // Each sign's pending-op TTL is ~15 s (see `started_at`
          // / `timeout_at` fields); wait up to 30 s for EITHER
          // completion OR failure to leave headroom for
          // `drainFailures` to surface the TTL expiry on the next
          // refresh tick.
          const outcome = await pageB
            .waitForFunction(
              (rid: string) => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeCompletions?: Array<Record<string, unknown>>;
                    runtimeFailures?: Array<{
                      request_id?: string;
                      op_type?: string;
                    }>;
                  };
                };
                const completions = w.__appState?.runtimeCompletions ?? [];
                for (const entry of completions) {
                  const sign = (
                    entry as { Sign?: { request_id?: string } }
                  ).Sign;
                  if (sign?.request_id === rid) {
                    return { kind: "completed" as const };
                  }
                }
                const failures = w.__appState?.runtimeFailures ?? [];
                const failure = failures.find(
                  (f) =>
                    typeof f.op_type === "string" &&
                    f.op_type.toLowerCase() === "sign" &&
                    f.request_id === rid,
                );
                if (failure) {
                  return { kind: "failed" as const };
                }
                return null;
              },
              thisRequestIdStr,
              { timeout: 30_000, polling: 200 },
            )
            .catch(() => null);
          const outcomeKind = outcome
            ? ((await outcome.jsonValue()) as
                | { kind: "completed" }
                | { kind: "failed" }
                | null)
            : null;

          if (outcomeKind && outcomeKind.kind === "completed") {
            successfulRetryRequestId = thisRequestIdStr;
            successfulSignatures = await pageB.evaluate(
              (rid: string) => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeCompletions?: Array<Record<string, unknown>>;
                  };
                };
                const completions = w.__appState?.runtimeCompletions ?? [];
                const hit = completions.find((entry) => {
                  const sign = (
                    entry as { Sign?: { request_id?: string } }
                  ).Sign;
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
              },
              thisRequestIdStr,
            );
            break;
          }

          // Attempt failed (most likely "locked peer response timeout"
          // because B's `remote_scoped_policies[A]` still holds the
          // stale `deny`). Drive another `refresh_all_peers` on A to
          // re-broadcast the allow profile, bump B's `last_seen` for
          // A, and loop.
          if (Date.now() >= retryDeadline) break;
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
          // Short backoff before the next dispatch so the natural
          // 2.5 s refresh tick and the inline refresh_all_peers have a
          // chance to propagate A's new profile to B's view.
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }

        if (!successfulRetryRequestId || !successfulSignatures) {
          const diag = await pageB.evaluate(() => {
            const w = window as unknown as {
              __appState?: {
                runtimeFailures?: unknown;
                runtimeCompletions?: unknown;
                runtimeStatus?: unknown;
              };
            };
            return {
              runtimeFailures: w.__appState?.runtimeFailures,
              runtimeCompletions: w.__appState?.runtimeCompletions,
              runtimeStatus: w.__appState?.runtimeStatus,
            };
          });
          throw new Error(
            `B never observed a Sign completion across ${attemptedRequestIds.length} ` +
              `retry attempt(s) within ${SIGN_COMPLETION_TIMEOUT_MS}ms ` +
              `(attempted request_ids=${JSON.stringify(
                attemptedRequestIds,
              )}).\nB state:\n${JSON.stringify(diag, null, 2)}`,
          );
        }
        const retrySignatures: string[] | null = successfulSignatures;
        expect(retrySignatures).not.toBeNull();
        expect(Array.isArray(retrySignatures)).toBe(true);
        expect(retrySignatures!.length).toBeGreaterThan(0);
        for (const sig of retrySignatures!) {
          expect(sig).toMatch(/^[0-9a-f]{128}$/);
        }

        // === Step 8a: Verify A's `policyOverrides` slice records the
        // allow-once as `source:"session"` (NOT `source:"persistent"`).
        // This is the AppState-level fingerprint of the one-shot — the
        // dispatcher in `resolvePeerDenial` writes `source:"session"`
        // only for `allow-once` and `source:"persistent"` for
        // `allow-always` / `deny-always`. A persistent entry here would
        // indicate the one-shot leaked into profile persistence.
        const aPolicyOverrides = await pageA.evaluate(() => {
          const w = window as unknown as {
            __appState?: {
              policyOverrides?: Array<{
                peer: string;
                direction: string;
                method: string;
                value: string;
                source: string;
              }>;
            };
          };
          return w.__appState?.policyOverrides ?? [];
        });
        const matching = aPolicyOverrides.filter(
          (entry) =>
            entry.peer === peerBPubkey32 &&
            entry.direction === "respond" &&
            entry.method === "sign",
        );
        expect(
          matching.length,
          `A.policyOverrides should contain exactly one entry for ` +
            `(peer=${peerBPubkey32}, direction=respond, method=sign). ` +
            `Got: ${JSON.stringify(aPolicyOverrides)}`,
        ).toBe(1);
        expect(matching[0].value).toBe("allow");
        // Step 8a's one-shot persistence-discriminator check:
        expect(
          matching[0].source,
          `allow-once MUST record as source:"session" (not "persistent") ` +
            `— proof the one-shot did NOT escalate to profile persistence. ` +
            `Entry: ${JSON.stringify(matching[0])}`,
        ).toBe("session");

        // === Step 8b: Re-assert the persistence invariant as a direct
        // predicate on the list (in case a future `resolvePeerDenial`
        // refactor ever duplicates the entry with a persistent copy,
        // the single-entry check above might pass the wrong row).
        const anyPersistent = aPolicyOverrides.some(
          (entry) =>
            entry.peer === peerBPubkey32 &&
            entry.direction === "respond" &&
            entry.method === "sign" &&
            entry.source === "persistent",
        );
        expect(
          anyPersistent,
          `A.policyOverrides MUST NOT contain any persistent entry for ` +
            `(peer=B, direction=respond, method=sign) after an allow-once ` +
            `resolution. This would indicate allow-once leaked into the ` +
            `profile-persistence layer. Full slice: ` +
            `${JSON.stringify(aPolicyOverrides)}`,
        ).toBe(false);
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
      }
    },
  );
});
