import { test, expect, type Page } from "@playwright/test";
import {
  bootstrapTwoRealPeers,
  cargoAvailable,
  clientNavigate,
  nextMessageHex,
  RELAY_URL,
  runtimeSnapshot,
  startBifrostDevtoolsRelay,
  waitForReadiness,
  waitForRealPeerHooks,
  waitForRelayOnline,
  wireConsoleErrors,
  type RealPeerNetwork,
} from "../support/realPeers";

/**
 * Real-peer dashboard workability suite.
 *
 * This is intentionally broader than the visual/mock dashboard tests:
 * two browser contexts run real bifrost runtimes through the local
 * `bifrost-devtools` relay, then the Dashboard UI is exercised from the
 * active profile on page A. Coverage target:
 *
 * - Running dashboard against live `runtime_status`.
 * - Dev sign/ECDH/ping panels dispatch real runtime commands.
 * - Sign Activity and Event Log render real completions and policy events.
 * - Policies view writes live request.* overrides and those permissions
 *   feed back into dashboard signing readiness.
 * - Stopped, relays-offline, and signing-blocked dashboard states are
 *   reached from a real seeded runtime, not from Paper fixtures.
 *
 * To run manually:
 *   npx playwright test \
 *     src/e2e/multi-device/dashboard-real-peers.spec.ts \
 *     --project=desktop --workers=1
 */

test.describe.configure({ mode: "serial" });

test.describe("dashboard real-peer workability", () => {
  test.skip(
    () => !cargoAvailable(),
    "`cargo --version` exited non-zero — Rust toolchain unavailable, " +
      "cannot run the local bifrost-devtools relay for real-peer e2e.",
  );

  test.setTimeout(300_000);

  let relay: { stop: () => Promise<void> } | null = null;

  test.beforeAll(async () => {
    relay = await startBifrostDevtoolsRelay();
  });

  test.afterAll(async () => {
    if (relay) {
      await relay.stop();
      relay = null;
    }
  });

  test(
    "real peers drive dashboard states, event log, policies, signing, and permission feedback",
    async ({ browser }) => {
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      let consoleErrorsA: string[] = [];

      try {
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        consoleErrorsA = wireConsoleErrors(pageA, "dashboard-A");
        wireConsoleErrors(pageB, "dashboard-B");

        await Promise.all([pageA.goto("/"), pageB.goto("/")]);
        await Promise.all([
          waitForRealPeerHooks(pageA, "A"),
          waitForRealPeerHooks(pageB, "B"),
        ]);

        const network = await bootstrapTwoRealPeers(pageA, pageB, {
          groupName: "Dashboard Real Peer Workability",
        });
        await clientNavigate(pageA, `/dashboard/${network.profileIdA}`);
        await expectRunningDashboard(pageA);

        await expect(
          pageA.getByLabel("Active keyset context"),
        ).toContainText("Dashboard Real Peer Workability");
        await expect(pageA.getByText("1 online")).toBeVisible();
        await expect(pageA.getByText("2 total")).toBeVisible();
        await expect(pageA.getByText("Event Log")).toBeVisible();
        await expect(pageA.getByText("Pending Approvals")).toBeVisible();

        await openTestPage(pageA);
        await expect(pageA.getByText("No runtime operations dispatched yet")).toBeVisible();

        const signRequestId = await dispatchSignUntilCompleted(
          pageA,
          pageB,
          network,
        );
        await expect(
          pageA.getByTestId(`sign-activity-row-${signRequestId}`),
        ).toHaveAttribute("data-status", "completed");
        await assertRuntimeLogHasBadges(pageB, ["SIGN"]);

        const publishRequestId = await publishTestNoteUntilReached(
          pageA,
          pageB,
          network,
        );
        await expect(
          pageA.getByTestId(`sign-activity-row-${publishRequestId}`),
        ).toHaveAttribute("data-status", "completed");

        const ecdhRequestId = await dispatchFromDevPanel(pageA, {
          panelTestId: "test-ecdh-panel",
          inputLabel: "Peer pubkey (64 hex chars)",
          buttonName: "Test ECDH",
          opType: "ecdh",
          input: network.peerBPubkey32,
        });
        await expect(
          pageA.getByTestId(`sign-activity-row-${ecdhRequestId}`),
        ).toHaveAttribute("data-status", "completed", { timeout: 45_000 });

        const pingRequestId = await dispatchFromDevPanel(pageA, {
          panelTestId: "test-ping-panel",
          inputLabel: "Peer pubkey (64 hex chars)",
          buttonName: "Ping",
          opType: "ping",
          input: network.peerBPubkey32,
        });
        await expect(
          pageA.getByTestId(`sign-activity-row-${pingRequestId}`),
        ).toHaveAttribute("data-status", "completed", { timeout: 45_000 });

        await returnToDashboard(pageA);
        await expectEventLogBadges(pageA, ["SIGN", "ECDH", "PING"]);
        await assertRuntimeLogHasBadges(pageA, ["SIGN", "ECDH", "PING"]);

        await drivePermissionDenyAndRecovery(pageA, pageB, network);
        await assertRuntimeLogHasBadges(pageA, ["SIGNER_POLICY"]);

        await driveStoppedState(pageA);
        await driveRelaysOfflineState(pageA);
        await driveNonceBlockedState(pageA);

        await expectEventLogBadges(pageA, [
          "SIGN",
          "ECDH",
          "PING",
          "SIGNER_POLICY",
        ]);
        const eventPanel = pageA.locator(".event-log-panel");
        await eventPanel
          .getByRole("button", { name: "Clear", exact: true })
          .click();
        await expect(eventPanel.getByText("No events yet")).toBeVisible();
        await expect
          .poll(() => runtimeSnapshot(pageA).then((snap) => snap.eventLog.length))
          .toBe(0);

        // Ignore the expected WebSocket close chatter from the deliberate
        // relay-offline transition; anything else should stay quiet.
        expect(
          consoleErrorsA.filter(
            (text) =>
              !/WebSocket connection to/.test(text) &&
              !/ERR_CONNECTION/.test(text) &&
              !/locked peer response timeout/i.test(text) &&
              !/Sign request .* failed/i.test(text),
          ),
        ).toEqual([]);
      } finally {
        await ctxA.close().catch(() => undefined);
        await ctxB.close().catch(() => undefined);
      }
    },
  );
});

async function openTestPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByTestId("test-sign-panel")).toBeVisible();
}

async function returnToDashboard(page: Page): Promise<void> {
  await page.getByRole("button", { name: /back to dashboard/i }).click();
  await expectRunningDashboard(page);
}

async function dispatchSignUntilCompleted(
  page: Page,
  responderPage: Page,
  network: RealPeerNetwork,
): Promise<string> {
  const attempts: Array<{ requestId: string; outcome: string }> = [];
  await refreshResponderAdvertisement(page, responderPage, network.peerBPubkey32);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const requestId = await dispatchFromDevPanel(page, {
      panelTestId: "test-sign-panel",
      inputLabel: "Message (64 hex chars)",
      buttonName: "Test Sign",
      opType: "sign",
      input: nextMessageHex(attempt),
    });
    const outcome = await waitForActivityOutcome(page, requestId);
    attempts.push({ requestId, outcome });
    if (outcome === "completed") return requestId;

    // Real bifrost signing can reject an early attempt with a
    // `locked peer response timeout` while the signer refreshes the
    // peer's remote-scoped policy view. A manual refresh mirrors the
    // operator recovery path and asks the peer to re-advertise policy
    // and nonce state before retrying with a distinct message.
    await dismissRuntimeModalIfPresent(page);
    await restoreRelayAndReadiness(page);
    await refreshResponderAdvertisement(page, responderPage, network.peerBPubkey32);
  }
  throw new Error(
    `Sign never completed after retries: ${JSON.stringify(attempts)}`,
  );
}

async function publishTestNoteUntilReached(
  page: Page,
  responderPage: Page,
  network: RealPeerNetwork,
): Promise<string> {
  const attempts: Array<{ requestId: string; outcome: string }> = [];
  await refreshResponderAdvertisement(page, responderPage, network.peerBPubkey32);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const baselineIds = await signLifecycleIds(page);
    const panel = page.getByTestId("test-publish-note-panel");
    await panel.getByLabel("Note content").fill(
      attempt === 1 ? "hello world" : `hello world ${attempt}`,
    );
    await panel.getByRole("button", { name: "Publish Note" }).click();
    const requestId = await waitForNewSignLifecycleId(page, baselineIds);
    const outcome = await waitForActivityOutcome(page, requestId);
    attempts.push({ requestId, outcome });
    if (outcome === "completed") {
      await expect(panel.getByTestId("test-publish-note-event-id")).toContainText(
        /[0-9a-f]{64}/,
        { timeout: 45_000 },
      );
      await expect(panel.getByTestId("test-publish-note-relays")).toContainText(
        /Published to [1-9]\d*/,
        { timeout: 45_000 },
      );
      return requestId;
    }
    await dismissRuntimeModalIfPresent(page);
    await restoreRelayAndReadiness(page);
    await refreshResponderAdvertisement(page, responderPage, network.peerBPubkey32);
  }
  throw new Error(
    `Publish note never completed after retries: ${JSON.stringify(attempts)}`,
  );
}

async function signLifecycleIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        signLifecycleLog?: Array<{
          request_id: string;
          op_type: string;
        }>;
      };
    };
    return (w.__appState?.signLifecycleLog ?? [])
      .filter((entry) => entry.op_type === "sign")
      .map((entry) => entry.request_id);
  });
}

async function waitForNewSignLifecycleId(
  page: Page,
  baselineIds: string[],
): Promise<string> {
  const handle = await page.waitForFunction(
    (baselineIds: string[]) => {
      const baseline = new Set(baselineIds);
      const w = window as unknown as {
        __appState?: {
          signLifecycleLog?: Array<{
            request_id: string;
            op_type: string;
            status: string;
          }>;
        };
      };
      const match = (w.__appState?.signLifecycleLog ?? [])
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.op_type === "sign" &&
            !baseline.has(entry.request_id) &&
            (entry.status === "pending" ||
              entry.status === "completed" ||
              entry.status === "failed"),
        );
      return match?.request_id ?? null;
    },
    baselineIds,
    { timeout: 15_000, polling: 100 },
  );
  const requestId = (await handle.jsonValue()) as string | null;
  expect(requestId).toBeTruthy();
  if (!requestId) {
    throw new Error("No lifecycle request_id surfaced for publish note.");
  }
  return requestId;
}

async function dismissRuntimeModalIfPresent(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    return;
  }
  const close = page.getByRole("button", { name: "Close modal" });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  }
}

async function restoreRelayAndReadiness(
  page: Page,
): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __iglooTestRestoreRelays: () => Promise<void>;
    };
    await w.__iglooTestRestoreRelays();
  });
  await waitForRelayOnline(page, "A");
  await waitForReadiness(page, "sign_ready", "A");
  await waitForReadiness(page, "ecdh_ready", "A");
  await expectRunningDashboard(page);
}

async function refreshResponderAdvertisement(
  signerPage: Page,
  responderPage: Page,
  responderPubkey32: string,
): Promise<void> {
  const baseline = await peerLastSeen(signerPage, responderPubkey32);
  await refreshAllPeers(responderPage);
  await signerPage
    .waitForFunction(
      ({ peer, baseline }) => {
        const w = window as unknown as {
          __appState?: {
            runtimeStatus?: {
              peers?: Array<{
                pubkey: string;
                last_seen: number | null;
              }>;
            };
          };
        };
        const match = (w.__appState?.runtimeStatus?.peers ?? []).find(
          (entry) => entry.pubkey === peer,
        );
        return (match?.last_seen ?? 0) > baseline;
      },
      { peer: responderPubkey32, baseline },
      { timeout: 30_000, polling: 200 },
    )
    .catch((error) => {
      throw new Error(
        `Signer never observed a fresh responder advertisement from ` +
          `${responderPubkey32} after refresh_all_peers. (${error})`,
      );
    });
  await waitForReadiness(signerPage, "sign_ready", "A");
}

async function peerLastSeen(page: Page, peerPubkey32: string): Promise<number> {
  return page.evaluate((peer) => {
    const w = window as unknown as {
      __appState?: {
        runtimeStatus?: {
          peers?: Array<{
            pubkey: string;
            last_seen: number | null;
          }>;
        };
      };
    };
    const match = (w.__appState?.runtimeStatus?.peers ?? []).find(
      (entry) => entry.pubkey === peer,
    );
    return match?.last_seen ?? 0;
  }, peerPubkey32);
}

async function dispatchFromDevPanel(
  page: Page,
  input: {
    panelTestId: string;
    inputLabel: string;
    buttonName: string;
    opType: "sign" | "ecdh" | "ping";
    input: string;
  },
): Promise<string> {
  const panel = page.getByTestId(input.panelTestId);
  await panel.getByLabel(input.inputLabel).fill(input.input);
  await panel.getByRole("button", { name: input.buttonName }).click();
  const preview = input.input.slice(0, 10).toLowerCase();

  const handle = await page.waitForFunction(
    ({ opType, preview }) => {
      const w = window as unknown as {
        __appState?: {
          signLifecycleLog?: Array<{
            request_id: string;
            op_type: string;
            message_preview: string | null;
            status: string;
          }>;
        };
      };
      const entries = w.__appState?.signLifecycleLog ?? [];
      const match = entries
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.op_type === opType &&
            entry.message_preview === preview &&
            (entry.status === "pending" ||
              entry.status === "completed" ||
              entry.status === "failed"),
        );
      return match?.request_id ?? null;
    },
    { opType: input.opType, preview },
    { timeout: 15_000, polling: 100 },
  );
  const requestId = (await handle.jsonValue()) as string | null;
  expect(requestId).toBeTruthy();
  if (!requestId) {
    throw new Error(`No lifecycle request_id surfaced for ${input.opType}.`);
  }
  return requestId;
}

async function waitForActivityOutcome(
  page: Page,
  requestId: string,
): Promise<"completed" | "failed"> {
  const handle = await page.waitForFunction(
    (rid: string) => {
      const w = window as unknown as {
        __appState?: {
          signLifecycleLog?: Array<{
            request_id: string;
            status: string;
          }>;
        };
      };
      const entry = (w.__appState?.signLifecycleLog ?? []).find(
        (candidate) => candidate.request_id === rid,
      );
      return entry?.status === "completed" || entry?.status === "failed"
        ? entry.status
        : null;
    },
    requestId,
    { timeout: 45_000, polling: 150 },
  );
  const outcome = (await handle.jsonValue()) as "completed" | "failed" | null;
  if (outcome !== "completed" && outcome !== "failed") {
    throw new Error(`No terminal activity outcome for ${requestId}.`);
  }
  return outcome;
}

async function refreshAllPeers(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __appState: {
        handleRuntimeCommand: (cmd: {
          type: "refresh_all_peers";
        }) => Promise<{ requestId: string | null; debounced: boolean }>;
      };
    };
    await w.__appState.handleRuntimeCommand({ type: "refresh_all_peers" });
  });
}

type DashboardStateId =
  | "running"
  | "stopped"
  | "relays-offline"
  | "signing-blocked";

async function expectRunningDashboard(page: Page): Promise<void> {
  await expectDashboardState(page, "running", 45_000);
  await expect(page.locator(".peers-panel-collapsible")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText("Event Log")).toBeVisible();
  await expect(page.getByText("Pending Approvals")).toBeVisible();
}

async function expectEventLogBadges(
  page: Page,
  badges: string[],
): Promise<void> {
  const eventPanel = page.locator(".event-log-panel");
  const filter = eventPanel.getByRole("button", {
    name: /Filter event log/,
  });
  if ((await filter.getAttribute("aria-expanded")) !== "true") {
    await filter.click();
  }
  await eventPanel.getByRole("button", { name: "Select all" }).click();
  for (const badge of badges) {
    await expect(
      eventPanel.locator(".event-log-type").filter({ hasText: badge }).first(),
    )
      .toBeVisible({ timeout: 30_000 })
      .catch(async (error) => {
        const diagnostics = await eventLogDiagnostics(page);
        throw new Error(
          `Expected Event Log badge "${badge}" did not appear.\n` +
            `Diagnostics: ${JSON.stringify(diagnostics, null, 2)}\n` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
  if ((await filter.getAttribute("aria-expanded")) === "true") {
    await filter.click();
  }
}

async function assertRuntimeLogHasBadges(
  page: Page,
  badges: string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const snapshot = await runtimeSnapshot(page);
      return [...new Set(snapshot.eventLog.map((entry) => entry.badge))].sort();
    }, { timeout: 45_000 })
    .toEqual(expect.arrayContaining(badges));
}

async function drivePermissionDenyAndRecovery(
  page: Page,
  responderPage: Page,
  network: RealPeerNetwork,
): Promise<void> {
  await page.getByRole("button", { name: "Policies", exact: true }).click();
  const signChip = page.getByTestId(
    `peer-policy-chip-${network.peerBPubkey32}-sign`,
  );
  await expect(signChip).toBeVisible();

  await signChip.click();
  await expect(signChip).toHaveAttribute("data-state", "allow", {
    timeout: 15_000,
  });
  await signChip.click();
  await expect(signChip).toHaveAttribute("data-state", "deny", {
    timeout: 15_000,
  });

  await page.waitForFunction(
    (peer: string) => {
      const w = window as unknown as {
        __appState?: {
          runtimeStatus?: {
            peer_permission_states?: Array<{
              pubkey: string;
              manual_override?: { request?: { sign?: string } } | null;
              effective_policy?: { request?: { sign?: string | boolean } };
            }>;
          };
        };
      };
      const state = (w.__appState?.runtimeStatus?.peer_permission_states ?? [])
        .find((entry) => entry.pubkey === peer);
      return (
        state?.manual_override?.request?.sign === "deny" &&
        state?.effective_policy?.request?.sign !== "allow" &&
        state?.effective_policy?.request?.sign !== true
      );
    },
    network.peerBPubkey32,
    { timeout: 30_000, polling: 200 },
  );

  await page.getByRole("button", { name: /back to dashboard/i }).click();
  await expectStateTitle(page, "Signing Blocked", 45_000);
  await openTestPage(page);
  await expect(
    page.getByTestId("test-sign-panel").getByRole("button", {
      name: "Test Sign",
    }),
  ).toBeDisabled();

  await page.getByRole("button", { name: /back to dashboard/i }).click();
  await page.getByRole("button", { name: "Policies", exact: true }).click();
  await signChip.click();
  await expect(signChip).toHaveAttribute("data-state", "unset", {
    timeout: 15_000,
  });
  await page.waitForFunction(
    (peer: string) => {
      const w = window as unknown as {
        __appState?: {
          runtimeStatus?: {
            peer_permission_states?: Array<{
              pubkey: string;
              manual_override?: { request?: { sign?: string } } | null;
            }>;
          };
        };
      };
      const state = (w.__appState?.runtimeStatus?.peer_permission_states ?? [])
        .find((entry) => entry.pubkey === peer);
      return state?.manual_override?.request?.sign !== "deny";
    },
    network.peerBPubkey32,
    { timeout: 30_000, polling: 200 },
  );

  await waitForRelayOnline(page, "A");
  await refreshResponderAdvertisement(page, responderPage, network.peerBPubkey32);
  await waitForReadiness(page, "sign_ready", "A");
  await page.getByRole("button", { name: /back to dashboard/i }).click();
  await expectRunningDashboard(page);
}

async function driveStoppedState(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Stop Signer" }).click();
  await expectStateTitle(page, "Signer Stopped", 15_000);
  await openTestPage(page);
  await expect(
    page.getByTestId("test-ping-panel").getByRole("button", { name: "Ping" }),
  ).toBeDisabled();
  await expect(
    page.getByTestId("test-peer-refresh-panel").getByRole("button", {
      name: "Refresh peers",
    }),
  ).toBeDisabled();

  await page.getByRole("button", { name: /back to dashboard/i }).click();
  await page.getByRole("button", { name: "Start Signer" }).click();
  await waitForRelayOnline(page, "A");
  await waitForReadiness(page, "sign_ready", "A");
  await expectRunningDashboard(page);
}

async function driveRelaysOfflineState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __iglooTestDropRelays: (closeCode?: number) => void;
    };
    w.__iglooTestDropRelays(1006);
  });
  await expectStateTitle(page, "All Relays Offline", 20_000);
  await openTestPage(page);
  await expect(
    page.getByTestId("test-sign-panel").getByRole("button", {
      name: "Test Sign",
    }),
  ).toBeDisabled();
  await expect(
    page.getByTestId("test-peer-refresh-panel").getByRole("button", {
      name: "Refresh peers",
    }),
  ).toBeEnabled();

  await page.getByRole("button", { name: /back to dashboard/i }).click();
  await page.evaluate(async () => {
    const w = window as unknown as {
      __iglooTestRestoreRelays: () => Promise<void>;
    };
    await w.__iglooTestRestoreRelays();
  });
  await waitForRelayOnline(page, "A", RELAY_URL);
  await waitForReadiness(page, "sign_ready", "A");
  await expectRunningDashboard(page);
}

async function driveNonceBlockedState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __iglooTestSimulateNonceDepletion: (input?: {
        nonce_pool_size?: number;
        nonce_pool_threshold?: number;
        reason?: string;
      }) => void;
    };
    w.__iglooTestSimulateNonceDepletion({
      nonce_pool_size: 0,
      nonce_pool_threshold: 2,
      reason: "nonce_pool_depleted",
    });
  });
  await expectStateTitle(page, "Signing Blocked", 15_000);
  await expect(page.getByText("Trigger Sync")).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as {
      __iglooTestRestoreNonce: () => void;
    };
    w.__iglooTestRestoreNonce();
  });
  await waitForReadiness(page, "sign_ready", "A");
  await expectRunningDashboard(page);
}

async function expectStateTitle(
  page: Page,
  title: string,
  timeout: number,
): Promise<void> {
  await expectDashboardState(
    page,
    dashboardStateIdForTitle(title),
    timeout,
    title,
  );

  const locator = dashboardStateTitleLocator(page, title);
  await expect(locator)
    .toBeVisible({ timeout })
    .catch(async (error) => {
      const diagnostics = await dashboardDiagnostics(page);
      throw new Error(
        `Expected dashboard state title "${title}" did not appear.\n` +
          `Diagnostics: ${JSON.stringify(diagnostics, null, 2)}\n` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

async function expectDashboardState(
  page: Page,
  state: DashboardStateId,
  timeout: number,
  label: string = state,
): Promise<void> {
  await expect(page.getByTestId("dashboard-state-announcer"))
    .toHaveAttribute("data-dashboard-state", state, { timeout })
    .catch(async (error) => {
      const diagnostics = await dashboardDiagnostics(page);
      throw new Error(
        `Expected dashboard state "${state}" for "${label}" did not appear.\n` +
          `Diagnostics: ${JSON.stringify(diagnostics, null, 2)}\n` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

function dashboardStateIdForTitle(title: string): DashboardStateId {
  switch (title) {
    case "Signing Blocked":
      return "signing-blocked";
    case "All Relays Offline":
      return "relays-offline";
    case "Signer Stopped":
      return "stopped";
    default:
      throw new Error(`Unknown dashboard state title "${title}".`);
  }
}

function dashboardStateTitleLocator(page: Page, title: string) {
  switch (title) {
    case "Signing Blocked":
      return page.locator(".dash-blocked-title", { hasText: title });
    case "All Relays Offline":
      return page.locator(".dash-readiness-title", { hasText: title });
    case "Signer Stopped":
      return page.locator(".dash-hero-title", { hasText: title });
    default:
      throw new Error(`Unknown dashboard state title "${title}".`);
  }
}

async function dashboardDiagnostics(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        runtimeStatus?: {
          readiness?: unknown;
          peers?: Array<{
            pubkey: string;
            online: boolean;
            can_sign: boolean;
          }>;
          peer_permission_states?: Array<{
            pubkey: string;
            manual_override?: unknown;
            effective_policy?: unknown;
          }>;
        };
        runtimeRelays?: Array<{ url: string; state: string }>;
        signerPaused?: boolean;
      };
    };
    return {
      url: window.location.href,
      visibleTitles: Array.from(
        document.querySelectorAll(
          ".dash-hero-title, .dash-blocked-title, .dash-readiness-title",
        ),
      )
        .map((node) => node.textContent?.trim())
        .filter(Boolean),
      policiesVisible: Boolean(
        Array.from(document.querySelectorAll(".policies-panel-title")).some(
          (node) => node.textContent?.includes("Peer Policies"),
        ),
      ),
      announcerState: document
        .querySelector("[data-testid='dashboard-state-announcer']")
        ?.getAttribute("data-dashboard-state"),
      relays: w.__appState?.runtimeRelays ?? [],
      signerPaused: w.__appState?.signerPaused,
      readiness: w.__appState?.runtimeStatus?.readiness ?? null,
      peers: w.__appState?.runtimeStatus?.peers ?? [],
      peerPermissionStates:
        w.__appState?.runtimeStatus?.peer_permission_states ?? [],
    };
  });
}

async function eventLogDiagnostics(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __appState?: {
        runtimeEventLog?: Array<{ badge: string; source: string; seq: number }>;
      };
    };
    return {
      panelPresent: Boolean(document.querySelector(".event-log-panel")),
      visibleBadges: Array.from(document.querySelectorAll(".event-log-type"))
        .map((node) => node.textContent?.trim())
        .filter(Boolean),
      emptyText: document.querySelector(".event-log-empty")?.textContent,
      filterLabel: document.querySelector(".event-log-filter")?.textContent,
      runtimeBadges: Array.from(
        new Set((w.__appState?.runtimeEventLog ?? []).map((entry) => entry.badge)),
      ).sort(),
      runtimeEventCount: w.__appState?.runtimeEventLog?.length ?? 0,
    };
  });
}
