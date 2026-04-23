import { describe, expect, it } from "vitest";
import type { RuntimeStatusSummary } from "../bifrost/types";
import { RuntimeRelayPump } from "./runtimeRelayPump";
import type { RelayClient, RelayConnection } from "./browserRelayClient";
import type { RelayFilter, RelaySubscription } from "./relayPort";

class FakeRuntime {
  commands: unknown[] = [];
  inbound: unknown[] = [];
  ticks: number[] = [];
  outbound: unknown[] = [];

  metadata() {
    return {
      device_id: "device",
      member_idx: 0,
      share_public_key: "local-pubkey",
      group_public_key: "group-pubkey",
      peers: ["peer-a", "peer-b"],
    };
  }

  handleCommand(command: unknown) {
    this.commands.push(command);
  }

  handleInboundEvent(event: unknown) {
    this.inbound.push(event);
  }

  tick(now: number) {
    this.ticks.push(now);
  }

  drainOutboundEvents() {
    const outbound = this.outbound;
    this.outbound = [];
    return outbound;
  }

  drainCompletions() {
    return [];
  }

  drainFailures() {
    return [];
  }

  drainRuntimeEvents() {
    return [];
  }

  runtimeStatus(): RuntimeStatusSummary {
    return {
      status: {
        device_id: "device",
        pending_ops: 0,
        last_active: 1,
        known_peers: 2,
        request_seq: 1,
      },
      metadata: this.metadata(),
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 1,
        signing_peer_count: 1,
        ecdh_peer_count: 1,
        last_refresh_at: 1,
        degraded_reasons: [],
      },
      peers: [],
      peer_permission_states: [],
      pending_operations: [],
    };
  }
}

class FakeRelayConnection implements RelayConnection {
  publishes: unknown[] = [];
  subscriptions: Array<{
    filter: RelayFilter;
    onEvent: (event: unknown) => void;
    closed: boolean;
  }> = [];
  closed = false;

  constructor(
    readonly url: string,
    private readonly options: { connectError?: Error; publishError?: Error } = {},
  ) {}

  async connect() {
    if (this.options.connectError) {
      throw this.options.connectError;
    }
  }

  async publish(event: unknown) {
    if (this.options.publishError) {
      throw this.options.publishError;
    }
    this.publishes.push(event);
  }

  subscribe(filter: RelayFilter, onEvent: (event: unknown) => void): RelaySubscription {
    const subscription = { filter, onEvent, closed: false };
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
  connections: FakeRelayConnection[];

  constructor(connections: FakeRelayConnection[]) {
    this.connections = connections;
  }

  connect(url: string): RelayConnection {
    const connection = this.connections.find((entry) => entry.url === url);
    if (!connection) {
      throw new Error(`Unexpected relay ${url}`);
    }
    return connection;
  }
}

describe("RuntimeRelayPump", () => {
  it("subscribes with the runtime filter, refreshes peers, publishes outbound events, and accepts inbound events", async () => {
    const runtime = new FakeRuntime();
    runtime.outbound.push({ id: "outbound-event" });
    const relay = new FakeRelayConnection("wss://relay.test");
    const statuses: unknown[] = [];
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://relay.test"],
      relayClient: new FakeRelayClient([relay]),
      eventKind: 27000,
      now: () => 123,
      onRelayStatusChange: (value) => statuses.push(value),
    });

    await pump.start();
    expect(relay.subscriptions[0].filter).toEqual({
      kinds: [27000],
      authors: ["peer-a", "peer-b"],
      "#p": ["local-pubkey"],
    });
    // m5-relay-telemetry: online status now carries `eventsReceived`,
    // `consecutiveSlowSamples`, and undefined `latencyMs` / `lastEventAt`
    // until the first ping / inbound event arrives.
    expect(statuses.at(-1)).toEqual([
      {
        url: "wss://relay.test",
        state: "online",
        lastConnectedAt: 123,
        lastError: undefined,
        reconnectCount: 0,
        eventsReceived: 0,
        consecutiveSlowSamples: 0,
        latencyMs: undefined,
        lastEventAt: undefined,
      },
    ]);

    await pump.refreshAll();
    expect(runtime.commands).toContainEqual({ type: "refresh_all_peers" });
    expect(runtime.ticks).toContain(123);
    expect(relay.publishes).toEqual([{ id: "outbound-event" }]);

    relay.subscriptions[0].onEvent({ id: "inbound-event" });
    await Promise.resolve();
    expect(runtime.inbound).toEqual([{ id: "inbound-event" }]);

    pump.stop();
    expect(relay.subscriptions[0].closed).toBe(true);
    expect(relay.closed).toBe(true);
  });

  it("marks failed connects and failed publishes offline", async () => {
    const runtime = new FakeRuntime();
    const offline = new FakeRelayConnection("wss://offline.test", {
      connectError: new Error("offline"),
    });
    const publishing = new FakeRelayConnection("wss://publish.test", {
      publishError: new Error("publish denied"),
    });
    const statuses: unknown[] = [];
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://offline.test", "wss://publish.test"],
      relayClient: new FakeRelayClient([offline, publishing]),
      eventKind: 27000,
      now: () => 500,
      onRelayStatusChange: (value) => statuses.push(value),
    });

    await pump.start();
    // m5-relay-telemetry: telemetry fields are initialized for every
    // relay, including ones that never reach `online`.
    expect(pump.relayStatuses()).toEqual([
      {
        url: "wss://offline.test",
        state: "offline",
        lastError: "offline",
        reconnectCount: 0,
        eventsReceived: 0,
        consecutiveSlowSamples: 0,
      },
      {
        url: "wss://publish.test",
        state: "online",
        lastConnectedAt: 500,
        lastError: undefined,
        reconnectCount: 0,
        eventsReceived: 0,
        consecutiveSlowSamples: 0,
        latencyMs: undefined,
        lastEventAt: undefined,
      },
    ]);

    runtime.outbound.push({ id: "outbound-event" });
    await pump.refreshAll();
    expect(pump.relayStatuses()[1]).toMatchObject({
      url: "wss://publish.test",
      state: "offline",
      lastError: "publish denied",
    });
    expect(statuses.at(-1)).toEqual(pump.relayStatuses());
  });

  /**
   * VAL-OPS-016 / VAL-OPS-023 / VAL-OPS-028 — exercise the dev-only
   * simulateDropAll + simulateRestoreAll test hooks and assert that
   * `lastCloseCode`, `lastDisconnectedAt`, and `reconnectCount` telemetry
   * lands on `runtimeRelays[*]` so the flow validator can observe a
   * disconnect-then-reconnect cycle without inspecting raw WS frames.
   */
  it("simulateDropAll + simulateRestoreAll record lastCloseCode and increment reconnectCount", async () => {
    const runtime = new FakeRuntime();
    let nowCursor = 100;
    // Each call to connect/publish creates the same connection instance —
    // but simulateRestoreAll reconnects via a fresh call to
    // `relayClient.connect(url)`. Our FakeRelayClient maps by URL so the
    // SAME FakeRelayConnection is returned on both connects; we just reset
    // its `closed` flag so the second connect.connect() resolves.
    const relay = new FakeRelayConnection("wss://relay.test");
    const statusUpdates: unknown[] = [];
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://relay.test"],
      relayClient: new FakeRelayClient([relay]),
      eventKind: 27000,
      now: () => {
        nowCursor += 1;
        return nowCursor;
      },
      onRelayStatusChange: (value) => statusUpdates.push(value),
    });

    await pump.start();
    expect(pump.relayStatuses()[0]).toMatchObject({
      state: "online",
      reconnectCount: 0,
    });

    pump.simulateDropAll(1006);
    const afterDrop = pump.relayStatuses()[0];
    expect(afterDrop.state).toBe("offline");
    expect(afterDrop.lastCloseCode).toBe(1006);
    expect(typeof afterDrop.lastDisconnectedAt).toBe("number");
    // reconnectCount is NOT incremented by a drop — only by a successful
    // restore. This keeps the counter monotonic in the "survived a drop"
    // sense.
    expect(afterDrop.reconnectCount).toBe(0);

    // Reset the FakeRelayConnection so restore can re-subscribe.
    relay.closed = false;
    relay.subscriptions.length = 0;

    await pump.simulateRestoreAll();
    const afterRestore = pump.relayStatuses()[0];
    expect(afterRestore.state).toBe("online");
    expect(afterRestore.reconnectCount).toBe(1);
    expect(afterRestore.lastConnectedAt).toBe(nowCursor);
  });

  it("forwards socket lifecycle events to onSocketEvent hook", async () => {
    // Uses the default BrowserRelayClient path (no custom relayClient) so
    // the pump wires its own onSocketEvent through. We stub out the socket
    // factory via the createSocket option.
    const runtime = new FakeRuntime();
    const events: unknown[] = [];
    // A minimal fake socket for the BrowserRelayClient. readyState=1 means
    // "open" for `send`. Fire open synchronously on addEventListener.
    class MiniFakeSocket {
      readyState = 0;
      private openL: Array<(event: Event | MessageEvent) => void> = [];
      private closeL: Array<(event: Event | MessageEvent) => void> = [];
      constructor(readonly url: string) {}
      send() {
        /* no-op */
      }
      close() {
        this.readyState = 3;
        const syntheticClose = {
          code: 1000,
          wasClean: true,
        } as unknown as Event;
        this.closeL.forEach((listener) => listener(syntheticClose));
      }
      addEventListener(
        type: "open" | "message" | "error" | "close",
        listener: (event: Event | MessageEvent) => void,
      ) {
        if (type === "open") {
          this.openL.push(listener);
          // Fire open on next tick so the connect promise can resolve.
          queueMicrotask(() => {
            this.readyState = 1;
            listener(new Event("open"));
          });
        }
        if (type === "close") {
          this.closeL.push(listener);
        }
      }
      removeEventListener(
        _type: "open" | "message" | "error" | "close",
        _listener: (event: Event | MessageEvent) => void,
      ) {
        /* no-op for tests */
      }
    }
    const { BrowserRelayClient } = await import("./browserRelayClient");
    const relayClient = new BrowserRelayClient({
      createSocket: (url) => new MiniFakeSocket(url),
      onSocketEvent: (event) => events.push(event),
    });
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://relay.test"],
      relayClient,
      eventKind: 27000,
      now: () => 1,
      onSocketEvent: (event) => events.push(event),
    });
    await pump.start();
    // The pump wires its own handler, and we supplied onSocketEvent, so
    // we see the "open" event TWICE (once from the client's direct
    // observer, once via the pump's handleSocketEvent hook).
    const opens = events.filter(
      (event) => (event as { type: string }).type === "open",
    );
    expect(opens.length).toBeGreaterThan(0);
    expect((opens[0] as { url: string }).url).toBe("wss://relay.test");

    pump.simulateDropAll(1006);
    const closes = events.filter(
      (event) => (event as { type: string }).type === "close",
    );
    expect(closes.length).toBeGreaterThan(0);
    const synthetic = closes.find(
      (event) => (event as { code: number }).code === 1006,
    );
    expect(synthetic).toBeTruthy();
  });

  /**
   * m5-relay-list-persist — hot-reload the relay list:
   *   - Removed relays close cleanly with code 1000.
   *   - Added relays acquire a fresh subscription.
   *   - Relays present on both sides are untouched (counter/subscription
   *     identity preserved for VAL-SETTINGS-022 "no duplicate REQ").
   */
  it("updateRelays closes removed sockets cleanly, opens added sockets, preserves untouched ones", async () => {
    const runtime = new FakeRuntime();
    class CleanCloseRelay extends FakeRelayConnection {
      cleanCloseCalls: Array<{ code: number; reason: string }> = [];
      closeCleanly(code: number, reason: string) {
        this.cleanCloseCalls.push({ code, reason });
        this.closed = true;
      }
    }
    const keep = new CleanCloseRelay("wss://keep.test");
    const remove = new CleanCloseRelay("wss://remove.test");
    const add = new CleanCloseRelay("wss://added.test");
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://keep.test", "wss://remove.test"],
      relayClient: new FakeRelayClient([keep, remove, add]),
      eventKind: 27000,
      now: () => 100,
    });

    await pump.start();
    // Initial subscribe: each of the two starting relays has exactly one
    // live subscription; the un-added relay has none.
    expect(keep.subscriptions.length).toBe(1);
    expect(remove.subscriptions.length).toBe(1);
    expect(add.subscriptions.length).toBe(0);
    const keepSubscription = keep.subscriptions[0];

    await pump.updateRelays(["wss://keep.test", "wss://added.test"]);

    // Removed relay socket is closed via `closeCleanly(1000, ...)` and its
    // subscription is shut down.
    expect(remove.cleanCloseCalls).toEqual([
      { code: 1000, reason: "relay-removed" },
    ]);
    expect(remove.subscriptions[0].closed).toBe(true);

    // Added relay got exactly one fresh subscription.
    expect(add.subscriptions.length).toBe(1);
    expect(add.subscriptions[0].filter).toEqual({
      kinds: [27000],
      authors: ["peer-a", "peer-b"],
      "#p": ["local-pubkey"],
    });

    // Kept relay's SAME subscription survived — no new REQ landed, so
    // validators asserting "no duplicate REQ on edit" (VAL-SETTINGS-022)
    // see a stable subscription identity.
    expect(keep.subscriptions.length).toBe(1);
    expect(keep.subscriptions[0]).toBe(keepSubscription);
    expect(keepSubscription.closed).toBe(false);

    // Final status list reflects the new membership, in order.
    expect(pump.relayStatuses().map((status) => status.url)).toEqual([
      "wss://keep.test",
      "wss://added.test",
    ]);
    expect(pump.relayStatuses()[0].state).toBe("online");
    expect(pump.relayStatuses()[1].state).toBe("online");
  });

  it("updateRelays treats duplicate / whitespace entries as a no-op (idempotent)", async () => {
    const runtime = new FakeRuntime();
    const relay = new FakeRelayConnection("wss://relay.test");
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://relay.test"],
      relayClient: new FakeRelayClient([relay]),
      eventKind: 27000,
      now: () => 100,
    });
    await pump.start();
    const subscriptionsBefore = relay.subscriptions.length;
    await pump.updateRelays([
      "wss://relay.test",
      "  wss://relay.test  ",
      "",
    ]);
    // No new subscription was opened.
    expect(relay.subscriptions.length).toBe(subscriptionsBefore);
    expect(pump.relayStatuses().map((status) => status.url)).toEqual([
      "wss://relay.test",
    ]);
  });

  /**
   * VAL-OPS-028 — page unload must tell each open relay socket to close
   * with a well-formed close frame (default 1001 "going-away") so the
   * eventual close reported post-reopen is clean, not the default 1006
   * abnormal that the OS produces when the tab is torn down.
   */
  it("closeCleanly emits a clean (1001) close event for every active relay socket", async () => {
    const runtime = new FakeRuntime();
    const events: unknown[] = [];
    class MiniFakeSocket {
      readyState = 0;
      closeCalls: Array<{ code?: number; reason?: string }> = [];
      private openL: Array<(event: Event | MessageEvent) => void> = [];
      private closeL: Array<(event: Event | MessageEvent) => void> = [];
      constructor(readonly url: string) {}
      send() {
        /* no-op */
      }
      close(code?: number, reason?: string) {
        this.closeCalls.push({ code, reason });
        this.readyState = 3;
      }
      addEventListener(
        type: "open" | "message" | "error" | "close",
        listener: (event: Event | MessageEvent) => void,
      ) {
        if (type === "open") {
          this.openL.push(listener);
          queueMicrotask(() => {
            this.readyState = 1;
            listener(new Event("open"));
          });
        }
        if (type === "close") {
          this.closeL.push(listener);
        }
      }
      removeEventListener() {
        /* no-op */
      }
    }
    const createdSockets: MiniFakeSocket[] = [];
    const { BrowserRelayClient } = await import("./browserRelayClient");
    const relayClient = new BrowserRelayClient({
      createSocket: (url) => {
        const socket = new MiniFakeSocket(url);
        createdSockets.push(socket);
        return socket;
      },
      onSocketEvent: (event) => events.push(event),
    });
    const pump = new RuntimeRelayPump({
      runtime: runtime as never,
      relays: ["wss://primal.test", "wss://damus.test"],
      relayClient,
      eventKind: 27000,
      now: () => 42,
    });
    await pump.start();

    pump.closeCleanly();

    // Each underlying socket received socket.close(1001, 'going-away').
    expect(
      createdSockets
        .map((socket) => socket.closeCalls)
        .sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        ),
    ).toEqual([
      [{ code: 1001, reason: "going-away" }],
      [{ code: 1001, reason: "going-away" }],
    ]);

    const closes = events.filter(
      (event) => (event as { type: string }).type === "close",
    );
    expect(closes.length).toBe(2);
    closes.forEach((close) => {
      expect((close as { code: number }).code).toBe(1001);
      expect((close as { wasClean: boolean }).wasClean).toBe(true);
    });
  });

  /**
   * VAL-SETTINGS-021 — Lock Profile must close every active relay
   * socket with a well-formed close frame. `lockProfile()` in
   * `AppStateProvider` invokes `closeCleanly(1000, "lock-profile")`
   * specifically so validators inspecting `lastCloseCode` can
   * distinguish a Lock (1000) from a tab unload (1001 — see
   * VAL-OPS-028). This test pins the mechanism independently of the
   * caller to guarantee the code + reason survive pump edits.
   */
  it(
    "closeCleanly(1000, 'lock-profile') emits code 1000 with reason 'lock-profile' on every active socket (VAL-SETTINGS-021)",
    async () => {
      const runtime = new FakeRuntime();
      const events: unknown[] = [];
      class MiniFakeSocket {
        readyState = 0;
        closeCalls: Array<{ code?: number; reason?: string }> = [];
        private openL: Array<(event: Event | MessageEvent) => void> = [];
        private closeL: Array<(event: Event | MessageEvent) => void> = [];
        constructor(readonly url: string) {}
        send() {
          /* no-op */
        }
        close(code?: number, reason?: string) {
          this.closeCalls.push({ code, reason });
          this.readyState = 3;
        }
        addEventListener(
          type: "open" | "message" | "error" | "close",
          listener: (event: Event | MessageEvent) => void,
        ) {
          if (type === "open") {
            this.openL.push(listener);
            queueMicrotask(() => {
              this.readyState = 1;
              listener(new Event("open"));
            });
          }
          if (type === "close") {
            this.closeL.push(listener);
          }
        }
        removeEventListener() {
          /* no-op */
        }
      }
      const createdSockets: MiniFakeSocket[] = [];
      const { BrowserRelayClient } = await import("./browserRelayClient");
      const relayClient = new BrowserRelayClient({
        createSocket: (url) => {
          const socket = new MiniFakeSocket(url);
          createdSockets.push(socket);
          return socket;
        },
        onSocketEvent: (event) => events.push(event),
      });
      const pump = new RuntimeRelayPump({
        runtime: runtime as never,
        relays: ["wss://primal.test", "wss://damus.test"],
        relayClient,
        eventKind: 27000,
        now: () => 42,
      });
      await pump.start();

      pump.closeCleanly(1000, "lock-profile");

      expect(
        createdSockets
          .map((socket) => socket.closeCalls)
          .sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
      ).toEqual([
        [{ code: 1000, reason: "lock-profile" }],
        [{ code: 1000, reason: "lock-profile" }],
      ]);
      const closes = events.filter(
        (event) => (event as { type: string }).type === "close",
      );
      expect(closes.length).toBe(2);
      closes.forEach((close) => {
        expect((close as { code: number }).code).toBe(1000);
        expect((close as { wasClean: boolean }).wasClean).toBe(true);
      });
    },
  );

  /**
   * `publishEvent` publishes a prepared Nostr event to every online
   * relay in parallel with independent error handling so one relay
   * failing does not short-circuit the others.
   */
  describe("publishEvent", () => {
    it("publishes a prepared event to every online relay and returns `reached`", async () => {
      const runtime = new FakeRuntime();
      const relayA = new FakeRelayConnection("wss://relay-a.test");
      const relayB = new FakeRelayConnection("wss://relay-b.test");
      const pump = new RuntimeRelayPump({
        runtime: runtime as never,
        relays: ["wss://relay-a.test", "wss://relay-b.test"],
        relayClient: new FakeRelayClient([relayA, relayB]),
        eventKind: 27000,
      });
      await pump.start();

      const backupEvent = {
        id: "event-id",
        pubkey: "share-pubkey",
        kind: 10000,
        content: "ciphertext",
        tags: [],
        sig: "sig",
        created_at: 1_700_000_000,
      };
      const outcome = await pump.publishEvent(backupEvent);
      expect(outcome.reached.sort()).toEqual([
        "wss://relay-a.test",
        "wss://relay-b.test",
      ]);
      expect(outcome.failed).toEqual([]);
      expect(relayA.publishes).toEqual([backupEvent]);
      expect(relayB.publishes).toEqual([backupEvent]);
    });

    it("returns `failed` for relays whose publish rejected without failing the whole call", async () => {
      const runtime = new FakeRuntime();
      const good = new FakeRelayConnection("wss://good.test");
      const bad = new FakeRelayConnection("wss://bad.test", {
        publishError: new Error("publish denied"),
      });
      const pump = new RuntimeRelayPump({
        runtime: runtime as never,
        relays: ["wss://good.test", "wss://bad.test"],
        relayClient: new FakeRelayClient([good, bad]),
        eventKind: 27000,
      });
      await pump.start();

      const outcome = await pump.publishEvent({ id: "event-id" });
      expect(outcome.reached).toEqual(["wss://good.test"]);
      expect(outcome.failed).toEqual(["wss://bad.test"]);
      expect(good.publishes).toEqual([{ id: "event-id" }]);
      expect(bad.publishes).toEqual([]);
    });

    it("returns empty arrays when no relays are online (VAL-BACKUP-007)", async () => {
      const runtime = new FakeRuntime();
      const offline = new FakeRelayConnection("wss://offline.test", {
        connectError: new Error("offline"),
      });
      const pump = new RuntimeRelayPump({
        runtime: runtime as never,
        relays: ["wss://offline.test"],
        relayClient: new FakeRelayClient([offline]),
        eventKind: 27000,
      });
      await pump.start();

      const outcome = await pump.publishEvent({ id: "never-reaches" });
      expect(outcome.reached).toEqual([]);
      expect(outcome.failed).toEqual([]);
      expect(offline.publishes).toEqual([]);
    });

    it("returns empty arrays when the pump is stopped", async () => {
      const runtime = new FakeRuntime();
      const relay = new FakeRelayConnection("wss://relay.test");
      const pump = new RuntimeRelayPump({
        runtime: runtime as never,
        relays: ["wss://relay.test"],
        relayClient: new FakeRelayClient([relay]),
        eventKind: 27000,
      });
      await pump.start();
      pump.stop();
      const outcome = await pump.publishEvent({ id: "never" });
      expect(outcome.reached).toEqual([]);
      expect(outcome.failed).toEqual([]);
    });
  });
});
