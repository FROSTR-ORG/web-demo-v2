import { useCallback, useState } from "react";
import { useAppState } from "../../../app/AppState";

/**
 * Dev-only affordance for smoke-testing the `refresh_all_peers` runtime
 * command from the Dashboard. Complements the PeersPanel header "Refresh
 * peers" icon button with a second, keyboard-first "Refresh All" surface
 * whose accessible name is explicit so keyboard users (and the Tab-order
 * validator driving VAL-OPS-025) can reach a broadcast-refresh dispatch
 * without aiming at the icon-sized button in the peers header.
 *
 * Fulfils:
 *   - Feature `fix-m1-keyboard-ping-trigger-and-enter-activation` — ensures
 *     the five OPS surfaces (Refresh peers, Ping, Test Sign, Test ECDH,
 *     Refresh All) are all reachable in tab order.
 *   - VAL-OPS-025 — "All OPS surfaces are keyboard reachable" (Refresh All
 *     side).
 *
 * Rendered only when `import.meta.env.DEV` is true so Vite's dead-code
 * elimination strips it (and its help copy) from production builds.
 */
export function TestRefreshAllPanel({
  refreshBlocked,
}: {
  /**
   * When true, the Refresh All button is force-disabled and a status hint
   * is rendered. Derived by the caller from `runtime_status.readiness`
   * plus signer-paused / stopped / relays-offline dashboard states — a
   * broadcast refresh cannot travel the wire while the runtime is
   * unavailable.
   */
  refreshBlocked: boolean;
}) {
  const { handleRuntimeCommand, refreshRuntime } = useAppState();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [lastDispatchAt, setLastDispatchAt] = useState<number | null>(null);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
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
      className="panel panel-pad test-refresh-all-panel"
      data-testid="test-refresh-all-panel"
      aria-labelledby="test-refresh-all-heading"
    >
      <div className="value" id="test-refresh-all-heading">
        Test Refresh All (dev)
      </div>
      <p className="help">
        Dispatches <code>refresh_all_peers</code>, fanning out pings to every
        known peer. Keyboard-first sibling of the Peers header icon button.
        Dev-only; absent from production builds.
      </p>
      <form onSubmit={onSubmit} className="test-refresh-all-form">
        <div className="inline-actions">
          <button
            type="submit"
            className="button button-primary button-md"
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
            aria-label="Refresh All"
          >
            {dispatching ? "Refreshing…" : "Refresh All"}
          </button>
          {refreshBlocked ? (
            <span className="help" role="status">
              Refresh All unavailable — runtime not ready.
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
            data-testid="test-refresh-all-last-dispatch-at"
          >
            Last broadcast:{" "}
            <code>{new Date(lastDispatchAt).toISOString()}</code>
          </p>
        ) : null}
      </form>
    </section>
  );
}
