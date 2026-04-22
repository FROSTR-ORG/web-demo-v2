/**
 * m5-relay-telemetry — tests for the BrowserRelayClient telemetry
 * surface: inbound EVENT counting (VAL-SETTINGS-011) and REQ→EOSE
 * latency probing (VAL-SETTINGS-010 / VAL-SETTINGS-013).
 */
import { describe, expect, it } from "vitest";
import { BrowserRelayClient, type RelaySocketEvent } from "./browserRelayClient";

/**
 * Minimal observable WebSocket-like fake that exposes `openSync` and
 * `message` helpers tests can use to drive the connection lifecycle
 * synchronously.
 */
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
  openSync() {
    this.readyState = 1;
    this.listeners
      .get("open")
      ?.forEach((listener) => listener(new Event("open")));
  }
  message(data: string) {
    this.listeners
      .get("message")
      ?.forEach((listener) =>
        listener(new MessageEvent("message", { data })),
      );
  }
}

describe("BrowserRelayClient telemetry", () => {
  it("fires 'event_received' telemetry per inbound EVENT frame", async () => {
    const socket = new FakeSocket("wss://telemetry.test");
    const events: RelaySocketEvent[] = [];
    const client = new BrowserRelayClient({
      createSocket: () => socket,
      onSocketEvent: (event) => events.push(event),
    });
    const connection = client.connect("wss://telemetry.test");
    const connectPromise = connection.connect();
    socket.openSync();
    await connectPromise;

    // Subscribe so the subscription map has a handler (though telemetry
    // fires regardless of match).
    const received: unknown[] = [];
    connection.subscribe({ kinds: [1] }, (evt) => received.push(evt));
    const reqId = JSON.parse(socket.sent.slice(-1)[0])[1] as string;

    // Inject two EVENT frames and one NOTICE (must not increment).
    socket.message(JSON.stringify(["EVENT", reqId, { id: "a" }]));
    socket.message(JSON.stringify(["EVENT", reqId, { id: "b" }]));
    socket.message(JSON.stringify(["NOTICE", "heads-up"]));

    const eventReceived = events.filter(
      (event) => event.type === "event_received",
    );
    expect(eventReceived.length).toBe(2);
    expect(eventReceived[0].url).toBe("wss://telemetry.test");
    expect(received).toHaveLength(2);
  });

  it("ping() resolves with RTT ms on matching EOSE, firing ping_sample", async () => {
    const socket = new FakeSocket("wss://probe.test");
    const events: RelaySocketEvent[] = [];
    const client = new BrowserRelayClient({
      createSocket: () => socket,
      onSocketEvent: (event) => events.push(event),
    });
    const connection = client.connect("wss://probe.test");
    const connectPromise = connection.connect();
    socket.openSync();
    await connectPromise;

    if (typeof connection.ping !== "function") {
      throw new Error("BrowserRelayConnection.ping must be defined");
    }
    const pingPromise = connection.ping(1_000);
    // Extract the REQ id the probe just sent.
    const lastSent = socket.sent[socket.sent.length - 1];
    const parsed = JSON.parse(lastSent) as [string, string, unknown];
    expect(parsed[0]).toBe("REQ");
    const reqId = parsed[1];
    // Respond with EOSE on the matching id — should resolve the ping.
    socket.message(JSON.stringify(["EOSE", reqId]));
    const rtt = await pingPromise;
    expect(typeof rtt).toBe("number");
    expect(rtt).toBeGreaterThanOrEqual(0);
    const pingSamples = events.filter((event) => event.type === "ping_sample");
    expect(pingSamples.length).toBe(1);
    if (pingSamples[0].type === "ping_sample") {
      expect(pingSamples[0].rtt_ms).toBe(rtt);
    }
    // The probe sent a CLOSE frame for its REQ during cleanup so the
    // relay-side subscription is torn down.
    const closedReq = socket.sent.some((line) => {
      const parsedLine = JSON.parse(line);
      return (
        Array.isArray(parsedLine) &&
        parsedLine[0] === "CLOSE" &&
        parsedLine[1] === reqId
      );
    });
    expect(closedReq).toBe(true);
  });

  it("ping() resolves with null and fires ping_timeout when EOSE never arrives", async () => {
    const socket = new FakeSocket("wss://slow.test");
    const events: RelaySocketEvent[] = [];
    const client = new BrowserRelayClient({
      createSocket: () => socket,
      onSocketEvent: (event) => events.push(event),
    });
    const connection = client.connect("wss://slow.test");
    const connectPromise = connection.connect();
    socket.openSync();
    await connectPromise;

    if (typeof connection.ping !== "function") {
      throw new Error("BrowserRelayConnection.ping must be defined");
    }
    const rtt = await connection.ping(10);
    expect(rtt).toBeNull();
    const timeouts = events.filter((event) => event.type === "ping_timeout");
    expect(timeouts.length).toBe(1);
  });

  it("EOSE frames do not advance the event_received counter", async () => {
    const socket = new FakeSocket("wss://eose.test");
    const events: RelaySocketEvent[] = [];
    const client = new BrowserRelayClient({
      createSocket: () => socket,
      onSocketEvent: (event) => events.push(event),
    });
    const connection = client.connect("wss://eose.test");
    const connectPromise = connection.connect();
    socket.openSync();
    await connectPromise;
    connection.subscribe({ kinds: [1] }, () => undefined);
    const reqId = JSON.parse(socket.sent.slice(-1)[0])[1] as string;

    socket.message(JSON.stringify(["EOSE", reqId]));
    const eventReceived = events.filter(
      (event) => event.type === "event_received",
    );
    expect(eventReceived.length).toBe(0);
  });
});
