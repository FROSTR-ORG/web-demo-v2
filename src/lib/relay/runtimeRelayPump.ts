import { defaultBifrostEventKind } from "../bifrost/packageService";
import { RuntimeClient } from "../bifrost/runtimeClient";
import type {
  CompletedOperation,
  OperationFailure,
  RuntimeEvent,
  RuntimeStatusSummary,
} from "../bifrost/types";
import { BrowserRelayClient, type RelayClient, type RelayConnection } from "./browserRelayClient";
import type { RelayFilter, RelaySubscription } from "./relayPort";

export type RuntimeRelayState = "connecting" | "online" | "offline";

export interface RuntimeRelayStatus {
  url: string;
  state: RuntimeRelayState;
  lastConnectedAt?: number;
  lastError?: string;
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

  constructor(options: RuntimeRelayPumpOptions) {
    const relays = uniqueRelays(options.relays);
    this.runtime = options.runtime;
    this.relayClient = options.relayClient ?? new BrowserRelayClient();
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
    }));
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

    await Promise.all(
      this.connections.map((entry) => this.connectOne(entry, filter)),
    );

    if (!this.stopped) {
      return this.pump();
    }
    return this.runtime.runtimeStatus();
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

  private async connectOne(
    entry: RuntimeRelayConnectionState,
    filter: RelayFilter,
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
      this.updateRelay(entry.url, {
        state: "online",
        lastConnectedAt: this.now(),
        lastError: undefined,
      });
    } catch (error) {
      connection.close();
      this.updateRelay(entry.url, {
        state: "offline",
        lastError: errorMessage(error),
      });
    }
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
