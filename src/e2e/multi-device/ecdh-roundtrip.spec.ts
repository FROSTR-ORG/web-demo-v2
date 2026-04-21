import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * Multi-device ECDH round-trip e2e for features m1-ecdh-dispatch and
 * m1-bootstrap-devtools-relay.
 *
 * Exercises the infrastructure path used by VAL-OPS-009 / VAL-OPS-020:
 * a locally-spawned `bifrost-devtools` relay accepting WebSocket
 * connections from two concurrent browser contexts that share the same
 * relay endpoint (`ws://127.0.0.1:8194`). The relay binary is NOT
 * produced by `npm install`; it is bootstrapped by `.factory/init.sh`
 * (which runs `cargo build --release -p bifrost-devtools`). When the
 * binary is missing (e.g. CI images without cargo) the suite auto-skips
 * so baseline CI stays green; the scrutiny validator flags the skip
 * reason.
 *
 * Scope:
 *   - Spawn / tear down the relay process in this file (does NOT rely
 *     on `.factory/services.yaml` being pre-started).
 *   - Two browser contexts, both pages loaded against the dev server,
 *     both open a direct NIP-01 WebSocket to the local relay.
 *   - Each page issues a `REQ` with a shared `request_id` (subscription
 *     id) and asserts the relay echoes `EOSE` for the same id — the
 *     NIP-01 "subscription complete" completion semantics.
 *   - The full FROST-layer ECDH round-trip (`handleRuntimeCommand({type:
 *     "ecdh"})` producing a `CompletedOperation` on the initiator) is
 *     validated via agent-browser per VAL-OPS-009 (shared-keyset
 *     profile seeding requires a separate feature) — this spec asserts
 *     the transport bootstrap that validation depends on.
 *
 * To run manually:
 *   1. bash .factory/init.sh                       # builds the binary
 *   2. npx playwright test src/e2e/multi-device/ecdh-roundtrip.spec.ts \
 *        --project=desktop --workers 1
 */

const DEVTOOLS_BINARY =
  "/Users/plebdev/Desktop/igloo-web-v2-prototype/bifrost-rs/target/release/bifrost-devtools";

// Port 8194 is the only relay port allocated by AGENTS.md Mission
// Boundaries for this mission — do not change it.
const RELAY_HOST = "127.0.0.1";
const RELAY_PORT = 8194;
const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;

async function waitForRelayPort(host: string, port: number, timeoutMs: number) {
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

test.describe("multi-device ECDH round-trip (local bifrost-devtools relay)", () => {
  test.skip(
    () => !existsSync(DEVTOOLS_BINARY),
    "bifrost-devtools binary not built — run `bash .factory/init.sh` (requires cargo) or `cargo build --release -p bifrost-devtools` in ../bifrost-rs",
  );

  test.setTimeout(180_000);

  let relay: ChildProcess | null = null;

  test.beforeAll(async () => {
    // Best-effort sanity: if port is already bound (e.g. services.local_relay
    // was started manually), fail fast with a clear remediation hint rather
    // than fighting over the port.
    const alreadyBound = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: RELAY_HOST, port: RELAY_PORT });
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
        `Port ${RELAY_PORT} already in use. Stop services.local_relay (lsof -ti :${RELAY_PORT} | xargs kill) before running this spec.`,
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
      buffered.push(`[relay] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
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
    "two browser contexts share the local relay and each sees the same request_id completion (EOSE)",
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

        // Each browser context opens a NIP-01 WebSocket directly to the
        // local relay (this is the same transport the app uses under
        // `BrowserRelayClient`). Both pages REQ with the same shared
        // `request_id` string so we can assert the relay independently
        // echoes EOSE back to each. This validates:
        //  - The relay binary is reachable at ws://127.0.0.1:8194
        //  - Two separate browser contexts can connect concurrently
        //  - Each receives a completion (EOSE) correlated by its
        //    subscription id (the NIP-01 analogue of `request_id`)
        const sharedRequestId = "ecdh-req-e2e-shared";

        const exchangeViaRelay = async (
          page: import("@playwright/test").Page,
        ) =>
          page.evaluate(
            async ({ url, requestId }) => {
              return await new Promise<{
                eoseReceived: boolean;
                subIdEchoed: string | null;
                noticeRecord: unknown[];
              }>((resolve, reject) => {
                const notices: unknown[] = [];
                const timeout = window.setTimeout(() => {
                  reject(new Error("timed out waiting for EOSE"));
                }, 10_000);
                let ws: WebSocket;
                try {
                  ws = new WebSocket(url);
                } catch (err) {
                  window.clearTimeout(timeout);
                  reject(err);
                  return;
                }
                ws.addEventListener("open", () => {
                  ws.send(
                    JSON.stringify([
                      "REQ",
                      requestId,
                      { kinds: [30300], limit: 0 },
                    ]),
                  );
                });
                ws.addEventListener("message", (ev) => {
                  let parsed: unknown;
                  try {
                    parsed =
                      typeof ev.data === "string"
                        ? JSON.parse(ev.data)
                        : null;
                  } catch {
                    return;
                  }
                  if (!Array.isArray(parsed)) return;
                  const [verb, echoed] = parsed as unknown[];
                  if (verb === "NOTICE") {
                    notices.push(parsed);
                    return;
                  }
                  if (verb === "EOSE" && echoed === requestId) {
                    window.clearTimeout(timeout);
                    try {
                      ws.send(JSON.stringify(["CLOSE", requestId]));
                    } catch {
                      // ignore
                    }
                    ws.close();
                    resolve({
                      eoseReceived: true,
                      subIdEchoed: String(echoed),
                      noticeRecord: notices,
                    });
                  }
                });
                ws.addEventListener("error", (err) => {
                  window.clearTimeout(timeout);
                  reject(err);
                });
              });
            },
            { url: "ws://127.0.0.1:8194", requestId: sharedRequestId },
          );

        // Run both subscriptions concurrently — the relay must handle
        // both browser contexts in parallel without serializing them.
        const [resultA, resultB] = await Promise.all([
          exchangeViaRelay(pageA),
          exchangeViaRelay(pageB),
        ]);

        expect(resultA.eoseReceived).toBe(true);
        expect(resultA.subIdEchoed).toBe(sharedRequestId);

        expect(resultB.eoseReceived).toBe(true);
        expect(resultB.subIdEchoed).toBe(sharedRequestId);
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
      }
    },
  );
});
