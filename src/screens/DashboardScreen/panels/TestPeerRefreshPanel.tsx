import { useCallback, useState, type FormEvent } from "react";
import { RotateCw } from "lucide-react";
import { useAppState } from "../../../app/AppState";

/**
 * Web-demo affordance for smoke-testing the `refresh_all_peers` runtime
 * command from the profile-scoped Test page. This is the only manual
 * peer-refresh command surface; the Dashboard Peers header is display-only.
 *
 * Fulfils:
 *   - Feature `fix-m1-keyboard-ping-trigger-and-enter-activation` — ensures
 *     the OPS surfaces are all reachable in tab order.
 *   - VAL-OPS-025 — "All OPS surfaces are keyboard reachable" (peer refresh
 *     side).
 */
export function TestPeerRefreshPanel({
  refreshBlocked,
  refreshBlockedReason = null,
}: {
  /**
   * When true, the Refresh peers button is force-disabled and a status hint
   * is rendered. Disabled only when the runtime is truly unavailable
   * (paused or stopped) — `connecting`, `relays-offline`, and
   * `signing-blocked` states all keep it live because a broadcast ping is
   * exactly what the user reaches for to kick the pump in those states.
   */
  refreshBlocked: boolean;
  /**
   * Human-readable reason surfaced alongside the disabled button so the
   * user (and VAL-OPS-025 validator) sees *why* the control is off — per
   * feature `fix-m1-test-ping-and-refresh-all-enablement` requirement
   * "When signerPaused=true, both buttons are disabled with an
   * accessible reason". When null, a neutral fallback copy is shown.
   */
  refreshBlockedReason?: string | null;
}) {
  const { handleRuntimeCommand, refreshRuntime } = useAppState();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [lastDispatchAt, setLastDispatchAt] = useState<number | null>(null);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (refreshBlocked || dispatching) return;
      setDispatching(true);
      setDispatchError(null);
      try {
        await handleRuntimeCommand({ type: "refresh_all_peers" });
        setLastDispatchAt(Date.now());
      } catch (err) {
        const reason =
          err instanceof Error
            ? err.message
            : "Failed to dispatch refresh_all_peers";
        setDispatchError(reason);
      } finally {
        setDispatching(false);
        // Kick the pump so outbound pings flush immediately — matches the
        // PeersPanel Refresh button behaviour.
        refreshRuntime?.();
      }
    },
    [handleRuntimeCommand, refreshBlocked, dispatching, refreshRuntime],
  );

  const submitDisabled = refreshBlocked || dispatching;

  return (
    <section
      className="panel panel-pad test-peer-refresh-panel"
      data-testid="test-peer-refresh-panel"
      aria-labelledby="test-peer-refresh-heading"
    >
      <div className="value" id="test-peer-refresh-heading">
        Refresh peers
      </div>
      <p className="help">
        Dispatches <code>refresh_all_peers</code>, fanning out pings to every
        known peer.
      </p>
      <form onSubmit={onSubmit} className="test-peer-refresh-form">
        <div className="inline-actions">
          <button
            type="submit"
            className="button button-primary button-md"
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
            aria-label="Refresh peers"
          >
            <RotateCw size={16} aria-hidden="true" />
            {dispatching ? "Refreshing…" : "Refresh peers"}
          </button>
          {refreshBlocked ? (
            <span
              className="help"
              role="status"
              data-testid="test-peer-refresh-blocked-reason"
            >
              {refreshBlockedReason ??
                "Refresh peers unavailable — runtime not ready."}
            </span>
          ) : null}
        </div>
        {dispatchError ? (
          <p className="field-error-text" role="alert">
            {dispatchError}
          </p>
        ) : null}
        {lastDispatchAt ? (
          <p
            className="help"
            data-testid="test-peer-refresh-last-dispatch-at"
          >
            Last broadcast:{" "}
            <code>{new Date(lastDispatchAt).toISOString()}</code>
          </p>
        ) : null}
      </form>
    </section>
  );
}
