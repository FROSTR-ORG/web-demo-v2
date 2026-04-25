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
import {
  RELAY_PING_INTERVAL_MS,
  RELAY_PING_TIMEOUT_MS,
  SLOW_RELAY_CONSECUTIVE_SAMPLES,
  SLOW_RELAY_THRESHOLD_MS,
} from "./relayTelemetry";

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
  /**
   * m5-relay-telemetry — most-recent REQ→EOSE round-trip time in
   * milliseconds. `undefined` until the first successful ping sample
   * completes, or after the pump resets this relay's telemetry on
   * reconnect. Populated from the `ping_sample` socket event that
   * {@link BrowserRelayConnection.ping} emits. Powers VAL-SETTINGS-010
   * (numeric ms Latency column).
   */
  latencyMs?: number;
  /**
   * Running counter of inbound NIP-01 `EVENT` frames observed on this
   * relay's socket since the current connection opened. Advances by
   * `+1` per inbound EVENT regardless of whether the event matched the
   * runtime filter. Reset to `0` every time the pump successfully
   * (re)connects this relay (VAL-SETTINGS-011).
   *
   * Optional for legacy literal callers (unit-test fixtures that
   * predate this field); the pump itself always populates it.
   */
  eventsReceived?: number;
  /**
   * Unix-ms timestamp of the most recent inbound EVENT on this relay.
   * `undefined` until at least one EVENT has been observed. Used by
   * the Dashboard's Last-Seen column (VAL-SETTINGS-012) to render the
   * relative "Xs ago" / "Xm ago" copy against the current clock.
   */
  lastEventAt?: number;
  /**
   * Count of consecutive latency samples whose RTT exceeded
   * {@link SLOW_RELAY_THRESHOLD_MS}. A sample at or below the threshold
   * resets this counter to `0`. When the counter reaches
   * {@link SLOW_RELAY_CONSECUTIVE_SAMPLES} (2) the relay renders in
   * the Slow (amber) status per VAL-SETTINGS-013.
   *
   * Optional for legacy literal callers (unit-test fixtures that
   * predate this field); the pump itself always populates it.
   */
  consecutiveSlowSamples?: number;
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
   * Called after `refresh_all_peers` has materialised its fan-out Ping
   * operations and before the resulting drains are emitted. App state uses
   * this to tag background liveness probes so they do not masquerade as
   * user/dev pings when completions or failures arrive later.
   */
  onRefreshPingRequestIds?: (requestIds: string[]) => void;
  /**
   * Optional observer called on every underlying socket event (open/close/
   * error) for diagnostic consumers. The pump itself already uses socket
   * events to drive per-relay telemetry; this hook is for additional
   * recorders such as the dev-only `window.__debug.relayHistory` ring.
   */
  onSocketEvent?: (event: RelaySocketEvent) => void;
  /**
   * m5-relay-telemetry — override the interval (ms) between per-relay
   * latency probes. Defaults to {@link RELAY_PING_INTERVAL_MS}. Unit
   * tests dial this down so the first two samples land within a single
   * fake-timer advance.
   */
  pingIntervalMs?: number;
  /**
   * m5-relay-telemetry — override the probe timeout (ms). Defaults to
   * {@link RELAY_PING_TIMEOUT_MS}.
   */
  pingTimeoutMs?: number;
}

interface RuntimeRelayConnectionState {
  url: string;
  connection: RelayConnection | null;
  subscription: RelaySubscription | null;
  /**
   * Handle returned by `setInterval` for the per-relay latency sampler.
   * `null` until the relay first transitions to `online`; cleared (and
   * the interval killed) on disconnect, stop, or removal so we never
   * leak timers across reconnect cycles.
   */
  pingTimer: ReturnType<typeof globalThis.setInterval> | null;
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
  private readonly onRefreshPingRequestIds?: (requestIds: string[]) => void;
  private readonly connections: RuntimeRelayConnectionState[];
  private relayStatusesValue: RuntimeRelayStatus[];
  private stopped = true;
  private eventKindPromise: Promise<number>;

  private readonly onSocketEventHook?: (event: RelaySocketEvent) => void;
  private readonly lastFilter: { current: RelayFilter | null };
  private readonly pingIntervalMs: number;
  private readonly pingTimeoutMs: number;

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
    this.pingIntervalMs = options.pingIntervalMs ?? RELAY_PING_INTERVAL_MS;
    this.pingTimeoutMs = options.pingTimeoutMs ?? RELAY_PING_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.onRelayStatusChange = options.onRelayStatusChange;
    this.onDrains = options.onDrains;
    this.onRefreshPingRequestIds = options.onRefreshPingRequestIds;
    this.connections = relays.map((url) => ({
      url,
      connection: null,
      subscription: null,
      pingTimer: null,
    }));
    this.relayStatusesValue = relays.map((url) => ({
      url,
      state: "connecting",
      reconnectCount: 0,
      eventsReceived: 0,
      consecutiveSlowSamples: 0,
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
      if (entry.pingTimer) {
        globalThis.clearInterval(entry.pingTimer);
        entry.pingTimer = null;
      }
      this.updateRelay(entry.url, {
        state: "connecting",
        lastError: undefined,
      });
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
      if (entry.pingTimer) {
        globalThis.clearInterval(entry.pingTimer);
        entry.pingTimer = null;
      }
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
    let baselineIds: Set<string> | null = null;
    if (!this.stopped) {
      baselineIds = new Set(
        this.runtime.runtimeStatus().pending_operations.map(
          (op) => op.request_id,
        ),
      );
      this.runtime.handleCommand({ type: "refresh_all_peers" });
    }
    this.runtime.tick(this.now());
    if (baselineIds) {
      const requestIds = this.runtime
        .runtimeStatus()
        .pending_operations.filter(
          (op) => op.op_type === "Ping" && !baselineIds.has(op.request_id),
        )
        .map((op) => op.request_id);
      if (requestIds.length > 0) {
        try {
          this.onRefreshPingRequestIds?.(requestIds);
        } catch (err) {
          console.error("[RuntimeRelayPump] onRefreshPingRequestIds failed", err);
        }
      }
    }
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
      if (entry.pingTimer) {
        globalThis.clearInterval(entry.pingTimer);
        entry.pingTimer = null;
      }
    });
  }

  /**
   * Hot-reload the relay list: connect newly-added URLs, close removed
   * URLs with a clean close frame (default `1000 "relay-removed"`), and
   * leave URLs present on both sides untouched. Counters and subscription
   * state survive for untouched relays so the UI's per-relay telemetry
   * (events received, last-seen, reconnectCount) is preserved across a
   * relay-list edit (VAL-SETTINGS-005 / VAL-SETTINGS-006 /
   * VAL-SETTINGS-022).
   *
   * De-dup rules:
   *   - Trim + drop empty strings.
   *   - Exact case-sensitive equality against existing connection urls;
   *     callers should normalise before dispatch if they want
   *     case-insensitive de-dup (AppStateProvider.updateRelays already
   *     does so via `normalizeRelayKey`).
   *
   * The pump must be started (i.e. have a live filter) before the first
   * call; if not, newly-added relays are registered with `connecting`
   * telemetry but are not dialed until `start()` runs.
   */
  async updateRelays(
    nextRelays: string[],
    closeCode: number = 1000,
    closeReason: string = "relay-removed",
  ): Promise<void> {
    if (this.stopped) return;
    const next = uniqueRelays(nextRelays);
    const nextSet = new Set(next);
    const currentUrls = this.connections.map((entry) => entry.url);
    const removed = currentUrls.filter((url) => !nextSet.has(url));
    const added = next.filter((url) => !currentUrls.includes(url));

    // Close removed relays with a clean close frame. For each removed
    // entry we drop the subscription first (so no inbound relay event
    // arrives after the socket is gone), then close cleanly when the
    // underlying connection supports it, or fall back to plain `close()`
    // for test fakes.
    removed.forEach((url) => {
      const index = this.connections.findIndex((entry) => entry.url === url);
      if (index === -1) return;
      const entry = this.connections[index];
      entry.subscription?.close();
      entry.subscription = null;
      if (entry.pingTimer) {
        globalThis.clearInterval(entry.pingTimer);
        entry.pingTimer = null;
      }
      const connection = entry.connection;
      entry.connection = null;
      if (connection) {
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
            ).closeCleanly(closeCode, closeReason);
          } catch {
            try {
              connection.close();
            } catch {
              // already closed
            }
          }
        } else {
          try {
            connection.close();
          } catch {
            // already closed
          }
        }
      }
      // Drop from the ordered connection list + telemetry in lock-step.
      this.connections.splice(index, 1);
      this.relayStatusesValue = this.relayStatusesValue.filter(
        (status) => status.url !== url,
      );
    });

    // Register new relays optimistically (so the UI shows `connecting`
    // immediately) before dialing them. If the filter is not yet known
    // (pump started but connect handshake never finished — the typical
    // case is test setups that skip start()), we short-circuit the dial
    // and leave them in `connecting` so a subsequent `start()` picks
    // them up.
    if (added.length > 0) {
      added.forEach((url) => {
        this.connections.push({
          url,
          connection: null,
          subscription: null,
          pingTimer: null,
        });
        this.relayStatusesValue = [
          ...this.relayStatusesValue,
          {
            url,
            state: "connecting",
            reconnectCount: 0,
            eventsReceived: 0,
            consecutiveSlowSamples: 0,
          },
        ];
      });
      this.onRelayStatusChange?.(this.relayStatuses());
      const filter = this.lastFilter.current;
      if (filter) {
        await Promise.all(
          added.map((url) => {
            const entry = this.connections.find(
              (candidate) => candidate.url === url,
            );
            if (!entry) return Promise.resolve();
            return this.connectOne(entry, filter);
          }),
        );
      }
    }

    // Emit a final status snapshot so subscribers see the converged list
    // even if only removals happened (connectOne already pings the
    // subscriber for each added relay).
    this.onRelayStatusChange?.(this.relayStatuses());
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
      if (entry.pingTimer) {
        globalThis.clearInterval(entry.pingTimer);
        entry.pingTimer = null;
      }
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
    // Always cancel any stale ping timer before we dial — on reconnect
    // the new connection owns a fresh sampler.
    this.clearPingTimer(entry.url);
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
      // m5-relay-telemetry: reset per-connection counters on (re)connect
      // so VAL-SETTINGS-011 sees `eventsReceived = 0` immediately after
      // a fresh socket opens.
      const patch: Partial<RuntimeRelayStatus> = {
        state: "online",
        lastConnectedAt: this.now(),
        lastError: undefined,
        eventsReceived: 0,
        consecutiveSlowSamples: 0,
        latencyMs: undefined,
        lastEventAt: undefined,
      };
      if (options.incrementReconnect) {
        const existing = this.relayStatusesValue.find(
          (status) => status.url === entry.url,
        );
        patch.reconnectCount = (existing?.reconnectCount ?? 0) + 1;
      }
      this.updateRelay(entry.url, patch);
      this.schedulePingTimer(entry);
    } catch (error) {
      connection.close();
      // fix-followup-create-bootstrap-live-relay-pump — if the pump was
      // stopped (e.g. the AppStateProvider swapped in a
      // `LocalRuntimeSimulator` via the DEV `__iglooTestAttachSimulator`
      // hook) while the `connect()` promise was still pending, the
      // resulting `offline` status must NOT leak back into the host's
      // `onRelayStatusChange` callback — the host has already cleared
      // `runtimeRelays` on the strength of the synchronous `stop()` and
      // does not expect a post-stop status emission.
      if (this.stopped) return;
      this.updateRelay(entry.url, {
        state: "offline",
        lastError: errorMessage(error),
      });
    }
  }

  /**
   * Start a repeating latency probe for `entry`. Fires a first sample
   * immediately (so VAL-SETTINGS-010's "≤10 s to numeric Latency"
   * window is satisfied regardless of the configured interval) and
   * then schedules additional samples every `pingIntervalMs`. Any
   * prior timer for this URL is cleared first so this method is
   * idempotent.
   */
  private schedulePingTimer(entry: RuntimeRelayConnectionState): void {
    this.clearPingTimer(entry.url);
    // Fire the first sample asynchronously — no reason to hold up
    // connectOne's return.
    void this.sampleRelayLatency(entry);
    entry.pingTimer = globalThis.setInterval(() => {
      void this.sampleRelayLatency(entry);
    }, this.pingIntervalMs);
  }

  private clearPingTimer(url: string): void {
    const entry = this.connections.find((candidate) => candidate.url === url);
    if (!entry || !entry.pingTimer) return;
    globalThis.clearInterval(entry.pingTimer);
    entry.pingTimer = null;
  }

  /**
   * Drive a single REQ→EOSE probe on `entry.connection`. Swallows
   * all errors so a flaky relay cannot break the sampler schedule;
   * the connection-level `ping_sample` / `ping_timeout` telemetry
   * event is the authoritative signal for the UI.
   */
  private async sampleRelayLatency(
    entry: RuntimeRelayConnectionState,
  ): Promise<void> {
    const connection = entry.connection;
    if (!connection || this.stopped) return;
    const status = this.relayStatusesValue.find(
      (candidate) => candidate.url === entry.url,
    );
    if (!status || status.state !== "online") return;
    if (typeof connection.ping !== "function") return;
    try {
      await connection.ping(this.pingTimeoutMs);
    } catch {
      // `ping()` should not throw in practice; if it does the socket
      // will be marked offline by the close listener and we just
      // drop the sample.
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
    const existing = this.relayStatusesValue.find(
      (status) => status.url === event.url,
    );
    if (event.type === "close") {
      // Only update when the url matches a known relay; ignore spurious
      // events from orphaned connections that outlived a stop()/start().
      if (existing) {
        this.updateRelay(event.url, {
          state: "offline",
          lastDisconnectedAt: event.at,
          lastCloseCode: event.code ?? null,
        });
        this.clearPingTimer(event.url);
      }
    } else if (event.type === "event_received") {
      // VAL-SETTINGS-011 / VAL-SETTINGS-012: advance the inbound-EVENT
      // counter and the last-seen timestamp.
      if (existing) {
        this.updateRelay(event.url, {
          eventsReceived: (existing.eventsReceived ?? 0) + 1,
          lastEventAt: event.at,
        });
      }
    } else if (event.type === "ping_sample") {
      // VAL-SETTINGS-010 / VAL-SETTINGS-013: record latency and the
      // consecutive-slow counter so the UI mapper can render Slow after
      // `SLOW_RELAY_CONSECUTIVE_SAMPLES` over-threshold samples.
      if (existing) {
        const nextCount =
          event.rtt_ms > SLOW_RELAY_THRESHOLD_MS
            ? (existing.consecutiveSlowSamples ?? 0) + 1
            : 0;
        this.updateRelay(event.url, {
          latencyMs: event.rtt_ms,
          consecutiveSlowSamples: nextCount,
        });
      }
    } else if (event.type === "ping_timeout") {
      // A timed-out probe does not change Online/Slow status (the
      // socket may still be healthy), but it does freeze the displayed
      // latency number rather than refreshing to a fresh sample.
    }
    this.onSocketEventHook?.(event);
  }

  /**
   * Publish a single prepared Nostr event to every relay that is currently
   * `online`. Each relay is dialed in parallel with independent error
   * handling so one relay failing does not short-circuit the others.
   * Returns the list of relay URLs that accepted the publish (`reached`)
   * and the list that rejected or threw (`failed`). A pump that is
   * stopped, has no online relays, or was never started resolves to empty
   * arrays. Callers decide whether "no relays reached" is user-visible.
   */
  async publishEvent(
    event: unknown,
  ): Promise<{ reached: string[]; failed: string[] }> {
    if (this.stopped) {
      return { reached: [], failed: [] };
    }
    const onlineEntries = this.connections.filter(
      (entry) =>
        entry.connection &&
        this.relayStatusesValue.find((status) => status.url === entry.url)
          ?.state === "online",
    );
    if (onlineEntries.length === 0) {
      return { reached: [], failed: [] };
    }
    const settled = await Promise.allSettled(
      onlineEntries.map(async (entry) => {
        await entry.connection!.publish(event);
        return entry.url;
      }),
    );
    const reached: string[] = [];
    const failed: string[] = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        reached.push(outcome.value);
      } else {
        failed.push(onlineEntries[index].url);
      }
    });
    return { reached, failed };
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
