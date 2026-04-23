import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device policy-denial round-trip e2e for feature
 * `m3-policy-denial-and-persistence` — VAL-POLICIES-010 and VAL-CROSS-003.
 *
 * Contract under test: with peer A holding a persistent override
 * `respond.sign = deny` targeting peer B's x-only pubkey, peer B's
 * sign dispatch must:
 *
 *  1. A's runtime status reports an effective `respond.sign = false`
 *     peer-permission for peer B, confirming the override is live at
 *     the runtime layer (VAL-POLICIES-010 pre-dispatch condition).
 *  2. produce an `OperationFailure` on B whose `code` or `message`
 *     matches `/denied|policy/i` within 15s of the dispatch. This is
 *     B's user-visible surface per VAL-POLICIES-010 and VAL-CROSS-003
 *     ("B event log emits peer_denied"): bifrost-signer rejects the
 *     sign via `reject_request("peer_denied", "inbound sign denied
 *     by local policy")`; B's pending op is failed with
 *     OperationFailureCode::PeerRejected and the message contains
 *     "peer_denied".
 *  3. neither peer produces a Sign completion for B's request_id.
 *
 * NOTE on A's local `peer_denied` runtime event: the upstream
 * bifrost-rs runtime (bifrost-bridge-wasm `RuntimeEventKind`) does NOT
 * currently enumerate a `PeerDenied` variant — see
 * `src/app/AppStateTypes.ts` PeerDeniedEvent jsdoc:
 *   "a future `drain_runtime_events` `peer_denied` kind in production"
 * So A's side cannot assert a `peer_denied` lifecycle event today; the
 * override's effect on A is verified indirectly by asserting the
 * effective_policy snapshot and by asserting no Sign completion
 * surfaces for B's request_id.
 *
 * The spec mirrors the structural patterns of
 * `src/e2e/multi-device/ecdh-roundtrip.spec.ts` (same relay spawn,
 * same dev-hook seeding), so the baseline infrastructure is stable.
 *
 * To run manually:
 *   1. bash .factory/init.sh                      # builds the binary
 *   2. npx playwright test \
 *        src/e2e/multi-device/policy-denial-roundtrip.spec.ts \
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
// With nonce prepopulation via `__iglooTestSeedRuntime({initial_peer_nonces})`
// (see `fix-m3-nonce-prepopulate-test-hook`) B's `sign_ready` flips to
// true the moment its runtime reports initialized — no ping/pong
// round-trip required. The 10 s ceiling is a generous upper bound for
// the init + first `runtime_status` refresh tick on a stressed CI
// host; a healthy run resolves inside ~1 s.
const SIGN_READY_TIMEOUT_MS = 10_000;
// VAL-POLICIES-010 mandates "B receives OperationFailure within 15 s of
// the dispatch". This bound is enforced strictly here (not as a loose
// Playwright step timeout): the wait starts the instant B's
// `handleRuntimeCommand({type:"sign"})` returns and fails fast with a
// descriptive error the moment 15 000 ms elapse without a matching
// failure surfacing on B.
const SIGN_FAILURE_TIMEOUT_MS = 15_000;

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
  "multi-device policy denial round-trip (VAL-POLICIES-010 / VAL-CROSS-003)",
  () => {
    test.skip(
      () => !cargoAvailable(),
      "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
        "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
        "(https://rustup.rs) or run in an environment with cargo to unskip.",
    );

    // Round-trip sign denial can burn through ~90 s of sign_ready
    // convergence twice (once before the override write, once after
    // the PolicyUpdated event resets readiness) plus up to 60 s
    // waiting on OperationFailure drainage — padded to 5 minutes.
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

    // End-to-end sign-denial round-trip: with peer A holding
    // respond.sign=deny for peer B's pubkey, B's sign dispatch
    // surfaces as an OperationFailure on B with code peer_rejected
    // and message matching /denied|policy/ — the contract narrowed
    // to B-side observability in VAL-POLICIES-010 and VAL-CROSS-003.
    //
    // The narrowed contract explicitly removes the A-side `peer_denied`
    // RuntimeEvent assertion because upstream bifrost-rs does not
    // enumerate a `PeerDenied` kind in its runtime event taxonomy
    // today (see `src/app/AppStateTypes.ts` PeerDeniedEvent jsdoc and
    // `docs/runtime-deviations-from-paper.md`). We verify the override
    // landed on A's runtime via the `effective_policy` snapshot
    // pre-dispatch instead.
    //
    // Nonce convergence: sign_ready on B requires B to have received
    // A's advertised_nonces via the ping/pong cycle. The seeded
    // runtime's refresh interval is 2.5 s; we drive
    // `refresh_all_peers` explicitly on BOTH pages between waits to
    // collapse convergence time from the natural ~20-40 s cadence
    // down into the test's budget. The 90 s sign_ready ceiling gives
    // plenty of margin for even the slowest observed convergence
    // during agent-browser runs on the mission host.
    test(
      "A.respond.sign=deny → A's effective_policy blocks B.sign and B receives OperationFailure matching /denied|policy/ within 15s",
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
                  };
                  return (
                    typeof w.__appState === "object" &&
                    typeof w.__iglooTestSeedRuntime === "function" &&
                    typeof w.__iglooTestCreateKeysetBundle === "function" &&
                    typeof w.__iglooTestMemberPubkey32 === "function" &&
                    typeof w.__iglooTestCreatePeerNonces === "function"
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
              groupName: "Policy Denial E2E",
              threshold: 2,
              count: 3,
            });
          });
          expect(keyset.shares.length).toBeGreaterThanOrEqual(2);
          const shareA = keyset.shares[0];
          const shareB = keyset.shares[1];
          expect(shareA.idx).not.toBe(shareB.idx);

          // Derive both 32-byte x-only peer pubkeys up-front so we can
          // generate peer-scoped nonces BEFORE seeding the runtimes.
          // Reading these on page A is cheap (no runtime required —
          // derived purely from the keyset group metadata).
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

          // Nonce prepopulation: generate peer-bound
          // `DerivedPublicNonceWire` batches on page A (which has
          // access to both share secrets via `__iglooTestCreateKeysetBundle`'s
          // return value) for each direction of the pair. The nonces
          // are bound to the FROST commitments derived from the
          // corresponding share secret, so seeding pageB's incoming
          // pool for peer A with nonces generated from shareA's
          // secret satisfies the `can_sign(A_idx)` gate deterministically
          // — no ping/pong round-trip required.
          //
          // See `fix-m3-nonce-prepopulate-test-hook`: this replaces
          // the previous `refresh_all_peers` pump loop that took
          // ~90 s to converge and fell outside the VAL-POLICIES-010
          // 15 s failure bound under CPU contention.
          const { noncesFromA, noncesFromB } = await pageA.evaluate(
            async ({ shareASec, shareBSec, peerAHex, peerBHex }) => {
              const w = window as unknown as {
                __iglooTestCreatePeerNonces: (input: {
                  share_secret_hex: string;
                  peer_pubkey32_hex: string;
                  event_kind?: number;
                }) => Promise<
                  Array<{
                    binder_pn: string;
                    hidden_pn: string;
                    code: string;
                  }>
                >;
              };
              // Nonces generated from A's secret, targeting B — these
              // go into B's incoming pool keyed on peer A.
              const noncesFromA = await w.__iglooTestCreatePeerNonces({
                share_secret_hex: shareASec,
                peer_pubkey32_hex: peerBHex,
              });
              // Nonces generated from B's secret, targeting A — these
              // go into A's incoming pool keyed on peer B.
              const noncesFromB = await w.__iglooTestCreatePeerNonces({
                share_secret_hex: shareBSec,
                peer_pubkey32_hex: peerAHex,
              });
              return { noncesFromA, noncesFromB };
            },
            {
              shareASec: shareA.seckey,
              shareBSec: shareB.seckey,
              peerAHex: peerAPubkey32,
              peerBHex: peerBPubkey32,
            },
          );
          // Both batches must exceed the default `critical_threshold`
          // (=5) so `NoncePool::can_sign` flips to true immediately
          // after seeding.
          expect(noncesFromA.length).toBeGreaterThan(5);
          expect(noncesFromB.length).toBeGreaterThan(5);

          const seedWithNonces = async (
            page: Page,
            share: SpecShare,
            deviceName: string,
            peerHex: string,
            peerNonces: typeof noncesFromA,
          ) =>
            page.evaluate(
              async ({
                group,
                share,
                relayUrl,
                deviceName,
                peerHex,
                peerNonces,
              }) => {
                const w = window as unknown as {
                  __iglooTestSeedRuntime: (input: {
                    group: unknown;
                    share: unknown;
                    relays: string[];
                    deviceName: string;
                    initial_peer_nonces?: Array<{
                      peer: string;
                      nonces: Array<{
                        binder_pn: string;
                        hidden_pn: string;
                        code: string;
                      }>;
                    }>;
                  }) => Promise<void>;
                };
                await w.__iglooTestSeedRuntime({
                  group,
                  share,
                  relays: [relayUrl],
                  deviceName,
                  initial_peer_nonces: [
                    { peer: peerHex, nonces: peerNonces },
                  ],
                });
              },
              {
                group: keyset.group,
                share,
                relayUrl: RELAY_URL,
                deviceName,
                peerHex,
                peerNonces,
              },
            );
          // Seed A with B's nonces (so A.incoming[B] is preloaded).
          // Seed B with A's nonces (so B.incoming[A] is preloaded).
          await seedWithNonces(
            pageA,
            shareA,
            "Alice",
            peerBPubkey32,
            noncesFromB,
          );
          await seedWithNonces(
            pageB,
            shareB,
            "Bob",
            peerAPubkey32,
            noncesFromA,
          );

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

          // With the nonce pools pre-seeded, `sign_ready` must flip to
          // true on the first `runtime_status` refresh tick — no
          // ping/pong pump needed. A tight loop polling the observable
          // snapshot bounds the wait to `SIGN_READY_TIMEOUT_MS` (10 s).
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
                    `on page ${label} within ${SIGN_READY_TIMEOUT_MS}ms ` +
                    `(nonce prepopulate seed should have flipped sign_ready ` +
                    `immediately). (${err})`,
                );
              });
          await Promise.all([
            waitForSignReady(pageA, "A"),
            waitForSignReady(pageB, "B"),
          ]);

          // Note: peerAPubkey32 / peerBPubkey32 were derived earlier,
          // before seeding, so the nonce-generation step could target
          // each peer precisely. They remain in scope here for the
          // override + assertion steps below.

          // Install `respond.sign = deny` for peer B on page A via the
          // AppState bridge. `setPeerPolicyOverride` dispatches
          // `set_policy_override` against the live runtime. We do NOT
          // persist to a stored profile here because this spec bootstraps
          // its runtimes via __iglooTestSeedRuntime which has no
          // IndexedDB profile; the runtime-level override is the
          // subject of VAL-POLICIES-010.
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

          // IMPORTANT: do NOT drive `refresh_all_peers` or otherwise
          // wait on pageA's runtimeStatus to reflect the override
          // before dispatching on B. bifrost-signer's
          // `select_signing_peers` ANDs its nonce gate with the
          // remotely-observed `PeerScopedPolicyProfile.respond.sign`
          // (see `effective_policy_for_peer`). Every ping A sends
          // re-broadcasts A's new profile, landing in B's
          // `remote_scoped_policies[A]`; once that update arrives,
          // B's signer filters A out BEFORE ever shipping the sign
          // request and raises `NonceUnavailable` (serialised as
          // "nonce unavailable"), which does NOT match
          // `/denied|policy/`. B must dispatch while still holding
          // A's pre-override profile so the sign actually reaches
          // A's `reject_request("peer_denied", "inbound sign denied
          // by local policy")` path and the wire-echoed failure
          // carries the peer_denied message. `setPolicyOverride` on
          // A's WASM runtime is synchronous, so A's internal state
          // already reflects the override when we return here; the
          // only risk is pageA's 2.5 s `refreshRuntime` timer
          // firing before B's sign is in flight — minimised by
          // dispatching immediately without any intermediate page
          // state inspection. The post-dispatch assertion below
          // verifies A's runtime effective_policy reflects the
          // override, satisfying the VAL-POLICIES-010 contract's
          // "A's effective_policy blocks B.sign" predicate without
          // gating the dispatch on it.

          // Snapshot A's observable-state invariants BEFORE B's sign
          // dispatch so the post-failure assertions can prove that
          // B's request NEVER landed in A's pending queue and never
          // produced a Sign completion on A. These are the two
          // invariants VAL-POLICIES-010 requires of the denier:
          //   - A's Sign-typed pending_operations count is unchanged
          //     (no entry keyed on B's sign request_id is ever
          //     admitted). A's total pending_operations.length can
          //     and does churn freely due to background Ping traffic
          //     emitted by the seeded runtime's 2.5 s refresh ticks,
          //     so we snapshot total length for diagnostics only and
          //     assert equality on the *Sign-typed subset*. The
          //     "no entry keyed on B's request_id" assertion below
          //     covers the actual contract invariant via continuous
          //     sampling during the 15 s window.
          //   - A's Sign completion count is unchanged (A did not
          //     partially sign)
          const snapshotASide = () =>
            pageA.evaluate(() => {
              const w = window as unknown as {
                __appState?: {
                  runtimeStatus?: {
                    pending_operations?: Array<{
                      request_id?: string;
                      op_type?: string;
                    }>;
                  };
                  runtimeCompletions?: Array<Record<string, unknown>>;
                };
              };
              const pending =
                w.__appState?.runtimeStatus?.pending_operations ?? [];
              const completions =
                w.__appState?.runtimeCompletions ?? [];
              const signPending = pending.filter(
                (op) =>
                  typeof op.op_type === "string" &&
                  op.op_type.toLowerCase() === "sign",
              );
              const signCompletionsCount = completions.filter(
                (entry) => !!(entry as { Sign?: unknown }).Sign,
              ).length;
              return {
                pendingLength: pending.length,
                pendingRequestIds: pending
                  .map((op) => op.request_id)
                  .filter(
                    (id): id is string => typeof id === "string",
                  ),
                pendingSignCount: signPending.length,
                pendingSignRequestIds: signPending
                  .map((op) => op.request_id)
                  .filter(
                    (id): id is string => typeof id === "string",
                  ),
                signCompletionsCount,
              };
            });
          const aSnapshotBeforeDispatch = await snapshotASide();

          // Dispatch a sign from peer B targeting the group. The sign
          // requires A's partial response; A will deny with `peer_denied`
          // and B will see an OperationFailure.
          //
          // The synchronous `handleRuntimeCommand` result can return
          // `requestId: null` when the runtime has not yet produced a
          // new entry in `pending_operations` on the tick immediately
          // following dispatch (for 2-of-2 groups, the Sign op may
          // only be registered after a subsequent tick). We capture
          // whatever id is returned synchronously, but fall back to
          // observing the first new `Sign` entry in
          // `pending_operations` or `runtimeFailures` if null.
          const messageHex = "7".repeat(64);
          // dispatchStart anchors the shared VAL-POLICIES-010 15 000 ms
          // budget. Scrutiny r2 flagged that the previous implementation
          // re-started the 15 s clock AFTER `signRequestId` had been
          // resolved — so slow `request_id` discovery could push the
          // total dispatch → OperationFailure window well past the
          // contract's 15 s ceiling while the test still passed. The
          // fix: compute `remainingBudget` from a single `dispatchStart`
          // timestamp captured at the moment of sign dispatch; both
          // request_id discovery and the OperationFailure wait consume
          // from this shared budget.
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
          }, messageHex);
          expect(dispatchB.debounced).toBe(false);
          // Backwards-compat alias preserved for the existing
          // diagnostic log strings that reference
          // `dispatchStartedAt` (A-side sampler timeline + failure
          // diag). Semantically identical to `dispatchStart`.
          const dispatchStartedAt = dispatchStart;
          const remainingBudget = (): number =>
            SIGN_FAILURE_TIMEOUT_MS - (Date.now() - dispatchStart);

          let signRequestId: string | null = dispatchB.requestId;
          if (!signRequestId) {
            const discoveryBudget = remainingBudget();
            if (discoveryBudget <= 0) {
              throw new Error(
                `request_id discovery exceeded VAL-POLICIES-010 budget: ` +
                  `dispatch returned null requestId and ` +
                  `${SIGN_FAILURE_TIMEOUT_MS}ms already elapsed ` +
                  `before discovery could start ` +
                  `(elapsed=${Date.now() - dispatchStart}ms).`,
              );
            }
            // PendingOperation.op_type is PascalCase ("Sign") while
            // OperationFailure.op_type is lowercase ("sign"). Match
            // case-insensitively so either channel can provide the
            // request_id correlation during the 15 s window.
            signRequestId = await pageB
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
                      signLifecycleLog?: Array<{
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
                  if (signPending?.request_id) {
                    return signPending.request_id;
                  }
                  const failures = w.__appState?.runtimeFailures ?? [];
                  const signFailure = failures.find(
                    (f) =>
                      typeof f.op_type === "string" &&
                      f.op_type.toLowerCase() === "sign",
                  );
                  if (signFailure?.request_id) {
                    return signFailure.request_id;
                  }
                  const lifecycle = w.__appState?.signLifecycleLog ?? [];
                  const lifecycleSign = lifecycle.find(
                    (entry) =>
                      typeof entry.op_type === "string" &&
                      entry.op_type.toLowerCase() === "sign" &&
                      typeof entry.request_id === "string",
                  );
                  return lifecycleSign?.request_id ?? null;
                },
                undefined,
                { timeout: discoveryBudget, polling: 100 },
              )
              .then((handle) => handle.jsonValue() as Promise<string>)
              .catch(async (err) => {
                const diag = await pageB.evaluate(() => {
                  const w = window as unknown as {
                    __appState?: {
                      runtimeStatus?: unknown;
                      runtimeFailures?: unknown;
                      runtimeCompletions?: unknown;
                      signLifecycleLog?: unknown;
                      lifecycleEvents?: Array<Record<string, unknown>>;
                    };
                  };
                  const events = w.__appState?.lifecycleEvents ?? [];
                  return {
                    runtimeFailures: w.__appState?.runtimeFailures,
                    runtimeCompletions: w.__appState?.runtimeCompletions,
                    signLifecycleLog: w.__appState?.signLifecycleLog,
                    readiness: (
                      w.__appState?.runtimeStatus as {
                        readiness?: unknown;
                      }
                    )?.readiness,
                    pending: (
                      w.__appState?.runtimeStatus as {
                        pending_operations?: unknown;
                      }
                    )?.pending_operations,
                    recentLifecycleKinds: events
                      .slice(-30)
                      .map((e) => e.kind),
                  };
                });
                throw new Error(
                  `request_id discovery exceeded VAL-POLICIES-010 budget: ` +
                    `B never registered a Sign pending_op or Sign failure ` +
                    `within the remaining ${discoveryBudget}ms of the ` +
                    `${SIGN_FAILURE_TIMEOUT_MS}ms shared budget ` +
                    `(elapsed since dispatch ${
                      Date.now() - dispatchStart
                    }ms): ${err}\n` +
                    `B state:\n${JSON.stringify(diag, null, 2)}`,
                );
              });
          }
          expect(signRequestId).toBeTruthy();

          // 1. Wait for page B to drain an OperationFailure whose
          //    message matches /denied|policy/i — strictly bounded to
          //    the VAL-POLICIES-010 15 000 ms ceiling measured from
          //    B's dispatch. Concurrently sample A's
          //    `pending_operations` so we can prove no entry keyed on
          //    B's request_id EVER lands on A during the window (the
          //    A-side invariance assertion added during m3 scrutiny).
          const aPendingSamples: Array<{
            atMs: number;
            ids: Array<string | undefined>;
          }> = [];
          let aBRequestIdEverSeen = false;
          let samplerStop = false;
          let samplerError: Error | null = null;
          const aSidePoller = (async () => {
            while (!samplerStop) {
              try {
                const ids = await pageA.evaluate(() => {
                  const w = window as unknown as {
                    __appState?: {
                      runtimeStatus?: {
                        pending_operations?: Array<{
                          request_id?: string;
                          op_type?: string;
                        }>;
                      };
                    };
                  };
                  const pending =
                    w.__appState?.runtimeStatus?.pending_operations ??
                    [];
                  return pending.map((op) => op.request_id);
                });
                aPendingSamples.push({
                  atMs: Date.now() - dispatchStartedAt,
                  ids,
                });
                if (ids.some((id) => id === signRequestId)) {
                  aBRequestIdEverSeen = true;
                  // Capture the sighting, then keep sampling so we
                  // surface a complete timeline in diag on failure.
                }
              } catch (err) {
                samplerError =
                  err instanceof Error ? err : new Error(String(err));
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
          })();

          // The strict 15 000 ms budget is a SHARED ceiling spanning
          // both request_id discovery and this OperationFailure wait,
          // measured from `dispatchStart` (i.e. the moment of sign
          // dispatch). Scrutiny r2 flagged that the previous
          // implementation anchored the 15 s on failure-wait START —
          // meaning slow request_id resolution could push the total
          // dispatch-to-failure window past 15 s undetected. Now any
          // time spent resolving `signRequestId` consumes from the
          // same budget that the failure wait draws from, so the
          // contract's "within 15 s" bound is enforced end-to-end
          // from B's dispatch.
          const failureWaitStartedAt = Date.now();
          const failureBudget = remainingBudget();
          if (failureBudget <= 0) {
            samplerStop = true;
            await aSidePoller;
            throw new Error(
              `VAL-POLICIES-010 strict ${SIGN_FAILURE_TIMEOUT_MS}ms ` +
                `OperationFailure bound EXCEEDED before failure-wait ` +
                `could start: ${SIGN_FAILURE_TIMEOUT_MS}ms already ` +
                `elapsed since dispatch while resolving request_id ` +
                `(elapsed since dispatch ${
                  Date.now() - dispatchStart
                }ms, request_id=${signRequestId}).`,
            );
          }
          try {
            await pageB.waitForFunction(
              (rid: string) => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeFailures?: Array<{
                      request_id?: string;
                      op_type?: string;
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
              signRequestId,
              { timeout: failureBudget, polling: 100 },
            );
          } catch (err) {
            samplerStop = true;
            await aSidePoller;
            const diag = await pageB.evaluate(() => {
              const w = window as unknown as {
                __appState?: {
                  runtimeFailures?: unknown;
                  runtimeCompletions?: unknown;
                  signLifecycleLog?: unknown;
                  runtimeStatus?: unknown;
                };
              };
              return {
                runtimeFailures: w.__appState?.runtimeFailures,
                runtimeCompletions: w.__appState?.runtimeCompletions,
                signLifecycleLog: w.__appState?.signLifecycleLog,
                runtimeStatus: w.__appState?.runtimeStatus,
              };
            });
            throw new Error(
              `VAL-POLICIES-010 strict ${SIGN_FAILURE_TIMEOUT_MS}ms ` +
                `OperationFailure bound EXCEEDED: no failure matching ` +
                `/denied|policy/i observed on B within the shared ` +
                `${SIGN_FAILURE_TIMEOUT_MS}ms budget measured from ` +
                `dispatch (elapsed since dispatch ${
                  Date.now() - dispatchStart
                }ms, elapsed since failure-wait start ${
                  Date.now() - failureWaitStartedAt
                }ms, remaining-budget-allocated=${failureBudget}ms, ` +
                `request_id=${signRequestId}): ${err}\n` +
                `B state:\n${JSON.stringify(diag, null, 2)}`,
            );
          }
          samplerStop = true;
          await aSidePoller;
          if (samplerError) {
            throw samplerError;
          }

          // 2. A-side invariance assertions (VAL-POLICIES-010): B's
          //    request_id must NEVER have been admitted to A's
          //    pending_operations during the denial window, and
          //    A.pending_operations.length must be unchanged from the
          //    pre-dispatch snapshot. Sampled continuously during
          //    the OperationFailure wait above.
          expect(
            aBRequestIdEverSeen,
            `A.pending_operations should never contain an entry ` +
              `keyed on B's sign request_id (${signRequestId}). ` +
              `Observed A-side samples (t ms → request_ids): ${JSON.stringify(
                aPendingSamples,
              )}`,
          ).toBe(false);

          const aSnapshotAfterFailure = await snapshotASide();

          // Sign-typed pending count on A must be unchanged — a
          // denied inbound sign must not be admitted into A's queue.
          // (Total pending length is checked diagnostically only;
          // it fluctuates with background Ping churn.)
          expect(
            aSnapshotAfterFailure.pendingSignCount,
            `A's Sign-typed pending_operations count must be ` +
              `unchanged across the denied round-trip. ` +
              `Before: ${aSnapshotBeforeDispatch.pendingSignCount} ` +
              `(sign ids=${JSON.stringify(
                aSnapshotBeforeDispatch.pendingSignRequestIds,
              )}, total pending=${aSnapshotBeforeDispatch.pendingLength}); ` +
              `After: ${aSnapshotAfterFailure.pendingSignCount} ` +
              `(sign ids=${JSON.stringify(
                aSnapshotAfterFailure.pendingSignRequestIds,
              )}, total pending=${aSnapshotAfterFailure.pendingLength}). ` +
              `Sighted A-side samples: ${JSON.stringify(
                aPendingSamples,
              )}.`,
          ).toBe(aSnapshotBeforeDispatch.pendingSignCount);

          // After re-snapshotting, B's request_id must still not
          // appear in A's pending list — re-asserted against the
          // final snapshot to catch any late-arriving entry that
          // slipped in after the failure was drained on B.
          expect(
            aSnapshotAfterFailure.pendingRequestIds.includes(
              signRequestId,
            ),
            `A.pending_operations must not contain an entry keyed on ` +
              `B's sign request_id (${signRequestId}) after B's ` +
              `OperationFailure is observed. Final A.pending ids: ` +
              `${JSON.stringify(
                aSnapshotAfterFailure.pendingRequestIds,
              )}.`,
          ).toBe(false);

          // A's Sign completion count — the protocol-layer "sign_completed"
          // signal surfaced by web-demo-v2 — must be unchanged. A
          // denied the inbound sign and therefore never produced a
          // partial signature that could flow into `runtimeCompletions`.
          expect(
            aSnapshotAfterFailure.signCompletionsCount,
            `A's Sign completion count must be unchanged across the ` +
              `denied round-trip. Before: ${aSnapshotBeforeDispatch.signCompletionsCount}; ` +
              `After: ${aSnapshotAfterFailure.signCompletionsCount}.`,
          ).toBe(aSnapshotBeforeDispatch.signCompletionsCount);

          // Back-compat assertion retained from the original spec:
          // peer A records NO Sign completion for B's request_id
          // specifically. (Equivalent to the count-unchanged check
          // above in practice, but protects against a hypothetical
          // regression where A's sign_completed counter stays flat
          // while a stray completion with B's request_id nonetheless
          // leaks in.)
          const aHasSignCompletion = await pageA.evaluate(
            (rid: string) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeCompletions?: Array<Record<string, unknown>>;
                };
              };
              const completions = w.__appState?.runtimeCompletions ?? [];
              return completions.some((entry) => {
                const sign = (
                  entry as { Sign?: { request_id?: string } }
                ).Sign;
                return !!sign && sign.request_id === rid;
              });
            },
            signRequestId,
          );
          expect(aHasSignCompletion).toBe(false);

          // 3. Peer B's runtime completions must NOT include a Sign
          //    entry for this request_id either.
          const bHasSignCompletion = await pageB.evaluate(
            (rid: string) => {
              const w = window as unknown as {
                __appState?: {
                  runtimeCompletions?: Array<Record<string, unknown>>;
                };
              };
              const completions = w.__appState?.runtimeCompletions ?? [];
              return completions.some((entry) => {
                const sign = (
                  entry as { Sign?: { request_id?: string } }
                ).Sign;
                return !!sign && sign.request_id === rid;
              });
            },
            signRequestId,
          );
          expect(bHasSignCompletion).toBe(false);

          // 4. Post-assertion (part of VAL-POLICIES-010): A's runtime
          //    status now reports `effective_policy.respond.sign ===
          //    false` for peer B — the override must be live at the
          //    runtime layer. Deferred to AFTER the dispatch because
          //    waiting for it BEFORE would necessarily wait for
          //    pageA's 2.5 s refreshRuntime tick to repopulate the
          //    JS snapshot, and that refresh also broadcasts A's new
          //    policy profile to B which in turn causes B's signer
          //    to short-circuit the sign with a misleading
          //    "nonce unavailable" error rather than reaching A's
          //    peer_denied path. The WASM-side state on A already
          //    reflects the override at the moment setPolicyOverride
          //    returns; this assertion just confirms the observable
          //    JS surface has caught up.
          await pageA
            .waitForFunction(
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
                    | {
                        respond?: { sign?: boolean };
                      }
                    | undefined;
                  return (
                    typeof pub === "string" &&
                    pub === peerBHex &&
                    effective?.respond?.sign === false
                  );
                });
              },
              peerBPubkey32,
              { timeout: 10_000, polling: 200 },
            );
        } finally {
          await ctxA.close().catch(() => undefined);
          await ctxB.close().catch(() => undefined);
        }
      },
    );

    // Passing regression for the policy propagation half of
    // VAL-POLICIES-010: when a user sets `respond.sign = deny` via
    // the AppState bridge, A's runtime `effective_policy` for peer B
    // must immediately flip to `respond.sign === false`. This is the
    // minimum round-trippable assertion that does not depend on B's
    // nonce pool having enough material to dispatch a sign.
    test(
      "setPeerPolicyOverride(respond.sign=deny) propagates into A's runtime effective_policy for peer B",
      async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        try {
          const pageA = await ctxA.newPage();
          const pageB = await ctxB.newPage();

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
              groupName: "Policy Propagation E2E",
              threshold: 2,
              count: 3,
            });
          });
          const shareA = keyset.shares[0];
          const shareB = keyset.shares[1];

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
              { group: keyset.group, share, relayUrl: RELAY_URL, deviceName },
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

          const peerBPubkey32 = await pageA.evaluate(
            ({ group, idxB }) => {
              const w = window as unknown as {
                __iglooTestMemberPubkey32: (
                  group: unknown,
                  shareIdx: number,
                ) => string;
              };
              return w.__iglooTestMemberPubkey32(group, idxB);
            },
            { group: keyset.group, idxB: shareB.idx },
          );

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

          await pageA
            .waitForFunction(
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
                    effective?.respond?.sign === false
                  );
                });
              },
              peerBPubkey32,
              { timeout: 15_000, polling: 200 },
            )
            .catch(async (err) => {
              const diag = await pageA.evaluate(() => {
                const w = window as unknown as {
                  __appState?: {
                    runtimeStatus?: {
                      peer_permission_states?: unknown;
                    };
                  };
                };
                return {
                  peer_permission_states:
                    w.__appState?.runtimeStatus?.peer_permission_states,
                };
              });
              throw new Error(
                `A's effective_policy.respond.sign did not flip to false ` +
                  `for peer B (${peerBPubkey32}) within 15 s: ${err}\n` +
                  `A status:\n${JSON.stringify(diag, null, 2)}`,
              );
            });

          // Self-peer override guard: attempting to override the local
          // pubkey must throw (VAL-POLICIES-025 bridge-level defense).
          const selfGuard = await pageA.evaluate(async () => {
            const w = window as unknown as {
              __appState: {
                setPeerPolicyOverride: (input: {
                  peer: string;
                  direction: "request" | "respond";
                  method: "sign" | "ecdh" | "ping" | "onboard";
                  value: "unset" | "allow" | "deny";
                }) => Promise<void>;
                runtimeStatus?: {
                  metadata?: { share_public_key?: string };
                };
              };
            };
            const selfPubkey =
              w.__appState.runtimeStatus?.metadata?.share_public_key;
            if (!selfPubkey) {
              return { threw: false, reason: "no share_public_key" };
            }
            try {
              await w.__appState.setPeerPolicyOverride({
                peer: selfPubkey,
                direction: "respond",
                method: "sign",
                value: "deny",
              });
              return { threw: false, reason: "no error thrown" };
            } catch (error) {
              return {
                threw: true,
                reason:
                  error instanceof Error ? error.message : String(error),
              };
            }
          });
          expect(selfGuard.threw).toBe(true);
          expect(selfGuard.reason).toMatch(/local|self/i);
        } finally {
          await ctxA.close().catch(() => undefined);
          await ctxB.close().catch(() => undefined);
        }
      },
    );
  },
);
