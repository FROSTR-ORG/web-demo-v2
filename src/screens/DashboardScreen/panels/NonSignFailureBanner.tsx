import { AlertTriangle, X } from "lucide-react";

/**
 * A single non-sign `OperationFailure` that could not be attributed to a
 * visible PeerRow — either the failure has no `failed_peer` (e.g. ECDH
 * timeout before a peer was selected) or the target pubkey is not in
 * `runtime_status.peers`. Surfaced via {@link NonSignFailureBannerStack}
 * as a non-modal aria-live banner so VAL-OPS-015's "non-modal feedback
 * appears" requirement is observable for these failures too.
 */
export interface NonSignFailureBannerEntry {
  /** Stable id used for React key and dismissal lookup — the runtime's
   *  `OperationFailure.request_id`. */
  id: string;
  op_type: "ecdh" | "ping" | "onboard";
  code: string;
  /** Human-readable runtime error message. Surfaced verbatim — the runtime
   *  never places secret material in this field. */
  message: string;
  /** Epoch ms when the banner was raised, used by the 30s sweep. */
  createdAt: number;
}

/**
 * Non-modal feedback surface for non-sign `OperationFailure`s that have
 * no visible PeerRow to attach to (VAL-OPS-015).
 *
 * Rendered as a polite aria-live region so screen readers announce the
 * failure without stealing focus from the dashboard, and with an explicit
 * Dismiss button so users can clear a still-visible banner before the 30s
 * auto-clear sweep removes it.
 *
 * `banners` is ordered newest-first by the dashboard so the most recent
 * failure is at the top of the stack.
 */
export function NonSignFailureBannerStack({
  banners,
  onDismiss,
}: {
  banners: NonSignFailureBannerEntry[];
  onDismiss: (id: string) => void;
}) {
  // Always render the container so the aria-live region is stable across
  // insertions (SRs pick up text changes without needing the element to
  // mount anew).
  return (
    <div
      className="non-sign-failure-banners"
      data-testid="non-sign-failure-banners"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {banners.map((banner) => (
        <div
          key={banner.id}
          className={`non-sign-failure-banner non-sign-failure-banner-${banner.op_type}`}
          data-testid={`non-sign-failure-banner-${banner.id}`}
          data-op-type={banner.op_type}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--ig-red, #ef4444)",
            background: "var(--ig-red-soft, #7f1d1d33)",
            color: "var(--ig-text, #fecaca)",
            fontSize: 13,
          }}
        >
          <AlertTriangle
            size={14}
            color="#ef4444"
            aria-hidden="true"
            focusable="false"
          />
          <span
            className="non-sign-failure-banner-body"
            style={{ flex: 1 }}
          >
            <strong
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginRight: 6,
                color: "var(--ig-red, #ef4444)",
              }}
            >
              {banner.op_type}
            </strong>
            failed: {banner.message}
            <span
              className="non-sign-failure-banner-code"
              style={{
                marginLeft: 6,
                fontSize: 11,
                color: "var(--ig-muted, #94a3b8)",
              }}
            >
              ({banner.code})
            </span>
          </span>
          <button
            type="button"
            className="non-sign-failure-banner-dismiss"
            data-testid={`non-sign-failure-banner-dismiss-${banner.id}`}
            aria-label={`Dismiss ${banner.op_type} failure notice`}
            onClick={() => onDismiss(banner.id)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--ig-muted, #94a3b8)",
              cursor: "pointer",
              padding: 2,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <X size={14} aria-hidden="true" focusable="false" />
          </button>
        </div>
      ))}
    </div>
  );
}
