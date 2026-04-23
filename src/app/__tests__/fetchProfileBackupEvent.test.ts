/**
 * Unit tests for {@link fetchProfileBackupEvent} — the parallel
 * relay fan-out helper behind
 * `AppStateValue.restoreProfileFromRelay`.
 *
 * These tests pin the behavioural contract that earlier scrutiny
 * m6 r1 flagged:
 *
 *   1. A hung first relay MUST NOT starve later relays. Three relays,
 *      relay 1 hangs, relay 2 delivers the event — the helper resolves
 *      from relay 2 within a few ms (well under the 5s global budget).
 *   2. If every relay hangs, the helper rejects with the canonical
 *      copy `"No backup found for this share."` after ~per-relay
 *      timeout.
 *
 * We use {@link vi.useFakeTimers} so the ~5s per-relay timeout can be
 * advanced deterministically without delaying the suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RelayClient,
  RelayConnection,
} from "../../lib/relay/browserRelayClient";
import { fetchProfileBackupEvent } from "../fetchProfileBackupEvent";

type EventCb = (event: unknown) => void;

interface ScriptedRelay {
  url: string;
  /** Resolves when `connect()` is called. */
  connected: Promise<void>;
  /** Trigger an EVENT delivery to the subscribe callback. */
  deliverEvent: (event: unknown) => void;
  /** Record of how many times `close()` was invoked. */
  closeCount: () => number;
  /** Record of how many times `subscribe()` was invoked. */
  subscribeCount: () => number;
}

/**
 * Build a {@link RelayClient} whose connections behave per the supplied
 * `behavior` map (keyed by URL). Any URL not in the map defaults to
 * "connect immediately, subscribe succeeds, event never arrives" — i.e.
 * hang.
 */
function buildScriptedClient(behavior: {
  [url: string]: "connect_hang" | "connect_ok" | "connect_fail";
}): { client: RelayClient; relays: Record<string, ScriptedRelay> } {
  const relays: Record<string, ScriptedRelay> = {};
  const client: RelayClient = {
    connect(url: string): RelayConnection {
      const mode = behavior[url] ?? "connect_ok";
      let eventCb: EventCb | null = null;
      let closeCount = 0;
      let subscribeCount = 0;
      let connectResolve: () => void = () => {};
      const connected = new Promise<void>((resolve) => {
        connectResolve = resolve;
      });
      const connection: RelayConnection = {
        url,
        connect: () => {
          connectResolve();
          if (mode === "connect_hang") return new Promise<void>(() => {});
          if (mode === "connect_fail")
            return Promise.reject(new Error(`connect failed: ${url}`));
          return Promise.resolve();
        },
        publish: () => Promise.resolve(),
        subscribe: (_filter, cb) => {
          subscribeCount += 1;
          eventCb = cb;
          return {
            close: () => {
              eventCb = null;
            },
          };
        },
        close: () => {
          closeCount += 1;
        },
      };
      relays[url] = {
        url,
        connected,
        deliverEvent: (event) => {
          if (eventCb) eventCb(event);
        },
        closeCount: () => closeCount,
        subscribeCount: () => subscribeCount,
      };
      return connection;
    },
  };
  return { client, relays };
}

describe("fetchProfileBackupEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "resolves from a later relay when the first relay hangs (parallel fan-out, per-relay timeout)",
    async () => {
      const urls = [
        "wss://relay-1.test",
        "wss://relay-2.test",
        "wss://relay-3.test",
      ];
      const { client, relays } = buildScriptedClient({
        "wss://relay-1.test": "connect_hang",
        "wss://relay-2.test": "connect_ok",
        "wss://relay-3.test": "connect_ok",
      });

      const resultPromise = fetchProfileBackupEvent({
        relays: urls,
        authorPubkey32: "a".repeat(64),
        eventKind: 10000,
        client,
        perRelayTimeoutMs: 5000,
      });

      // Let every relay's connect() fire (microtasks).
      await vi.advanceTimersByTimeAsync(0);

      // relay-2 connects and subscribes; deliver the event well under 5s.
      await vi.advanceTimersByTimeAsync(50);
      expect(relays["wss://relay-2.test"]?.subscribeCount()).toBe(1);

      relays["wss://relay-2.test"]?.deliverEvent({
        id: "abc",
        pubkey: "a".repeat(64),
        kind: 10000,
        content: "ciphertext",
      });

      const json = await resultPromise;
      expect(JSON.parse(json)).toMatchObject({ kind: 10000, id: "abc" });

      // After resolution, every connection must have been closed so no
      // relay keeps a dangling socket open.
      expect(relays["wss://relay-1.test"]?.closeCount()).toBeGreaterThanOrEqual(1);
      expect(relays["wss://relay-2.test"]?.closeCount()).toBeGreaterThanOrEqual(1);
      expect(relays["wss://relay-3.test"]?.closeCount()).toBeGreaterThanOrEqual(1);
    },
  );

  it(
    "rejects with 'No backup found' when every relay hangs past the per-relay timeout",
    async () => {
      const urls = [
        "wss://relay-a.test",
        "wss://relay-b.test",
        "wss://relay-c.test",
      ];
      const { client } = buildScriptedClient({
        "wss://relay-a.test": "connect_hang",
        "wss://relay-b.test": "connect_hang",
        "wss://relay-c.test": "connect_hang",
      });

      const resultPromise = fetchProfileBackupEvent({
        relays: urls,
        authorPubkey32: "b".repeat(64),
        eventKind: 10000,
        client,
        perRelayTimeoutMs: 5000,
      });

      // Attach a rejection spy so Node doesn't flag the pending
      // rejection as unhandled while we advance timers.
      const caught = resultPromise.catch((err) => err);

      // Advance *just past* a single per-relay budget (5s) — since all
      // three relays are fanned out in parallel with independent 5s
      // timers, every one of them should be exhausted after ~5s, NOT
      // 15s as the old sequential implementation required.
      await vi.advanceTimersByTimeAsync(5_050);

      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/No backup found/i);
    },
  );

  it(
    "rejects with 'No backup found' quickly when every relay fails to connect",
    async () => {
      const urls = ["wss://fail-1.test", "wss://fail-2.test"];
      const { client } = buildScriptedClient({
        "wss://fail-1.test": "connect_fail",
        "wss://fail-2.test": "connect_fail",
      });

      const resultPromise = fetchProfileBackupEvent({
        relays: urls,
        authorPubkey32: "c".repeat(64),
        eventKind: 10000,
        client,
        perRelayTimeoutMs: 5000,
      });
      const caught = resultPromise.catch((err) => err);

      // All connects reject synchronously at the microtask boundary —
      // the helper decrements `remaining` immediately so the final
      // rejection does NOT have to wait for the timeout.
      await vi.advanceTimersByTimeAsync(10);
      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/No backup found/i);
    },
  );
});
