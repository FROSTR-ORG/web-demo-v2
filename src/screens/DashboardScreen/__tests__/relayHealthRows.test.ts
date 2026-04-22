/**
 * m5-relay-telemetry — tests for the UI-facing mapper that turns
 * `RuntimeRelayStatus` into Paper-fixture relay-health rows.
 * Validates VAL-SETTINGS-010 (numeric latency), VAL-SETTINGS-011
 * (events counter), VAL-SETTINGS-012 (relative last-seen), and
 * VAL-SETTINGS-013 (Slow flag after 2 consecutive over-threshold
 * samples).
 */
import { describe, expect, it } from "vitest";
import { relayHealthRowsFromRuntime } from "../index";
import type { RuntimeRelayStatus } from "../../../lib/relay/runtimeRelayPump";
import { SLOW_RELAY_THRESHOLD_MS } from "../../../lib/relay/relayTelemetry";

const now = 1_700_000_000_000;

function mkStatus(patch: Partial<RuntimeRelayStatus>): RuntimeRelayStatus {
  return {
    url: "wss://t.test",
    state: "online",
    eventsReceived: 0,
    consecutiveSlowSamples: 0,
    ...patch,
  };
}

describe("relayHealthRowsFromRuntime", () => {
  it("renders numeric latency and events for an online relay", () => {
    const rows = relayHealthRowsFromRuntime(
      [
        mkStatus({
          url: "wss://online.test",
          latencyMs: 42,
          eventsReceived: 3,
          lastEventAt: now - 5_000,
          lastConnectedAt: now - 60_000,
        }),
      ],
      ["wss://online.test"],
      now,
    );
    expect(rows[0]).toMatchObject({
      relay: "wss://online.test",
      status: "Online",
      latency: "42ms",
      events: "3",
      lastSeen: "5s ago",
      slow: false,
    });
  });

  it("renders '--' latency before the first sample arrives", () => {
    const rows = relayHealthRowsFromRuntime(
      [mkStatus({ url: "wss://pending.test", latencyMs: undefined })],
      ["wss://pending.test"],
      now,
    );
    expect(rows[0].latency).toBe("--");
  });

  it("renders events '0' when the counter has not advanced", () => {
    const rows = relayHealthRowsFromRuntime(
      [mkStatus({ eventsReceived: 0 })],
      [],
      now,
    );
    expect(rows[0].events).toBe("0");
  });

  it("flags Slow when consecutiveSlowSamples >= 2 on an online relay", () => {
    const rows = relayHealthRowsFromRuntime(
      [
        mkStatus({
          url: "wss://slow.test",
          latencyMs: SLOW_RELAY_THRESHOLD_MS + 50,
          consecutiveSlowSamples: 2,
          lastConnectedAt: now - 1_000,
        }),
      ],
      [],
      now,
    );
    expect(rows[0].slow).toBe(true);
    // Keep the latency number visible alongside the slow flag so
    // users see the offending RTT.
    expect(rows[0].latency).toBe(`${SLOW_RELAY_THRESHOLD_MS + 50}ms`);
  });

  it("renders real lastSeen for an offline relay (VAL-SETTINGS-014)", () => {
    const rows = relayHealthRowsFromRuntime(
      [
        {
          url: "wss://dropped.test",
          state: "offline",
          lastDisconnectedAt: now - 47_000,
          latencyMs: 120,
        },
      ],
      [],
      now,
    );
    expect(rows[0].status).toBe("Offline");
    expect(rows[0].lastSeen).toBe("47s ago");
    // Latency freezes at the last measured sample rather than blanking
    // out — the Paper-faithful "frozen" behaviour in VAL-SETTINGS-014.
    expect(rows[0].latency).toBe("120ms");
  });

  it("falls back to configured relays when runtimeRelays is empty", () => {
    const rows = relayHealthRowsFromRuntime(
      [],
      ["wss://fallback.test"],
      now,
    );
    expect(rows[0].relay).toBe("wss://fallback.test");
    expect(rows[0].status).toBe("Offline");
  });
});
