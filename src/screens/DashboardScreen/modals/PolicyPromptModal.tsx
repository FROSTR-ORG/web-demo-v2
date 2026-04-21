import { Clock, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shortHex } from "../../../lib/bifrost/format";
import type {
  PeerDeniedEvent,
  PolicyPromptDecision,
} from "../../../app/AppStateTypes";

const CONTENT_MAX_CHARS = 10_000;
const CLIENT_TTL_MS = 60_000;

function safeTrunc(value: string | undefined): string {
  if (typeof value !== "string") return "";
  if (value.length <= CONTENT_MAX_CHARS) return value;
  return `${value.slice(0, CONTENT_MAX_CHARS)}…`;
}

function displayPeer(event: PeerDeniedEvent): string {
  if (event.peer_label && event.peer_label.length > 0) return event.peer_label;
  return shortHex(event.peer_pubkey, 6, 4);
}

function displayKey(event: PeerDeniedEvent): string {
  return shortHex(event.peer_pubkey, 6, 4);
}

function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function lockBodyScroll(): string | null {
  if (typeof document === "undefined") return null;
  const previous = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return previous;
}

function restoreBodyScroll(previous: string | null) {
  if (typeof document === "undefined") return;
  if (previous === null) {
    document.body.style.overflow = "";
  } else {
    document.body.style.overflow = previous;
  }
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector =
    'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("data-focus-trap-sentinel"),
  );
}

/**
 * Reactive peer-denial prompt modal.
 *
 * Opened only in response to a queued {@link PeerDeniedEvent} (VAL-APPROVALS-007 /
 * VAL-APPROVALS-018). Dispatches a {@link PolicyPromptDecision} back to the
 * caller which in turn routes the decision through
 * `AppStateValue.resolvePeerDenial` → `RuntimeClient.setPolicyOverride`.
 *
 * Behavioural highlights:
 *  - `role="dialog"` + `aria-modal` + labelled / described by ids
 *    (VAL-APPROVALS-019).
 *  - First actionable control focused on mount; focus is trapped inside
 *    the modal until dismissed; focus returns to the previously-focused
 *    element on close (VAL-APPROVALS-019 / VAL-APPROVALS-025).
 *  - Escape dismisses as a policy-neutral "deny" (no
 *    `set_policy_override` call — VAL-APPROVALS-020).
 *  - Body `overflow` locked while mounted and restored on close
 *    (VAL-APPROVALS-021).
 *  - All payload text rendered as {@link String} children — React escapes
 *    HTML for free, and arbitrarily large content is clamped to
 *    {@link CONTENT_MAX_CHARS} with an ellipsis (VAL-APPROVALS-022 /
 *    VAL-APPROVALS-023).
 *  - Scoped variants ("Always for kind:N" / "Always deny for domain")
 *    are NOT rendered: the bifrost-rs `setPolicyOverride` surface only
 *    accepts peer-level overrides, so exposing scoped buttons would
 *    silently fall back to the same peer-level write. The deviation is
 *    documented in `docs/runtime-deviations-from-paper.md`.
 *  - TTL: honours `event.ttl_ms` when the upstream event provides one;
 *    falls back to a {@link CLIENT_TTL_MS} 60 s client-side timer that
 *    dismisses the modal as a policy-neutral deny without mutating
 *    state (VAL-APPROVALS-014).
 */
export function PolicyPromptModal({
  event,
  onResolve,
  onDismiss,
}: {
  event: PeerDeniedEvent;
  onResolve: (decision: PolicyPromptDecision) => void | Promise<void>;
  /**
   * Called when the user dismisses the modal without making a policy
   * decision (Escape / X / backdrop / TTL expiry). The parent typically
   * treats this identically to `onResolve({ action: "deny" })` so the
   * queue advances to the next peer-denied entry.
   */
  onDismiss: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useMemo(
    () => `policy-prompt-title-${event.id}`,
    [event.id],
  );
  const descId = useMemo(
    () => `policy-prompt-desc-${event.id}`,
    [event.id],
  );

  const isEcdh = event.verb === "ecdh";
  const verbLabel = isEcdh ? "ECDH" : event.verb.toUpperCase();

  const initialRemaining = useMemo(() => {
    if (typeof event.ttl_ms === "number" && event.ttl_ms > 0) {
      return event.ttl_ms;
    }
    return CLIENT_TTL_MS;
  }, [event]);
  const ttlSource: "event" | "session" =
    typeof event.ttl_ms === "number" && event.ttl_ms > 0
      ? "event"
      : "session";
  const [remainingMs, setRemainingMs] = useState<number>(initialRemaining);

  // Countdown tick — recomputes every 500 ms so the rendered string lands
  // within VAL-APPROVALS-014's ±200 ms tolerance per second.
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const next = Math.max(0, initialRemaining - elapsed);
      setRemainingMs(next);
      if (next === 0) {
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [initialRemaining]);

  // Auto-dismiss when TTL reaches zero without an explicit user decision.
  useEffect(() => {
    if (remainingMs > 0) return;
    onDismiss();
  }, [remainingMs, onDismiss]);

  // Capture the previously-focused element and lock body scroll on mount.
  // useLayoutEffect so the body overflow restore happens in the same
  // synchronous pass as unmount — VAL-APPROVALS-021.
  useLayoutEffect(() => {
    previouslyFocusedRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    const priorOverflow = lockBodyScroll();
    return () => {
      restoreBodyScroll(priorOverflow);
      const prior = previouslyFocusedRef.current;
      if (prior && typeof prior.focus === "function") {
        try {
          prior.focus();
        } catch {
          // best-effort focus return
        }
      }
    };
  }, []);

  // Focus the first actionable control on mount and on each event change
  // (queue advance re-anchors focus — VAL-APPROVALS-025).
  useEffect(() => {
    if (firstActionRef.current) {
      try {
        firstActionRef.current.focus();
      } catch {
        // ignore
      }
    }
  }, [event.id]);

  // Global Escape handler — treat as dismiss (no state mutation).
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Focus-trap: intercept Tab / Shift+Tab inside the modal so focus
  // cycles within (VAL-APPROVALS-019). React's default handler is fine
  // for interior moves; we only wrap the edges.
  const handleKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLDivElement>) => {
      if (ev.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = focusableElements(root);
      if (focusables.length === 0) {
        ev.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (ev.shiftKey) {
        if (active === first || !root.contains(active)) {
          ev.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  const handleBackdropClick = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  const dispatchDecision = useCallback(
    (action: PolicyPromptDecision["action"]) => {
      void onResolve({ action });
    },
    [onResolve],
  );

  // Build the detail rows with safely-truncated strings. React renders
  // them as text nodes so HTML injection via malicious event payloads
  // cannot escape into the DOM (VAL-APPROVALS-023).
  const detailRows: Array<{ label: string; value: string; className?: string }> =
    isEcdh
      ? [
          {
            label: "OPERATION",
            value: safeTrunc(event.event_kind) || "ECDH key exchange",
          },
          {
            label: "TARGET PUBKEY",
            value:
              safeTrunc(event.target_pubkey) ||
              shortHex(event.peer_pubkey, 10, 6),
            className: "mono",
          },
          {
            label: "RELAY",
            value:
              safeTrunc(event.relay) ||
              safeTrunc(event.domain) ||
              "(not reported)",
            className: "mono",
          },
        ]
      : [
          {
            label: "EVENT KIND",
            value: safeTrunc(event.event_kind) || "(not reported)",
          },
          {
            label: "CONTENT",
            value: safeTrunc(event.content) || "(not reported)",
          },
          {
            label: "PUBKEY",
            value: shortHex(event.peer_pubkey, 10, 6),
            className: "mono",
          },
          {
            label: "DOMAIN",
            value: safeTrunc(event.domain) || "(not reported)",
            className: "bold",
          },
        ];

  const subtitle = isEcdh
    ? "A peer is requesting permission for an encryption operation"
    : `A peer is requesting permission to ${event.verb} on your behalf`;

  return (
    <div
      className="policy-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-peer-denial-id={event.id}
      data-ttl-source={ttlSource}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="policy-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="policy-modal-header">
          <div className="policy-modal-header-row">
            <div className="policy-modal-title-group">
              <div className="policy-modal-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10 1L18 5.5V14.5L10 19L2 14.5V5.5L10 1Z"
                    stroke="#EAB308"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path
                    d="M10 7V11M10 13V13.5"
                    stroke="#EAB308"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h2 className="policy-modal-title" id={titleId}>
                Signer Policy
              </h2>
            </div>
            <button
              type="button"
              className="policy-modal-close"
              onClick={onDismiss}
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
          <p className="policy-modal-subtitle" id={descId}>
            {subtitle}
          </p>
        </div>

        {/* Request info */}
        <div className="policy-modal-request">
          <span
            className={`policy-request-badge ${event.verb.toLowerCase()}`}
            data-verb={event.verb}
          >
            {verbLabel}
          </span>
          <span className="policy-request-peer">from {displayPeer(event)}</span>
          <span className="policy-request-key">{displayKey(event)}</span>
          {event.domain ? (
            <span className="policy-request-domain">
              {" "}
              · {safeTrunc(event.domain)}
            </span>
          ) : null}
        </div>

        {/* Details table */}
        <div className={`policy-details-table ${isEcdh ? "ecdh" : "sign"}`}>
          {detailRows.map((row) => (
            <div className="policy-detail-row" key={row.label}>
              <span className="policy-detail-label">{row.label}</span>
              <span
                className={`policy-detail-value ${row.className ?? ""}`.trim()}
                title={row.value}
                data-overflow-clampable="true"
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Expiration timer */}
        <div className="policy-expiry" data-ttl-source={ttlSource}>
          <Clock size={14} />
          <span>Expires in {formatRemaining(remainingMs)}</span>
        </div>

        {/* Action buttons. Scoped variants (kind / domain) are deliberately
         * not rendered — bifrost-rs exposes only peer-level overrides
         * through `setPolicyOverride`. See
         * `docs/runtime-deviations-from-paper.md` for the deviation note. */}
        <div className="policy-actions">
          <div className="policy-action-row">
            <button
              type="button"
              className="policy-btn deny"
              onClick={() => dispatchDecision("deny")}
            >
              Deny
            </button>
            <button
              type="button"
              className="policy-btn allow"
              ref={firstActionRef}
              onClick={() => dispatchDecision("allow-once")}
            >
              Allow once
            </button>
          </div>
          <div className="policy-action-row">
            <button
              type="button"
              className="policy-btn allow-outline"
              onClick={() => dispatchDecision("allow-always")}
            >
              Always allow
            </button>
            <button
              type="button"
              className="policy-btn deny-outline"
              onClick={() => dispatchDecision("deny-always")}
            >
              Always deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
