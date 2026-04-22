import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BfPolicyOverrideValue,
  PeerPermissionState,
} from "../../../lib/bifrost/types";

/**
 * Dropdown values the Signer Policies card exposes. The label strings
 * are the Paper-source copy (see
 * `igloo-paper/screens/dashboard/1c-policies/screen.html`) and serve as
 * stable ids for the selection state (they round-trip through
 * `aria-label` / visible trigger text — VAL-POLICIES-019).
 */
export const DEFAULT_POLICY_OPTIONS = [
  "Ask every time",
  "Allow known peers",
  "Deny by default",
] as const;

export type DefaultPolicyOption = (typeof DEFAULT_POLICY_OPTIONS)[number];

const METHODS = ["sign", "ecdh", "ping", "onboard"] as const;
type PolicyMethod = (typeof METHODS)[number];

export interface DefaultPolicyDropdownProps {
  /**
   * Currently-selected default policy. Controlled from `PoliciesState`
   * so the label survives across dashboard tab switches / re-mounts.
   */
  value: DefaultPolicyOption;
  onChange: (next: DefaultPolicyOption) => void;
  /**
   * Live `peer_permission_states` snapshot — needed so the dropdown can
   * decide which peers are "override-free" (VAL-POLICIES-011) and which
   * peers are "known" (`remote_observation !== null`) for the
   * `Allow known peers` semantic (VAL-POLICIES-012).
   */
  peerPermissionStates: PeerPermissionState[];
  /**
   * Per-cell override dispatcher. Invoked once per (peer, method) the
   * dropdown wants to mutate. The component retries / coalesces nothing
   * — the `PoliciesState` provider wires `setPeerPolicyOverride` from
   * AppState directly, which dispatches a single runtime override call
   * per invocation. Rejection is swallowed here (the runtime-layer
   * telemetry surfaces per-cell failures via the Peer Policies chip
   * error region); the dropdown itself does not open a modal on partial
   * failure.
   */
  dispatch: (input: {
    peer: string;
    direction: "request" | "respond";
    method: PolicyMethod;
    value: BfPolicyOverrideValue;
  }) => Promise<void>;
}

/**
 * Read the existing manual-override cell for (peer, respond, method)
 * from the current `peer_permission_states` snapshot. Returns `null`
 * when no override is set so callers can distinguish "not overridden"
 * from an explicit `unset` value.
 *
 * The dropdown operates exclusively in the `respond.*` direction (see
 * `docs/runtime-deviations-from-paper.md` — the Default Policy dropdown
 * governs whether A responds to peer-initiated requests), so we only
 * inspect the `respond` sub-object here.
 */
function currentRespondOverride(
  state: PeerPermissionState,
  method: PolicyMethod,
): "allow" | "deny" | null {
  const override = state.manual_override as
    | null
    | {
        respond?: Record<string, unknown>;
      }
    | undefined;
  if (!override) return null;
  const value = override.respond?.[method];
  return value === "allow" || value === "deny" ? value : null;
}

/**
 * Has the user explicitly overridden ANY of the four `respond.*` cells
 * for this peer? Matches the VAL-POLICIES-011 "peers with overrides are
 * unaffected" rule — we treat presence of ANY user-set respond override
 * (e.g. a persisted Signer Policies row from PolicyPromptModal
 * `Always allow` / `Always deny`) as evidence the default-policy
 * dropdown should leave that peer alone.
 *
 * The check subtracts cells we previously wrote from the default-policy
 * itself (tracked in `defaultAppliedKeys`) so switching defaults does
 * not treat our prior writes as user overrides. Peer Policies chip
 * overrides are tracked under `request.*` today and therefore do NOT
 * block the dropdown (the two directions are orthogonal).
 */
function hasUserOverride(
  state: PeerPermissionState,
  defaultAppliedKeys: Set<string>,
): boolean {
  for (const method of METHODS) {
    if (currentRespondOverride(state, method) !== null) {
      const key = `${state.pubkey}:respond:${method}`;
      if (!defaultAppliedKeys.has(key)) return true;
    }
  }
  return false;
}

/**
 * Signer Policies card "Default policy" dropdown.
 *
 * Direction semantics: all three options dispatch
 * `set_policy_override({ direction: "respond", ... })` — the dropdown
 * governs THIS device's inbound response permission (does A sign / ecdh
 * / ping / onboard FOR peers that drive requests at A). See
 * `docs/runtime-deviations-from-paper.md` →
 * "Default Policy dropdown writes to `respond.*`, not `request.*`" for
 * the full rationale and the VAL-POLICIES-011/012/013 contract
 * correction. `request.*` is the outbound-intent direction and is NOT
 * user-controlled via this dropdown.
 *
 * Semantics (VAL-POLICIES-011 / VAL-POLICIES-012 / VAL-POLICIES-013):
 *  - `Ask every time`   → no overrides applied; unset any `respond.*`
 *                         entries the dropdown itself previously wrote
 *                         so override-free peers fall through to the
 *                         reactive `PolicyPromptModal` denial path.
 *  - `Allow known peers`→ for every peer with `remote_observation`
 *                         present AND no user manual override, dispatch
 *                         `respond.{method}` → `allow` per method.
 *  - `Deny by default`  → for every peer without a user manual
 *                         override, dispatch `respond.{method}` → `deny`
 *                         per method (chips render muted).
 *
 * Accessibility (VAL-POLICIES-019 / VAL-POLICIES-022):
 *  - Trigger is a `combobox` that carries `aria-expanded` /
 *    `aria-haspopup="listbox"` / `aria-controls` / `aria-activedescendant`
 *    pointing at the panel and the currently-highlighted option.
 *  - Open panel has `role="radiogroup"` with `aria-activedescendant`
 *    shadowing the keyboard-focused option while DOM focus stays on the
 *    group (ARIA APG "radio" pattern variant).
 *  - Options are `role="radio"` with `aria-checked="true"` on the
 *    selected one (exactly one at a time).
 *  - Keyboard: Enter/Space opens from the trigger; ArrowDown/ArrowUp
 *    move the active descendant; Enter confirms; Escape closes without
 *    selection; outside click (mousedown anywhere outside the wrapper)
 *    closes without selection.
 */
export function DefaultPolicyDropdown({
  value,
  onChange,
  peerPermissionStates,
  dispatch,
}: DefaultPolicyDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, DEFAULT_POLICY_OPTIONS.indexOf(value)),
  );
  /**
   * Track which (peer, direction, method) cells this dropdown applied
   * on a prior default-policy switch. On the next switch we revert
   * those cells (dispatch `unset`) so the new default starts from a
   * clean baseline. User-driven chip clicks land in the same manual
   * override storage but are NOT in this set — so the revert logic
   * correctly leaves them untouched (VAL-POLICIES-011).
   */
  const defaultAppliedKeysRef = useRef<Set<string>>(new Set());

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);

  const groupId = useId();
  const optionIdPrefix = useId();

  const optionId = useCallback(
    (index: number) => `${optionIdPrefix}-opt-${index}`,
    [optionIdPrefix],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (event.target instanceof Node && wrapper.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Move DOM focus to the radiogroup when the dropdown opens so
  // ArrowUp / ArrowDown keydowns are captured by the group element
  // (that's where `aria-activedescendant` lives).
  useEffect(() => {
    if (open) {
      // Reset active index to the currently-selected value on open.
      setActiveIndex(Math.max(0, DEFAULT_POLICY_OPTIONS.indexOf(value)));
      // Focus after paint so the node actually exists.
      queueMicrotask(() => {
        groupRef.current?.focus();
      });
    }
  }, [open, value]);

  const applyDefault = useCallback(
    async (next: DefaultPolicyOption) => {
      const priorKeys = Array.from(defaultAppliedKeysRef.current);
      const newKeys = new Set<string>();

      // 1. Revert everything we previously wrote from the dropdown so
      //    the new default starts from a known-clean baseline. We fire
      //    dispatches in parallel but ignore individual failures — the
      //    per-chip error surface owns UI feedback for policy writes.
      await Promise.allSettled(
        priorKeys.map(async (key) => {
          const [peer, direction, method] = key.split(":");
          if (!peer || !direction || !method) return;
          await dispatch({
            peer,
            direction: direction as "request" | "respond",
            method: method as PolicyMethod,
            value: "unset",
          });
        }),
      );

      // 2. Apply the new default to eligible peers.
      //    All writes target `respond.*` — see class-level comment.
      if (next === "Ask every time") {
        // No overrides applied — all peer cells we previously wrote
        // have been reverted above, leaving override-free peers with
        // `unset` chips that fall through to the reactive denial path.
      } else if (next === "Deny by default") {
        await Promise.allSettled(
          peerPermissionStates.flatMap((state) => {
            if (hasUserOverride(state, defaultAppliedKeysRef.current)) {
              return [] as Array<Promise<void>>;
            }
            return METHODS.map(async (method) => {
              newKeys.add(`${state.pubkey}:respond:${method}`);
              await dispatch({
                peer: state.pubkey,
                direction: "respond",
                method,
                value: "deny",
              });
            });
          }),
        );
      } else if (next === "Allow known peers") {
        await Promise.allSettled(
          peerPermissionStates.flatMap((state) => {
            if (state.remote_observation == null) {
              return [] as Array<Promise<void>>;
            }
            if (hasUserOverride(state, defaultAppliedKeysRef.current)) {
              return [] as Array<Promise<void>>;
            }
            return METHODS.map(async (method) => {
              newKeys.add(`${state.pubkey}:respond:${method}`);
              await dispatch({
                peer: state.pubkey,
                direction: "respond",
                method,
                value: "allow",
              });
            });
          }),
        );
      }

      defaultAppliedKeysRef.current = newKeys;
    },
    [dispatch, peerPermissionStates],
  );

  const selectOption = useCallback(
    (next: DefaultPolicyOption) => {
      setOpen(false);
      if (next !== value) {
        onChange(next);
        void applyDefault(next);
      }
      // Return focus to trigger for a11y.
      triggerRef.current?.focus();
    },
    [applyDefault, onChange, value],
  );

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
        return;
      }
    },
    [],
  );

  const handleGroupKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index + 1) % DEFAULT_POLICY_OPTIONS.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) =>
            (index - 1 + DEFAULT_POLICY_OPTIONS.length) %
            DEFAULT_POLICY_OPTIONS.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        const next = DEFAULT_POLICY_OPTIONS[activeIndex];
        if (next) selectOption(next);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(DEFAULT_POLICY_OPTIONS.length - 1);
        return;
      }
    },
    [activeIndex, selectOption],
  );

  const activeDescendantId = useMemo(
    () => (open ? optionId(activeIndex) : undefined),
    [activeIndex, open, optionId],
  );

  return (
    <div className="policies-dropdown-wrap" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label="Default policy"
        className="policies-dropdown"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={groupId}
        aria-activedescendant={activeDescendantId}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="policies-dropdown-text">{value}</span>
        <span className="policies-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          ref={groupRef}
          id={groupId}
          className="policies-dropdown-menu"
          role="radiogroup"
          aria-label="Default policy options"
          aria-activedescendant={activeDescendantId}
          tabIndex={-1}
          onKeyDown={handleGroupKeyDown}
        >
          {DEFAULT_POLICY_OPTIONS.map((option, index) => {
            const checked = value === option;
            const active = index === activeIndex;
            return (
              <button
                key={option}
                id={optionId(index)}
                type="button"
                role="radio"
                aria-checked={checked}
                data-active={active || undefined}
                className={
                  [checked ? "active" : "", active ? "focused" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onClick={() => selectOption(option)}
                onMouseEnter={() => setActiveIndex(index)}
                tabIndex={-1}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
