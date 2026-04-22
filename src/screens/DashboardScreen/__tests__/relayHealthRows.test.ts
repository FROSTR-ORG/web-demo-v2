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

  /**
   * fix-m5-relay-telemetry-last-seen-precedence — last-seen precedence
   * must prefer the most relevant timestamp for each relay state so
   * disconnected relays do not display a stale `lastEventAt` carried
   * across disconnect cycles.
   *
   * Transitions covered:
   *   (a) online relay with a fresh inbound event → last-seen uses
   *       `lastEventAt`.
   *   (b) same relay disconnects with no new events and we want to
   *       reflect the time we lost the connection: last-seen uses
   *       `max(lastDisconnectedAt, lastEventAt)` — NOT the stale
   *       `lastEventAt`.
   *   (c) reconnect with a fresh inbound event → last-seen returns
   *       to using `lastEventAt`.
   */
  describe("last-seen precedence across connect / disconnect / reconnect", () => {
    it("(a) online relay prefers lastEventAt over lastConnectedAt", () => {
      const rows = relayHealthRowsFromRuntime(
        [
          mkStatus({
            url: "wss://cycle.test",
            state: "online",
            lastConnectedAt: now - 120_000,
            lastEventAt: now - 7_000,
          }),
        ],
        [],
        now,
      );
      expect(rows[0].status).toBe("Online");
      expect(rows[0].lastSeen).toBe("7s ago");
    });

    it("(b) disconnected relay prefers lastDisconnectedAt when it is more recent than stale lastEventAt", () => {
      const rows = relayHealthRowsFromRuntime(
        [
          {
            url: "wss://cycle.test",
            state: "offline",
            lastConnectedAt: now - 600_000,
            // Stale inbound event from before the disconnect.
            lastEventAt: now - 300_000,
            // Disconnect happened more recently than the last event —
            // that's what the user cares about.
            lastDisconnectedAt: now - 8_000,
          },
        ],
        [],
        now,
      );
      expect(rows[0].status).toBe("Offline");
      expect(rows[0].lastSeen).toBe("8s ago");
    });

    it("(b') disconnected relay keeps the max when lastEventAt is actually more recent than lastDisconnectedAt", () => {
      // Defensive: if an inbound event arrived after the disconnect
      // timestamp was captured (e.g. a late frame), the newer of the
      // two timestamps wins so 'last seen' monotonically advances.
      const rows = relayHealthRowsFromRuntime(
        [
          {
            url: "wss://cycle.test",
            state: "offline",
            lastConnectedAt: now - 600_000,
            lastEventAt: now - 3_000,
            lastDisconnectedAt: now - 45_000,
          },
        ],
        [],
        now,
      );
      expect(rows[0].lastSeen).toBe("3s ago");
    });

    it("(c) reconnect with a fresh inbound event returns to using lastEventAt", () => {
      const rows = relayHealthRowsFromRuntime(
        [
          mkStatus({
            url: "wss://cycle.test",
            state: "online",
            // The prior disconnect timestamp is retained on the status
            // struct after reconnect, but online-state precedence must
            // ignore it in favour of the fresh event.
            lastDisconnectedAt: now - 120_000,
            lastConnectedAt: now - 20_000,
            lastEventAt: now - 2_000,
          }),
        ],
        [],
        now,
      );
      expect(rows[0].status).toBe("Online");
      expect(rows[0].lastSeen).toBe("2s ago");
    });

    it("connecting state uses max(lastDisconnectedAt, lastEventAt) like offline", () => {
      const rows = relayHealthRowsFromRuntime(
        [
          {
            url: "wss://cycle.test",
            state: "connecting",
            lastConnectedAt: now - 600_000,
            lastEventAt: now - 300_000,
            lastDisconnectedAt: now - 10_000,
          },
        ],
        [],
        now,
      );
      expect(rows[0].lastSeen).toBe("10s ago");
    });
  });
});
