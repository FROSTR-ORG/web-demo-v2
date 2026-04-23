/**
 * Tests for `fix-m1-clean-ws-close-on-unload` (VAL-OPS-028).
 *
 * Covers:
 *   (a) `BrowserRelayConnection.closeCleanly()` calls
 *       `socket.close(1001, 'going-away')` by default and emits a
 *       synthesized close event with `wasClean=true`.
 *   (b) `BrowserRelayClient.closeCleanly()` invokes `closeCleanly` on every
 *       managed connection.
 *   (c) The persistent close listener records `wasClean=true` when the
 *       CloseEvent code is in [1000, 1002], and `wasClean=false` for 1006
 *       and other codes outside the range.
 */
import { describe, expect, it } from "vitest";
import { BrowserRelayClient } from "./browserRelayClient";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<
    string,
    Set<(event: Event | MessageEvent) => void>
  >();

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
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

  fireClose(code: number, wasCleanFlag: boolean) {
    this.dispatch("close", { code, wasClean: wasCleanFlag } as unknown as Event);
  }

  private dispatch(type: string, event: Event | MessageEvent) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

describe("BrowserRelayConnection.closeCleanly", () => {
  it("calls socket.close(1001, 'going-away') by default and emits a wasClean=true close event", async () => {
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

    // Invoke the new cleanup method. Typed assertion since only
    // BrowserRelayConnection exposes it.
    (
      connection as unknown as { closeCleanly: (c?: number, r?: string) => void }
    ).closeCleanly();

    expect(sockets[0].closeCalls).toEqual([{ code: 1001, reason: "going-away" }]);

    const closes = events.filter(
      (event) => (event as { type: string }).type === "close",
    );
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({
      type: "close",
      url: "wss://relay.test",
      code: 1001,
      wasClean: true,
    });
  });

  it("accepts a custom code and reason (e.g. 1000 'normal')", async () => {
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

    (
      connection as unknown as { closeCleanly: (c?: number, r?: string) => void }
    ).closeCleanly(1000, "page-unload");

    expect(sockets[0].closeCalls).toEqual([{ code: 1000, reason: "page-unload" }]);
    const close = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(close.code).toBe(1000);
    expect(close.wasClean).toBe(true);
  });

  it("suppresses a subsequent real close event so only the synthesized clean close is observed", async () => {
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

    (
      connection as unknown as { closeCleanly: (c?: number, r?: string) => void }
    ).closeCleanly();

    // The browser will typically fire its own close event after socket.close().
    // Our impl must suppress that so the observer sees exactly one close.
    sockets[0].fireClose(1001, true);

    const closes = events.filter(
      (event) => (event as { type: string }).type === "close",
    );
    expect(closes).toHaveLength(1);
    expect((closes[0] as { wasClean: boolean }).wasClean).toBe(true);
  });

  it("is a no-op when the connection was never opened", () => {
    const client = new BrowserRelayClient({
      createSocket: (url) => new FakeSocket(url),
      onSocketEvent: () => {
        /* no-op */
      },
    });
    const connection = client.connect("wss://relay.test");
    // Never call connect(); closeCleanly should tolerate the absence of
    // an underlying socket without throwing.
    expect(() =>
      (
        connection as unknown as {
          closeCleanly: (c?: number, r?: string) => void;
        }
      ).closeCleanly(),
    ).not.toThrow();
  });
});

describe("BrowserRelayClient.closeCleanly", () => {
  it("invokes closeCleanly on every currently-managed connection", async () => {
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
    const urls = ["wss://one.test", "wss://two.test", "wss://three.test"];
    const connections = urls.map((url) => client.connect(url));
    for (let i = 0; i < connections.length; i += 1) {
      const open = connections[i].connect();
      sockets[i].open();
      // eslint-disable-next-line no-await-in-loop
      await open;
    }

    client.closeCleanly();

    // Every socket received socket.close(1001, 'going-away').
    expect(sockets.map((socket) => socket.closeCalls)).toEqual([
      [{ code: 1001, reason: "going-away" }],
      [{ code: 1001, reason: "going-away" }],
      [{ code: 1001, reason: "going-away" }],
    ]);

    // Each relay produced exactly one clean close event.
    const closes = events.filter(
      (event) => (event as { type: string }).type === "close",
    );
    expect(closes).toHaveLength(3);
    closes.forEach((close) => {
      expect((close as { code: number }).code).toBe(1001);
      expect((close as { wasClean: boolean }).wasClean).toBe(true);
    });
    expect(closes.map((close) => (close as { url: string }).url).sort()).toEqual(
      urls.slice().sort(),
    );
  });

  it("accepts a custom code and reason and forwards to every managed socket", async () => {
    const sockets: FakeSocket[] = [];
    const client = new BrowserRelayClient({
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const connections = ["wss://a.test", "wss://b.test"].map((url) =>
      client.connect(url),
    );
    for (let i = 0; i < connections.length; i += 1) {
      const open = connections[i].connect();
      sockets[i].open();
      // eslint-disable-next-line no-await-in-loop
      await open;
    }

    client.closeCleanly(1000, "page-unload");

    expect(sockets.map((socket) => socket.closeCalls)).toEqual([
      [{ code: 1000, reason: "page-unload" }],
      [{ code: 1000, reason: "page-unload" }],
    ]);
  });

  it("is safe to call when no connections have been opened", () => {
    const client = new BrowserRelayClient({
      createSocket: (url) => new FakeSocket(url),
    });
    expect(() => client.closeCleanly()).not.toThrow();
  });
});

describe("BrowserRelayConnection persistent close listener — wasClean range", () => {
  async function setup() {
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
    return { sockets, events };
  }

  it("records wasClean=true when CloseEvent.code is 1000 (normal)", async () => {
    const { sockets, events } = await setup();
    sockets[0].fireClose(1000, false);
    const close = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(close.code).toBe(1000);
    expect(close.wasClean).toBe(true);
  });

  it("records wasClean=true when CloseEvent.code is 1001 (going-away)", async () => {
    const { sockets, events } = await setup();
    // Even when the browser reports wasClean=false on the raw event, our
    // listener overrides based on the code range so a 1001 tab-unload
    // looks clean in telemetry.
    sockets[0].fireClose(1001, false);
    const close = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(close.code).toBe(1001);
    expect(close.wasClean).toBe(true);
  });

  it("records wasClean=true when CloseEvent.code is 1002 (protocol error, within range)", async () => {
    const { sockets, events } = await setup();
    sockets[0].fireClose(1002, false);
    const close = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(close.code).toBe(1002);
    expect(close.wasClean).toBe(true);
  });

  it("records wasClean=false when CloseEvent.code is 1006 (abnormal)", async () => {
    const { sockets, events } = await setup();
    sockets[0].fireClose(1006, false);
    const close = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(close.code).toBe(1006);
    expect(close.wasClean).toBe(false);
  });

  it("records wasClean=false when CloseEvent.code is 1011 (server error)", async () => {
    const { sockets, events } = await setup();
    sockets[0].fireClose(1011, false);
    const close = events.find(
      (event) => (event as { type: string }).type === "close",
    ) as { code: number; wasClean: boolean };
    expect(close.code).toBe(1011);
    expect(close.wasClean).toBe(false);
  });
});
