/**
 * Relay telemetry constants and shared formatting helpers (m5-relay-telemetry).
 *
 * Centralised so there is a single documented source of truth for the
 * slow-relay threshold and the relative "Xs ago" / "Xm ago" last-seen
 * copy that the Dashboard relay-health table (VAL-SETTINGS-012 /
 * VAL-SETTINGS-013 / VAL-SETTINGS-014) and any future relay telemetry
 * surface both rely on.
 */

/**
 * Round-trip-latency threshold (milliseconds) above which a relay
 * transitions from the Online (green) status to the Slow (amber)
 * status. Per VAL-SETTINGS-013 the transition requires **two
 * consecutive** samples above the threshold while the underlying socket
 * remains `readyState === OPEN` — a single spike does not move the
 * badge. Dropping a subsequent sample below the threshold resets the
 * slow counter and returns the badge to Online.
 *
 * Default `300 ms` chosen to flag relays that are noticeably slower
 * than the typical public Nostr relay but still functional enough that
 * the runtime should not tear the socket down. Exposed as a named
 * export so unit tests and UI consumers can reference the same
 * constant.
 */
export const SLOW_RELAY_THRESHOLD_MS = 300;

/**
 * Number of consecutive RTT samples above {@link SLOW_RELAY_THRESHOLD_MS}
 * required before a row is rendered with the Slow (amber) status.
 * VAL-SETTINGS-013 requires this to be exactly `2`.
 */
export const SLOW_RELAY_CONSECUTIVE_SAMPLES = 2;

/**
 * Default interval between latency pings (milliseconds). The
 * {@link RuntimeRelayPump} schedules a REQ/EOSE ping per online relay
 * at this cadence so VAL-SETTINGS-010's "≥2 distinct latency values
 * within 60 s" assertion is satisfied in steady state.
 */
export const RELAY_PING_INTERVAL_MS = 15_000;

/**
 * Maximum time the pump waits for the EOSE response to a probe
 * subscription before treating it as a dropped sample. A timeout does
 * not mark the relay offline (the underlying socket may still be
 * healthy) — it simply skips the sample so the counter does not
 * increment toward Slow.
 */
export const RELAY_PING_TIMEOUT_MS = 10_000;

/**
 * Format a Unix-ms timestamp as the Paper-faithful relative "Xs ago"
 * / "Xm ago" / "Xh ago" / "Xd ago" copy used in the dashboard relay
 * health table.
 *
 * - `null` / `undefined` → `"--"` (never-seen).
 * - `nowMs - lastSeenMs` ≤ 1 s → `"just now"`.
 * - Under 60 s → `"${secs}s ago"`.
 * - Under 60 min → `"${mins}m ago"`.
 * - Under 24 h → `"${hrs}h ago"`.
 * - Otherwise → `"${days}d ago"`.
 *
 * Negative deltas (lastSeen from the future — e.g. a test clock) are
 * clamped to zero so the copy always reads `"just now"` rather than
 * `"-3s ago"`.
 */
export function formatRelayLastSeen(
  lastSeenMs: number | null | undefined,
  nowMs: number,
): string {
  if (lastSeenMs === null || lastSeenMs === undefined) return "--";
  const diffSecs = Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
  if (diffSecs <= 1) return "just now";
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Compute whether a relay should render in the Slow (amber) state.
 * Derived in one place so both the UI mapper and validators can share
 * the same predicate.
 */
export function isRelaySlow(
  consecutiveSlowSamples: number | undefined,
): boolean {
  return (
    (consecutiveSlowSamples ?? 0) >= SLOW_RELAY_CONSECUTIVE_SAMPLES
  );
}
