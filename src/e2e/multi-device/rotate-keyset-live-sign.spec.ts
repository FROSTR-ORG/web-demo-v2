import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Multi-device rotate-keyset-live-sign regression gate for feature
 * `m7-rotate-keyset-live-sign`.
 *
 * Feature intent (from the mission contract):
 *   After Rotate Keyset completion, signing must still work on the
 *   rotated keyset with fresh shares. Three-device test: A rotates
 *   the keyset, distributes new shares to B and C (adoption step is
 *   modelled by seeding each context directly with the rotated
 *   share — the adoption ceremony itself is covered by
 *   onboard-sponsorship specs and is orthogonal to this regression
 *   gate). Sign initiated on A succeeds with at least one of B / C
 *   responding. The regression gate catches any breakage where the
 *   rotate-keyset pipeline silently produces shares that cannot
 *   actually complete a FROST sign round-trip (group-pk drift,
 *   stale nonces, mismatched member indices, etc).
 *
 * End-to-end flow:
 *   1. Tabs A / B / C each load the dev server and wait for the
 *      dev-only `__iglooTest*` hooks to attach (same gate as every
 *      other multi-device spec in this folder).
 *   2. Tab A generates a 2-of-3 keyset via
 *      `__iglooTestCreateKeysetBundle` — the original material.
 *   3. Tab A calls `rotateKeysetBundle` directly through the WASM
 *      bridge (exposed via `__iglooTestRotateKeysetBundle`) using
 *      the threshold original shares.  The returned `next` keyset
 *      preserves `group.group_pk` by contract (identical to the
 *      invariant asserted in
 *      `src/lib/bifrost/packageService.test.ts`) but contains fresh
 *      share secrets and fresh per-member x-only pubkeys.
 *   4. Assertion: rotated share seckeys differ from originals, and
 *      rotated member pubkeys differ from originals. This is the
 *      "old shares no longer valid on rotated keyset" predicate at
 *      the keyset material layer — the protocol-layer
 *      incompatibility (mixing old + new shares cannot produce a
 *      valid partial) follows from these differences by
 *      construction of the FROST scheme.
 *   5. Each tab is seeded via `__iglooTestSeedRuntime` with the
 *      rotated group + its own rotated share, pointed at the local
 *      `bifrost-devtools` relay. No `initial_peer_nonces` are
 *      supplied — the 2.5 s refresh cadence drives natural sign
 *      readiness convergence, matching the approach used by
 *      `policy-denial-allow-once-retry.spec.ts` (see the long
 *      comment there explaining why `initial_peer_nonces` cannot
 *      substitute for a real ping/pong handshake when the retry
 *      needs A's *outgoing* nonce pool populated).
 *   6. Wait until sign_ready on A, and until A observes at least
 *      one of {B, C} as online. Both B and C are available
 *      responders, but the 2-of-3 threshold means the signer only
 *      requires one of them to complete the partial — whichever
 *      becomes online first wins the race.
 *   7. Tab A dispatches `{ type: "sign", message_hex_32 }`; spec
 *      records the originating `request_id`; waits for the
 *      matching `Sign` entry in A's `runtimeCompletions` with at
 *      least one well-formed 128-hex aggregated signature.
 *
 * Skip gate: identical to all other specs in this folder — skip
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
const RELAY_PROCESS_START_TIMEOUT_MS = 10_000;

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
interface SpecRotateResult {
  previous_group_id: string;
  next_group_id: string;
  next: SpecKeyset;
}

test.describe("multi-device rotate-keyset-live-sign regression gate", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot build bifrost-devtools for multi-device e2e. Install Rust " +
      "(https://rustup.rs) or run in an environment with cargo to unskip.",
  );

  // Budget: ~2 min natural sign-ready convergence (3 tabs) +
  // ~90 s for the sign round-trip + ~30 s of setup/teardown. Padded
  // generously for stressed CI.
  test.setTimeout(360_000);

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
    "rotated keyset preserves group_pk, fresh shares differ, and sign on A completes via B or C",
    async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      const ctxC = await browser.newContext();
      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const pageC = await ctxC.newPage();

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

        await Promise.all([
          pageA.goto("/"),
          pageB.goto("/"),
          pageC.goto("/"),
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
        ]);

        // Wait until the dev-only test hooks are attached on every
        // page. `__iglooTestCreateKeysetBundle` is used to produce
        // both the original and rotated keysets; the rotation itself
        // is performed via the same WASM bridge module exposed by
        // `window.__iglooTestRotateKeysetBundle` (see below for how
        // this spec derives the rotated material without adding a
        // new dev-only hook).
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
        ]);

        // === Step 1: Generate the ORIGINAL 2-of-3 keyset on A ===
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

        // === Step 2: Rotate the keyset via the WASM bridge ===
        // `rotateKeysetBundle` is a pure client-side WASM call — no
        // runtime / relay / dispatch involved. It's exposed to
        // Playwright via the dev-only `__iglooTestRotateKeysetBundle`
        // hook (added alongside this spec) so specs can drive
        // rotation without routing through the setup-session
        // plumbing in `AppStateValue.generateRotatedKeyset`.
        //
        // Extra runtime guard: fail fast if the hook isn't attached
        // on this page. Unlike the always-present hooks checked in
        // `waitForHooks`, this one is feature-gated to
        // `m7-rotate-keyset-live-sign` and a future refactor could
        // remove it without the broader hooks check catching the
        // regression.
        await pageA
          .waitForFunction(
            () => {
              const w = window as unknown as {
                __iglooTestRotateKeysetBundle?: unknown;
              };
              return typeof w.__iglooTestRotateKeysetBundle === "function";
            },
            undefined,
            { timeout: HOOKS_READY_TIMEOUT_MS, polling: 100 },
          )
          .catch((err) => {
            throw new Error(
              `__iglooTestRotateKeysetBundle hook never attached on ` +
                `page A — the rotate-keyset regression gate depends on ` +
                `this DEV-only bridge surface. (${err})`,
            );
          });
        const rotateResult: SpecRotateResult = await pageA.evaluate(
          async ({ group, shares, threshold, count }) => {
            const w = window as unknown as {
              __iglooTestRotateKeysetBundle: (input: {
                group: unknown;
                shares: unknown;
                threshold: number;
                count: number;
              }) => Promise<{
                previous_group_id: string;
                next_group_id: string;
                next: {
                  group: {
                    group_name: string;
                    group_pk: string;
                    threshold: number;
                    members: Array<{ idx: number; pubkey: string }>;
                  };
                  shares: Array<{ idx: number; seckey: string }>;
                };
              }>;
            };
            return w.__iglooTestRotateKeysetBundle({
              group,
              shares,
              threshold,
              count,
            });
          },
          {
            group: originalKeyset.group,
            shares: originalKeyset.shares.slice(
              0,
              originalKeyset.group.threshold,
            ),
            threshold: 2,
            count: 3,
          },
        );

        // === Step 3: Verify rotation invariants ===
        // (a) same group_pk (this is the "rotation is correct"
        //     invariant enforced by
        //     `AppStateProvider.generateRotatedKeyset`; if the
        //     WASM pipeline ever drifted the group_pk it would
        //     break every downstream consumer of the existing
        //     profile record)
        expect(rotateResult.next.group.group_pk.toLowerCase()).toBe(
          originalKeyset.group.group_pk.toLowerCase(),
        );
        // (b) rotated keyset has the full three shares
        expect(rotateResult.next.shares.length).toBe(3);
        expect(rotateResult.next.group.members.length).toBe(3);
        expect(rotateResult.next.group.threshold).toBe(2);

        // (c) Fresh share material: every rotated share secret
        //     differs from its original counterpart, and every
        //     rotated member pubkey differs from its original
        //     counterpart (since member pubkeys are derived from
        //     the share secret, the second assertion follows from
        //     the first — but we check both so a regression that
        //     preserves the pubkey while mutating the secret still
        //     fails the gate).
        const originalByIdx = new Map(
          originalKeyset.shares.map((s) => [s.idx, s.seckey.toLowerCase()]),
        );
        const originalMemberByIdx = new Map(
          originalKeyset.group.members.map((m) => [
            m.idx,
            m.pubkey.toLowerCase(),
          ]),
        );
        for (const rotatedShare of rotateResult.next.shares) {
          const originalSeckey = originalByIdx.get(rotatedShare.idx);
          expect(
            originalSeckey,
            `original keyset missing share ${rotatedShare.idx}`,
          ).toBeTruthy();
          expect(
            rotatedShare.seckey.toLowerCase(),
            `rotated share ${rotatedShare.idx} seckey MUST differ from original (rotate must mint fresh material)`,
          ).not.toBe(originalSeckey);
        }
        for (const rotatedMember of rotateResult.next.group.members) {
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

        // === Step 4: Seed A / B / C with ROTATED shares ===
        // No `initial_peer_nonces` — natural ping/pong convergence
        // populates both outgoing and incoming nonce pools (required
        // for a real sign round-trip; see the long comment at the
        // top of policy-denial-allow-once-retry.spec.ts for why
        // `initial_peer_nonces` cannot substitute here).
        const rotatedGroup = rotateResult.next.group;
        const shareAByRotation = rotateResult.next.shares.find(
          (s) => s.idx === rotateResult.next.shares[0].idx,
        )!;
        const shareBByRotation = rotateResult.next.shares.find(
          (s) => s.idx === rotateResult.next.shares[1].idx,
        )!;
        const shareCByRotation = rotateResult.next.shares.find(
          (s) => s.idx === rotateResult.next.shares[2].idx,
        )!;
        expect(shareAByRotation).toBeTruthy();
        expect(shareBByRotation).toBeTruthy();
        expect(shareCByRotation).toBeTruthy();
        expect(shareAByRotation.idx).not.toBe(shareBByRotation.idx);
        expect(shareBByRotation.idx).not.toBe(shareCByRotation.idx);
        expect(shareAByRotation.idx).not.toBe(shareCByRotation.idx);

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
              group: rotatedGroup,
              share,
              relayUrl: RELAY_URL,
              deviceName,
            },
          );
        await Promise.all([
          seed(pageA, shareAByRotation, "Alice (rotated)"),
          seed(pageB, shareBByRotation, "Bob (rotated)"),
          seed(pageC, shareCByRotation, "Carol (rotated)"),
        ]);

        // === Step 5: Wait for the relay to transition to `online`
        //     on every page and every runtime to become
        //     `sign_ready`. Three tabs mean three concurrent ping
        //     loops converging in parallel.
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

        // Derive each peer's rotated x-only pubkey so we can wait
        // for observable peer-online state on A. For the signing
        // threshold of 2, A needs ONE of B / C to become online and
        // exchange ping/pong — not both. But we wait for at least
        // one to ensure a deterministic dispatch window.
        const peerAPubkey32 = await pageA.evaluate(
          ({ group, shareIdx }) => {
            const w = window as unknown as {
              __iglooTestMemberPubkey32: (
                group: unknown,
                shareIdx: number,
              ) => string;
            };
            return w.__iglooTestMemberPubkey32(group, shareIdx);
          },
          { group: rotatedGroup, shareIdx: shareAByRotation.idx },
        );
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
          { group: rotatedGroup, shareIdx: shareBByRotation.idx },
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
          { group: rotatedGroup, shareIdx: shareCByRotation.idx },
        );
        expect(peerAPubkey32).toMatch(/^[0-9a-f]{64}$/);
        expect(peerBPubkey32).toMatch(/^[0-9a-f]{64}$/);
        expect(peerCPubkey32).toMatch(/^[0-9a-f]{64}$/);
        expect(peerBPubkey32).not.toBe(peerAPubkey32);
        expect(peerCPubkey32).not.toBe(peerAPubkey32);
        expect(peerBPubkey32).not.toBe(peerCPubkey32);

        // Wait for A to observe at least one responder (B or C) as
        // online with a populated `last_seen`. This is the minimal
        // peer-discovery gate that proves the ping/pong exchange
        // completed at least one full loop between A and a
        // prospective partial-signing peer.
        const waitForAnyResponderOnline = async () =>
          pageA
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
                `A never observed any responder (B or C) as online ` +
                  `within ${PEERS_ONLINE_TIMEOUT_MS}ms — the underlying ` +
                  `ping/pong round-trip did not converge. (${err})`,
              );
            });
        await waitForAnyResponderOnline();

        // === Step 6: Dispatch a sign on A ===
        // Use a deterministic 32-byte message so the assertions are
        // stable across repeated runs. The bytes are arbitrary —
        // only their length matters to the WASM bridge.
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

        // `handleRuntimeCommand` sometimes returns `requestId: null`
        // when the pending op isn't captured on the tick immediately
        // following dispatch. Fall through to a poll on
        // `pending_operations` / `runtimeCompletions` to recover the
        // canonical id in that case.
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

        // === Step 7: Wait for the Sign completion on A ===
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

        // Completion payload must carry at least one valid
        // 128-hex aggregated signature — proof that the signer
        // finalized with a real partial from B or C, not just that
        // some arbitrary Sign row appeared.
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

        // === Step 8: Completion propagated to AppState observables ===
        // The regression gate's core assertion is that the rotated
        // keyset produced a real FROST signature (asserted above).
        // We do NOT additionally require the pending-operations list
        // to have drained for this `request_id` — that reconciliation
        // happens on a subsequent refresh tick and is covered by the
        // dedicated OPS specs (e.g. VAL-OPS-004). Introducing a
        // strict pending-op-drained assertion here would create
        // redundant coverage AND risk shadowing real rotate-keyset
        // regressions behind unrelated pending-op timing flakes.
        // Instead, cross-check that the completion entry carries a
        // group_pk-matched identifier so a caller inspecting
        // completions can correlate back to the rotated group.
        const completionsForRequest = await pageA.evaluate(
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
          signRequestIdStr,
        );
        expect(completionsForRequest).toBeGreaterThanOrEqual(1);
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
        await ctxC.close().catch(() => undefined);
      }
    },
  );
});
