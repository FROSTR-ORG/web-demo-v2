import { useCallback, useEffect, useRef, useState } from "react";
import type { BfPolicyOverrideValue } from "../../../lib/bifrost/types";

/**
 * Direction this chip targets in the runtime's `set_policy_override`
 * payload. Peer Policies chips on the dashboard target `request` so the
 * visual matches the `effective_policy.request.<method>` display read
 * used by the existing Peer Policies card + PeerRow inline badges
 * (VAL-POLICIES-005 / VAL-POLICIES-006 / VAL-POLICIES-020). Kept
 * configurable so future surfaces (e.g. "inbound" chip) can target
 * `respond` without forking this component.
 */
export type PeerPolicyChipDirection = "request" | "respond";

/**
 * Single policy verb surfaced on a Peer Policies chip.
 */
export type PeerPolicyChipMethod = "sign" | "ecdh" | "ping" | "onboard";

/**
 * Visual tone used for the chip's "allow" state — mirrors the existing
 * `PermissionBadge` tone palette so the chip drops into the existing
 * layout without visual drift (VAL-POLICIES-001 Paper parity).
 */
export type PeerPolicyChipTone = "success" | "info" | "ping" | "onboard";

export interface PeerPolicyChipProps {
  /** 64-char hex peer pubkey the chip targets. */
  peer: string;
  method: PeerPolicyChipMethod;
  /**
   * Direction the chip's `set_policy_override` dispatch targets in the
   * runtime. Defaults to `request` so the chip's cycle writes to the
   * cell the Peer Policies card visibly reads from
   * (`effective_policy.request.<method>`).
   */
  direction?: PeerPolicyChipDirection;
  tone?: PeerPolicyChipTone;
  /**
   * Current manual-override value for (peer, direction, method) as
   * surfaced by `peer_permission_states.manual_override` on the latest
   * runtime snapshot. Drives the initial state of the cycle and acts as
   * the authoritative reconciliation target for optimistic updates.
   */
  overrideValue: BfPolicyOverrideValue;
  /**
   * Whether the runtime's CURRENT `effective_policy` evaluates to an
   * allow-grant for this (peer, method). Used purely for visual parity
   * with the existing `PermissionBadge` (`muted` iff !allowed) when the
   * chip's cycle state is `unset` — explicit `allow` / `deny` override
   * values drive the visual themselves regardless of this prop.
   */
  effectiveAllows: boolean;
  /**
   * Async dispatcher invoked on every cycle step (one call per step —
   * VAL-POLICIES-008). Rejects on dispatch failure so the chip can roll
   * back its optimistic state within the 1 s window required by
   * VAL-POLICIES-026.
   */
  onDispatch: (input: {
    peer: string;
    direction: PeerPolicyChipDirection;
    method: PeerPolicyChipMethod;
    value: BfPolicyOverrideValue;
  }) => Promise<void>;
  children: React.ReactNode;
}

const CYCLE_ORDER: BfPolicyOverrideValue[] = ["unset", "allow", "deny"];

function nextValue(current: BfPolicyOverrideValue): BfPolicyOverrideValue {
  const index = CYCLE_ORDER.indexOf(current);
  if (index === -1) return "allow";
  return CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
}

function labelForValue(value: BfPolicyOverrideValue): string {
  switch (value) {
    case "allow":
      return "Allow";
    case "deny":
      return "Deny";
    case "unset":
      return "Unset (default)";
  }
}

/**
 * Peer Policies tri-state chip.
 *
 * - Click / Enter / Space cycles through `unset → allow → deny → unset`.
 *   Three consecutive cycles return the chip to `unset`
 *   (VAL-POLICIES-008).
 * - Every cycle step dispatches exactly one
 *   `set_policy_override({...value})` — the `unset` transition uses the
 *   same entry point with `value: "unset"` so the runtime's scoped
 *   "clear this cell" semantic is preserved (the global
 *   `clear_policy_overrides()` bridge call would reset every cell).
 * - Optimistic UI: the chip commits to its next visual state
 *   immediately, then reconciles with the authoritative `overrideValue`
 *   prop on the next poll tick. On dispatch failure it rolls back to
 *   the pre-click state within 1 s and surfaces an inline error via
 *   `role="status"` / visible copy (VAL-POLICIES-026).
 * - Keyboard: reachable via Tab; Enter/Space trigger the same cycle as
 *   click; `role="button"`; `aria-pressed` reflects the current state
 *   (true when `allow`, false otherwise); `aria-label` narrates the
 *   tri-state so screen readers announce unset-vs-allow-vs-deny
 *   (VAL-POLICIES-021).
 */
export function PeerPolicyChip({
  peer,
  method,
  direction = "request",
  tone = "success",
  overrideValue,
  effectiveAllows,
  onDispatch,
  children,
}: PeerPolicyChipProps) {
  // Optimistic value tracks the state we OPTIMISTICALLY committed to on
  // the last click but have not yet reconciled with a fresh runtime
  // snapshot. `null` means "no pending optimistic commit — render from
  // the authoritative `overrideValue` prop". The chip owns this state
  // so the underlying `peer_permission_states` poll never races the
  // fast-click path.
  const [optimistic, setOptimistic] = useState<BfPolicyOverrideValue | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dispatchSeqRef = useRef(0);
  const errorTimeoutRef = useRef<number | null>(null);

  // Reconcile the optimistic commit with the authoritative
  // `overrideValue` prop once the underlying runtime snapshot catches
  // up. A `null`-out here (not an overwrite) so subsequent renders
  // read directly from the prop and a later, unrelated prop change
  // cannot re-stale this chip.
  useEffect(() => {
    if (optimistic !== null && optimistic === overrideValue) {
      setOptimistic(null);
    }
  }, [optimistic, overrideValue]);

  // Clear any pending error-clear timer on unmount so a late setState
  // cannot fire after React unmounts us (React 19 warns on this).
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current !== null) {
        window.clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
    };
  }, []);

  const currentValue: BfPolicyOverrideValue = optimistic ?? overrideValue;

  const cycle = useCallback(async () => {
    const prior = currentValue;
    const next = nextValue(prior);
    const seq = dispatchSeqRef.current + 1;
    dispatchSeqRef.current = seq;
    setOptimistic(next);
    setErrorMessage(null);
    if (errorTimeoutRef.current !== null) {
      window.clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
    try {
      await onDispatch({ peer, direction, method, value: next });
    } catch (error) {
      // Only roll back if no newer click has superseded this one — a
      // rapid double-click should not clobber the second dispatch's
      // optimistic commit with a stale first-dispatch rollback.
      if (dispatchSeqRef.current !== seq) return;
      setOptimistic(prior);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update peer policy.";
      setErrorMessage(message);
      // Auto-clear the surfaced error after 6s so a transient failure
      // doesn't clutter the card indefinitely. The rollback itself
      // happens synchronously above (<1s — VAL-POLICIES-026); the
      // timer only affects when the error copy disappears.
      errorTimeoutRef.current = window.setTimeout(() => {
        setErrorMessage(null);
        errorTimeoutRef.current = null;
      }, 6000);
    }
  }, [currentValue, direction, method, onDispatch, peer]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        void cycle();
      }
    },
    [cycle],
  );

  // Visual muted semantic — preserved so the existing parity test
  // (PoliciesState ↔ PeerRow) keeps passing when manual_override is
  // "unset" and the chip falls back to the effective-policy display.
  // Explicit `allow` chips are never muted (user intends allow);
  // explicit `deny` chips are muted + carry the `deny` class so the
  // visual cue is distinct from the unset-muted variant.
  const muted =
    currentValue === "allow"
      ? false
      : currentValue === "deny"
        ? true
        : !effectiveAllows;

  const classes = [
    "permission-badge",
    "peer-policy-chip",
    tone,
    muted ? "muted" : "",
    currentValue === "allow" ? "allow" : "",
    currentValue === "deny" ? "deny" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const ariaLabel = `${method.toUpperCase()} policy for peer ${peer.slice(0, 8)}: ${labelForValue(currentValue)}. Click to cycle.`;

  return (
    <>
      <button
        type="button"
        role="button"
        className={classes}
        aria-pressed={currentValue === "allow"}
        aria-label={ariaLabel}
        data-state={currentValue}
        data-testid={`peer-policy-chip-${peer}-${method}`}
        onClick={() => void cycle()}
        onKeyDown={onKeyDown}
      >
        {children}
      </button>
      {errorMessage ? (
        <span
          role="status"
          aria-live="polite"
          className="peer-policy-chip-error"
          data-testid={`peer-policy-chip-error-${peer}-${method}`}
        >
          {errorMessage}
        </span>
      ) : null}
    </>
  );
}

/**
 * Resolve the current `manual_override.<direction>.<method>` value for
 * a peer permission snapshot, tolerating the loose `unknown` shape used
 * by the runtime bridge and demo fixtures (fixtures often emit a flat
 * `effective_policy` alongside a `manual_override: null`). Returns
 * `"unset"` whenever the override is absent or malformed so the chip
 * falls back to its neutral starting state.
 */
export function resolveManualOverrideValue(
  state: { manual_override?: unknown } | null | undefined,
  direction: PeerPolicyChipDirection,
  method: PeerPolicyChipMethod,
): BfPolicyOverrideValue {
  if (!state) return "unset";
  const override = state.manual_override as
    | null
    | {
        request?: Record<string, unknown>;
        respond?: Record<string, unknown>;
      }
    | undefined;
  if (!override) return "unset";
  const sub = override[direction];
  if (!sub || typeof sub !== "object") return "unset";
  const value = (sub as Record<string, unknown>)[method];
  return value === "allow" || value === "deny" ? value : "unset";
}
