import type { PeerPermissionState } from "./types";

/**
 * Policy methods covered by the dashboard surfaces (Peer Policies card
 * + PeerRow inline badges). Keep in sync with
 * `BfMethodPolicyOverrideSchema` (excluding `echo`, which is not
 * surfaced to users).
 */
export type PolicyMethod = "sign" | "ecdh" | "ping" | "onboard";

/**
 * Resolve whether a peer's `effective_policy.request.<method>` evaluates
 * to an allow-grant. Accepts both the nested runtime shape
 * (`{request: {sign: "allow", ...}, respond: {...}}`) and the flat shape
 * used by some demo fixtures (`{sign: "allow", ...}`) so both can share
 * this helper.
 *
 * Used by `PoliciesState` (Peer Policies card) and `PeerRow` (inline
 * peer badges) so both surfaces agree on grant state for the same
 * (peer, verb) pair within a single `runtime_status` snapshot
 * (VAL-POLICIES-005, VAL-POLICIES-006, VAL-POLICIES-020).
 */
export function resolveRequestPolicyAllows(
  state: PeerPermissionState | null | undefined,
  method: PolicyMethod,
): boolean {
  if (!state) return false;
  const effective = state.effective_policy as
    | ({
        request?: Record<string, unknown>;
      } & Record<string, unknown>)
    | null
    | undefined;
  if (!effective) return false;
  const value = effective.request?.[method] ?? effective[method];
  return value === true || value === "allow";
}
