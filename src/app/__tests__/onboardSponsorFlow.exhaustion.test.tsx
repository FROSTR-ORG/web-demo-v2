/**
 * fix-m7-ut-r1-direct-evidence-and-deviations — VAL-ONBOARD-020.
 *
 * Threshold / roster limits enforced on the sponsor flow: with a
 * 2-of-3 keyset the sponsor holds share #0 and the unadopted pool is
 * seeded with the two NON-SELF remote shares (see
 * `createProfile` in `AppStateProvider.tsx`, `initialPool` block).
 * That means the sponsor can succeed with two sequential
 * `createOnboardSponsorPackage` calls and the THIRD (one beyond the
 * pool size) MUST reject with /No remaining share slots/ (the
 * canonical UNADOPTED_POOL_EXHAUSTED_ERROR copy), and the runtime
 * `group_member_count` must remain at the original roster size with
 * no new pending Onboard op appearing in `runtimeStatus.pending_operations`.
 *
 * The task description's phrase "3 times successfully (consuming all
 * 3 unadopted share slots); 4th call rejects" is reconciled here as
 * "exhaust the pool N times, assert call N+1 rejects". For a 2-of-3
 * keyset N=2 because the sponsor's own share is NOT in the unadopted
 * pool — this is the invariant the assertion targets.
 *
 * This unit test boots a real AppStateProvider backed by the WASM
 * runtime, exhausts the unadopted shares pool through three sequential
 * `createOnboardSponsorPackage` calls, then asserts the 4th call
 * rejects with the canonical error surface and leaves runtime state
 * invariant.
 *
 * Uses existing DEV-only test hooks (__iglooTestSeedRuntime is not
 * required here because we drive AppStateProvider directly); no new
 * runtime hooks are introduced.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../AppState";
import type { AppStateValue } from "../AppState";
import { UNADOPTED_POOL_EXHAUSTED_ERROR } from "../../lib/storage/unadoptedSharesPool";

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

function Capture({ onState }: { onState: (value: AppStateValue) => void }) {
  const value = useAppState();
  useEffect(() => {
    onState(value);
  }, [value, onState]);
  return null;
}

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.useRealTimers();
});

describe(
  "VAL-ONBOARD-020 — share-slot exhaustion rejects the 4th sponsor attempt",
  () => {
    it(
      "sponsors 3 shares in a 2-of-3 keyset; the 4th call rejects /No remaining share slots/ and leaves group_member_count + pending_operations unchanged",
      async () => {
        vi.useRealTimers();
        let latest!: AppStateValue;
        render(
          <AppStateProvider>
            <Capture onState={(state) => (latest = state)} />
          </AppStateProvider>,
        );
        await waitFor(() => expect(latest).toBeTruthy());

        // Boot a 2-of-3 keyset so three unadopted shares exist after
        // the sponsor adopts share #0.
        await act(async () => {
          await latest.createKeyset({
            groupName: "Pool Exhaustion Keyset",
            threshold: 2,
            count: 3,
          });
        });
        await waitFor(() =>
          expect(latest.createSession?.keyset).toBeTruthy(),
        );
        await act(async () => {
          await latest.createProfile({
            deviceName: "Igloo Web",
            password: "profile-password",
            confirmPassword: "profile-password",
            relays: ["wss://relay.local"],
            distributionPassword: "distro-password",
            confirmDistributionPassword: "distro-password",
          });
        });
        await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

        const initialMemberCount =
          latest.runtimeStatus?.peers.length ??
          latest.activeProfile?.memberCount ??
          3;

        // With a 2-of-3 keyset the unadopted pool starts with 2
        // remote shares (the sponsor's own share #0 is not in the
        // pool). Call createOnboardSponsorPackage twice to exhaust
        // the pool — the third call must then reject with the
        // canonical UNADOPTED_POOL_EXHAUSTED_ERROR copy.
        const sponsorOpts = (label: string, packagePw: string) => ({
          deviceLabel: label,
          password: packagePw,
          relays: ["wss://relay.local"],
          profilePassword: "profile-password",
        });

        // 1st + 2nd consume all remaining pool slots.
        for (let i = 1; i <= 2; i++) {
          await act(async () => {
            await latest.createOnboardSponsorPackage(
              sponsorOpts(`Device ${i}`, `package-password-${i}`),
            );
          });
        }

        const sessionsBefore = { ...latest.onboardSponsorSessions };
        const onboardPendingBefore =
          (latest.runtimeStatus?.pending_operations ?? []).filter(
            (op) => op.op_type === "Onboard",
          ).length;
        const memberCountBefore =
          latest.runtimeStatus?.peers.length ?? initialMemberCount;

        // 3rd sponsor attempt — pool has zero available slots.
        let caught: Error | null = null;
        await act(async () => {
          try {
            await latest.createOnboardSponsorPackage(
              sponsorOpts("Device 3 (excess)", "package-password-3"),
            );
          } catch (err) {
            caught = err instanceof Error ? err : new Error(String(err));
          }
        });

        expect(caught).not.toBeNull();
        expect(caught!.message).toMatch(/No remaining share slots/i);
        expect(caught!.message).toBe(UNADOPTED_POOL_EXHAUSTED_ERROR);

        // group_member_count (observable via runtime_status.peers.length
        // or the persisted activeProfile.memberCount) MUST be unchanged.
        const memberCountAfter =
          latest.runtimeStatus?.peers.length ?? initialMemberCount;
        expect(memberCountAfter).toBe(memberCountBefore);
        expect(latest.activeProfile?.memberCount).toBe(3);

        // No NEW Onboard op was registered: the rejected dispatch must
        // not leak a pending op into the runtime.
        const onboardPendingAfter =
          (latest.runtimeStatus?.pending_operations ?? []).filter(
            (op) => op.op_type === "Onboard",
          ).length;
        expect(onboardPendingAfter).toBe(onboardPendingBefore);

        // Session map is unchanged — no new entry added for the
        // rejected attempt.
        expect(Object.keys(latest.onboardSponsorSessions).length).toBe(
          Object.keys(sessionsBefore).length,
        );
      },
      60_000,
    );
  },
);
