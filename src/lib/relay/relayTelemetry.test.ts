/**
 * m5-relay-telemetry — unit tests for the shared telemetry helpers.
 * Covers the constants surface (VAL-SETTINGS-013), the relative-time
 * formatter (VAL-SETTINGS-012), and the slow-relay predicate.
 */
import { describe, expect, it } from "vitest";
import {
  RELAY_PING_INTERVAL_MS,
  RELAY_PING_TIMEOUT_MS,
  SLOW_RELAY_CONSECUTIVE_SAMPLES,
  SLOW_RELAY_THRESHOLD_MS,
  formatRelayLastSeen,
  isRelaySlow,
} from "./relayTelemetry";

describe("relayTelemetry constants", () => {
  it("exposes SLOW_RELAY_THRESHOLD_MS = 300 (VAL-SETTINGS-013 default)", () => {
    // The feature description pins the default Slow threshold to 300 ms.
    // If this changes, update the deviation doc and the validation
    // contract entry together — do not silently drift.
    expect(SLOW_RELAY_THRESHOLD_MS).toBe(300);
  });

  it("requires two consecutive over-threshold samples to flag Slow", () => {
    expect(SLOW_RELAY_CONSECUTIVE_SAMPLES).toBe(2);
  });

  it("ping interval is positive and bounded below 60 s (VAL-SETTINGS-010)", () => {
    expect(RELAY_PING_INTERVAL_MS).toBeGreaterThan(0);
    // VAL-SETTINGS-010 requires ≥2 distinct values within 60 s, so the
    // interval must leave headroom for the second sample to land.
    expect(RELAY_PING_INTERVAL_MS).toBeLessThan(30_000);
  });

  it("ping timeout is strictly less than the dashboard 60 s window", () => {
    expect(RELAY_PING_TIMEOUT_MS).toBeGreaterThan(0);
    expect(RELAY_PING_TIMEOUT_MS).toBeLessThan(60_000);
  });
});

describe("formatRelayLastSeen", () => {
  const now = 1_700_000_000_000; // arbitrary fixed epoch-ms

  it("returns '--' when the timestamp is null/undefined (never seen)", () => {
    expect(formatRelayLastSeen(null, now)).toBe("--");
    expect(formatRelayLastSeen(undefined, now)).toBe("--");
  });

  it("returns 'just now' for deltas <= 1s", () => {
    expect(formatRelayLastSeen(now, now)).toBe("just now");
    expect(formatRelayLastSeen(now - 1_000, now)).toBe("just now");
  });

  it("formats seconds with the 'Xs ago' suffix under 60s", () => {
    expect(formatRelayLastSeen(now - 2_000, now)).toBe("2s ago");
    expect(formatRelayLastSeen(now - 45_000, now)).toBe("45s ago");
    expect(formatRelayLastSeen(now - 59_000, now)).toBe("59s ago");
  });

  it("formats minutes with the 'Xm ago' suffix at/above 60s", () => {
    expect(formatRelayLastSeen(now - 60_000, now)).toBe("1m ago");
    expect(formatRelayLastSeen(now - 180_000, now)).toBe("3m ago");
    expect(formatRelayLastSeen(now - 59 * 60_000, now)).toBe("59m ago");
  });

  it("formats hours and days beyond 60m", () => {
    expect(formatRelayLastSeen(now - 60 * 60_000, now)).toBe("1h ago");
    expect(formatRelayLastSeen(now - 25 * 60 * 60_000, now)).toBe("1d ago");
  });

  it("clamps future timestamps to 'just now' (no negative output)", () => {
    // Test clocks occasionally produce lastSeen > now; we clamp rather
    // than rendering "-3s ago".
    expect(formatRelayLastSeen(now + 5_000, now)).toBe("just now");
  });
});

describe("isRelaySlow", () => {
  it("returns false for undefined / below-threshold counts", () => {
    expect(isRelaySlow(undefined)).toBe(false);
    expect(isRelaySlow(0)).toBe(false);
    expect(isRelaySlow(1)).toBe(false);
  });

  it("returns true at the configured 2-sample threshold", () => {
    expect(isRelaySlow(2)).toBe(true);
    expect(isRelaySlow(3)).toBe(true);
  });
});
