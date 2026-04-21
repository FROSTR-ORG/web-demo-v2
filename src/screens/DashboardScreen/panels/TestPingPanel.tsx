import { useCallback, useId, useState } from "react";
import { useAppState } from "../../../app/AppState";

const HEX_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Dev-only affordance for smoke-testing the `ping` runtime command from the
 * Dashboard without needing a second device. Sibling of {@link TestSignPanel}
 * and {@link TestEcdhPanel}. Rendered only when `import.meta.env.DEV` is true
 * so Vite's dead-code elimination strips this panel (and its mock-style
 * helpers) from production builds.
 *
 * Fulfils:
 *   - Feature `fix-m1-keyboard-ping-trigger-and-enter-activation` — adds a
 *     dedicated keyboard-reachable Ping trigger next to Test Sign / Test ECDH
 *     so the Tab-order VAL-OPS-025 assertion finds all five OPS surfaces.
 *   - VAL-OPS-025 — "All OPS surfaces are keyboard reachable" (Ping side)
 *
 * Design:
 *   - Single text input for a 32-byte (64-hex-char) peer pubkey.
 *   - Submit button labelled "Ping" (accessible name matches
 *     /^ping(\s|$)/i per feature contract).
 *   - Disabled whenever the runtime is paused or not ready — the ping verb
 *     cannot travel the wire without an active runtime so we gate off the
 *     same readiness signal as refresh_all_peers.
 *   - Inline validation for non-hex / non-64-char input; the button stays
 *     disabled until the input is a canonical 64-hex-char pubkey so no
 *     malformed command ever reaches `handleRuntimeCommand`.
 *   - Both keyboard activation paths (Enter on focused input, Enter/Space
 *     on focused submit) flow through the same `onSubmit` handler as a
 *     pointer click so "Enter/Space dispatch identically to click" holds.
 */
export function TestPingPanel({
  pingBlocked,
}: {
  /**
   * When true, the submit button is force-disabled and a status hint is
   * rendered even if the input is valid. Derived by the caller from
   * `runtime_status.readiness.runtime_ready` plus signer-paused / stopped
   * / relays-offline dashboard states — a ping cannot round-trip while the
   * wire is down.
   */
  pingBlocked: boolean;
}) {
  const { handleRuntimeCommand } = useAppState();
  const inputId = useId();
  const errorId = useId();
  const [pubkey, setPubkey] = useState("");
  const [touched, setTouched] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  const trimmed = pubkey.trim();
  const isValidHex = HEX_RE.test(trimmed);
  const showInputError = touched && trimmed.length > 0 && !isValidHex;
  const showEmptyError = touched && trimmed.length === 0;

  const submitDisabled = pingBlocked || dispatching || !isValidHex;

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTouched(true);
      if (submitDisabled) return;
      setDispatching(true);
      setDispatchError(null);
      try {
        const result = await handleRuntimeCommand({
          type: "ping",
          peer_pubkey32_hex: trimmed,
        });
        setLastRequestId(result.requestId);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "Failed to dispatch ping";
        setDispatchError(reason);
      } finally {
        setDispatching(false);
      }
    },
    [handleRuntimeCommand, submitDisabled, trimmed],
  );

  const inlineError = showInputError
    ? "Pubkey must be exactly 64 hex characters (32 bytes)."
    : showEmptyError
      ? "Enter a 64-character hex pubkey to ping."
      : null;

  return (
    <section
      className="panel panel-pad test-ping-panel"
      data-testid="test-ping-panel"
      aria-labelledby={`${inputId}-heading`}
    >
      <div className="value" id={`${inputId}-heading`}>
        Test Ping (dev)
      </div>
      <p className="help">
        Dispatches a <code>ping</code> command to the runtime for the peer
        identified by the 32-byte hex pubkey below. Dev-only; absent from
        production builds.
      </p>
      <form onSubmit={onSubmit} className="test-ping-form">
        <div className="field">
          <label className="label" htmlFor={inputId}>
            Peer pubkey (64 hex chars)
          </label>
          <input
            id={inputId}
            className={`input${inlineError ? " input-error" : ""}`}
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="0000…"
            value={pubkey}
            onChange={(e) => {
              setPubkey(e.target.value);
              if (!touched) setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            aria-invalid={inlineError != null}
            aria-describedby={inlineError ? errorId : undefined}
          />
          {inlineError ? (
            <span id={errorId} className="field-error-text" role="alert">
              {inlineError}
            </span>
          ) : null}
        </div>
        <div className="inline-actions">
          <button
            type="submit"
            className="button button-primary button-md"
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
            aria-label="Ping"
          >
            {dispatching ? "Pinging…" : "Ping"}
          </button>
          {pingBlocked ? (
            <span className="help" role="status">
              Ping unavailable — runtime not ready.
            </span>
          ) : null}
        </div>
        {dispatchError ? (
          <p className="field-error-text" role="alert">
            {dispatchError}
          </p>
        ) : null}
        {lastRequestId ? (
          <p
            className="help"
            data-testid="test-ping-last-request-id"
          >
            Dispatched ping request: <code>{lastRequestId}</code>
          </p>
        ) : null}
      </form>
    </section>
  );
}
