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

export interface RelayConnection {
  url: string;
  connect(): Promise<void>;
  publish(event: unknown): Promise<void>;
  subscribe(
    filter: RelayFilter,
    onEvent: (event: unknown) => void,
    onNotice?: (message: string) => void,
  ): RelaySubscription;
  close(): void;
}

export interface RelayClient {
  connect(url: string): RelayConnection;
}

interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
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
  | { type: "error"; url: string; at: number };

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
    return new BrowserRelayConnection(url, this.createSocket, this.onSocketEvent);
  }
}

class BrowserRelayConnection implements RelayConnection {
  private socket: WebSocketLike | null = null;
  private subscriptionSeq = 0;
  private subscriptions = new Map<string, (event: unknown) => void>();
  private noticeListeners = new Set<(message: string) => void>();
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
      this.emitSocketEvent({
        type: "close",
        url: this.url,
        at: Date.now(),
        code: typeof closeEvent.code === "number" ? closeEvent.code : null,
        wasClean: Boolean(closeEvent.wasClean),
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
    socket.send(JSON.stringify(["EVENT", event]));
    return Promise.resolve();
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
    this.socket?.close();
    this.socket = null;
    this.messageListener = null;
    this.persistentCloseListener = null;
  }

  private requireOpenSocket(): WebSocketLike {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(`Relay is not connected: ${this.url}`);
    }
    return this.socket;
  }

  private handleMessage(event: MessageEvent): void {
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!Array.isArray(message)) {
      return;
    }
    const [kind, subscriptionId, payload] = message;
    if (kind === "NOTICE" && typeof subscriptionId === "string") {
      this.noticeListeners.forEach((listener) => listener(subscriptionId));
      return;
    }
    if (kind !== "EVENT" || typeof subscriptionId !== "string") {
      return;
    }
    this.subscriptions.get(subscriptionId)?.(payload);
  }
}

export async function runOnboardingRelayHandshake<T>(input: {
  relays: string[];
  eventKind: number;
  sourcePeerPubkey: string;
  localPubkey: string;
  requestEventJson: string;
  decodeEvent: (event: unknown) => Promise<T | null>;
  onNotice?: (notice: { relay: string; message: string }) => void;
  relayClient?: RelayClient;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const relayClient = input.relayClient ?? new BrowserRelayClient();
  const requestEvent = JSON.parse(input.requestEventJson) as unknown;
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
    authors: [input.sourcePeerPubkey],
    "#p": [input.localPubkey],
  };
  const timeoutMs = input.timeoutMs ?? 30_000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const subscriptions: RelaySubscription[] = [];
    let connected: RelayConnection[] = [];
    const cleanup = () => {
      globalThis.clearTimeout(timer);
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

    async function connectAndPublish() {
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
          connection.subscribe(filter, onEvent, (message) => {
            input.onNotice?.({ relay: connection.url, message });
          }),
        );
      }

      const publishResults = await Promise.allSettled(
        connected.map((connection) => connection.publish(requestEvent)),
      );
      if (settled) return;

      const publishedCount = publishResults.filter(
        (result) => result.status === "fulfilled",
      ).length;
      if (publishedCount > 0) {
        return;
      }

      const firstFailure = publishResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      finish(() =>
        reject(
          new OnboardingRelayError(
            "relay_unreachable",
            firstFailure?.reason instanceof Error
              ? firstFailure.reason.message
              : "Unable to publish onboarding request.",
          ),
        ),
      );
    }

    const onEvent = (event: unknown) => {
      void input
        .decodeEvent(event)
        .then((decoded) => {
          if (decoded) {
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
