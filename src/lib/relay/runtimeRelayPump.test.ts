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
    expect(statuses.at(-1)).toEqual([
      {
        url: "wss://relay.test",
        state: "online",
        lastConnectedAt: 123,
        lastError: undefined,
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
    expect(pump.relayStatuses()).toEqual([
      {
        url: "wss://offline.test",
        state: "offline",
        lastError: "offline",
      },
      {
        url: "wss://publish.test",
        state: "online",
        lastConnectedAt: 500,
        lastError: undefined,
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
});
