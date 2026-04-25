import { describe, expect, it, vi, afterEach } from "vitest";
import {
  BrowserRelayClient,
  ONBOARDING_RELAY_HANDSHAKE_TIMEOUT_MS,
  OnboardingRelayError,
  runOnboardingRelayHandshake,
  type RelayClient,
  type RelayConnection,
} from "./browserRelayClient";
import { ONBOARD_HANDSHAKE_TIMEOUT_MS } from "../../app/onboardingTiming";
import type { RelayFilter, RelaySubscription } from "./relayPort";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<
    string,
    Set<(event: Event | MessageEvent) => void>
  >();

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ) {
    this.listeners.get(type)?.delete(listener);
  }

  open() {
    this.readyState = 1;
    this.dispatch("open", new Event("open"));
  }

  message(data: string) {
    this.dispatch("message", new MessageEvent("message", { data }));
  }

  private dispatch(type: string, event: Event | MessageEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

class FakeRelayConnection implements RelayConnection {
  publishes: unknown[] = [];
  subscriptions: Array<{
    filter: RelayFilter;
    onEvent: (event: unknown) => void;
    onNotice?: (message: string) => void;
    closed: boolean;
  }> = [];
  closed = false;

  constructor(
    readonly url: string,
    private readonly options: {
      connectError?: Error;
      hangConnect?: boolean;
      publishError?: Error;
    } = {},
  ) {}

  async connect() {
    if (this.options.hangConnect) {
      await new Promise(() => undefined);
    }
    if (this.options.connectError) {
      throw this.options.connectError;
    }
  }

  async publish(event: unknown) {
    this.publishes.push(event);
    if (this.options.publishError) {
      throw this.options.publishError;
    }
  }

  subscribe(
    filter: RelayFilter,
    onEvent: (event: unknown) => void,
    onNotice?: (message: string) => void,
  ): RelaySubscription {
    const subscription = { filter, onEvent, onNotice, closed: false };
    this.subscriptions.push(subscription);
    return {
      close: () => {
        subscription.closed = true;
      },
    };
  }

  close() {
    this.closed = true;
  }
}

class FakeRelayClient implements RelayClient {
  readonly connections: FakeRelayConnection[];

  constructor(
    urls: string[],
    failAll = false,
    optionsByUrl: Record<
      string,
      ConstructorParameters<typeof FakeRelayConnection>[1]
    > = {},
  ) {
    this.connections = urls.map(
      (url) =>
        new FakeRelayConnection(
          url,
          failAll ? { connectError: new Error("offline") } : optionsByUrl[url],
        ),
    );
  }

  connect(url: string): RelayConnection {
    const connection = this.connections.find((item) => item.url === url);
    if (!connection) {
      throw new Error(`Unexpected relay ${url}`);
    }
    return connection;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

function flushTimers() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

describe("BrowserRelayClient — onSocketEvent telemetry", () => {
  it("emits open + close lifecycle events to the onSocketEvent observer", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const client = new BrowserRelayClient({
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      onSocketEvent: (event) => events.push(event),
    });
    const connection = client.connect("wss://relay.test");
    const open = connection.connect();
    sockets[0].open();
    await open;
    // Fire a real close event (simulate a server-side drop 1011) through
    // the socket's close listeners. BrowserRelayConnection's persistent
    // close listener must propagate it with the provided code.
    (sockets[0] as unknown as {
      listeners: Map<string, Set<(event: unknown) => void>>;
    }).listeners
      .get("close")
      ?.forEach((listener) =>
        listener({ code: 1011, wasClean: false } as unknown as Event),
      );

    const types = events.map((event) => (event as { type: string }).type);
    expect(types).toContain("open");
    expect(types).toContain("close");
    const closeEvent = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(closeEvent.code).toBe(1011);
    expect(closeEvent.wasClean).toBe(false);
    connection.close();
  });

  it("simulateAbnormalClose emits exactly one close event with the caller-supplied code and suppresses the real close", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const client = new BrowserRelayClient({
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      onSocketEvent: (event) => events.push(event),
    });
    const connection = client.connect("wss://relay.test");
    const open = connection.connect();
    sockets[0].open();
    await open;
    // Only BrowserRelayConnection exposes simulateAbnormalClose.
    (
      connection as unknown as { simulateAbnormalClose: (code: number) => void }
    ).simulateAbnormalClose(1006);
    const closes = events.filter(
      (event) => (event as { type: string }).type === "close",
    );
    expect(closes.length).toBe(1);
    expect((closes[0] as { code: number }).code).toBe(1006);
    expect((closes[0] as { wasClean: boolean }).wasClean).toBe(false);
  });
});

describe("BrowserRelayClient", () => {
  it("sends raw NIP-01 frames, handles events, captures notices, and closes", async () => {
    const sockets: FakeSocket[] = [];
    const client = new BrowserRelayClient((url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    });
    const connection = client.connect("wss://relay.test");
    const open = connection.connect();
    sockets[0].open();
    await open;

    const events: unknown[] = [];
    const notices: string[] = [];
    const subscription = connection.subscribe(
      { kinds: [27000], authors: ["peer"] },
      (event) => events.push(event),
      (notice) => notices.push(notice),
    );
    const reqFrame = JSON.parse(sockets[0].sent[0]);
    expect(reqFrame[0]).toBe("REQ");
    expect(reqFrame[2]).toEqual({ kinds: [27000], authors: ["peer"] });

    const publish = connection.publish({ id: "request-event" });
    expect(JSON.parse(sockets[0].sent[1])).toEqual([
      "EVENT",
      { id: "request-event" },
    ]);
    sockets[0].message(JSON.stringify(["OK", "request-event", true, ""]));
    await publish;

    sockets[0].message(
      JSON.stringify(["EVENT", reqFrame[1], { id: "response-event" }]),
    );
    sockets[0].message(
      JSON.stringify(["EVENT", "other-sub", { id: "ignored" }]),
    );
    sockets[0].message(JSON.stringify(["NOTICE", "rate limited"]));
    sockets[0].message("{bad json");

    expect(events).toEqual([{ id: "response-event" }]);
    expect(notices).toEqual(["rate limited"]);

    subscription.close();
    expect(JSON.parse(sockets[0].sent[2])).toEqual(["CLOSE", reqFrame[1]]);
    connection.close();
    expect(sockets[0].closed).toBe(true);
  });

  it("rejects publish when the relay returns OK false", async () => {
    const sockets: FakeSocket[] = [];
    const client = new BrowserRelayClient((url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    });
    const connection = client.connect("wss://relay.test");
    const open = connection.connect();
    sockets[0].open();
    await open;

    const publish = connection.publish({ id: "rejected-event" });
    sockets[0].message(
      JSON.stringify(["OK", "rejected-event", false, "restricted: kind"]),
    );

    await expect(publish).rejects.toThrow(/restricted: kind/);
    connection.close();
  });
});

describe("runOnboardingRelayHandshake", () => {
  it("uses a liberal app-level onboarding window while tests can still pass small explicit timeouts", () => {
    expect(ONBOARD_HANDSHAKE_TIMEOUT_MS).toBe(180_000);
    expect(ONBOARDING_RELAY_HANDSHAKE_TIMEOUT_MS).toBe(
      ONBOARD_HANDSHAKE_TIMEOUT_MS,
    );
  });

  it("subscribes before publishing, ignores nonmatching events, resolves first decoded response, and closes sockets", async () => {
    const client = new FakeRelayClient(["wss://one.test", "wss://two.test"]);
    const notices: Array<{ relay: string; message: string }> = [];
    const progress: string[] = [];
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://one.test", "wss://two.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      onNotice: (notice) => notices.push(notice),
      onProgress: (event) => progress.push(event.type),
      decodeEvent: async (event) =>
        (event as { id?: string }).id === "valid" ? { ok: true } : null,
    });

    await flushTimers();
    expect(client.connections[0].subscriptions[0].filter).toEqual({
      kinds: [27000],
      "#p": ["local-pubkey"],
    });
    expect(client.connections[0].publishes).toEqual([{ id: "request" }]);
    expect(client.connections[1].publishes).toEqual([{ id: "request" }]);

    client.connections[0].subscriptions[0].onNotice?.("stored");
    client.connections[0].subscriptions[0].onEvent({ id: "ignored" });
    await Promise.resolve();
    client.connections[1].subscriptions[0].onEvent({ id: "valid" });

    await expect(handshake).resolves.toEqual({ ok: true });
    expect(progress).toEqual(
      expect.arrayContaining([
        "relay_connecting",
        "relay_connected",
        "request_published",
        "response_candidate",
        "response_decoded",
      ]),
    );
    expect(notices).toEqual([{ relay: "wss://one.test", message: "stored" }]);
    expect(client.connections.every((connection) => connection.closed)).toBe(
      true,
    );
    expect(
      client.connections.every((connection) =>
        connection.subscriptions.every((subscription) => subscription.closed),
      ),
    ).toBe(true);
  });

  it("rejects when no relay can connect", async () => {
    const client = new FakeRelayClient(["wss://offline.test"], true);
    const progress: string[] = [];
    await expect(
      runOnboardingRelayHandshake({
        relays: ["wss://offline.test"],
        eventKind: 27000,
        sourcePeerPubkey: "peer-pubkey",
        localPubkey: "local-pubkey",
        requestEventJson: JSON.stringify({ id: "request" }),
        relayClient: client,
        onProgress: (event) => progress.push(event.type),
        decodeEvent: async () => null,
      }),
    ).rejects.toMatchObject({ code: "relay_unreachable" });
    expect(progress).toEqual([
      "relay_connecting",
      "relay_connect_failed",
    ]);
    expect(client.connections[0].closed).toBe(true);
  });

  it("times out and closes relay resources while connect is still pending", async () => {
    vi.useFakeTimers();
    const client = new FakeRelayClient(["wss://hung.test"], false, {
      "wss://hung.test": { hangConnect: true },
    });
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://hung.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      timeoutMs: 25,
      decodeEvent: async () => null,
    });
    const timeout = expect(handshake).rejects.toMatchObject({
      code: "onboard_timeout",
    });

    await vi.advanceTimersByTimeAsync(25);

    await timeout;
    expect(client.connections[0].closed).toBe(true);
    expect(client.connections[0].subscriptions).toHaveLength(0);
  });

  it("keeps listening when one relay publish fails but another relay accepts the request", async () => {
    const client = new FakeRelayClient(
      ["wss://rejects.test", "wss://accepts.test"],
      false,
      {
        "wss://rejects.test": { publishError: new Error("publish denied") },
      },
    );
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://rejects.test", "wss://accepts.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      decodeEvent: async (event) =>
        (event as { id?: string }).id === "valid" ? { ok: true } : null,
    });

    await flushTimers();
    expect(client.connections[0].publishes).toEqual([{ id: "request" }]);
    expect(client.connections[1].publishes).toEqual([{ id: "request" }]);

    client.connections[1].subscriptions[0].onEvent({ id: "valid" });

    await expect(handshake).resolves.toEqual({ ok: true });
    expect(client.connections.every((connection) => connection.closed)).toBe(
      true,
    );
  });

  it("times out and closes relay resources", async () => {
    vi.useFakeTimers();
    const client = new FakeRelayClient(["wss://slow.test"]);
    const progress: string[] = [];
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://slow.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      timeoutMs: 25,
      onProgress: (event) => progress.push(event.type),
      decodeEvent: async () => null,
    });
    const timeout = expect(handshake).rejects.toMatchObject({
      code: "onboard_timeout",
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    await timeout;
    await expect(handshake).rejects.toBeInstanceOf(OnboardingRelayError);
    expect(progress).toContain("request_published");
    expect(progress).toContain("timeout");
    expect(client.connections[0].closed).toBe(true);
    expect(client.connections[0].subscriptions[0].closed).toBe(true);
  });

  it("publishes fresh retry requests while waiting for a response, then times out accurately", async () => {
    vi.useFakeTimers();
    const client = new FakeRelayClient(["wss://slow.test"]);
    const progress: Array<{ type: string; attempt?: number }> = [];
    let retrySeq = 1;
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://slow.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      initialRequest: {
        request_id: "request-1",
        local_pubkey32: "local-pubkey",
        event_json: JSON.stringify({ id: "request-1" }),
      },
      createRetryRequest: async () => {
        retrySeq += 1;
        return {
          request_id: `request-${retrySeq}`,
          local_pubkey32: "local-pubkey",
          event_json: JSON.stringify({ id: `request-${retrySeq}` }),
        };
      },
      relayClient: client,
      timeoutMs: 10_500,
      retryIntervalMs: 5_000,
      onProgress: (event) =>
        progress.push({
          type: event.type,
          attempt: "attempt" in event ? event.attempt : undefined,
        }),
      decodeEvent: async () => null,
    });
    const timeout = expect(handshake).rejects.toMatchObject({
      code: "onboard_timeout",
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(client.connections[0].publishes).toEqual([{ id: "request-1" }]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.connections[0].publishes).toEqual([
      { id: "request-1" },
      { id: "request-2" },
    ]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.connections[0].publishes).toEqual([
      { id: "request-1" },
      { id: "request-2" },
      { id: "request-3" },
    ]);

    await vi.advanceTimersByTimeAsync(500);
    await timeout;
    expect(progress).toEqual(
      expect.arrayContaining([
        { type: "request_published", attempt: 1 },
        { type: "request_retry_scheduled", attempt: 2 },
        { type: "request_published", attempt: 2 },
        { type: "request_published", attempt: 3 },
        { type: "timeout", attempt: undefined },
      ]),
    );
    expect(client.connections[0].closed).toBe(true);
  });

  it("resolves a response that matches a later fresh request attempt", async () => {
    vi.useFakeTimers();
    const client = new FakeRelayClient(["wss://relay.test"]);
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://relay.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      initialRequest: {
        request_id: "request-1",
        local_pubkey32: "local-pubkey",
        event_json: JSON.stringify({ id: "request-1" }),
      },
      createRetryRequest: async () => ({
        request_id: "request-2",
        local_pubkey32: "local-pubkey",
        event_json: JSON.stringify({ id: "request-2" }),
      }),
      relayClient: client,
      timeoutMs: 30_000,
      retryIntervalMs: 5_000,
      decodeEvent: async (event, requests) => {
        const responseTo = (event as { responseTo?: string }).responseTo;
        const matched = requests.find(
          (request) => request.request_id === responseTo,
        );
        return matched ? { matched: matched.request_id } : null;
      },
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.connections[0].publishes).toEqual([
      { id: "request-1" },
      { id: "request-2" },
    ]);

    client.connections[0].subscriptions[0].onEvent({ responseTo: "request-2" });

    await expect(handshake).resolves.toEqual({ matched: "request-2" });
    expect(client.connections[0].closed).toBe(true);
  });

  it("aborts and closes relay resources without waiting for timeout", async () => {
    const client = new FakeRelayClient(["wss://abort.test"]);
    const controller = new AbortController();
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://abort.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      timeoutMs: 30_000,
      signal: controller.signal,
      decodeEvent: async () => null,
    });

    await flushTimers();
    controller.abort();

    await expect(handshake).rejects.toMatchObject({ name: "AbortError" });
    expect(client.connections[0].closed).toBe(true);
    expect(client.connections[0].subscriptions[0].closed).toBe(true);
  });
});
