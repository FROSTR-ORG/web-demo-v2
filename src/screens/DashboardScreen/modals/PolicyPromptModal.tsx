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

/**
 * Snapshot of the body inline styles and viewport scroll offset captured
 * at the moment the scroll lock engages so {@link restoreBodyScroll} can
 * revert the page exactly to its pre-modal state.
 */
interface ScrollLockSnapshot {
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  scrollY: number;
}

/**
 * Engage a robust viewport scroll lock while the modal is mounted.
 *
 * Setting `body.overflow = 'hidden'` alone is not sufficient — on many
 * browsers the viewport's scroll container is `documentElement` (or a
 * layout ancestor of `body`), so wheel / PageDown / touchmove still
 * scroll the background behind the modal (the concrete failure mode
 * VAL-APPROVALS-021 surfaced in user testing).
 *
 * The "fixed body offset" pattern below pins the body at its current
 * scroll offset (`top: -scrollY`) with `position: fixed` + `width: 100%`
 * which physically removes the body from the viewport's scroll container.
 * The viewport has nothing left to scroll — wheel / PageDown / touchmove
 * become no-ops — without having to attach event blockers or listen on
 * every scroll surface.
 *
 * On unmount we revert each mutated inline style to its pre-lock value
 * and `window.scrollTo(0, savedScrollY)` to snap the page back to where
 * the user was looking, so re-opening a modal at position 0 doesn't
 * silently yank them to the top.
 */
function lockBodyScroll(): ScrollLockSnapshot | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  const body = document.body;
  const scrollY =
    typeof window.scrollY === "number"
      ? window.scrollY
      : typeof window.pageYOffset === "number"
        ? window.pageYOffset
        : 0;
  const snapshot: ScrollLockSnapshot = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    scrollY,
  };
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0px";
  body.style.right = "0px";
  body.style.width = "100%";
  return snapshot;
}

function restoreBodyScroll(previous: ScrollLockSnapshot | null) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (previous === null) return;
  const body = document.body;
  body.style.overflow = previous.overflow;
  body.style.position = previous.position;
  body.style.top = previous.top;
  body.style.left = previous.left;
  body.style.right = previous.right;
  body.style.width = previous.width;
  if (typeof window.scrollTo === "function") {
    window.scrollTo(0, previous.scrollY);
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
 *    are hidden by default because the bifrost-rs `setPolicyOverride`
 *    surface only accepts peer-level overrides. Paper fixture mode may
 *    opt into those visual CTAs with `showPaperScopedActions`, while real
 *    runtime surfaces stay peer-level only. The split is documented in
 *    `docs/runtime-deviations-from-paper.md`.
 *  - TTL: honours `event.ttl_ms` when the upstream event provides one;
 *    falls back to a {@link CLIENT_TTL_MS} 60 s client-side timer that
 *    dismisses the modal as a policy-neutral deny without mutating
 *    state (VAL-APPROVALS-014).
 */
export function PolicyPromptModal({
  event,
  onResolve,
  onDismiss,
  showPaperScopedActions = false,
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
  showPaperScopedActions?: boolean;
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
  }, [event.ttl_ms]);
  const ttlSource: "event" | "session" =
    typeof event.ttl_ms === "number" && event.ttl_ms > 0
      ? "event"
      : "session";
  const [remainingMs, setRemainingMs] = useState<number>(initialRemaining);

  // Keep the latest `onDismiss` identity in a ref so the countdown effect
  // doesn't re-run every time the parent recreates its callback (which it
  // does whenever the active peer-denial advances — see DashboardScreen's
  // `handleDismissPolicyPrompt` closure over `activePeerDenial`).
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Countdown + reset, keyed on the active prompt id (fix-m2-policy-prompt
  // -modal-ttl-reset). When the FIFO peerDenialQueue advances and the
  // modal is rendered with a new `event.id`, we must reset `remainingMs`
  // back to the newly-active prompt's fresh TTL so the advanced prompt is
  // not inheriting the terminal `0` state of the previous prompt — which
  // would previously cause the separate auto-dismiss effect to fire
  // synchronously and immediately dismiss the second prompt before the
  // user could act on it.
  //
  // Auto-dismiss on TTL expiry is fired from inside the interval tick
  // against the fresh `initialRemaining` captured by this effect (not
  // from a separate `[remainingMs, onDismiss]` effect) so an outgoing
  // prompt's terminal state cannot bleed into the newly-active prompt's
  // render cycle.
  //
  // Recomputes every 500 ms so the rendered string lands within
  // VAL-APPROVALS-014's ±200 ms tolerance per second.
  useEffect(() => {
    setRemainingMs(initialRemaining);
    if (initialRemaining <= 0) {
      onDismissRef.current();
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const next = Math.max(0, initialRemaining - elapsed);
      setRemainingMs(next);
      if (next === 0) {
        window.clearInterval(timer);
        onDismissRef.current();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [event.id, initialRemaining]);

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

        {/* Runtime surfaces stay peer-level. Paper fixture mode may render
         * scoped-looking CTAs for visual parity; they still dispatch through
         * the existing peer-level allow/deny decisions. */}
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
          {showPaperScopedActions ? (
            <div className="policy-action-row">
              <button
                type="button"
                className="policy-btn allow-outline"
                onClick={() => dispatchDecision("allow-always")}
              >
                Always for kind:1
              </button>
              <button
                type="button"
                className="policy-btn deny-outline"
                onClick={() => dispatchDecision("deny-always")}
              >
                Always deny for primal.net
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
