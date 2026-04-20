import type { NavigateFunction } from "react-router-dom";
import type { RotateProductPhase, RotateRouteState } from "./types";

const ROTATE_PHASE_ORDER: Record<RotateProductPhase, number> = {
  sources_validated: 1,
  rotated: 2,
  profile_created: 3,
  distribution_ready: 4,
};

export function rotatePhaseAtLeast(
  session: { phase?: string } | null | undefined,
  phase: RotateProductPhase,
): boolean {
  const current = session?.phase;
  return Boolean(
    current &&
    current in ROTATE_PHASE_ORDER &&
    ROTATE_PHASE_ORDER[current as RotateProductPhase] >=
      ROTATE_PHASE_ORDER[phase],
  );
}

export function navigateWithRotateState(
  navigate: NavigateFunction,
  to: string,
  routeState?: RotateRouteState,
  options?: { replace?: boolean },
) {
  if (routeState || options?.replace) {
    navigate(to, {
      ...(options?.replace ? { replace: true } : {}),
      ...(routeState ? { state: routeState } : {}),
    });
    return;
  }
  navigate(to);
}

export async function copySecret(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard availability varies in tests and non-secure preview contexts.
    return false;
  }
}
