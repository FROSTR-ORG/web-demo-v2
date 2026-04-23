import { useEffect, useRef, useState } from "react";
import type { DashboardState } from "../types";

/**
 * m7-a11y-offline-banner / VAL-CROSS-025 — accessibility live-region
 * announcer for runtime state transitions.
 *
 * Paper does not depict a visible announcer — this component renders a
 * visually-hidden (screen-reader-only) region carrying the current
 * dashboard state label. A `useEffect` tracks the *previously announced*
 * state in a ref and rewrites the live-region text exactly once per
 * transition so assistive tech consumers receive a single "polite"
 * announcement per change (no stuttering repeats when the effect re-runs
 * with the same value, no initial phantom announcement on mount).
 *
 * Surface invariants:
 * - `role="status"` + `aria-live="polite"` so screen readers queue the
 *   announcement behind current speech without interrupting modal focus.
 * - `aria-atomic="true"` so assistive tech reads the full updated label
 *   rather than diffing individual words when the state changes.
 * - The announcement element is visually hidden via the standard
 *   sr-only clip technique (see CSS inline styles) so sighted users are
 *   unaffected while non-visual users still receive the cue.
 *
 * The initial mount writes the current label immediately so a user who
 * unlocks into a non-default state (e.g. directly into `relays-offline`
 * after a reload while the network is down) still hears the starting
 * condition announced once.
 */

/**
 * Human-readable labels for each dashboard state. Kept concise so
 * screen readers announce the transition without noise.
 */
const DASHBOARD_STATE_LABELS: Record<DashboardState, string> = {
  running: "Signer running",
  connecting: "Signer connecting to relays",
  stopped: "Signer stopped",
  "relays-offline": "Relays offline",
  "signing-blocked": "Signing blocked",
};

export interface DashboardStateAnnouncerProps {
  /** Current dashboard state derived from runtime/demo signals. */
  dashboardState: DashboardState;
}

export function DashboardStateAnnouncer({
  dashboardState,
}: DashboardStateAnnouncerProps) {
  const [announcement, setAnnouncement] = useState<string>(
    () => DASHBOARD_STATE_LABELS[dashboardState],
  );
  const lastAnnouncedRef = useRef<DashboardState>(dashboardState);

  useEffect(() => {
    if (lastAnnouncedRef.current === dashboardState) {
      // Same state as last announce — skip. This debounces effect
      // re-runs triggered by unrelated prop/render churn so the
      // live-region doesn't re-speak the same label.
      return;
    }
    lastAnnouncedRef.current = dashboardState;
    setAnnouncement(DASHBOARD_STATE_LABELS[dashboardState]);
  }, [dashboardState]);

  return (
    <div
      className="dashboard-state-announcer"
      data-testid="dashboard-state-announcer"
      data-dashboard-state={dashboardState}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Visually hidden (sr-only) so the announcement is
      // non-disruptive for sighted users. Standard clip pattern copied
      // from the WAI-ARIA APG to ensure the node still participates in
      // the accessibility tree.
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {announcement}
    </div>
  );
}
