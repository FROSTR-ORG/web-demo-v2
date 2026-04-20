import { describe, expect, it, vi, afterEach } from "vitest";
import {
  BrowserRelayClient,
  OnboardingRelayError,
  runOnboardingRelayHandshake,
  type RelayClient,
  type RelayConnection
} from "./browserRelayClient";
import type { RelayFilter, RelaySubscription } from "./relayPort";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: Event | MessageEvent) => void>>();

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: Event | MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: Event | MessageEvent) => void) {
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
    private readonly connectError?: Error
  ) {}

  async connect() {
    if (this.connectError) {
      throw this.connectError;
    }
  }

  async publish(event: unknown) {
    this.publishes.push(event);
  }

  subscribe(filter: RelayFilter, onEvent: (event: unknown) => void, onNotice?: (message: string) => void): RelaySubscription {
    const subscription = { filter, onEvent, onNotice, closed: false };
    this.subscriptions.push(subscription);
    return {
      close: () => {
        subscription.closed = true;
      }
    };
  }

  close() {
    this.closed = true;
  }
}

class FakeRelayClient implements RelayClient {
  readonly connections: FakeRelayConnection[];

  constructor(urls: string[], private readonly failAll = false) {
    this.connections = urls.map((url) => new FakeRelayConnection(url, failAll ? new Error("offline") : undefined));
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
    const subscription = connection.subscribe({ kinds: [27000], authors: ["peer"] }, (event) => events.push(event), (notice) => notices.push(notice));
    const reqFrame = JSON.parse(sockets[0].sent[0]);
    expect(reqFrame[0]).toBe("REQ");
    expect(reqFrame[2]).toEqual({ kinds: [27000], authors: ["peer"] });

    await connection.publish({ id: "request-event" });
    expect(JSON.parse(sockets[0].sent[1])).toEqual(["EVENT", { id: "request-event" }]);

    sockets[0].message(JSON.stringify(["EVENT", reqFrame[1], { id: "response-event" }]));
    sockets[0].message(JSON.stringify(["EVENT", "other-sub", { id: "ignored" }]));
    sockets[0].message(JSON.stringify(["NOTICE", "rate limited"]));
    sockets[0].message("{bad json");

    expect(events).toEqual([{ id: "response-event" }]);
    expect(notices).toEqual(["rate limited"]);

    subscription.close();
    expect(JSON.parse(sockets[0].sent[2])).toEqual(["CLOSE", reqFrame[1]]);
    connection.close();
    expect(sockets[0].closed).toBe(true);
  });
});

describe("runOnboardingRelayHandshake", () => {
  it("subscribes before publishing, ignores nonmatching events, resolves first decoded response, and closes sockets", async () => {
    const client = new FakeRelayClient(["wss://one.test", "wss://two.test"]);
    const notices: Array<{ relay: string; message: string }> = [];
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://one.test", "wss://two.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      onNotice: (notice) => notices.push(notice),
      decodeEvent: async (event) => ((event as { id?: string }).id === "valid" ? { ok: true } : null)
    });

    await flushTimers();
    expect(client.connections[0].subscriptions[0].filter).toEqual({
      kinds: [27000],
      authors: ["peer-pubkey"],
      "#p": ["local-pubkey"]
    });
    expect(client.connections[0].publishes).toEqual([{ id: "request" }]);
    expect(client.connections[1].publishes).toEqual([{ id: "request" }]);

    client.connections[0].subscriptions[0].onNotice?.("stored");
    client.connections[0].subscriptions[0].onEvent({ id: "ignored" });
    await Promise.resolve();
    client.connections[1].subscriptions[0].onEvent({ id: "valid" });

    await expect(handshake).resolves.toEqual({ ok: true });
    expect(notices).toEqual([{ relay: "wss://one.test", message: "stored" }]);
    expect(client.connections.every((connection) => connection.closed)).toBe(true);
    expect(client.connections.every((connection) => connection.subscriptions.every((subscription) => subscription.closed))).toBe(true);
  });

  it("rejects when no relay can connect", async () => {
    const client = new FakeRelayClient(["wss://offline.test"], true);
    await expect(
      runOnboardingRelayHandshake({
        relays: ["wss://offline.test"],
        eventKind: 27000,
        sourcePeerPubkey: "peer-pubkey",
        localPubkey: "local-pubkey",
        requestEventJson: JSON.stringify({ id: "request" }),
        relayClient: client,
        decodeEvent: async () => null
      })
    ).rejects.toMatchObject({ code: "relay_unreachable" });
    expect(client.connections[0].closed).toBe(true);
  });

  it("times out and closes relay resources", async () => {
    vi.useFakeTimers();
    const client = new FakeRelayClient(["wss://slow.test"]);
    const handshake = runOnboardingRelayHandshake({
      relays: ["wss://slow.test"],
      eventKind: 27000,
      sourcePeerPubkey: "peer-pubkey",
      localPubkey: "local-pubkey",
      requestEventJson: JSON.stringify({ id: "request" }),
      relayClient: client,
      timeoutMs: 25,
      decodeEvent: async () => null
    });
    const timeout = expect(handshake).rejects.toMatchObject({ code: "onboard_timeout" });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    await timeout;
    await expect(handshake).rejects.toBeInstanceOf(OnboardingRelayError);
    expect(client.connections[0].closed).toBe(true);
    expect(client.connections[0].subscriptions[0].closed).toBe(true);
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
      decodeEvent: async () => null
    });

    await flushTimers();
    controller.abort();

    await expect(handshake).rejects.toMatchObject({ name: "AbortError" });
    expect(client.connections[0].closed).toBe(true);
    expect(client.connections[0].subscriptions[0].closed).toBe(true);
  });
});
