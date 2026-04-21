import { X, XCircle } from "lucide-react";
import { shortHex } from "../../../lib/bifrost/format";
import type { OperationFailure } from "../../../lib/bifrost/types";

export interface SigningFailedModalProps {
  /**
   * Closes the modal (used by the backdrop and the top-right × control). The
   * default handler for Dismiss when `onDismiss` is not supplied.
   */
  onClose: () => void;
  /**
   * Real runtime failure payload captured from `runtimeFailures`. When
   * provided the modal renders the runtime's real `request_id` (surfaced as
   * the "Round" field), the failed peer short-identifier, and the runtime's
   * `code` + `message` (surfaced as the "Error" field). Required for
   * real-failure mode (VAL-OPS-006).
   */
  failure?: OperationFailure;
  /**
   * Original `message_hex_32` that produced the failing sign command. Used
   * only by {@link onRetry} callers — surfaced here so the modal can disable
   * the Retry button when the message is unavailable.
   */
  messageHex?: string;
  /**
   * Dismiss handler. Called when the user clicks "Dismiss" or the backdrop.
   * Expected to close the modal and mark the failure consumed without
   * dispatching any runtime command (VAL-OPS-008).
   */
  onDismiss?: () => void;
  /**
   * Retry handler. Called when the user clicks "Retry". Expected to
   * re-dispatch a fresh sign command with the same `message_hex_32` and
   * close the modal (VAL-OPS-007). When omitted the Retry button is a no-op
   * that simply closes the modal (Paper-fidelity demo behaviour).
   */
  onRetry?: () => void;
}

function formatRoundId(requestId: string): string {
  const trimmed = requestId.trim();
  if (!trimmed) return "—";
  // Match Paper "r-0x<8>" visual shape so the field is scannable.
  const slice = trimmed.replace(/^r-/, "").slice(0, 8);
  return `r-${slice}`;
}

function formatPeerResponses(failure: OperationFailure): string {
  if (failure.failed_peer) {
    return `failed peer ${shortHex(failure.failed_peer, 6, 4)}`;
  }
  if (failure.code === "timeout") {
    return "no peers responded";
  }
  return "unknown";
}

function formatErrorSummary(failure: OperationFailure): string {
  const base = failure.message?.trim()
    ? failure.message.trim()
    : failure.code;
  // Surface both the machine-readable code and the human message so
  // VAL-OPS-016's /relay|websocket|disconnect|timeout/i regex always sees
  // the code substring ("timeout", "peer_rejected", etc.).
  return `${failure.code} — ${base}`;
}

export function SigningFailedModal({
  onClose,
  failure,
  messageHex,
  onDismiss,
  onRetry,
}: SigningFailedModalProps) {
  const hasFailure = Boolean(failure);
  const description = hasFailure
    ? `Unable to complete signing request ${formatRoundId(failure!.request_id)}. The runtime reported ${failure!.code} before the signature could be aggregated.`
    : "Unable to complete signature for event kind:1. All 3 retry attempts exhausted.";
  const codeText = hasFailure
    ? `Round: ${formatRoundId(failure!.request_id)} · Peers responded: ${formatPeerResponses(failure!)} · Error: ${formatErrorSummary(failure!)}`
    : "Round: r-0x4f2a · Peers responded: 1/2 · Error: insufficient partial signatures";

  const handleDismiss = onDismiss ?? onClose;
  const retryDisabled = hasFailure && !messageHex;
  const handleRetry = () => {
    if (retryDisabled) return;
    if (onRetry) {
      onRetry();
    } else {
      onClose();
    }
  };

  return (
    <div
      className="policy-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={handleDismiss}
    >
      <div
        className="signing-failed-modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="signing-failed-modal"
      >
        {/* Header */}
        <div className="signing-failed-header">
          <div className="signing-failed-title-group">
            <div className="signing-failed-icon">
              <XCircle size={20} color="#EF4444" />
            </div>
            <h2 className="signing-failed-title">Signing Failed</h2>
          </div>
          <button
            type="button"
            className="policy-modal-close"
            onClick={handleDismiss}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="signing-failed-body">
          <p
            className="signing-failed-description"
            data-testid="signing-failed-description"
          >
            {description}
          </p>
          <div className="signing-failed-code">
            <span
              className="signing-failed-code-text"
              data-testid="signing-failed-code-text"
            >
              {codeText}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="signing-failed-actions">
          <button
            type="button"
            className="signing-failed-dismiss"
            onClick={handleDismiss}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="signing-failed-retry"
            onClick={handleRetry}
            disabled={retryDisabled}
            aria-disabled={retryDisabled}
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
