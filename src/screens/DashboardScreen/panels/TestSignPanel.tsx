import { useCallback, useId, useState } from "react";
import { useAppState } from "../../../app/AppState";

const HEX_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Web-demo affordance for smoke-testing the `sign` runtime command from the
 * profile-scoped Test page without needing a second device.
 *
 * Fulfils:
 *   - VAL-OPS-001 — "Test-sign surface exists on the Test page"
 *   - VAL-OPS-003 — "Sign input is validated before dispatch"
 *   - VAL-OPS-025 — "All OPS surfaces are keyboard reachable"
 *
 * Design:
 *   - Single text input for a 32-byte (64-hex-char) message.
 *   - Submit button labelled "Test Sign" (accessible name matches
 *     /^(test\s*sign|sign)(\s|$)/i).
 *   - Disabled whenever signing is blocked — that is, when the runtime
 *     readiness advertises `sign_ready = false` (equivalent to the documented
 *     `runtime_status.signing_state === 'SIGNING_BLOCKED'` gate — we derive
 *     it from `sign_ready` since that is the WASM bridge's surfaced flag).
 *   - Inline validation error surfaces for non-hex / non-64-char input; the
 *     button stays disabled until the input is a canonical 64-hex-char
 *     message so no malformed command ever reaches `handleRuntimeCommand`.
 */
export function TestSignPanel({
  signingBlocked,
}: {
  /**
   * When true, the submit button is force-disabled and a status hint is
   * rendered even if the input is valid. Derived by the caller from
   * `runtime_status` (sign readiness / signing_state).
   */
  signingBlocked: boolean;
}) {
  const { handleRuntimeCommand } = useAppState();
  const inputId = useId();
  const errorId = useId();
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  const trimmed = message.trim();
  const isValidHex = HEX_RE.test(trimmed);
  const showInputError = touched && trimmed.length > 0 && !isValidHex;
  const showEmptyError = touched && trimmed.length === 0;

  const submitDisabled =
    signingBlocked || dispatching || !isValidHex;

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTouched(true);
      if (submitDisabled) return;
      setDispatching(true);
      setDispatchError(null);
      try {
        const result = await handleRuntimeCommand({
          type: "sign",
          message_hex_32: trimmed,
        });
        setLastRequestId(result.requestId);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "Failed to dispatch sign";
        setDispatchError(reason);
      } finally {
        setDispatching(false);
      }
    },
    [handleRuntimeCommand, submitDisabled, trimmed],
  );

  const inlineError = showInputError
    ? "Message must be exactly 64 hex characters (32 bytes)."
    : showEmptyError
      ? "Enter a 64-character hex message to sign."
      : null;

  return (
    <section
      className="panel panel-pad test-sign-panel"
      data-testid="test-sign-panel"
      aria-labelledby={`${inputId}-heading`}
    >
      <div className="value" id={`${inputId}-heading`}>
        Test Sign
      </div>
      <p className="help">
        Dispatches a <code>sign</code> command to the runtime using the
        32-byte hex message below.
      </p>
      <form onSubmit={onSubmit} className="test-sign-form">
        <div className="field">
          <label className="label" htmlFor={inputId}>
            Message (64 hex chars)
          </label>
          <input
            id={inputId}
            className={`input${inlineError ? " input-error" : ""}`}
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="0000…"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
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
            aria-label="Test Sign"
          >
            {dispatching ? "Signing…" : "Test Sign"}
          </button>
          {signingBlocked ? (
            <span className="help" role="status">
              Signing unavailable — peers below threshold or runtime not
              ready.
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
            data-testid="test-sign-last-request-id"
          >
            Dispatched sign request: <code>{lastRequestId}</code>
          </p>
        ) : null}
      </form>
    </section>
  );
}
