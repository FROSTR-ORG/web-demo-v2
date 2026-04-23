import { X, XCircle } from "lucide-react";
import { shortHex } from "../../../lib/bifrost/format";
import type { OperationFailure } from "../../../lib/bifrost/types";

/**
 * Optional forward-compat fields the runtime may begin to emit on an
 * {@link OperationFailure} payload so the modal can surface a real
 * peer-response ratio. Defined as a structural-widening overlay so the
 * modal can accept an enriched failure today without another type
 * migration when the bridge exposes the fields.
 */
interface FailureWithPeerResponse extends OperationFailure {
  peers_responded?: number;
  total_peers?: number;
}

export interface SigningFailedModalProps {
  /**
   * Closes the modal (used by the backdrop and the top-right × control). The
   * default handler for Dismiss when `onDismiss` is not supplied.
   */
  onClose: () => void;
  /**
   * Real runtime failure payload captured from `runtimeFailures`. When
   * provided the modal renders the runtime's real `request_id` (surfaced as
   * the "Round" field), the failed peer short-identifier when present, and
   * the runtime's `code` + `message`. The modal ALWAYS renders a labelled
   * "Peer responses" line — either `Peer responses: <N> of <M>` when the
   * runtime reports a real ratio (`peers_responded` / `total_peers`) or
   * the neutral fallback `Peer responses: not reported by runtime` when
   * it does not. See `docs/runtime-deviations-from-paper.md`.
   * Required for real-failure mode (VAL-OPS-006).
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
  // Match Paper "r-<8 chars>" visual shape so the field is scannable.
  const slice = trimmed.replace(/^r-/, "").slice(0, 8);
  return `r-${slice}`;
}

/**
 * Builds the stacked "Round / Code / Error / Peer responses / Failed
 * peer" summary from a real {@link OperationFailure} payload.
 *
 * The "Peer responses" line is ALWAYS rendered so validators can
 * observe a clearly-labelled value for every failure shape:
 *   - When the failure carries a real `peers_responded` / `total_peers`
 *     pair (enrichment path, future runtime extension), render
 *     "Peer responses: <N> of <M>" verbatim.
 *   - Otherwise render the neutral fallback
 *     "Peer responses: not reported by runtime" — NEVER a hard-coded
 *     "1/2" placeholder or fabricated denominator.
 * See VAL-OPS-006 and `docs/runtime-deviations-from-paper.md` for the
 * contract gap rationale.
 */
function buildFailureSummary(
  failure: OperationFailure,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Round", value: formatRoundId(failure.request_id) },
    { label: "Code", value: failure.code },
    {
      label: "Error",
      value: failure.message?.trim() ? failure.message.trim() : "—",
    },
    {
      label: "Peer responses",
      value: formatPeerResponseValue(failure as FailureWithPeerResponse),
    },
  ];
  if (failure.failed_peer) {
    rows.push({
      label: "Failed peer",
      value: shortHex(failure.failed_peer, 6, 4),
    });
  }
  return rows;
}

/**
 * Produce the value half of the "Peer responses" row. When the runtime
 * supplies a structured `peers_responded` / `total_peers` pair, render
 * it verbatim as "N of M". Otherwise fall back to a labelled
 * "not reported by runtime" copy that documents the contract gap
 * instead of inventing a ratio.
 */
function formatPeerResponseValue(failure: FailureWithPeerResponse): string {
  const responded = failure.peers_responded;
  const total = failure.total_peers;
  if (
    typeof responded === "number" &&
    Number.isFinite(responded) &&
    typeof total === "number" &&
    Number.isFinite(total)
  ) {
    return `${responded} of ${total}`;
  }
  return "not reported by runtime";
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
    : "Unable to complete the signing request. Failure details are unavailable.";
  // Build the summary rows even in the no-failure fallback so the
  // labelled "Peer responses" line is ALWAYS rendered — the fallback
  // copy ends in "Failure details unavailable." with the peer-response
  // line appended after it.
  const summaryRows = hasFailure
    ? buildFailureSummary(failure!)
    : [
        { label: "Status", value: "Failure details unavailable." },
        { label: "Peer responses", value: "not reported by runtime" },
      ];

  const handleDismiss = onDismiss ?? onClose;
  // Retry is enabled only when the failure is a sign type AND a message
  // hex is resolvable. When disabled, surface a clear tooltip so users
  // and validators can observe the reason (VAL-OPS-007: "Retry is
  // disabled (with a clear reason) only when the failure record
  // genuinely has no resolvable message").
  const isSignFailure = !hasFailure || failure!.op_type === "sign";
  const retryDisabled = hasFailure && (!isSignFailure || !messageHex);
  const retryDisabledReason = !hasFailure
    ? undefined
    : !isSignFailure
      ? "Retry is only available for sign operations."
      : !messageHex
        ? "Retry unavailable: originating sign message could not be correlated from runtime state."
        : undefined;
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
              {summaryRows
                .map((row) => `${row.label}: ${row.value}`)
                .join(" · ")}
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
            title={retryDisabled ? retryDisabledReason : undefined}
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
