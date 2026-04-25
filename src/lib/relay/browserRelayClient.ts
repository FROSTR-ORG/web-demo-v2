import type { RelayFilter, RelaySubscription } from "./relayPort";

export type OnboardingRelayErrorCode =
  | "relay_unreachable"
  | "onboard_timeout"
  | "onboard_rejected"
  | "invalid_onboard_response";

export class OnboardingRelayError extends Error {
  constructor(
    public readonly code: OnboardingRelayErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OnboardingRelayError";
  }
}

export const ONBOARDING_RELAY_HANDSHAKE_TIMEOUT_MS = 180_000;
export const ONBOARDING_RELAY_RETRY_INTERVAL_MS = 5_000;

export interface OnboardingRelayRequest {
  request_id?: string;
  local_pubkey32: string;
  event_json: string;
}

export type OnboardingRelayProgressEvent =
  | { type: "relay_connecting"; relays: string[] }
  | { type: "relay_connected"; relay: string; connectedRelays: string[] }
  | { type: "relay_connect_failed"; relay: string; message: string }
  | { type: "request_published"; relays: string[]; attempt: number; requestId?: string }
  | { type: "request_publish_failed"; relay: string; message: string; attempt: number; requestId?: string }
  | { type: "request_retry_scheduled"; attempt: number; delayMs: number }
  | { type: "response_candidate"; relay?: string }
  | { type: "response_decoded"; relay?: string }
  | { type: "timeout" };

export interface RelayConnection {
  url: string;
  connect(): Promise<void>;
  publish(event: unknown): Promise<void>;
  subscribe(
    filter: RelayFilter,
    onEvent: (event: unknown) => void,
    onNotice?: (message: string) => void,
  ): RelaySubscription;
  /**
   * Optional latency probe (m5-relay-telemetry). Implementations that
   * do not support RTT sampling (test fakes) may omit it — callers
   * treat the missing method as "no sample".
   */
  ping?(timeoutMs: number): Promise<number | null>;
  close(): void;
}

export interface RelayClient {
  connect(url: string): RelayConnection;
}

interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  /**
   * Close the underlying socket. Optional `code`/`reason` arguments are
   * forwarded when provided so callers can emit a well-formed WebSocket
   * close frame (e.g. 1001 "going-away" during page unload — VAL-OPS-028).
   * When omitted the browser defaults apply (1005 "no status rcvd").
   */
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ): void;
}

/**
 * Lightweight observable WS lifecycle event emitted by
 * {@link BrowserRelayClient} so higher-layer code (the RuntimeRelayPump, the
 * dev-only `window.__debug.relayHistory` recorder) can observe every
 * open/close transition without reaching into the socket directly.
 *
 * Close events carry a numeric `code` when the browser provided one
 * (`CloseEvent.code`) or `null` when the event was synthesised by us for a
 * connection that was never given a chance to report. The
 * `wasClean` flag mirrors `CloseEvent.wasClean` — `true` for cooperative
 * shutdown (1000 "normal"), `false` for abnormal terminations (e.g. 1006).
 */
export type RelaySocketEvent =
  | { type: "open"; url: string; at: number }
  | {
      type: "close";
      url: string;
      at: number;
      code: number | null;
      wasClean: boolean;
    }
  | { type: "error"; url: string; at: number }
  /**
   * Emitted once per inbound NIP-01 `EVENT` frame that the connection
   * observed on the wire, regardless of whether any subscription matched.
   * Consumed by `RuntimeRelayPump` to drive the per-relay `eventsReceived`
   * counter (VAL-SETTINGS-011) and to advance `lastEventAt`
   * (VAL-SETTINGS-012).
   */
  | { type: "event_received"; url: string; at: number }
  /**
   * Emitted when a `ping()` probe subscription completed its REQ→EOSE
   * round-trip. `rtt_ms` is the measured elapsed time in milliseconds
   * (VAL-SETTINGS-010, VAL-SETTINGS-013).
   */
  | { type: "ping_sample"; url: string; at: number; rtt_ms: number }
  /**
   * Emitted when a `ping()` probe did not receive an EOSE within its
   * timeout window. The pump uses this to skip a sample (no counter
   * increment) without marking the relay offline.
   */
  | { type: "ping_timeout"; url: string; at: number };

export interface BrowserRelayClientOptions {
  createSocket?: (url: string) => WebSocketLike;
  /**
   * Optional observer invoked on every socket lifecycle event. Used by
   * `RuntimeRelayPump` to drive per-relay `reconnectCount` / `lastCloseCode`
   * telemetry and the dev-only relay-history ring buffer.
   */
  onSocketEvent?: (event: RelaySocketEvent) => void;
}

export class BrowserRelayClient implements RelayClient {
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly onSocketEvent?: (event: RelaySocketEvent) => void;
  /**
   * Every BrowserRelayConnection this client has issued that has not yet
   * been closed. Used by {@link closeCleanly} to iterate managed sockets
   * during page unload (VAL-OPS-028). Connections remove themselves from
   * this set on {@link BrowserRelayConnection.close} /
   * {@link BrowserRelayConnection.closeCleanly}.
   */
  private readonly managedConnections = new Set<BrowserRelayConnection>();

  constructor(
    options?:
      | BrowserRelayClientOptions
      | ((url: string) => WebSocketLike),
  ) {
    if (typeof options === "function") {
      this.createSocket = options;
    } else {
      this.createSocket = options?.createSocket ?? ((url) => new WebSocket(url));
      this.onSocketEvent = options?.onSocketEvent;
    }
  }

  connect(url: string): RelayConnection {
    const connection = new BrowserRelayConnection(
      url,
      this.createSocket,
      this.onSocketEvent,
      (closed) => {
        this.managedConnections.delete(closed);
      },
    );
    this.managedConnections.add(connection);
    return connection;
  }

  /**
   * VAL-OPS-028 — cleanly close every currently-managed relay socket with
   * a well-formed close frame (default `1001 'going-away'`). Browsers
   * default to code 1006 (abnormal) when the OS tears down the socket
   * AFTER `beforeunload`, so the AppStateProvider teardown path must
   * invoke this proactively before the tab dies. Safe to call when no
   * connections exist. Errors from individual sockets are swallowed so a
   * single bad relay cannot block the others.
   */
  closeCleanly(
    code: number = 1001,
    reason: string = "going-away",
  ): void {
    // Copy to an array first: closeCleanly() mutates `managedConnections`
    // via the onDispose callback.
    const managed = Array.from(this.managedConnections);
    for (const connection of managed) {
      try {
        connection.closeCleanly(code, reason);
      } catch {
        // Best-effort during unload. Continue with the remaining sockets.
      }
    }
  }
}

class BrowserRelayConnection implements RelayConnection {
  private socket: WebSocketLike | null = null;
  private subscriptionSeq = 0;
  private subscriptions = new Map<string, (event: unknown) => void>();
  private noticeListeners = new Set<(message: string) => void>();
  private okListeners = new Map<
    string,
    (accepted: boolean, message: string) => void
  >();
  /**
   * Per-subscription EOSE listeners. Populated transiently by
   * {@link ping} so the probe can resolve on the matching EOSE frame;
   * production subscriptions (`subscribe()`) do not install one because
   * the runtime consumes EOSE implicitly via its subscription filter.
   */
  private eoseListeners = new Map<string, () => void>();
  private messageListener: ((event: Event | MessageEvent) => void) | null =
    null;
  private persistentCloseListener:
    | ((event: Event | MessageEvent) => void)
    | null = null;
  /**
   * When true, the next real close event fired by the underlying socket is
   * not propagated to `onSocketEvent`. Used by {@link simulateAbnormalClose}
   * so the caller's synthesised close (with a specific `code` like 1006) is
   * the authoritative event seen by subscribers.
   */
  private suppressNextCloseReport = false;

  constructor(
    public readonly url: string,
    private readonly createSocket: (url: string) => WebSocketLike,
    private readonly onSocketEvent?: (event: RelaySocketEvent) => void,
    /**
     * Invoked when this connection is definitively torn down (either via
     * {@link close} or {@link closeCleanly}) so {@link BrowserRelayClient}
     * can drop it from its `managedConnections` set. No-op when the owner
     * is not a BrowserRelayClient (e.g. direct callers in tests).
     */
    private readonly onDispose?: (self: BrowserRelayConnection) => void,
  ) {}

  connect(): Promise<void> {
    if (this.socket?.readyState === 1) {
      return Promise.resolve();
    }

    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.messageListener = (event) => this.handleMessage(event as MessageEvent);
    socket.addEventListener("message", this.messageListener);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };
      const handleOpen = () => {
        cleanup();
        // Install the persistent close listener so close events emitted
        // after a successful open still reach observers (network drops,
        // relay-side shutdowns, __iglooTestDropRelays).
        this.attachPersistentCloseListener(socket);
        this.emitSocketEvent({ type: "open", url: this.url, at: Date.now() });
        resolve();
      };
      const handleError = () => {
        cleanup();
        this.emitSocketEvent({
          type: "error",
          url: this.url,
          at: Date.now(),
        });
        reject(new Error(`Relay connection failed: ${this.url}`));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error(`Relay closed before opening: ${this.url}`));
      };
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  /**
   * Emit a synthetic "close" event with a caller-provided code (e.g. 1006
   * "simulated abnormal close" for `window.__iglooTestDropRelays()`), then
   * close the underlying socket. The next real close event is suppressed so
   * observers see exactly one close transition with the simulated code.
   */
  simulateAbnormalClose(code: number): void {
    if (!this.socket) return;
    this.suppressNextCloseReport = true;
    this.emitSocketEvent({
      type: "close",
      url: this.url,
      at: Date.now(),
      code,
      wasClean: false,
    });
    this.close();
  }

  /**
   * VAL-OPS-028 — close the underlying WebSocket with a well-formed close
   * frame (default 1001 "going-away"). Emits a synthesized close event
   * with `wasClean=true` so observers (e.g. the dev-only
   * `window.__debug.relayHistory` recorder) see the clean transition
   * *before* the browser tears the tab down; the subsequent real close
   * event is suppressed so the ring buffer records exactly one entry per
   * relay. Safe to call when the connection was never opened (no-op).
   */
  closeCleanly(
    code: number = 1001,
    reason: string = "going-away",
  ): void {
    if (!this.socket) {
      // Never opened a socket — nothing to close, but still notify the
      // owner so it can drop us from its managed set.
      this.onDispose?.(this);
      return;
    }
    const socket = this.socket;
    this.suppressNextCloseReport = true;
    this.emitSocketEvent({
      type: "close",
      url: this.url,
      at: Date.now(),
      code,
      wasClean: true,
    });
    // Attempt socket.close(code, reason) to send a proper close frame.
    // Some implementations may throw on invalid codes/reasons; fall back
    // to an argument-less close so the socket still terminates.
    try {
      socket.close(code, reason);
    } catch {
      try {
        socket.close();
      } catch {
        // Already closed — nothing more to do.
      }
    }
    // Drop internal listeners/subscriptions WITHOUT calling close() again
    // (we already closed the socket above with the clean code).
    if (this.messageListener) {
      socket.removeEventListener("message", this.messageListener);
    }
    if (this.persistentCloseListener) {
      socket.removeEventListener("close", this.persistentCloseListener);
    }
    this.subscriptions.clear();
    this.noticeListeners.clear();
    this.eoseListeners.clear();
    this.okListeners.clear();
    this.socket = null;
    this.messageListener = null;
    this.persistentCloseListener = null;
    this.onDispose?.(this);
  }

  private attachPersistentCloseListener(socket: WebSocketLike): void {
    if (this.persistentCloseListener) {
      socket.removeEventListener("close", this.persistentCloseListener);
    }
    const listener = (event: Event | MessageEvent) => {
      if (this.suppressNextCloseReport) {
        this.suppressNextCloseReport = false;
        return;
      }
      const closeEvent = event as Event & { code?: number; wasClean?: boolean };
      const code =
        typeof closeEvent.code === "number" ? closeEvent.code : null;
      // VAL-OPS-028: codes 1000 ("normal"), 1001 ("going-away"), and
      // 1002 ("protocol error", still a structured close) represent a
      // cooperative shutdown and must surface as `wasClean=true` in
      // telemetry even when the browser-native CloseEvent.wasClean flag
      // is false (it can lag for 1001 on tab unload). Any other code
      // (1006 abnormal, 1011 server error, etc.) keeps wasClean=false
      // so VAL-OPS-016's abnormal-drop expectations continue to hold.
      const wasClean =
        code !== null
          ? code >= 1000 && code <= 1002
          : Boolean(closeEvent.wasClean);
      this.emitSocketEvent({
        type: "close",
        url: this.url,
        at: Date.now(),
        code,
        wasClean,
      });
    };
    this.persistentCloseListener = listener;
    socket.addEventListener("close", listener);
  }

  private emitSocketEvent(event: RelaySocketEvent): void {
    if (!this.onSocketEvent) return;
    try {
      this.onSocketEvent(event);
    } catch {
      // Observer must not break the connection pipeline.
    }
  }

  publish(event: unknown): Promise<void> {
    const socket = this.requireOpenSocket();
    const eventId =
      event &&
      typeof event === "object" &&
      typeof (event as { id?: unknown }).id === "string"
        ? (event as { id: string }).id
        : null;
    socket.send(JSON.stringify(["EVENT", event]));
    if (!eventId) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.okListeners.delete(eventId);
        // Some relays still omit OK. Treat the already-sent frame as
        // best-effort success so older relay behavior does not hang flows.
        resolve();
      }, 2_000);
      this.okListeners.set(eventId, (accepted, message) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        this.okListeners.delete(eventId);
        if (accepted) {
          resolve();
        } else {
          reject(new Error(message || `Relay rejected event: ${this.url}`));
        }
      });
    });
  }

  subscribe(
    filter: RelayFilter,
    onEvent: (event: unknown) => void,
    onNotice?: (message: string) => void,
  ): RelaySubscription {
    const socket = this.requireOpenSocket();
    const id = `onboard-${Date.now()}-${this.subscriptionSeq}`;
    this.subscriptionSeq += 1;
    this.subscriptions.set(id, onEvent);
    if (onNotice) {
      this.noticeListeners.add(onNotice);
    }
    socket.send(JSON.stringify(["REQ", id, filter]));
    return {
      close: () => {
        this.subscriptions.delete(id);
        if (onNotice) {
          this.noticeListeners.delete(onNotice);
        }
        if (this.socket?.readyState === 1) {
          this.socket.send(JSON.stringify(["CLOSE", id]));
        }
      },
    };
  }

  close(): void {
    if (this.socket && this.messageListener) {
      this.socket.removeEventListener("message", this.messageListener);
    }
    if (this.socket && this.persistentCloseListener) {
      this.socket.removeEventListener("close", this.persistentCloseListener);
    }
    this.subscriptions.clear();
    this.noticeListeners.clear();
    this.eoseListeners.clear();
    this.okListeners.clear();
    this.socket?.close();
    this.socket = null;
    this.messageListener = null;
    this.persistentCloseListener = null;
    this.onDispose?.(this);
  }

  private requireOpenSocket(): WebSocketLike {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(`Relay is not connected: ${this.url}`);
    }
    return this.socket;
  }

  private handleMessage(event: MessageEvent): void {
    let frame: unknown;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!Array.isArray(frame)) {
      return;
    }
    const [kind, subscriptionId, payload] = frame;
    if (kind === "NOTICE" && typeof subscriptionId === "string") {
      this.noticeListeners.forEach((listener) => listener(subscriptionId));
      return;
    }
    if (
      kind === "OK" &&
      typeof subscriptionId === "string" &&
      typeof payload === "boolean"
    ) {
      const okMessage = typeof frame[3] === "string" ? frame[3] : "";
      this.okListeners.get(subscriptionId)?.(payload, okMessage);
      return;
    }
    if (kind === "EOSE" && typeof subscriptionId === "string") {
      // Resolve any probe subscription waiting on its EOSE — used by
      // `ping()` to compute RTT. We intentionally do NOT fire
      // `event_received` for EOSE frames (VAL-SETTINGS-011 increments
      // only on EVENT frames).
      const listener = this.eoseListeners.get(subscriptionId);
      listener?.();
      return;
    }
    if (kind !== "EVENT" || typeof subscriptionId !== "string") {
      return;
    }
    // VAL-SETTINGS-011 + VAL-SETTINGS-012: fire telemetry *before*
    // dispatching to the subscription handler so downstream counters
    // see the inbound frame even if the handler throws.
    this.emitSocketEvent({
      type: "event_received",
      url: this.url,
      at: Date.now(),
    });
    this.subscriptions.get(subscriptionId)?.(payload);
  }

  /**
   * m5-relay-telemetry — send a lightweight NIP-01 probe subscription
   * and resolve with the round-trip time (milliseconds) from REQ to
   * the first `EOSE` frame. Use case: the {@link RuntimeRelayPump}
   * latency sampler that powers the dashboard Latency column
   * (VAL-SETTINGS-010 / VAL-SETTINGS-013).
   *
   * The probe uses a filter that returns no events (`limit: 0` with a
   * guaranteed-empty `kinds` window) so relays respond with EOSE
   * immediately after acknowledging the subscription. The REQ is
   * cleaned up with `CLOSE` whether the probe resolves, times out, or
   * the caller aborts.
   *
   * `timeoutMs` defaults to the module-level
   * `RELAY_PING_TIMEOUT_MS` when unspecified; on timeout the promise
   * resolves with `null` and a `ping_timeout` telemetry event fires.
   * Errors thrown before the REQ is sent (socket not open) reject with
   * an Error; transient protocol errors after REQ don't reject —
   * they just time out.
   */
  ping(timeoutMs: number): Promise<number | null> {
    const socket = this.requireOpenSocket();
    const id = `ping-${Date.now()}-${this.subscriptionSeq}`;
    this.subscriptionSeq += 1;
    const startedAt =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    return new Promise<number | null>((resolve) => {
      let settled = false;
      const cleanup = () => {
        this.eoseListeners.delete(id);
        if (this.socket?.readyState === 1) {
          try {
            this.socket.send(JSON.stringify(["CLOSE", id]));
          } catch {
            // Socket already torn down; nothing to clean up.
          }
        }
      };
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        this.emitSocketEvent({
          type: "ping_timeout",
          url: this.url,
          at: Date.now(),
        });
        resolve(null);
      }, timeoutMs);
      this.eoseListeners.set(id, () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        cleanup();
        const endedAt =
          typeof performance !== "undefined" &&
          typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        const rtt = Math.max(0, Math.round(endedAt - startedAt));
        this.emitSocketEvent({
          type: "ping_sample",
          url: this.url,
          at: Date.now(),
          rtt_ms: rtt,
        });
        resolve(rtt);
      });
      try {
        // A guaranteed-empty filter: `limit: 0` tells the relay to
        // skip any stored events and emit EOSE immediately.
        socket.send(
          JSON.stringify([
            "REQ",
            id,
            { kinds: [1], limit: 0 },
          ]),
        );
      } catch (error) {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        cleanup();
        resolve(null);
        // Re-throw-equivalent: an outbound send failure is fatal for
        // this probe but we resolve with null so callers drive the
        // next sample instead of crashing. The error is non-silent
        // because the caller will see the null return.
        void error;
      }
    });
  }
}

export async function runOnboardingRelayHandshake<T>(input: {
  relays: string[];
  eventKind: number;
  sourcePeerPubkey: string;
  localPubkey?: string;
  requestEventJson?: string;
  initialRequest?: OnboardingRelayRequest;
  createRetryRequest?: () => Promise<OnboardingRelayRequest>;
  decodeEvent: (
    event: unknown,
    requests: readonly OnboardingRelayRequest[],
  ) => Promise<T | null>;
  onProgress?: (event: OnboardingRelayProgressEvent) => void;
  onNotice?: (notice: { relay: string; message: string }) => void;
  relayClient?: RelayClient;
  timeoutMs?: number;
  retryIntervalMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const relayClient = input.relayClient ?? new BrowserRelayClient();
  const initialRequest =
    input.initialRequest ??
    (input.localPubkey && input.requestEventJson
      ? {
          local_pubkey32: input.localPubkey,
          event_json: input.requestEventJson,
        }
      : null);
  if (!initialRequest) {
    throw new OnboardingRelayError(
      "invalid_onboard_response",
      "Onboarding request bundle was not provided.",
    );
  }
  const firstRequest = initialRequest;
  const connections = input.relays.map((relay) => relayClient.connect(relay));
  const abortError = () => {
    if (typeof DOMException !== "undefined") {
      return new DOMException(
        "Onboarding handshake was cancelled.",
        "AbortError",
      );
    }
    const error = new Error("Onboarding handshake was cancelled.");
    error.name = "AbortError";
    return error;
  };
  if (input.signal?.aborted) {
    connections.forEach((connection) => connection.close());
    throw abortError();
  }

  const filter: RelayFilter = {
    kinds: [input.eventKind],
    "#p": [firstRequest.local_pubkey32],
  };
  const timeoutMs = input.timeoutMs ?? ONBOARDING_RELAY_HANDSHAKE_TIMEOUT_MS;
  const retryIntervalMs =
    input.retryIntervalMs ?? ONBOARDING_RELAY_RETRY_INTERVAL_MS;
  const emitProgress = (event: OnboardingRelayProgressEvent) => {
    try {
      input.onProgress?.(event);
    } catch {
      // Progress observers are diagnostic/UI only and must not affect relay IO.
    }
  };

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const subscriptions: RelaySubscription[] = [];
    let connected: RelayConnection[] = [];
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let publishAttempt = 0;
    const activeRequests: OnboardingRelayRequest[] = [firstRequest];
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      if (retryTimer) {
        globalThis.clearTimeout(retryTimer);
        retryTimer = null;
      }
      input.signal?.removeEventListener("abort", handleAbort);
      subscriptions.forEach((subscription) => subscription.close());
      connections.forEach((connection) => connection.close());
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const timer = globalThis.setTimeout(() => {
      emitProgress({ type: "timeout" });
      finish(() =>
        reject(
          new OnboardingRelayError(
            "onboard_timeout",
            "Onboarding peer did not respond before the timeout.",
          ),
        ),
      );
    }, timeoutMs);
    const handleAbort = () => {
      finish(() => reject(abortError()));
    };
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    if (input.signal?.aborted) {
      handleAbort();
      return;
    }

    const publishRequest = async (
      request: OnboardingRelayRequest,
      attempt: number,
    ): Promise<boolean> => {
      const requestEvent = JSON.parse(request.event_json) as unknown;
      const publishResults = await Promise.allSettled(
        connected.map((connection) => connection.publish(requestEvent)),
      );
      if (settled) return false;

      const publishedRelays: string[] = [];
      publishResults.forEach((result, index) => {
        const relay = connected[index].url;
        if (result.status === "fulfilled") {
          publishedRelays.push(relay);
          return;
        }
        emitProgress({
          type: "request_publish_failed",
          relay,
          attempt,
          requestId: request.request_id,
          message:
            result.reason instanceof Error
              ? result.reason.message
              : "Unable to publish onboarding request.",
        });
      });
      if (publishedRelays.length > 0) {
        emitProgress({
          type: "request_published",
          relays: publishedRelays,
          attempt,
          requestId: request.request_id,
        });
        return true;
      }
      return false;
    };

    const scheduleRetry = () => {
      if (settled || !input.createRetryRequest || retryIntervalMs <= 0) {
        return;
      }
      const nextAttempt = publishAttempt + 1;
      emitProgress({
        type: "request_retry_scheduled",
        attempt: nextAttempt,
        delayMs: retryIntervalMs,
      });
      retryTimer = globalThis.setTimeout(() => {
        retryTimer = null;
        void (async () => {
          if (settled) return;
          publishAttempt += 1;
          let request: OnboardingRelayRequest;
          try {
            request = await input.createRetryRequest!();
          } catch (error) {
            emitProgress({
              type: "request_publish_failed",
              relay: "all",
              attempt: publishAttempt,
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to prepare onboarding retry.",
            });
            scheduleRetry();
            return;
          }
          activeRequests.push(request);
          const accepted = await publishRequest(request, publishAttempt);
          if (!settled) {
            if (!accepted) {
              // Keep listening; the prior accepted request may still receive
              // a delayed response on a public relay.
            }
            scheduleRetry();
          }
        })();
      }, retryIntervalMs);
    };

    async function connectAndPublish() {
      emitProgress({ type: "relay_connecting", relays: input.relays });
      const connectedResults = await Promise.allSettled(
        connections.map(async (connection) => {
          await connection.connect();
          return connection;
        }),
      );
      if (settled) return;

      connected = connectedResults
        .filter(
          (result): result is PromiseFulfilledResult<RelayConnection> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);
      connected.forEach((connection, index) => {
        emitProgress({
          type: "relay_connected",
          relay: connection.url,
          connectedRelays: connected.slice(0, index + 1).map((item) => item.url),
        });
      });
      connectedResults.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        emitProgress({
          type: "relay_connect_failed",
          relay: input.relays[index],
          message:
            result.reason instanceof Error
              ? result.reason.message
              : "Relay connection failed.",
        });
      });

      if (input.signal?.aborted) {
        handleAbort();
        return;
      }

      if (connected.length === 0) {
        finish(() =>
          reject(
            new OnboardingRelayError(
              "relay_unreachable",
              "Unable to connect to any onboarding relay.",
            ),
          ),
        );
        return;
      }

      for (const connection of connected) {
        subscriptions.push(
          connection.subscribe(filter, (event) => onEvent(event, connection.url), (message) => {
            input.onNotice?.({ relay: connection.url, message });
          }),
        );
      }

      publishAttempt = 1;
      const accepted = await publishRequest(firstRequest, publishAttempt);
      if (settled) return;
      if (accepted) {
        scheduleRetry();
        return;
      }

      finish(() =>
        reject(
          new OnboardingRelayError(
            "relay_unreachable",
            "Unable to publish onboarding request.",
          ),
        ),
      );
    }

    const onEvent = (event: unknown, relay: string) => {
      emitProgress({ type: "response_candidate", relay });
      void input
        .decodeEvent(event, activeRequests.slice())
        .then((decoded) => {
          if (decoded) {
            emitProgress({ type: "response_decoded", relay });
            finish(() => resolve(decoded));
          }
        })
        .catch((error) => {
          finish(() =>
            reject(
              error instanceof OnboardingRelayError
                ? error
                : new OnboardingRelayError(
                    "invalid_onboard_response",
                    error instanceof Error
                      ? error.message
                      : "Invalid onboarding response.",
                  ),
            ),
          );
        });
    };

    void connectAndPublish().catch((error) => {
      if (!settled) {
        finish(() =>
          reject(
            new OnboardingRelayError(
              "relay_unreachable",
              error instanceof Error
                ? error.message
                : "Unable to use onboarding relay.",
            ),
          ),
        );
      }
    });
  });
}
