import { Button } from "../../../components/ui";

export function SigningBlockedState({ onStop }: { onStop: () => void }) {
  return (
    <>
      <div className="dash-hero-card">
        <div className="dash-hero-content">
          <div className="dash-hero-indicator">
            <span className="status-light" />
            <span className="dash-hero-title green">Signer Running</span>
          </div>
          <p className="dash-hero-copy">
            Runtime is online, but current policy/readiness gating prevents new signing work from completing.
          </p>
        </div>
        <div className="dash-hero-action">
          <Button type="button" variant="danger" onClick={onStop}>
            Stop Signer
          </Button>
        </div>
      </div>

      <div className="dash-blocked-panel">
        <div className="dash-blocked-header">
          <span className="status-light warning" />
          <span className="dash-blocked-title">Signing Blocked</span>
        </div>
        <p className="dash-blocked-copy">
          Requests are not failing outright, but they cannot complete until the blocking condition clears. Use this state for policy prompts, pending operator review, or temporary readiness gating that stops signing before execution.
        </p>
        <div className="dash-two-col">
          <div className="dash-sub-panel">
            <div className="dash-panel-kicker">Common Causes</div>
            <p className="dash-sub-line">Pending signer-policy decision</p>
            <p className="dash-sub-line">Insufficient ready peers for current request type</p>
            <p className="dash-sub-line">Temporary pool imbalance after reconnect</p>
          </div>
          <div className="dash-sub-panel">
            <div className="dash-panel-kicker">Operator Action</div>
            <p className="dash-sub-line">
              Review approvals or open policies before retrying. If readiness is the issue, wait for relay and peer health to recover.
            </p>
            <div className="dash-action-row">
              <Button type="button" variant="primary">
                Open Policies
              </Button>
              <Button type="button" variant="ghost">
                Review Approvals
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
