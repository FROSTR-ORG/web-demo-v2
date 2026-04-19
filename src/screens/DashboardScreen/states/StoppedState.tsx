import { Button } from "../../../components/ui";

export function StoppedState({ onStart }: { onStart: () => void }) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light error" />
            <span className="dash-hero-title red">Signer Stopped</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is intentionally offline. Relay sessions, peer discovery, and signing capacity are paused until you start the signer again.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="primary" onClick={onStart}>
            Start Signer
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
              <div className="dash-readiness-title">No active relay or peer sessions</div>
              <p className="dash-readiness-desc">
                Starting the signer reconnects configured relays, re-announces presence, and begins refilling pool state.
              </p>
            </div>
          </div>

          <div className="dash-badge-row">
            <span className="dash-badge red">0 relays connected</span>
            <span className="dash-badge red">0 peers online</span>
            <span className="dash-badge neutral">Signing unavailable</span>
          </div>
        </div>

        <div className="dash-info-panel">
          <div className="dash-panel-kicker">Next Step</div>
          <div className="dash-next-steps">
            <p className="dash-info-line">1. Start the signer to resume relay connectivity.</p>
            <p className="dash-info-line">2. Wait for peers to return online and refill signing pools.</p>
            <p className="dash-info-line">3. Policy prompts and approvals will resume once runtime is available again.</p>
          </div>
          <div className="dash-info-note">
            Recent request queues remain preserved, but no new signing or encryption work can complete while the signer is stopped.
          </div>
        </div>
      </div>
    </>
  );
}
