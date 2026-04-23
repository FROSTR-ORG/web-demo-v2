import { Button } from "../../../components/ui";
import { MOCK_RELAY_HEALTH_ROWS, type DashboardRelayHealthRow } from "../mocks";

/**
 * Row shape produced by the runtime-mode mapper
 * (`relayHealthRowsFromRuntime`). Extends the Paper-fixture shape with
 * a `slow` flag so the row can render amber (Slow) distinct from red
 * (Offline) per VAL-SETTINGS-013.
 */
type RelayHealthRow = DashboardRelayHealthRow & { slow?: boolean };

export function RelaysOfflineState({
  onStop,
  onRetry,
  relays = MOCK_RELAY_HEALTH_ROWS,
}: {
  onStop: () => void;
  onRetry: () => void;
  relays?: RelayHealthRow[];
}) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light" />
            <span className="dash-hero-title green">Signer Running</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is active, but every configured relay is currently unreachable. Signing and sync are degraded until connectivity returns.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="danger" onClick={onStop}>
            Stop Signer
          </Button>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Readiness</div>

          <div className="dash-readiness-row">
            <div className="dash-readiness-orbit">
              <div className="dash-readiness-orbit-inner">
                <span className="dash-readiness-dot offline" />
              </div>
            </div>
            <div className="dash-readiness-labels">
              <span className="dash-readiness-status">Offline</span>
              <span className="help">—</span>
            </div>
            <div className="dash-readiness-detail">
              <div className="dash-readiness-title">All Relays Offline</div>
              <p className="dash-readiness-desc">
                Peer presence and pool exchange pause when no relay route is available.
              </p>
            </div>
          </div>

          <div className="dash-badge-row">
            <span className="dash-badge red">0 / 2 relays reachable</span>
            <span className="dash-badge amber">Ready count degraded</span>
          </div>
        </div>

        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Recovery</div>
          <p className="dash-info-line">
            Check network reachability, relay DNS resolution, and local firewall state. Relay sessions will automatically recover when a route is available.
          </p>
          <div className="dash-info-note">
            Signing requests remain blocked or degraded here because runtime has no live relay path to peers.
          </div>
          <Button type="button" variant="primary" onClick={onRetry}>
            Retry Connections
          </Button>
        </div>
      </div>

      <div className="relay-offline-section">
        <div className="relay-offline-alert" role="status">
          <span className="relay-offline-alert-icon">!</span>
          <div>
            <div className="relay-offline-alert-title">All Relays Offline</div>
            <div className="relay-offline-alert-copy">
              Unable to reach any configured relay. Signing, ECDH, and peer communication unavailable.
            </div>
          </div>
        </div>

        <div className="relay-health-table" aria-label="Relay health">
          <div className="relay-health-head">
            <span>Relay</span>
            <span>Status</span>
            <span>Latency</span>
            <span>Events</span>
            <span>Last Seen</span>
          </div>
          {relays.map((relay) => {
            // VAL-SETTINGS-013: render "Slow" status in amber when the
            // row's `slow` flag is set, even though the underlying
            // `status` value is reused from the enum. Keeps the CSS
            // target (`.relay-health-status.slow`) independent of
            // `.offline` so validators can distinguish the two.
            const statusLabel = relay.slow ? "Slow" : relay.status;
            const statusClass = relay.slow
              ? "slow"
              : relay.status.toLowerCase();
            return (
              <div className="relay-health-row" key={relay.relay}>
                <span className="relay-health-url">{relay.relay}</span>
                <span className={`relay-health-status ${statusClass}`}>
                  <span className="relay-health-dot" />
                  {statusLabel}
                </span>
                <span>{relay.latency}</span>
                <span>{relay.events}</span>
                <span>{relay.lastSeen}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
