/**
 * m6-backup-restore — parallel relay fan-out helper for
 * {@link AppStateValue.restoreProfileFromRelay}.
 *
 * Opens a subscription on every supplied relay URL in parallel, each
 * with its own per-attempt timeout (default 5000 ms — NOT shared across
 * relays). Resolves with the first EVENT JSON string any relay delivers
 * for `{authors: [authorPubkey32], kinds: [eventKind]}`. When every
 * attempt has either timed out, failed to connect, or completed without
 * a match, rejects with `"No backup found for this share."`.
 *
 * Why this shape:
 *   The previous implementation awaited `conn.connect()` sequentially
 *   inside a single shared 5s timer. A hung/slow relay earlier in the
 *   list could starve later relays and surface a false "No backup
 *   found" even when the event was sitting on a later relay. This
 *   helper fixes that by issuing every connect+subscribe in parallel
 *   and giving each its own 5s budget.
 *
 * The behaviour is covered by:
 *   - Unit tests in `src/app/__tests__/fetchProfileBackupEvent.test.ts`
 *     (3 relays, first hangs → resolves from relay 2 before 5s; all hang
 *     → "No backup found" after ≤ ~5s).
 *   - Multi-device Playwright spec `src/e2e/multi-device/backup-restore.spec.ts`
 *     (real `bifrost-devtools` relay).
 */

import type { RelayClient, RelayConnection } from "../lib/relay/browserRelayClient";
import { RELAY_EMPTY_ERROR } from "./AppStateTypes";

interface FetchProfileBackupEventInput {
  /** Validated wss:// (or test-opted-in ws://) relay URLs, deduped. */
  relays: string[];
  /** 32-byte x-only hex pubkey the backup event was signed with. */
  authorPubkey32: string;
  /** NIP-01 kind for the profile backup event (usually 10000). */
  eventKind: number;
  /**
   * Relay client to use. Injectable so unit tests can supply a fake
   * whose connections have scripted connect/subscribe behaviour. In
   * production callers pass a fresh {@link BrowserRelayClient}.
   */
  client: RelayClient;
  /**
   * Per-relay attempt timeout in milliseconds (NOT shared). Each relay
   * gets its own budget; a hung relay cannot starve the rest. Defaults
   * to 5000 to preserve the UX contract ("No backup found" within ~5s
   * when nothing is published anywhere).
   */
  perRelayTimeoutMs?: number;
}

/**
 * Open a parallel REQ on every relay in `input.relays`, resolve with
 * the first EVENT JSON that any relay delivers, and reject with the
 * canonical copy `"No backup found for this share."` when all
 * per-relay attempts are exhausted.
 */
export async function fetchProfileBackupEvent(
  input: FetchProfileBackupEventInput,
): Promise<string> {
  const {
    relays,
    authorPubkey32,
    eventKind,
    client,
    perRelayTimeoutMs = 5000,
  } = input;

  if (relays.length === 0) {
    throw new Error(RELAY_EMPTY_ERROR);
  }

  const connections: RelayConnection[] = relays.map((url) => client.connect(url));
  const subscriptions: Array<{ close: () => void }> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let settled = false;
  let remaining = connections.length;

  const closeSubscriptions = () => {
    for (const sub of subscriptions) {
      try {
        sub.close();
      } catch {
        /* best-effort */
      }
    }
  };
  const closeConnections = () => {
    for (const conn of connections) {
      try {
        conn.close();
      } catch {
        /* best-effort */
      }
    }
  };
  const clearTimers = () => {
    for (const t of timers) {
      clearTimeout(t);
    }
    timers.clear();
  };

  return new Promise<string>((resolve, reject) => {
    const finish = (json: string) => {
      if (settled) return;
      settled = true;
      clearTimers();
      closeSubscriptions();
      closeConnections();
      resolve(json);
    };
    const failAll = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      closeSubscriptions();
      closeConnections();
      reject(new Error("No backup found for this share."));
    };
    const markAttemptDone = () => {
      if (settled) return;
      remaining -= 1;
      if (remaining <= 0) failAll();
    };

    for (const conn of connections) {
      let attemptDone = false;
      const finishAttempt = () => {
        if (attemptDone) return;
        attemptDone = true;
        markAttemptDone();
      };
      const timer = setTimeout(() => {
        // Per-relay timeout: count this attempt as exhausted. We do
        // NOT close the connection here — the outer cleanup (finish
        // or failAll) will handle that atomically for all relays,
        // which prevents a double-close race when another relay is
        // delivering the event at the same instant.
        finishAttempt();
      }, perRelayTimeoutMs);
      timers.add(timer);

      (async () => {
        try {
          await conn.connect();
          if (settled || attemptDone) return;
          const sub = conn.subscribe(
            { kinds: [eventKind], authors: [authorPubkey32] },
            (event: unknown) => {
              if (!event || typeof event !== "object") return;
              // Found the backup event. Immediately finish — this
              // implicitly cancels every other per-relay timer and
              // closes siblings.
              finish(JSON.stringify(event));
            },
          );
          subscriptions.push(sub);
        } catch {
          // Per-relay connect/subscribe failure is non-fatal; the
          // timer may still fire (harmless), but we also decrement
          // `remaining` now so a bulk failure can reject faster than
          // `perRelayTimeoutMs`.
          finishAttempt();
        }
      })();
    }
  });
}
