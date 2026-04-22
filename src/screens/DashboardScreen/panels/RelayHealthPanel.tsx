import { useEffect, useState } from "react";
import type { RuntimeRelayStatus } from "../../../lib/relay/runtimeRelayPump";
import {
  formatRelayLastSeen,
  isRelaySlow,
  resolveRelayLastSeenSource,
} from "../../../lib/relay/relayTelemetry";

/**
 * Runtime-mode Relay Health table. Renders per-relay telemetry sourced
 * from {@link RuntimeRelayStatus} so VAL-SETTINGS-010/011/012/013/014
 * are observable on the live Dashboard (the Paper reference renders a
 * similar table only in the all-relays-offline state, so this panel is
 * a documented deviation — see
 * `docs/runtime-deviations-from-paper.md`).
 *
 * Hidden in Paper-fixture mode so pixel-parity demo scenarios continue
 * to render identically.
 */
export function RelayHealthPanel({
  runtimeRelays,
}: {
  runtimeRelays: RuntimeRelayStatus[];
}) {
  // 1 s tick so relative `lastSeen` copy ("Xs ago" / "Xm ago") keeps
  // advancing without requiring runtime churn.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  if (runtimeRelays.length === 0) return null;

  return (
    <div className="relay-health-table" aria-label="Relay health">
      <div className="relay-health-head">
        <span>Relay</span>
        <span>Status</span>
        <span>Latency</span>
        <span>Events</span>
        <span>Last Seen</span>
      </div>
      {runtimeRelays.map((relay) => {
        const slow =
          relay.state === "online" && isRelaySlow(relay.consecutiveSlowSamples);
        const statusLabel =
          relay.state === "online"
            ? slow
              ? "Slow"
              : "Online"
            : relay.state === "connecting"
              ? "Connecting"
              : "Offline";
        const statusClass = slow ? "slow" : relay.state;
        const latency =
          typeof relay.latencyMs === "number" ? `${relay.latencyMs}ms` : "--";
        const events =
          typeof relay.eventsReceived === "number"
            ? String(relay.eventsReceived)
            : "0";
        // State-aware last-seen precedence — see
        // `resolveRelayLastSeenSource` and
        // fix-m5-relay-telemetry-last-seen-precedence: online relays
        // prefer `lastEventAt`, disconnected/offline relays prefer
        // `max(lastDisconnectedAt, lastEventAt)` so a stale pre-
        // disconnect event cannot win over a fresher disconnect.
        const lastSeenSource = resolveRelayLastSeenSource(relay);
        const lastSeen = formatRelayLastSeen(lastSeenSource, nowMs);
        return (
          <div
            className="relay-health-row"
            key={relay.url}
            data-relay-url={relay.url}
          >
            <span className="relay-health-url">{relay.url}</span>
            <span className={`relay-health-status ${statusClass}`}>
              <span className="relay-health-dot" />
              {statusLabel}
            </span>
            <span className="relay-health-latency">{latency}</span>
            <span className="relay-health-events">{events}</span>
            <span className="relay-health-last-seen">{lastSeen}</span>
          </div>
        );
      })}
    </div>
  );
}
