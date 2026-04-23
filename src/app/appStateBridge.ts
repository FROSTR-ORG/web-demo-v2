import type {
  RuntimeStatusSummary,
  StoredProfileSummary,
} from "../lib/bifrost/types";
import type { RuntimeRelayStatus } from "../lib/relay/runtimeRelayPump";
import type { AppStateValue } from "./AppState";

/**
 * sessionStorage key used by the demo-to-real-app-state bridge.
 *
 * The MockAppStateProvider that wraps `/demo/:scenarioId/*` writes a one-shot
 * snapshot of its state into this key (and dispatches `BRIDGE_EVENT`) so that
 * the real AppStateProvider — mounted at the root of the app — can rehydrate
 * its state before a demo scenario navigates into a real application route
 * (e.g. `/dashboard/{id}`, `/create`, etc.).
 *
 * The real AppStateProvider always consumes (read + delete) the key on first
 * read so the snapshot does not leak across page reloads or independent
 * navigation cycles. When the key is absent the real provider falls back to
 * loading from IndexedDB exactly as it did before this bridge existed.
 */
export const BRIDGE_STORAGE_KEY = "igloo.web-demo-v2.app-state-bridge";

/**
 * Custom DOM event dispatched on `window` whenever a bridge snapshot is
 * written. The real AppStateProvider listens for this event so it can hydrate
 * even after its own `useEffect` has already attached.
 */
export const BRIDGE_EVENT = "igloo:app-state-bridge-update";

/** Serialisable portion of {@link AppStateValue}. */
export interface AppStateBridgeSnapshot {
  profiles: StoredProfileSummary[];
  activeProfile: StoredProfileSummary | null;
  runtimeStatus: RuntimeStatusSummary | null;
  runtimeRelays: RuntimeRelayStatus[];
  signerPaused: boolean;
  createSession: null;
  importSession: null;
  onboardSession: null;
  rotateKeysetSession: null;
  replaceShareSession: null;
  recoverSession: null;
}

/**
 * Extract the bridge-serialisable fields from an AppStateValue.
 */
export function snapshotFromAppState(
  value: Pick<
    AppStateValue,
    | "profiles"
    | "activeProfile"
    | "runtimeStatus"
    | "runtimeRelays"
    | "signerPaused"
    | "createSession"
    | "importSession"
    | "onboardSession"
    | "rotateKeysetSession"
    | "replaceShareSession"
    | "recoverSession"
  >,
): AppStateBridgeSnapshot {
  return {
    profiles: value.profiles,
    activeProfile: value.activeProfile,
    runtimeStatus: value.runtimeStatus,
    runtimeRelays: Array.isArray(value.runtimeRelays)
      ? value.runtimeRelays
      : [],
    signerPaused: value.signerPaused,
    // Setup sessions contain decoded shares, package passwords, or recovered
    // keys. The demo bridge is only a visual hand-off convenience, so never
    // write those secrets to sessionStorage.
    createSession: null,
    importSession: null,
    onboardSession: null,
    rotateKeysetSession: null,
    replaceShareSession: null,
    recoverSession: null,
  };
}

function normalizeAppStateBridgeSnapshot(
  parsed: object,
): AppStateBridgeSnapshot {
  const snapshot = parsed as Partial<AppStateBridgeSnapshot>;
  return {
    profiles: Array.isArray(snapshot.profiles) ? snapshot.profiles : [],
    activeProfile: snapshot.activeProfile ?? null,
    runtimeStatus: snapshot.runtimeStatus ?? null,
    runtimeRelays: Array.isArray(snapshot.runtimeRelays)
      ? snapshot.runtimeRelays
      : [],
    signerPaused: Boolean(snapshot.signerPaused),
    // Harden reads too: older snapshots or manually injected sessionStorage
    // must not rehydrate setup-session secrets.
    createSession: null,
    importSession: null,
    onboardSession: null,
    rotateKeysetSession: null,
    replaceShareSession: null,
    recoverSession: null,
  };
}

/**
 * Write a snapshot to sessionStorage and fire the bridge update event so the
 * already-mounted real AppStateProvider can rehydrate.
 *
 * No-ops outside of a browser-like environment and swallows storage quota
 * errors — the bridge is a best-effort convenience, never a correctness
 * requirement.
 */
export function writeBridgeSnapshot(snapshot: AppStateBridgeSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(BRIDGE_EVENT));
  } catch {
    // older environments may not support CustomEvent; the storage write is
    // still useful because AppStateProvider also checks on mount.
  }
}

/**
 * Read the bridge snapshot and remove it from sessionStorage in a single pass.
 * Returns `null` if no key is present or if the payload cannot be parsed.
 */
export function consumeBridgeSnapshot(): AppStateBridgeSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(BRIDGE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    window.sessionStorage.removeItem(BRIDGE_STORAGE_KEY);
  } catch {
    // ignore — a lingering key just means a subsequent consume will get it.
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return normalizeAppStateBridgeSnapshot(parsed);
  } catch {
    return null;
  }
}
