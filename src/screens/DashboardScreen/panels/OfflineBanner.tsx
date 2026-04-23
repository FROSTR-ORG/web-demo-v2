import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * m7-a11y-offline-banner / VAL-CROSS-026 — persistent network-offline
 * banner.
 *
 * Listens to the browser's `window` `online` / `offline` lifecycle
 * events and mirrors `navigator.onLine`. When the browser reports the
 * network as offline the banner renders with the canonical copy
 * `"Offline — relays unreachable"` and stays visible until the browser
 * reports back online. On the return-to-online transition the banner
 * invokes the caller-supplied `onReconnect` callback (typically the
 * dashboard's `restartRuntimeConnections`) which re-establishes the
 * relay WebSockets.
 *
 * Invariants for VAL-CROSS-026:
 * - Banner appears within one render of the `offline` event (well
 *   under the 5 s budget).
 * - `role="alert"` + `aria-live="assertive"` so assistive tech
 *   announces the offline state immediately (this is different from
 *   the polite state announcer — an offline network is a degradation
 *   the user must be told about right away).
 * - `onReconnect` failures NEVER escalate into uncaught promise
 *   rejections: the banner `.catch`es the returned promise and
 *   silently logs the reason so the DevTools offline/online toggle
 *   round-trip always completes clean.
 * - Initial `navigator.onLine` is read on mount so a tab that was
 *   already offline when it unlocked still renders the banner
 *   immediately (no wait for the next `offline` event).
 */
export interface OfflineBannerProps {
  /**
   * Called once per `offline → online` transition after the browser
   * reports `navigator.onLine === true`. Typically the dashboard's
   * `restartRuntimeConnections` mutator so relay WS sockets are
   * reconnected transparently when the network returns. Any
   * throw/rejection is swallowed so a mutator failure cannot surface
   * as an uncaught promise in the console.
   */
  onReconnect?: () => void | Promise<void>;
}

/**
 * Read the current `navigator.onLine` in an SSR-safe way. Always
 * returns `false` (not offline) when `navigator` is undefined so unit
 * tests that render without a `window` mock do not spuriously show the
 * banner.
 */
function readInitialOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  // `navigator.onLine === false` is the definitive offline signal; any
  // other value (true, undefined) means "not known to be offline".
  return navigator.onLine === false;
}

export function OfflineBanner({ onReconnect }: OfflineBannerProps) {
  const [offline, setOffline] = useState<boolean>(readInitialOffline);

  useEffect(() => {
    function handleOffline() {
      setOffline(true);
    }
    function handleOnline() {
      setOffline(false);
      if (!onReconnect) return;
      try {
        const result = onReconnect();
        if (
          result !== undefined &&
          result !== null &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          (result as Promise<unknown>).catch((err) => {
            // Swallow — VAL-CROSS-026 "no uncaught promise rejections".
            // Surface at warn level so operators can still inspect the
            // failure in devtools if desired.
            // eslint-disable-next-line no-console
            console.warn(
              "[OfflineBanner] reconnect after online event failed:",
              err,
            );
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[OfflineBanner] reconnect after online event threw:",
          err,
        );
      }
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [onReconnect]);

  if (!offline) return null;

  return (
    <div
      className="offline-banner"
      data-testid="offline-banner"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
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
      <WifiOff
        size={14}
        color="#ef4444"
        aria-hidden="true"
        focusable="false"
      />
      <span className="offline-banner-body" style={{ flex: 1 }}>
        Offline — relays unreachable
      </span>
    </div>
  );
}
