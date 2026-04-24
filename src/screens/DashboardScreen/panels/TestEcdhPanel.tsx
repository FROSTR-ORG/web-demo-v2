import { useCallback, useId, useState } from "react";
import { useAppState } from "../../../app/AppState";

const HEX_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Web-demo affordance for smoke-testing the `ecdh` runtime command from the
 * profile-scoped Test page without needing a second device. Sibling of
 * {@link TestSignPanel}.
 *
 * Fulfils:
 *   - Feature m1-ecdh-dispatch — "Add an ECDH dispatch path in AppStateValue /
 *     Dashboard"
 *   - VAL-OPS-009 — "ECDH happy path surfaces a completion" (UI dispatch side)
 *   - VAL-OPS-020 — "Concurrent sign + ECDH do not interfere" — the
 *     dispatch path is independent of TestSignPanel so a user can fire both
 *     commands back-to-back; each produces its own pending_operations entry
 *     with a distinct request_id.
 *
 * Design:
 *   - Single text input for a 32-byte (64-hex-char) peer pubkey.
 *   - Submit button labelled "Test ECDH" (accessible name matches
 *     /^(test\s*ecdh|ecdh)(\s|$)/i).
 *   - Disabled whenever ECDH is blocked — runtime readiness advertises
 *     `ecdh_ready = false`, or the signer is paused, or the dashboard is in
 *     a non-running state.
 *   - Inline validation for non-hex / non-64-char input; the button stays
 *     disabled until the input is a canonical 64-hex-char pubkey so no
 *     malformed command ever reaches `handleRuntimeCommand`.
 */
export function TestEcdhPanel({
  ecdhBlocked,
}: {
  /**
   * When true, the submit button is force-disabled and a status hint is
   * rendered even if the input is valid. Derived by the caller from
   * `runtime_status.readiness.ecdh_ready` plus signer-paused / signing
   * degraded states.
   */
  ecdhBlocked: boolean;
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

  const submitDisabled = ecdhBlocked || dispatching || !isValidHex;

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTouched(true);
      if (submitDisabled) return;
      setDispatching(true);
      setDispatchError(null);
      try {
        const result = await handleRuntimeCommand({
          type: "ecdh",
          pubkey32_hex: trimmed,
        });
        setLastRequestId(result.requestId);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "Failed to dispatch ECDH";
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
      ? "Enter a 64-character hex pubkey to derive a shared secret."
      : null;

  return (
    <section
      className="panel panel-pad test-ecdh-panel"
      data-testid="test-ecdh-panel"
      aria-labelledby={`${inputId}-heading`}
    >
      <div className="value" id={`${inputId}-heading`}>
        Test ECDH
      </div>
      <p className="help">
        Dispatches an <code>ecdh</code> command to the runtime using the
        32-byte hex pubkey below.
      </p>
      <form onSubmit={onSubmit} className="test-ecdh-form">
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
            aria-label="Test ECDH"
          >
            {dispatching ? "Deriving…" : "Test ECDH"}
          </button>
          {ecdhBlocked ? (
            <span className="help" role="status">
              ECDH unavailable — peers below threshold or runtime not ready.
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
            data-testid="test-ecdh-last-request-id"
          >
            Dispatched ECDH request: <code>{lastRequestId}</code>
          </p>
        ) : null}
      </form>
    </section>
  );
}
