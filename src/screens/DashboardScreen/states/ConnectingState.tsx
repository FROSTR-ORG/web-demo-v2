export function ConnectingState({ relays }: { relays: string[] }) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light warning" />
            <span className="dash-hero-title amber">Signer Connecting...</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is starting relay sessions and rebuilding peer state. Signing stays unavailable until connectivity and readiness recover.
          </p>
        </div>
        <div className="dash-hero-action">
          <span className="button button-ghost button-md dash-connecting-badge" role="status" aria-live="polite">
            Connecting...
          </span>
        </div>
      </div>

      <div className="dash-two-col">
        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Connection Progress</div>

          <div className="dash-progress-step">
            <span className="dash-step-dot done" />
            <div className="dash-step-content">
              <div className="dash-step-label">Runtime process started</div>
              <div className="dash-step-detail">Signer booted and local credentials loaded.</div>
            </div>
          </div>

          <div className="dash-progress-step">
            <span className="dash-step-dot active" />
            <div className="dash-step-content">
              <div className="dash-step-label">Connecting to configured relays</div>
              <div className="dash-step-detail">
                Opening sessions for {relays.join(" and ")}.
              </div>
            </div>
          </div>

          <div className="dash-progress-step">
            <span className="dash-step-dot pending" />
            <div className="dash-step-content">
              <div className="dash-step-label">Discovering peers and refilling pools</div>
              <div className="dash-step-detail">
                Ready state returns once peers are online and pool counts recover.
              </div>
            </div>
          </div>
        </div>

        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Current Targets</div>
          <p className="dash-info-line">Relays: {relays.length} configured</p>
          <p className="dash-info-line">Peers: waiting for presence announcements</p>
          <div className="dash-info-note">
            Event logs stay compact here. The primary concern is relay and peer readiness, not log volume.
          </div>
        </div>
      </div>
    </>
  );
}
