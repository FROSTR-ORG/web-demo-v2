import { existsSync } from "node:fs";
import net from "node:net";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { expect, type Page } from "@playwright/test";

export const RELAY_HOST = "127.0.0.1";
// Fixed-port relay used by the real-peer specs. These specs must run
// serially; startBifrostDevtoolsRelay guards against parallel workers.
export const RELAY_PORT = 8194;
export const RELAY_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`;

export const HOOKS_READY_TIMEOUT_MS = 15_000;
export const RELAY_READY_TIMEOUT_MS = 20_000;
export const PEER_ONLINE_TIMEOUT_MS = 75_000;
export const RUNTIME_READY_TIMEOUT_MS = 120_000;

const BIFROST_RS_CANDIDATES = [
  process.env.BIFROST_RS_DIR,
  "./bifrost-rs",
  "../bifrost-rs",
].filter((value): value is string => Boolean(value));

export interface SpecGroup {
  group_name: string;
  group_pk: string;
  threshold: number;
  members: Array<{ idx: number; pubkey: string }>;
}

export interface SpecShare {
  idx: number;
  seckey: string;
}

export interface SpecKeyset {
  group: SpecGroup;
  shares: SpecShare[];
}

export interface RealPeerNetwork {
  keyset: SpecKeyset;
  shareA: SpecShare;
  shareB: SpecShare;
  peerAPubkey32: string;
  peerBPubkey32: string;
  profileIdA: string;
  profileIdB: string;
}

export function cargoAvailable(): boolean {
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

function resolveDevtoolsBinary(): string {
  if (BIFROST_RS_CANDIDATES.length === 0) {
    throw new Error("No bifrost-rs candidates configured for bifrost-devtools.");
  }
  for (const dir of BIFROST_RS_CANDIDATES) {
    const candidate = `${dir}/target/release/bifrost-devtools`;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `bifrost-devtools binary missing. Checked: ${BIFROST_RS_CANDIDATES.map(
      (dir) => `${dir}/target/release/bifrost-devtools`,
    ).join(", ")}.`,
  );
}

async function portIsBound(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
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
}

async function waitForRelayPort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsBound(host, port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for relay ${host}:${port}`);
}

async function killChild(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
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

export async function startBifrostDevtoolsRelay(): Promise<{
  stop: () => Promise<void>;
}> {
  const workerIndex = process.env.TEST_WORKER_INDEX;
  if (workerIndex && workerIndex !== "0") {
    throw new Error(
      `Real-peer relay uses fixed ${RELAY_URL} and requires serial test execution. ` +
        "Run with --workers=1 / serial execution or avoid startBifrostDevtoolsRelay() from parallel workers.",
    );
  }

  const binary = resolveDevtoolsBinary();

  if (await portIsBound(RELAY_HOST, RELAY_PORT)) {
    throw new Error(
      `Port ${RELAY_PORT} is already in use. Stop the existing local relay ` +
        `before running this real-peer suite.`,
    );
  }

  const proc = spawn(
    binary,
    ["relay", "--host", RELAY_HOST, "--port", String(RELAY_PORT)],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
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
  } catch (error) {
    await killChild(proc);
    throw new Error(
      `Failed to start bifrost-devtools relay on ${RELAY_URL}: ${
        error instanceof Error ? error.message : String(error)
      }\nRelay output tail:\n${buffered.join("\n")}`,
    );
  }

  return {
    stop: async () => {
      await killChild(proc);
    },
  };
}

export function wireConsoleErrors(page: Page, label: string): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    errors.push(text);
    // eslint-disable-next-line no-console
    console.log(`[${label}:console.error] ${text}`);
  });
  return errors;
}

export async function waitForRealPeerHooks(
  page: Page,
  label: string,
): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __appState?: unknown;
          __debug?: unknown;
          __iglooTestSeedRuntime?: unknown;
          __iglooTestCreateKeysetBundle?: unknown;
          __iglooTestMemberPubkey32?: unknown;
          __iglooTestDropRelays?: unknown;
          __iglooTestRestoreRelays?: unknown;
          __iglooTestSimulateNonceDepletion?: unknown;
          __iglooTestRestoreNonce?: unknown;
        };
        return (
          typeof w.__appState === "object" &&
          typeof w.__debug === "object" &&
          typeof w.__iglooTestSeedRuntime === "function" &&
          typeof w.__iglooTestCreateKeysetBundle === "function" &&
          typeof w.__iglooTestMemberPubkey32 === "function" &&
          typeof w.__iglooTestDropRelays === "function" &&
          typeof w.__iglooTestRestoreRelays === "function" &&
          typeof w.__iglooTestSimulateNonceDepletion === "function" &&
          typeof w.__iglooTestRestoreNonce === "function"
        );
      },
      undefined,
      { timeout: HOOKS_READY_TIMEOUT_MS, polling: 100 },
    )
    .catch((error) => {
      throw new Error(
        `Dev-only real-peer hooks never attached on page ${label}. ` +
          `Is the Playwright dev server running under import.meta.env.DEV? ` +
          `(${error})`,
      );
    });
}

export async function createKeyset(
  page: Page,
  params: { groupName: string; threshold?: number; count?: number },
): Promise<SpecKeyset> {
  return page.evaluate(async (input) => {
    const w = window as unknown as {
      __iglooTestCreateKeysetBundle: (params: {
        groupName: string;
        threshold: number;
        count: number;
      }) => Promise<SpecKeyset>;
    };
    return w.__iglooTestCreateKeysetBundle({
      groupName: input.groupName,
      threshold: input.threshold ?? 2,
      count: input.count ?? 3,
    });
  }, params);
}

export async function memberPubkey32(
  page: Page,
  group: SpecGroup,
  shareIdx: number,
): Promise<string> {
  const pubkey = await page.evaluate(
    ({ group, shareIdx }) => {
      const w = window as unknown as {
        __iglooTestMemberPubkey32: (
          group: SpecGroup,
          shareIdx: number,
        ) => string;
      };
      return w.__iglooTestMemberPubkey32(group, shareIdx);
    },
    { group, shareIdx },
  );
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  return pubkey;
}

async function seedPersistedRuntime(
  page: Page,
  input: {
    group: SpecGroup;
    share: SpecShare;
    deviceName: string;
    profileLabel: string;
    profilePassword: string;
  },
): Promise<string> {
  await page.evaluate(
    async ({
      group,
      share,
      deviceName,
      profileLabel,
      profilePassword,
      relayUrl,
    }) => {
      const w = window as unknown as {
        __iglooTestSeedRuntime: (input: {
          group: SpecGroup;
          share: SpecShare;
          relays: string[];
          deviceName: string;
          persistProfile: { password: string; label: string };
        }) => Promise<void>;
      };
      await w.__iglooTestSeedRuntime({
        group,
        share,
        relays: [relayUrl],
        deviceName,
        persistProfile: { password: profilePassword, label: profileLabel },
      });
    },
    { ...input, relayUrl: RELAY_URL },
  );

  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __appState?: { activeProfile?: { id?: string } | null };
      };
      return Boolean(w.__appState?.activeProfile?.id);
    },
    undefined,
    { timeout: RUNTIME_READY_TIMEOUT_MS, polling: 100 },
  );

  return page.evaluate(() => {
    const w = window as unknown as {
      __appState: { activeProfile: { id: string } };
    };
    return w.__appState.activeProfile.id;
  });
}

export async function clientNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await page.waitForURL(`**${path}`);
}

export async function waitForRelayOnline(
  page: Page,
  label: string,
  relayUrl = RELAY_URL,
): Promise<void> {
  await page
    .waitForFunction(
      (url: string) => {
        const w = window as unknown as {
          __appState?: {
            runtimeRelays?: Array<{ url: string; state: string }>;
          };
        };
        return (w.__appState?.runtimeRelays ?? []).some(
          (entry) => entry.url === url && entry.state === "online",
        );
      },
      relayUrl,
      { timeout: RELAY_READY_TIMEOUT_MS, polling: 150 },
    )
    .catch((error) => {
      throw new Error(
        `Relay ${relayUrl} never reached "online" on page ${label}. (${error})`,
      );
    });
}

export async function waitForPeerOnline(
  page: Page,
  peerPubkey32: string,
  label: string,
): Promise<void> {
  await page
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
        const peer = (w.__appState?.runtimeStatus?.peers ?? []).find(
          (entry) => entry.pubkey === expected,
        );
        return Boolean(peer?.online && (peer.last_seen ?? 0) > 0);
      },
      peerPubkey32,
      { timeout: PEER_ONLINE_TIMEOUT_MS, polling: 250 },
    )
    .catch((error) => {
      throw new Error(
        `Peer ${peerPubkey32} never became online on page ${label}. (${error})`,
      );
    });
}

export async function waitForReadiness(
  page: Page,
  key: "sign_ready" | "ecdh_ready",
  label: string,
): Promise<void> {
  await page
    .waitForFunction(
      (readinessKey: "sign_ready" | "ecdh_ready") => {
        const w = window as unknown as {
          __appState?: {
            runtimeStatus?: {
              readiness?: Record<string, unknown>;
            };
          };
        };
        return w.__appState?.runtimeStatus?.readiness?.[readinessKey] === true;
      },
      key,
      { timeout: RUNTIME_READY_TIMEOUT_MS, polling: 200 },
    )
    .catch((error) => {
      throw new Error(
        `${key} never became true on page ${label} within ` +
          `${RUNTIME_READY_TIMEOUT_MS}ms. (${error})`,
      );
    });
}

export async function bootstrapTwoRealPeers(
  pageA: Page,
  pageB: Page,
  options: { groupName: string },
): Promise<RealPeerNetwork> {
  const keyset = await createKeyset(pageA, {
    groupName: options.groupName,
    threshold: 2,
    count: 3,
  });
  expect(keyset.shares.length).toBeGreaterThanOrEqual(2);
  const shareA = keyset.shares[0];
  const shareB = keyset.shares[1];
  expect(shareA.idx).not.toBe(shareB.idx);

  const [peerAPubkey32, peerBPubkey32] = await Promise.all([
    memberPubkey32(pageA, keyset.group, shareA.idx),
    memberPubkey32(pageA, keyset.group, shareB.idx),
  ]);

  const [profileIdA, profileIdB] = await Promise.all([
    seedPersistedRuntime(pageA, {
      group: keyset.group,
      share: shareA,
      deviceName: "Alice",
      profileLabel: `${options.groupName} Alice`,
      profilePassword: "alice-real-peer-dashboard-pw",
    }),
    seedPersistedRuntime(pageB, {
      group: keyset.group,
      share: shareB,
      deviceName: "Bob",
      profileLabel: `${options.groupName} Bob`,
      profilePassword: "bob-real-peer-dashboard-pw",
    }),
  ]);

  await Promise.all([
    waitForRelayOnline(pageA, "A"),
    waitForRelayOnline(pageB, "B"),
  ]);

  await Promise.all([
    waitForPeerOnline(pageA, peerBPubkey32, "A"),
    waitForPeerOnline(pageB, peerAPubkey32, "B"),
  ]);

  await Promise.all([
    waitForReadiness(pageA, "sign_ready", "A"),
    waitForReadiness(pageA, "ecdh_ready", "A"),
    waitForReadiness(pageB, "sign_ready", "B"),
    waitForReadiness(pageB, "ecdh_ready", "B"),
  ]);

  return {
    keyset,
    shareA,
    shareB,
    peerAPubkey32,
    peerBPubkey32,
    profileIdA,
    profileIdB,
  };
}

export function nextMessageHex(seed: number): string {
  const prefix = seed.toString(16).padStart(10, "0").slice(-10);
  return `${prefix}${"a".repeat(54)}`.slice(0, 64);
}

export async function runtimeSnapshot(page: Page): Promise<{
  eventLog: Array<{ badge: string; source: string; payload: unknown }>;
  lifecycle: Array<{ op_type: string; status: string; request_id: string }>;
  policyStates: unknown[];
  relays: Array<{ url: string; state: string }>;
}> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        runtimeEventLog?: Array<{
          badge: string;
          source: string;
          payload: unknown;
        }>;
        signLifecycleLog?: Array<{
          op_type: string;
          status: string;
          request_id: string;
        }>;
        runtimeStatus?: { peer_permission_states?: unknown[] } | null;
        runtimeRelays?: Array<{ url: string; state: string }>;
      };
    };
    return {
      eventLog: w.__appState?.runtimeEventLog ?? [],
      lifecycle: w.__appState?.signLifecycleLog ?? [],
      policyStates: w.__appState?.runtimeStatus?.peer_permission_states ?? [],
      relays: w.__appState?.runtimeRelays ?? [],
    };
  });
}
