import { Button } from "../../../components/ui";

/**
 * SigningBlockedState — Paper-faithful "Signing Blocked" overlay rendered
 * when `deriveDashboardState(...) === 'signing-blocked'` (see
 * `dashboardState.ts` for the transition conditions).
 *
 * When `noncePoolDepleted` is true, we surface a dedicated "Trigger Sync"
 * affordance that dispatches a runtime refresh/rebalance command. The
 * affordance disappears automatically once the pool recovers and the
 * parent stops passing `noncePoolDepleted`. Covers VAL-OPS-018 and
 * VAL-OPS-024.
 */
export function SigningBlockedState({
  onStop,
  onOpenPolicies,
  onReviewApprovals,
  noncePoolDepleted = false,
  onTriggerSync,
}: {
  onStop: () => void;
  onOpenPolicies?: () => void;
  onReviewApprovals?: () => void;
  /**
   * When true, render the nonce-pool "Syncing nonces" banner with a
   * "Trigger Sync" button that re-balances nonce allotments with peers.
   */
  noncePoolDepleted?: boolean;
  onTriggerSync?: () => void;
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
        {noncePoolDepleted ? (
          <div
            className="dash-nonce-sync"
            role="status"
            aria-label="Syncing nonces"
            data-testid="nonce-pool-overlay"
          >
            <div className="dash-nonce-sync-copy">
              <span className="dash-nonce-sync-title">Syncing nonces</span>
              <span className="dash-nonce-sync-detail">
                Nonce pool with peers is exhausted. Trigger a sync to
                rebalance before the next sign.
              </span>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onTriggerSync}
            >
              Trigger Sync
            </Button>
          </div>
        ) : null}
        <div className="dash-capacity-alert" aria-label="Signing capacity">
          <span className="dash-capacity-label">Signing Capacity</span>
          <span className="dash-capacity-track" />
          <span className="dash-capacity-state">
            <span className="dash-capacity-x">×</span>
            0 ready
          </span>
        </div>
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
              <Button type="button" variant="primary" onClick={onOpenPolicies}>
                Open Policies
              </Button>
              <Button type="button" variant="ghost" onClick={onReviewApprovals}>
                Review Approvals
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
