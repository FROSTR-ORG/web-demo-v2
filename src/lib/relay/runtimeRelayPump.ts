import { defaultBifrostEventKind } from "../bifrost/packageService";
import { RuntimeClient } from "../bifrost/runtimeClient";
import type {
  CompletedOperation,
  OperationFailure,
  RuntimeEvent,
  RuntimeStatusSummary,
} from "../bifrost/types";
import {
  BrowserRelayClient,
  type RelayClient,
  type RelayConnection,
  type RelaySocketEvent,
} from "./browserRelayClient";
import type { RelayFilter, RelaySubscription } from "./relayPort";

export type RuntimeRelayState = "connecting" | "online" | "offline";

export interface RuntimeRelayStatus {
  url: string;
  state: RuntimeRelayState;
  lastConnectedAt?: number;
  lastError?: string;
  /**
   * Number of times this relay has successfully completed a connect after
   * the first one (monotonic). `0` on initial connect; incremented each
   * time `start()` / `simulateRestoreAll()` / `reconnect()` restores the
   * socket from an offline state. Optional for legacy callers that
   * construct literals; the pump itself always populates it.
   * Surfaced in `runtimeRelays[*]` so validators can detect a reconnect
   * cycle survived at least one drop (VAL-OPS-023 / VAL-OPS-028).
   */
  reconnectCount?: number;
  /**
   * Unix-ms timestamp of the most recent close event observed on this
   * relay's socket (either a real network-side close or a test-simulated
   * close via `__iglooTestDropRelays()`). `undefined` until the relay
   * has disconnected at least once.
   */
  lastDisconnectedAt?: number;
  /**
   * Close code from the most recent disconnect:
   *   - `1000` — normal shutdown
   *   - `1001` — going away (tab close)
   *   - `1006` — abnormal close with no close frame (test-simulated drop)
   *   - `1011` — server error
   *   - `null` — close observed without a numeric code
   *   - `undefined` — never disconnected
   */
  lastCloseCode?: number | null;
}

export interface RuntimeDrainBatch {
  completions: CompletedOperation[];
  failures: OperationFailure[];
  events: RuntimeEvent[];
}

interface RuntimeRelayPumpOptions {
  runtime: RuntimeClient;
  relays: string[];
  relayClient?: RelayClient;
  eventKind?: number;
  connectTimeoutMs?: number;
  now?: () => number;
  onRelayStatusChange?: (statuses: RuntimeRelayStatus[]) => void;
  /**
   * Invoked after every pump tick with the batch of drained completions,
   * failures, and lifecycle runtime events. Callers should not mutate the
   * arrays; the pump reuses new arrays on each invocation. Never called with
   * results that were produced before `start()`.
   */
  onDrains?: (drains: RuntimeDrainBatch) => void;
  /**
   * Optional observer called on every underlying socket event (open/close/
   * error) for diagnostic consumers. The pump itself already uses socket
   * events to drive per-relay telemetry; this hook is for additional
   * recorders such as the dev-only `window.__debug.relayHistory` ring.
   */
  onSocketEvent?: (event: RelaySocketEvent) => void;
}

interface RuntimeRelayConnectionState {
  url: string;
  connection: RelayConnection | null;
  subscription: RelaySubscription | null;
}

function uniqueRelays(relays: string[]): string[] {
  return Array.from(new Set(relays.map((relay) => relay.trim()).filter(Boolean)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RuntimeRelayPump {
  private readonly runtime: RuntimeClient;
  private readonly relayClient: RelayClient;
  private readonly connectTimeoutMs: number;
  private readonly now: () => number;
  private readonly onRelayStatusChange?: (statuses: RuntimeRelayStatus[]) => void;
  private readonly onDrains?: (drains: RuntimeDrainBatch) => void;
  private readonly connections: RuntimeRelayConnectionState[];
  private relayStatusesValue: RuntimeRelayStatus[];
  private stopped = true;
  private eventKindPromise: Promise<number>;

  private readonly onSocketEventHook?: (event: RelaySocketEvent) => void;
  private readonly lastFilter: { current: RelayFilter | null };

  constructor(options: RuntimeRelayPumpOptions) {
    const relays = uniqueRelays(options.relays);
    this.runtime = options.runtime;
    this.onSocketEventHook = options.onSocketEvent;
    // Install our own socket-event handler so the pump can drive
    // reconnectCount / lastCloseCode telemetry regardless of whether the
    // caller supplied its own BrowserRelayClient. When the caller did
    // supply one we still attach via an internal pump-level dispatcher,
    // meaning the caller's client may silently lose observability — in
    // practice only unit tests pass a custom RelayClient and they don't
    // rely on telemetry.
    this.relayClient =
      options.relayClient ??
      new BrowserRelayClient({
        onSocketEvent: (event) => this.handleSocketEvent(event),
      });
    this.connectTimeoutMs = options.connectTimeoutMs ?? 8_000;
    this.now = options.now ?? (() => Date.now());
    this.onRelayStatusChange = options.onRelayStatusChange;
    this.onDrains = options.onDrains;
    this.connections = relays.map((url) => ({
      url,
      connection: null,
      subscription: null,
    }));
    this.relayStatusesValue = relays.map((url) => ({
      url,
      state: "connecting",
      reconnectCount: 0,
    }));
    this.lastFilter = { current: null };
    this.eventKindPromise =
      options.eventKind === undefined
        ? defaultBifrostEventKind()
        : Promise.resolve(options.eventKind);
  }

  relayStatuses(): RuntimeRelayStatus[] {
    return this.relayStatusesValue.map((status) => ({ ...status }));
  }

  async start(): Promise<RuntimeStatusSummary> {
    this.stopped = false;
    this.connections.forEach((entry) => {
      entry.subscription?.close();
      entry.connection?.close();
      entry.subscription = null;
      entry.connection = null;
      this.updateRelay(entry.url, { state: "connecting", lastError: undefined });
    });

    const metadata = this.runtime.metadata();
    const eventKind = await this.eventKindPromise;
    const filter: RelayFilter = {
      kinds: [eventKind],
      authors: metadata.peers,
      "#p": [metadata.share_public_key],
    };
    this.lastFilter.current = filter;

    await Promise.all(
      this.connections.map((entry) => this.connectOne(entry, filter)),
    );

    if (!this.stopped) {
      return this.pump();
    }
    return this.runtime.runtimeStatus();
  }

  /**
   * Dev-only test helper: forcibly close every currently-open relay socket
   * with a synthesised close code (`1006` simulates an abnormal drop). Each
   * affected relay's telemetry is updated with `lastDisconnectedAt`,
   * `lastCloseCode`, and `state: "offline"`. This hook does NOT touch the
   * runtime state — in particular it does not synchronously mutate
   * `readiness.sign_ready`; the existing TTL-driven failure path must
   * surface any in-flight operation as a timeout (VAL-OPS-016).
   */
  simulateDropAll(code: number = 1006): void {
    this.connections.forEach((entry) => {
      entry.subscription?.close();
      entry.subscription = null;
      if (entry.connection) {
        const connection = entry.connection;
        entry.connection = null;
        if (
          "simulateAbnormalClose" in connection &&
          typeof (connection as { simulateAbnormalClose?: unknown })
            .simulateAbnormalClose === "function"
        ) {
          (
            connection as unknown as {
              simulateAbnormalClose: (c: number) => void;
            }
          ).simulateAbnormalClose(code);
        } else {
          connection.close();
          this.updateRelay(entry.url, {
            state: "offline",
            lastDisconnectedAt: this.now(),
            lastCloseCode: code,
          });
        }
      } else {
        this.updateRelay(entry.url, {
          state: "offline",
          lastDisconnectedAt: this.now(),
          lastCloseCode: code,
        });
      }
    });
  }

  /**
   * Dev-only test helper: re-establish the relay connections dropped by
   * {@link simulateDropAll}. For each relay, reopens a fresh socket and, on
   * a successful connect, increments `reconnectCount` and sets
   * `lastConnectedAt`.
   */
  async simulateRestoreAll(): Promise<void> {
    if (this.stopped) return;
    const filter = this.lastFilter.current;
    if (!filter) {
      // Connection never successfully started — nothing to restore.
      return;
    }
    await Promise.all(
      this.connections.map((entry) => {
        if (entry.connection) return Promise.resolve();
        this.updateRelay(entry.url, {
          state: "connecting",
          lastError: undefined,
        });
        return this.connectOne(entry, filter, { incrementReconnect: true });
      }),
    );
  }

  async refreshAll(): Promise<RuntimeStatusSummary> {
    if (!this.stopped) {
      this.runtime.handleCommand({ type: "refresh_all_peers" });
    }
    return this.pump();
  }

  async pump(): Promise<RuntimeStatusSummary> {
    this.runtime.tick(this.now());
    if (!this.stopped) {
      await this.publishOutboundEvents();
    }
    const completions = this.runtime.drainCompletions();
    const failures = this.runtime.drainFailures();
    const events = this.runtime.drainRuntimeEvents();
    if (
      this.onDrains &&
      (completions.length > 0 || failures.length > 0 || events.length > 0)
    ) {
      try {
        this.onDrains({ completions, failures, events });
      } catch {
        // Callback must not break pumping. Swallow and continue.
      }
    }
    return this.runtime.runtimeStatus();
  }

  stop(): void {
    this.stopped = true;
    this.connections.forEach((entry) => {
      entry.subscription?.close();
      entry.connection?.close();
      entry.subscription = null;
      entry.connection = null;
    });
  }

  /**
   * VAL-OPS-028 — close every currently-open relay socket with a
   * well-formed close frame (default `1001 'going-away'`). Intended for
   * `AppStateProvider`'s `beforeunload` handler so the relay observes a
   * clean close and the persisted `__debug.relayHistory` ring buffer
   * shows `lastCloseCode=1001 wasClean=true` after the tab reopens
   * instead of the default 1006 abnormal-close the OS would produce
   * otherwise.
   *
   * Connections that expose `closeCleanly` (the production
   * {@link BrowserRelayConnection}) receive the full clean-close path
   * with synthesised close event. Connections that don't (test fakes
   * from unit tests that mock the RelayClient directly) fall back to a
   * plain `close()` so behavior in those tests is preserved.
   */
  closeCleanly(
    code: number = 1001,
    reason: string = "going-away",
  ): void {
    this.connections.forEach((entry) => {
      const connection = entry.connection;
      entry.subscription?.close();
      entry.subscription = null;
      if (!connection) return;
      entry.connection = null;
      if (
        "closeCleanly" in connection &&
        typeof (connection as { closeCleanly?: unknown }).closeCleanly ===
          "function"
      ) {
        try {
          (
            connection as unknown as {
              closeCleanly: (c: number, r: string) => void;
            }
          ).closeCleanly(code, reason);
        } catch {
          // Fall through to a plain close if the clean-close path fails.
          try {
            connection.close();
          } catch {
            // Already closed — nothing more to do.
          }
        }
      } else {
        connection.close();
      }
    });
  }

  private async connectOne(
    entry: RuntimeRelayConnectionState,
    filter: RelayFilter,
    options: { incrementReconnect?: boolean } = {},
  ): Promise<void> {
    const connection = this.relayClient.connect(entry.url);
    entry.connection = connection;
    try {
      await this.withTimeout(connection.connect());
      if (this.stopped) {
        connection.close();
        return;
      }
      entry.subscription = connection.subscribe(filter, (event) => {
        this.handleInboundEvent(event);
      });
      const patch: Partial<RuntimeRelayStatus> = {
        state: "online",
        lastConnectedAt: this.now(),
        lastError: undefined,
      };
      if (options.incrementReconnect) {
        const existing = this.relayStatusesValue.find(
          (status) => status.url === entry.url,
        );
        patch.reconnectCount = (existing?.reconnectCount ?? 0) + 1;
      }
      this.updateRelay(entry.url, patch);
    } catch (error) {
      connection.close();
      this.updateRelay(entry.url, {
        state: "offline",
        lastError: errorMessage(error),
      });
    }
  }

  /**
   * Receive every socket lifecycle event from the BrowserRelayClient this
   * pump owns. We re-fire to the caller's hook (if any) so dev-only
   * recorders like `window.__debug.relayHistory` can observe them, and for
   * close/error events we also update the relevant relay telemetry entry
   * so `runtimeRelays[*]` reflects drops that happen asynchronously
   * (server-side 1011, network 1006, etc.).
   */
  private handleSocketEvent(event: RelaySocketEvent): void {
    if (event.type === "close") {
      // Only update when the url matches a known relay; ignore spurious
      // events from orphaned connections that outlived a stop()/start().
      const existing = this.relayStatusesValue.find(
        (status) => status.url === event.url,
      );
      if (existing) {
        this.updateRelay(event.url, {
          state: "offline",
          lastDisconnectedAt: event.at,
          lastCloseCode: event.code ?? null,
        });
      }
    }
    this.onSocketEventHook?.(event);
  }

  private async publishOutboundEvents(): Promise<void> {
    const events = this.runtime.drainOutboundEvents();
    const online = this.connections.filter(
      (entry) =>
        entry.connection &&
        this.relayStatusesValue.find((status) => status.url === entry.url)
          ?.state === "online",
    );
    await Promise.all(
      online.flatMap((entry) =>
        events.map(async (event) => {
          try {
            await entry.connection?.publish(event);
          } catch (error) {
            entry.connection?.close();
            entry.subscription = null;
            entry.connection = null;
            this.updateRelay(entry.url, {
              state: "offline",
              lastError: errorMessage(error),
            });
          }
        }),
      ),
    );
  }

  private handleInboundEvent(event: unknown): void {
    if (this.stopped) {
      return;
    }
    try {
      this.runtime.handleInboundEvent(event);
      void this.pump();
    } catch {
      // The runtime owns recipient and payload validation. Non-routable relay
      // events are expected on shared subscriptions.
    }
  }

  private updateRelay(url: string, patch: Partial<RuntimeRelayStatus>): void {
    this.relayStatusesValue = this.relayStatusesValue.map((status) =>
      status.url === url ? { ...status, ...patch, url } : status,
    );
    this.onRelayStatusChange?.(this.relayStatuses());
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    return new Promise<T>((resolve, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new Error("Relay connection timed out."));
      }, this.connectTimeoutMs);
      promise.then(resolve, reject).finally(() => {
        if (timer !== undefined) {
          globalThis.clearTimeout(timer);
        }
      });
    });
  }
}
