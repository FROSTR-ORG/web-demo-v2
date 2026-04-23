/**
 * Feature: m7-security-live-sweep
 *
 * "Security live sweep: mid-sign/mid-ECDH/mid-onboard, snapshot
 *  sessionStorage + IndexedDB + window.__debug state + console
 *  transcript + outbound WS frames at 5 points; scan for
 *  partial_signature, share_secret, nonce_secret, passphrase,
 *  plaintext bfprofile, nsec1… — expect zero matches."
 *
 * This test is the gate described by the feature's
 * `verificationSteps`: `npx vitest run (snapshot.security.test.ts)`.
 *
 * What we prove here: while a real `AppStateProvider` drives a real
 * `RuntimeClient` through sign / ECDH / onboard dispatches (backed by
 * the bifrost WASM bridge and the in-memory
 * `LocalRuntimeSimulator`), NONE of the observable client-side
 * surfaces ever carries a raw secret.
 *
 * The observable surfaces sampled at each of the 5 snapshot points
 * are:
 *
 *   (A) `sessionStorage` — jsdom window bridge (mirrors what a real
 *       browser DevTools Application tab would show).
 *   (B) `IndexedDB` via the `idb-keyval` Map mock — identical key/
 *       value shape the production code writes.
 *   (C) `window.__debug` — dev-only debug surface installed by
 *       `AppStateProvider` (when `import.meta.env.DEV` is truthy).
 *   (D) `window.__appState` — latest live app-state snapshot exposed
 *       under the same dev gate.
 *   (E) Captured console transcript — every `console.log / info /
 *       warn / error / debug` argument intercepted during the flow.
 *   (F) Outbound envelopes — what
 *       `RuntimeClient.drainOutboundEvents` returned during the run.
 *       In a real deployment these are the payloads the
 *       `RuntimeRelayPump` serialises into Nostr events and writes
 *       to each relay's WebSocket — i.e. the "outbound WS frames"
 *       referenced by the feature description. We capture them by
 *       monkey-patching the prototype so every instance's drain
 *       output is mirrored into a module-local array before the
 *       LocalRuntimeSimulator consumes them.
 *
 * The scan is performed by `scanSnapshot` / `scanSnapshotSet` from
 * `src/lib/security/secretSweepScanner.ts`. Zero findings per
 * snapshot is the pass criterion.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppStateProvider,
  useAppState,
  type AppStateValue,
} from "../AppState";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import {
  scanSnapshotSet,
  type SecretSweepFinding,
} from "../../lib/security/secretSweepScanner";
import { BRIDGE_EVENT, BRIDGE_STORAGE_KEY } from "../appStateBridge";

/* ---------- idb-keyval storage mock (mirrors operations.test.tsx) --------- */
const storage = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));

/* --------- drainOutboundEvents prototype patch — outbound WS mirror ------- */
/**
 * The production `RuntimeRelayPump` calls
 * `runtime.drainOutboundEvents()` on every pump cycle and publishes
 * each returned envelope to every configured relay's WebSocket
 * connection as a Nostr `EVENT` frame. In a unit-test environment no
 * real WS exists — the `LocalRuntimeSimulator` consumes the drained
 * envelopes instead. Either way, the drain output IS the "outbound
 * WS frames" payload stream the feature wants us to scan.
 *
 * To capture that stream without modifying the production code path,
 * we patch the prototype's `drainOutboundEvents` to mirror a deep
 * copy of every returned entry into `recordedOutbound` before
 * yielding the original array to the caller. A deep clone is
 * essential because the caller (the simulator / pump) mutates /
 * re-keys these objects in-place after drain.
 */
const recordedOutbound: unknown[] = [];
let originalDrain: typeof RuntimeClient.prototype.drainOutboundEvents | null =
  null;

function installOutboundCapture() {
  originalDrain = RuntimeClient.prototype.drainOutboundEvents;
  RuntimeClient.prototype.drainOutboundEvents = function patched(
    this: RuntimeClient,
  ) {
    const events = originalDrain!.call(this);
    for (const event of events) {
      recordedOutbound.push(JSON.parse(JSON.stringify(event)));
    }
    return events;
  };
}

function restoreOutboundCapture() {
  if (originalDrain) {
    RuntimeClient.prototype.drainOutboundEvents = originalDrain;
    originalDrain = null;
  }
}

/* -------------------- console transcript capture ------------------------- */
interface ConsoleEntry {
  readonly level: "log" | "info" | "warn" | "error" | "debug";
  readonly args: unknown[];
}
const consoleEntries: ConsoleEntry[] = [];
const originalConsole: Partial<typeof console> = {};

function installConsoleCapture() {
  const levels: ConsoleEntry["level"][] = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
  ];
  for (const level of levels) {
    originalConsole[level] = console[level];
    console[level] = (...args: unknown[]) => {
      // Deep-clone each arg so a later mutation by the caller cannot
      // scrub the evidence after capture. We DO still forward to the
      // original console so validators can see what was logged in
      // CI output — but only a short prefix to avoid flooding logs.
      try {
        consoleEntries.push({
          level,
          args: args.map((arg) => {
            try {
              return typeof arg === "object" && arg !== null
                ? JSON.parse(JSON.stringify(arg))
                : arg;
            } catch {
              return String(arg);
            }
          }),
        });
      } catch {
        // Never let capture itself throw — it would mask real errors.
      }
      try {
        originalConsole[level]?.apply(console, args);
      } catch {
        // ignore
      }
    };
  }
}

function restoreConsoleCapture() {
  for (const level of Object.keys(originalConsole) as ConsoleEntry["level"][]) {
    const fn = originalConsole[level];
    if (fn) console[level] = fn;
  }
}

/* ----------------------- Capture component ------------------------------- */
function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

/* --------------------------- Test setup ---------------------------------- */
beforeEach(() => {
  storage.clear();
  recordedOutbound.length = 0;
  consoleEntries.length = 0;
  installOutboundCapture();
  installConsoleCapture();
  // jsdom preserves sessionStorage / localStorage across tests unless
  // cleared. Empty them so we see ONLY what the provider writes.
  // (Older jsdom builds under vitest expose sessionStorage as a bare
  // Storage implementation but leave `.clear` off — guard both.)
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
  try {
    window.localStorage?.clear?.();
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
  restoreOutboundCapture();
  restoreConsoleCapture();
  storage.clear();
  recordedOutbound.length = 0;
  consoleEntries.length = 0;
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
  try {
    window.localStorage?.clear?.();
  } catch {
    // ignore
  }
  // Remove dev-only globals so they do not bleed across tests.
  const globalWindow = window as unknown as Record<string, unknown>;
  delete globalWindow.__appState;
  delete globalWindow.__debug;
});

/* ---------------------- Snapshot helpers --------------------------------- */
/**
 * Circular-safe structured clone. The snapshot surfaces (notably
 * `window.__appState` and `window.__debug`) can contain React fibres,
 * function closures, circular parent/child refs, and other non-JSON
 * leaves. A naive `JSON.parse(JSON.stringify(...))` would throw on
 * cycles. This helper mirrors the scanner's own safeStringify
 * behaviour for exotic leaves so the snapshot is a pure point-in-
 * time JSON tree, safe to scan later regardless of how the live
 * state mutates in the interim.
 *
 * fix-m7-scrutiny-r1-security-sweep-snapshot-cloning — without this,
 * the snapshot object retained live references to the mutable
 * AppState / __debug / outbound envelope array, so by the time
 * `scanSnapshotSet` ran after all 5 captures, every snapshot had
 * collapsed to the final state and transient mid-sign / mid-ECDH /
 * mid-onboard secrets could have been missed.
 */
function freezeSnapshot(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const serialised = JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "function") return `[fn ${val.name || "anonymous"}]`;
    if (typeof val === "symbol") return val.toString();
    if (val instanceof Error) return `${val.name}: ${val.message}`;
    if (val !== null && typeof val === "object") {
      if (seen.has(val as object)) return "[circular]";
      seen.add(val as object);
    }
    return val;
  });
  return serialised === undefined ? null : JSON.parse(serialised);
}

/**
 * Build one snapshot object — a frozen-in-time reading of every
 * observable surface at the moment the caller invokes it. The
 * returned value is a deep clone of the underlying surfaces so it
 * cannot collapse to a later state before scanning. Safe to feed
 * directly to `scanSnapshotSet`.
 */
function buildSnapshot(label: string): {
  context: string;
  value: unknown;
} {
  const sessionStorageContents: Record<string, string | null> = {};
  try {
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (typeof key === "string") {
        sessionStorageContents[key] = window.sessionStorage.getItem(key);
      }
    }
  } catch {
    // ignore
  }
  const localStorageContents: Record<string, string | null> = {};
  try {
    const ls = window.localStorage as Storage | undefined;
    if (ls && typeof ls.length === "number") {
      for (let i = 0; i < ls.length; i += 1) {
        const key = ls.key(i);
        if (typeof key === "string") {
          localStorageContents[key] = ls.getItem(key);
        }
      }
    }
  } catch {
    // ignore
  }
  // Serialise the storage Map as plain entries for scan-friendliness.
  const indexedDbContents: Record<string, unknown> = {};
  for (const [key, value] of storage.entries()) {
    indexedDbContents[key] = value;
  }
  const globalWindow = window as unknown as {
    __debug?: unknown;
    __appState?: unknown;
  };
  const raw = {
    sessionStorage: sessionStorageContents,
    localStorage: localStorageContents,
    indexedDb: indexedDbContents,
    windowDebug: globalWindow.__debug ?? null,
    windowAppState: globalWindow.__appState ?? null,
    consoleTranscript: consoleEntries.map((entry) => ({
      level: entry.level,
      args: entry.args,
    })),
    // Copy of the outbound envelope array as-of-now; the underlying
    // module-local array continues to grow on subsequent drains.
    outboundEnvelopes: [...recordedOutbound],
  };
  // Structured clone so the snapshot is a point-in-time JSON tree
  // that cannot collapse to a later state before scanning. See
  // freezeSnapshot docstring for the rationale.
  return {
    context: label,
    value: freezeSnapshot(raw),
  };
}

function summariseFindings(findings: SecretSweepFinding[]): string {
  if (findings.length === 0) return "(no findings)";
  return findings
    .map(
      (f) =>
        `  - kind=${f.kind} context=${f.context} evidence=${f.evidence}`,
    )
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* The sweep                                                                  */
/* -------------------------------------------------------------------------- */
describe("m7-security-live-sweep — snapshot.security", () => {
  it(
    "mid-sign / mid-ECDH / mid-onboard snapshots contain zero secret matches",
    async () => {
      // Real timers — the LocalRuntimeSimulator runs synchronously in-
      // process but the AppStateProvider's setup path schedules micro-
      // tasks for WASM init and profile save. Fake timers would deadlock
      // the runtime bootstrap.
      vi.useRealTimers();

      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      // --- Setup: create a 2-of-2 keyset and complete profile save. --
      await act(async () => {
        await latest.createKeyset({
          groupName: "Security Sweep Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latest.createSession?.keyset).toBeTruthy(),
      );
      // fix-followup-create-bootstrap-live-relay-pump — capture the
      // plaintext keyset BEFORE createProfile redacts its
      // `share.seckey` fields so the simulator attach below can
      // stand up virtual peers.
      const capturedGroup = latest.createSession!.keyset!.group;
      const capturedLocalShare = latest.createSession!.localShare!;
      const capturedRemoteShares = latest.createSession!.keyset!.shares.filter(
        (share) => share.idx !== capturedLocalShare.idx,
      );

      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: "profile-password",
          confirmPassword: "profile-password",
          relays: ["wss://relay.local"],
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      // Attach a LocalRuntimeSimulator so the downstream sign / ECDH /
      // onboard dispatches produce real completions the security sweep
      // can scan. createProfile no longer attaches a simulator —
      // VAL-FOLLOWUP-001 — so we opt into simulator semantics here
      // via the DEV-only hook.
      const attachSimulatorHook = (
        window as typeof window & {
          __iglooTestAttachSimulator?: (input: {
            group: typeof capturedGroup;
            localShare: typeof capturedLocalShare;
            remoteShares: typeof capturedRemoteShares;
          }) => Promise<void>;
        }
      ).__iglooTestAttachSimulator;
      expect(typeof attachSimulatorHook).toBe("function");
      await act(async () => {
        await attachSimulatorHook!({
          group: capturedGroup,
          localShare: capturedLocalShare,
          remoteShares: capturedRemoteShares,
        });
      });

      // fix-m7-createsession-redact-secrets-on-finalize —
      // `createProfile` now REDACTS every sensitive field in
      // `createSession` in place before returning: share seckeys and
      // distribution passwords resolve to the `[redacted]` sentinel,
      // and every bfonboard package text resolves to the
      // `[redacted-bfprofile]` sentinel. Non-sensitive display
      // metadata (group pubkey, threshold, member list, device labels,
      // profile id, per-package booleans) survives intact so
      // `DistributionCompleteScreen` still renders correctly.
      //
      // The sweep therefore no longer needs to emulate the
      // `DistributionCompleteScreen` finish-transition with a manual
      // `clearCreateSession` — the redaction already makes every
      // observable surface (window.__appState, IndexedDB, console,
      // outbound envelopes) scan-clean immediately after
      // `createProfile` resolves. The real UI-mediated
      // `clearCreateSession` is still invoked from the finish-
      // transition, and its unit coverage lives in
      // `DistributionCompleteScreen.test.tsx`.
      expect(latest.createSession).toBeTruthy();
      // fix-followup-distribute-2a — createProfile no longer encrypts
      // onboarding packages eagerly; `onboardingPackages[i].packageText`
      // is empty and `packageCreated === false` until the per-share
      // `encodeDistributionPackage(idx, password)` mutator is invoked.
      // The security sweep's invariant is strictly about the absence
      // of plaintext on `window.__appState`, so an empty string is
      // equally scan-clean. Local-share seckey redaction is unchanged.
      expect(
        latest.createSession?.onboardingPackages[0]?.packageText,
      ).toBe("");
      expect(latest.createSession?.onboardingPackages[0]?.password).toBe("");
      expect(
        latest.createSession?.onboardingPackages[0]?.packageCreated,
      ).toBe(false);
      expect(latest.createSession?.localShare?.seckey).toBe("[redacted]");
      // Drive a single per-share encodeDistributionPackage so the
      // downstream mid-sign / mid-ECDH snapshots observe a populated
      // (but redacted-preview) packageText + stashed plaintext in the
      // provider secret ref — mirrors the Distribute screen's
      // "user sets a password for share N" action.
      await act(async () => {
        const pkg = latest.createSession!.onboardingPackages[0];
        await latest.encodeDistributionPackage(pkg.idx, "distro-password");
      });
      expect(
        latest.createSession?.onboardingPackages[0]?.packageText.startsWith(
          "bfonboard1",
        ),
      ).toBe(true);
      expect(latest.createSession?.onboardingPackages[0]?.password).toBe(
        "[redacted]",
      );

      /* ------------------- Snapshot 1: post-unlock ------------------- */
      const snap1 = buildSnapshot("post-unlock");

      // --- Dispatch sign (mid-sign) ---
      let signResult = {
        requestId: null as string | null,
        debounced: false,
      };
      await act(async () => {
        signResult = await latest.handleRuntimeCommand({
          type: "sign",
          message_hex_32: "a".repeat(64),
        });
      });
      expect(signResult.requestId).toBeTruthy();

      /* ------------------- Snapshot 2: mid-sign ---------------------- */
      // Captured BEFORE the next refresh tick drains completions —
      // the sign request is actively in-flight and a partial signature
      // may exist inside the runtime's internal session state. None of
      // that may leak to the observable surfaces.
      const snap2 = buildSnapshot("mid-sign-pending");

      // Pump to drive the drain path so completions/failures land on
      // the provider slices.
      await act(async () => {
        latest.refreshRuntime();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      /* ------------------- Snapshot 3: post-sign --------------------- */
      const snap3 = buildSnapshot("post-sign-drain");

      // --- Dispatch ECDH (mid-ECDH) ---
      const remotePeer = latest.runtimeStatus!.peers[0]?.pubkey;
      expect(remotePeer).toBeTruthy();

      let ecdhResult = {
        requestId: null as string | null,
        debounced: false,
      };
      await act(async () => {
        ecdhResult = await latest.handleRuntimeCommand({
          type: "ecdh",
          pubkey32_hex: remotePeer!,
        });
      });
      expect(ecdhResult.requestId).toBeTruthy();

      await act(async () => {
        latest.refreshRuntime();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      /* ------------------- Snapshot 4: mid-ECDH (drained) ------------ */
      // Post-drain so the ECDH completion (if any) has been surfaced
      // into `runtimeCompletions`. VAL-OPS-009 requires the shared
      // secret to be present in a completion's `shared_secret_hex32`
      // field — that field is NOT on the SENSITIVE_KEYS list because
      // the runtime intentionally surfaces the derived secret to the
      // consuming app (per Ecdh design). This snapshot is still
      // expected clean because no partial_signature / share_secret /
      // nonce_secret / passphrase / plaintext-bfprofile /
      // nsec1 leak may have occurred.
      const snap4 = buildSnapshot("post-ecdh-drain");

      // --- Onboard sponsor dispatch (mid-onboard) ---
      // `createOnboardSponsorPackage` exercises the full
      // `handleRuntimeCommand({type: "onboard", ...})` path AND
      // encrypts the bfonboard package with a user-supplied password.
      // Neither the password nor the sponsor's share secret may leak.
      //
      // polish-2nd-pass-code-tests — the previous version wrapped this
      // call in a try/catch that swallowed failures silently so the
      // security sweep still passed even if the unadopted shares pool
      // was empty. That hid real dispatch regressions. The 2-of-2
      // keyset seeded by the `createProfile` block above deterministically
      // populates the pool with one remote share (see the `initialPool`
      // construction in `AppStateProvider.createProfile`), so the
      // happy path MUST succeed. Let any real failure propagate.
      let sponsorPackage: string | null = null;
      await act(async () => {
        sponsorPackage = await latest.createOnboardSponsorPackage({
          deviceLabel: "Security Sweep Device",
          password: "onboard-package-pw-1234",
          relays: ["wss://relay.local"],
          profilePassword: "profile-password",
        });
      });

      // polish-2nd-pass-code-tests — assert the post-dispatch session
      // status reached `awaiting_adoption` so the dispatch is not
      // silently a no-op. The sensitive-surface scanner still runs
      // on every snapshot below (snap5 = post-dispatch).
      expect(latest.onboardSponsorSession?.status).toBe(
        "awaiting_adoption",
      );

      // Force another refresh tick so any in-flight onboard dispatch
      // completes or fails through the drain path (populating the
      // outbound envelope capture and console transcript fully).
      await act(async () => {
        latest.refreshRuntime();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      /* ------------------- Snapshot 5: mid-onboard ------------------- */
      const snap5 = buildSnapshot("mid-onboard");

      /* -------------- Scan every snapshot; expect zero findings ------ */
      const findings = scanSnapshotSet([snap1, snap2, snap3, snap4, snap5]);
      expect(
        findings,
        `secret-leak scan produced ${findings.length} finding(s):\n${summariseFindings(findings)}`,
      ).toEqual([]);

      // Guard rails: ensure the harness actually captured *something*
      // during the run — otherwise a silent no-op would trivially
      // pass the scan. The outbound envelope stream MUST be non-
      // empty (handle_command always produces at least one outbound
      // envelope for the sign / ECDH / onboard dispatches above).
      expect(recordedOutbound.length).toBeGreaterThan(0);

      // Sponsor package MUST begin with the bfonboard1 bech32 preamble.
      // This is the only place in the flow that a bfonboard-prefixed
      // string is allowed — and it is NEVER persisted anywhere by the
      // mutator; it is returned to the caller for rendering into a
      // handoff screen. The snapshot surfaces did not include it, which
      // is exactly the contract.
      expect(sponsorPackage).not.toBeNull();
      expect((sponsorPackage as unknown as string).startsWith("bfonboard1"))
        .toBe(true);
    },
    60_000,
  );

  it(
    "bridge-driven createSession reset clears the package-secrets ref and leaves no plaintext retrievable (fix-m7-scrutiny-r1-createsession-packagesecrets-ref-reset)",
    async () => {
      // Real timers for the same reason as the main sweep.
      vi.useRealTimers();

      let latest!: AppStateValue;
      render(
        <AppStateProvider>
          <Capture onState={(state) => (latest = state)} />
        </AppStateProvider>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      // createSession → createProfile.
      await act(async () => {
        await latest.createKeyset({
          groupName: "Bridge Reset Sweep Key",
          threshold: 2,
          count: 3,
        });
      });
      await waitFor(() => expect(latest.createSession?.keyset).toBeTruthy());
      await act(async () => {
        await latest.createProfile({
          deviceName: "Igloo Web",
          password: "profile-password",
          confirmPassword: "profile-password",
          relays: ["wss://relay.local"],
        });
      });
      await waitFor(() =>
        expect(latest.createSession?.onboardingPackages?.length ?? 0)
          .toBeGreaterThan(0),
      );
      // fix-followup-distribute-2a — explicitly encode each remote
      // share so the per-share secret ref is populated before we
      // assert that bridge-driven reset wipes plaintext.
      await act(async () => {
        for (const pkg of latest.createSession!.onboardingPackages) {
          await latest.encodeDistributionPackage(pkg.idx, "distro-password");
        }
      });
      const packages = latest.createSession!.onboardingPackages;
      // Sanity: the out-of-band plaintext stash is populated.
      for (const pkg of packages) {
        const secret = latest.getCreateSessionPackageSecret(pkg.idx);
        expect(secret).not.toBeNull();
        expect(secret!.packageText.startsWith("bfonboard1")).toBe(true);
      }

      /* -------- Snapshot A: post-createProfile (pre-bridge-reset) ------ */
      const snapA = buildSnapshot("post-create-profile-pre-bridge-reset");

      // Simulate an AppStateBridge snapshot delivery. The real
      // `applyBridge` handler calls `setCreateSession(null)` as part
      // of consuming the snapshot; the mirrored-to-session useEffect
      // added by this feature must then clear the package-secrets
      // ref so plaintext is no longer retrievable.
      const bridgeSnapshot = {
        profiles: [],
        activeProfile: null,
        runtimeStatus: null,
        runtimeRelays: [],
        signerPaused: false,
        createSession: null,
        importSession: null,
        onboardSession: null,
        rotateKeysetSession: null,
        replaceShareSession: null,
        recoverSession: null,
      };
      await act(async () => {
        window.sessionStorage.setItem(
          BRIDGE_STORAGE_KEY,
          JSON.stringify(bridgeSnapshot),
        );
        window.dispatchEvent(new CustomEvent(BRIDGE_EVENT));
      });
      await waitFor(() => expect(latest.createSession).toBeNull());

      // Contract: after a bridge-driven reset, getCreateSessionPackageSecret
      // returns null for every index — including the previously-known
      // indices — proving the ref itself is cleared rather than the entries
      // being individually redacted.
      for (const pkg of packages) {
        expect(latest.getCreateSessionPackageSecret(pkg.idx)).toBeNull();
      }
      expect(latest.getCreateSessionPackageSecret(-1)).toBeNull();
      expect(latest.getCreateSessionPackageSecret(99)).toBeNull();

      /* -------- Snapshot B: post-bridge-reset ------------------------- */
      const snapB = buildSnapshot("post-bridge-reset");

      /* -------- Scan both snapshots; expect zero findings -------------- */
      const findings = scanSnapshotSet([snapA, snapB]);
      expect(
        findings,
        `secret-leak scan produced ${findings.length} finding(s):\n${summariseFindings(findings)}`,
      ).toEqual([]);
    },
    60_000,
  );
});
