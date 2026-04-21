/**
 * Integration test for VAL-OPS-024 — the "Syncing nonces" / "Trigger
 * Sync" overlay must render end-to-end after the dev-only
 * `window.__iglooTestSimulateNonceDepletion()` hook fires on a real
 * `AppStateProvider` with an attached runtime, and must clear after
 * `window.__iglooTestRestoreNonce()` fires.
 *
 * Feature: `fix-m1-nonce-overlay-visible-on-hook`.
 *
 * The scenario this test locks in is the exact sequence an agent-browser
 * validator runs:
 *   1. Unlock / create a profile → a real `RuntimeClient` is attached and
 *      the dashboard renders in `"running"` state.
 *   2. Call `window.__iglooTestSimulateNonceDepletion()`.
 *   3. Within one runtime_status tick, the `SigningBlockedState` overlay
 *      must render with the accessible label `Syncing nonces` and a
 *      `Trigger Sync` button.
 *   4. Call `window.__iglooTestRestoreNonce()`.
 *   5. The overlay must disappear within one runtime_status tick.
 *
 * We use the real `AppStateProvider` (MockAppStateProvider does NOT install
 * the `__igloo*` hooks so it can't exercise this path). We drive the
 * provider through the public `createKeyset` + `createProfile` APIs which
 * attach a `LocalRuntimeSimulator` — that gives us a real
 * `runtimeRef.current` so the hook's `runtime.runtimeStatus()` call
 * actually returns a snapshot.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AppStateProvider } from "../../app/AppStateProvider";
import { useAppState } from "../../app/AppState";
import type { AppStateValue } from "../../app/AppStateTypes";
import { DashboardScreen } from "../DashboardScreen";

// Mirror the idb-keyval mock used by sibling real-provider tests so the
// AppStateProvider's initial listProfiles() call doesn't explode in jsdom.
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

interface IglooTestWindow extends Window {
  __iglooTestSimulateNonceDepletion?: (input?: {
    nonce_pool_size?: number;
    nonce_pool_threshold?: number;
    reason?: string;
  }) => void;
  __iglooTestRestoreNonce?: () => void;
}

function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function NavCapture({
  onNavigate,
}: {
  onNavigate: (nav: (to: string) => void) => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    onNavigate((to) => navigate(to));
  }, [navigate, onNavigate]);
  return null;
}

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  const iglooWindow = window as IglooTestWindow;
  iglooWindow.__iglooTestRestoreNonce?.();
  cleanup();
  storage.clear();
});

describe("Dashboard nonce-pool overlay — __iglooTestSimulateNonceDepletion end-to-end", () => {
  it(
    "renders 'Syncing nonces' + 'Trigger Sync' after simulate; clears after restore (VAL-OPS-024)",
    async () => {
      vi.useRealTimers();
      let latest!: AppStateValue;
      let navigateTo: (to: string) => void = () => {};

      // Render a small app that walks the create-profile flow, then mounts
      // DashboardScreen at /dashboard/:profileId. We do NOT go through
      // CoreRoutes so the test isolates only the dashboard; the AppStateProvider
      // is what installs the dev-only __igloo* hooks.
      render(
        <MemoryRouter initialEntries={["/"]}>
          <AppStateProvider>
            <Capture onState={(s) => (latest = s)} />
            <NavCapture onNavigate={(nav) => (navigateTo = nav)} />
            <Routes>
              <Route path="/" element={<div data-testid="boot" />} />
              <Route
                path="/dashboard/:profileId"
                element={<DashboardScreen />}
              />
            </Routes>
          </AppStateProvider>
        </MemoryRouter>,
      );
      await waitFor(() => expect(latest).toBeTruthy());

      await act(async () => {
        await latest.createKeyset({
          groupName: "Nonce Overlay Key",
          threshold: 2,
          count: 2,
        });
      });
      await waitFor(() =>
        expect(latest.createSession?.keyset).toBeTruthy(),
      );

      let profileId: string | null = null;
      await act(async () => {
        profileId = await latest.createProfile({
          deviceName: "Igloo Web",
          password: "profile-password",
          confirmPassword: "profile-password",
          relays: ["wss://relay.local"],
          distributionPassword: "distro-password",
          confirmDistributionPassword: "distro-password",
        });
      });
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());
      await waitFor(() =>
        expect(latest.activeProfile?.id).toBe(profileId),
      );
      expect(profileId).toBeTruthy();

      // Navigate to the dashboard for the just-created profile — stays
      // inside the SAME provider so runtime state is preserved.
      await act(async () => {
        navigateTo(`/dashboard/${profileId}`);
      });

      await waitFor(() =>
        expect(latest.activeProfile?.id).toBe(profileId),
      );
      await waitFor(() => expect(latest.runtimeStatus).toBeTruthy());

      // Sanity: the hook must be installed on window by the dev-only
      // AppStateProvider effect. Without this the whole test is meaningless.
      const iglooWindow = window as IglooTestWindow;
      await waitFor(() =>
        expect(typeof iglooWindow.__iglooTestSimulateNonceDepletion).toBe(
          "function",
        ),
      );
      await waitFor(() =>
        expect(typeof iglooWindow.__iglooTestRestoreNonce).toBe("function"),
      );

      // Before simulate, the overlay must NOT be present. We can't assert
      // `dashboardState === "running"` deterministically here (simulator
      // pump may surface as signing-blocked if no peers are yet ready),
      // but the NONCE-pool overlay specifically must only render when
      // noncePoolDepleted=true. We just assert absence.
      expect(screen.queryByTestId("nonce-pool-overlay")).toBeNull();

      // Fire the dev hook. The hook synchronously updates
      // nonceOverrideRef AND calls applyRuntimeStatus to push the augmented
      // status into React state — so the overlay must render within one
      // render cycle (no 2.5s poll required).
      await act(async () => {
        iglooWindow.__iglooTestSimulateNonceDepletion?.({
          nonce_pool_size: 0,
          nonce_pool_threshold: 2,
        });
      });

      // The overlay renders with accessible label "Syncing nonces" and a
      // "Trigger Sync" button. Both must be present.
      await waitFor(() => {
        expect(screen.getByTestId("nonce-pool-overlay")).toBeInTheDocument();
      });
      expect(
        screen.getByLabelText("Syncing nonces"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Trigger Sync" }),
      ).toBeInTheDocument();

      // Regression guard for the feature root cause: dispatching a runtime
      // command (which internally re-pulls the runtime status and commits
      // it to React state) must NOT wipe the override. Previously
      // `handleRuntimeCommand` called `setRuntimeStatus(statusAfter)`
      // directly, bypassing the nonce-depletion augmentation — any user
      // action between simulate() and restore() would silently clear the
      // overlay.
      await act(async () => {
        try {
          await latest.handleRuntimeCommand({
            type: "refresh_all_peers",
          });
        } catch {
          // Runtime may throw in jsdom depending on simulator state; the
          // point of this call is to exercise the status-commit path, not
          // to succeed at the runtime level.
        }
      });
      expect(screen.getByTestId("nonce-pool-overlay")).toBeInTheDocument();

      // Clear the override. Overlay must disappear within one render cycle.
      await act(async () => {
        iglooWindow.__iglooTestRestoreNonce?.();
      });

      await waitFor(() => {
        expect(screen.queryByTestId("nonce-pool-overlay")).toBeNull();
      });
      expect(screen.queryByLabelText("Syncing nonces")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Trigger Sync" }),
      ).toBeNull();
    },
    30_000,
  );
});
