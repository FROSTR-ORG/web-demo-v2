/**
 * m5-relay-telemetry — RuntimeRelayPump telemetry integration tests.
 *
 * Exercises the pump's per-relay `latencyMs`, `eventsReceived`,
 * `lastEventAt`, and `consecutiveSlowSamples` counters by injecting
 * socket-lifecycle events through the client-level `onSocketEvent`
 * hook. Also covers the reset-on-reconnect invariant
 * (VAL-SETTINGS-011) and the Slow-after-two-samples transition
 * (VAL-SETTINGS-013).
 */
import { describe, expect, it } from "vitest";
import { RuntimeRelayPump } from "./runtimeRelayPump";
import type {
  RelayClient,
  RelayConnection,
  RelaySocketEvent,
} from "./browserRelayClient";
import type { RuntimeStatusSummary } from "../bifrost/types";
import type { RelayFilter, RelaySubscription } from "./relayPort";
import { SLOW_RELAY_THRESHOLD_MS } from "./relayTelemetry";

class FakeRuntime {
  metadata() {
    return {
      device_id: "device",
      member_idx: 0,
      share_public_key: "local-pubkey",
      group_public_key: "group-pubkey",
      peers: ["peer-a"],
    };
  }
  handleCommand() {}
  handleInboundEvent() {}
  tick() {}
  drainOutboundEvents() {
    return [];
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
        known_peers: 1,
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

/**
 * Relay connection fake whose `ping()` is driven by a resolver the
 * test caller pokes manually. This lets us assert telemetry flows
 * without racing with timers.
 */
class FakeConnection implements RelayConnection {
  closed = false;
  pingCalls = 0;
  constructor(readonly url: string) {}
  async connect() {}
  async publish() {}
  subscribe(
    _filter: RelayFilter,
    _onEvent: (event: unknown) => void,
  ): RelaySubscription {
    return { close: () => undefined };
  }
  async ping(_timeoutMs: number): Promise<number | null> {
    this.pingCalls += 1;
    return null;
  }
  close() {
    this.closed = true;
  }
}

/**
 * Relay client that captures the `onSocketEvent` hook the pump
 * installs so the test can fire synthetic telemetry events through it.
 */
class HookCapturingClient implements RelayClient {
  hook: ((event: RelaySocketEvent) => void) | null = null;
  constructor(
    private readonly getConnection: (url: string) => RelayConnection,
    hook: (event: RelaySocketEvent) => void,
  ) {
    this.hook = hook;
  }
  connect(url: string): RelayConnection {
    return this.getConnection(url);
  }
}

function buildPump(
  connection: RelayConnection,
  hookBox: { current: ((event: RelaySocketEvent) => void) | null },
) {
  const pump = new RuntimeRelayPump({
    runtime: new FakeRuntime() as never,
    relays: [connection.url],
    relayClient: new HookCapturingClient(
      () => connection,
      (event) => hookBox.current?.(event),
    ),
    eventKind: 27000,
    now: () => 1_000,
    // Long interval so the scheduler fires exactly one initial sample
    // per test.
    pingIntervalMs: 10_000_000,
  });
  return pump;
}

describe("RuntimeRelayPump telemetry", () => {
  it("initialises eventsReceived=0 / consecutiveSlowSamples=0 on every relay", async () => {
    const connection = new FakeConnection("wss://telemetry.test");
    const hookBox: { current: ((event: RelaySocketEvent) => void) | null } = {
      current: null,
    };
    const pump = buildPump(connection, hookBox);
    // Manually wire handleSocketEvent replacement — the pump installs
    // its own handler only when it constructs its own BrowserRelayClient,
    // so for our custom RelayClient we intercept the pump's internal
    // handler by re-exposing it through a thin adapter that we install
    // BEFORE start.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hookBox.current = (event) => (pump as any).handleSocketEvent(event);
    await pump.start();
    const status = pump.relayStatuses()[0];
    expect(status.eventsReceived).toBe(0);
    expect(status.consecutiveSlowSamples).toBe(0);
  });

  it("advances eventsReceived + lastEventAt on each event_received telemetry", async () => {
    const connection = new FakeConnection("wss://events.test");
    const hookBox: { current: ((event: RelaySocketEvent) => void) | null } = {
      current: null,
    };
    const pump = buildPump(connection, hookBox);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hookBox.current = (event) => (pump as any).handleSocketEvent(event);
    await pump.start();
    hookBox.current!({
      type: "event_received",
      url: "wss://events.test",
      at: 5_000,
    });
    hookBox.current!({
      type: "event_received",
      url: "wss://events.test",
      at: 6_000,
    });
    const status = pump.relayStatuses()[0];
    expect(status.eventsReceived).toBe(2);
    expect(status.lastEventAt).toBe(6_000);
  });

  it("tracks latency and transitions to Slow after two over-threshold samples", async () => {
    const connection = new FakeConnection("wss://slow.test");
    const hookBox: { current: ((event: RelaySocketEvent) => void) | null } = {
      current: null,
    };
    const pump = buildPump(connection, hookBox);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hookBox.current = (event) => (pump as any).handleSocketEvent(event);
    await pump.start();

    // First over-threshold sample: counter becomes 1, not yet Slow.
    hookBox.current!({
      type: "ping_sample",
      url: "wss://slow.test",
      at: 7_000,
      rtt_ms: SLOW_RELAY_THRESHOLD_MS + 50,
    });
    expect(pump.relayStatuses()[0].consecutiveSlowSamples).toBe(1);
    expect(pump.relayStatuses()[0].latencyMs).toBe(
      SLOW_RELAY_THRESHOLD_MS + 50,
    );

    // Second over-threshold sample: counter hits 2 → Slow.
    hookBox.current!({
      type: "ping_sample",
      url: "wss://slow.test",
      at: 8_000,
      rtt_ms: SLOW_RELAY_THRESHOLD_MS + 80,
    });
    expect(pump.relayStatuses()[0].consecutiveSlowSamples).toBe(2);

    // A fast sample resets the counter.
    hookBox.current!({
      type: "ping_sample",
      url: "wss://slow.test",
      at: 9_000,
      rtt_ms: 50,
    });
    expect(pump.relayStatuses()[0].consecutiveSlowSamples).toBe(0);
    expect(pump.relayStatuses()[0].latencyMs).toBe(50);
  });

  it("resets eventsReceived to 0 on reconnect (simulateDropAll + simulateRestoreAll)", async () => {
    const connection = new FakeConnection("wss://reset.test");
    const hookBox: { current: ((event: RelaySocketEvent) => void) | null } = {
      current: null,
    };
    const pump = buildPump(connection, hookBox);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hookBox.current = (event) => (pump as any).handleSocketEvent(event);
    await pump.start();
    hookBox.current!({
      type: "event_received",
      url: "wss://reset.test",
      at: 5_000,
    });
    hookBox.current!({
      type: "event_received",
      url: "wss://reset.test",
      at: 5_001,
    });
    expect(pump.relayStatuses()[0].eventsReceived).toBe(2);
    pump.simulateDropAll(1006);
    expect(pump.relayStatuses()[0].state).toBe("offline");
    // FakeConnection reuses the same instance; mark it reusable.
    connection.closed = false;
    await pump.simulateRestoreAll();
    // After reconnect, counter is back to 0 per VAL-SETTINGS-011.
    expect(pump.relayStatuses()[0].eventsReceived).toBe(0);
    expect(pump.relayStatuses()[0].state).toBe("online");
    expect(pump.relayStatuses()[0].reconnectCount).toBe(1);
  });

  it("schedules a latency probe on connect (first sample fires immediately)", async () => {
    const connection = new FakeConnection("wss://probe.test");
    const hookBox: { current: ((event: RelaySocketEvent) => void) | null } = {
      current: null,
    };
    const pump = buildPump(connection, hookBox);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hookBox.current = (event) => (pump as any).handleSocketEvent(event);
    await pump.start();
    // Allow the scheduled async sample to run.
    await Promise.resolve();
    expect(connection.pingCalls).toBeGreaterThanOrEqual(1);
    // Stop the pump so the test's fake interval is torn down.
    pump.stop();
  });
});
