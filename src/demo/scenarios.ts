import type { AppStateValue } from "../app/AppState";
import {
  DEMO_BFONBOARD,
  DEMO_BFPROFILE,
  DEMO_PASSWORD,
  DEMO_PROFILE_ID,
  createDemoAppState,
  createDemoSession,
  demoProfile,
  demoProfiles,
  demoRuntimeStatus
} from "./fixtures";

export type DemoFlow = "welcome" | "import" | "onboard" | "create" | "shared" | "dashboard" | "rotate-keyset" | "rotate-share" | "recover";

export interface DemoLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key: string;
}

export interface DemoScenario {
  id: string;
  flow: DemoFlow;
  title: string;
  paperPath: string;
  paperReference: string;
  location: DemoLocation;
  appState: AppStateValue;
  expectedText: string;
  canonical?: boolean;
  variantOf?: string;
  expectedVisibleText?: string[];
}

function locationFor(id: string, pathname: string, state: Record<string, unknown> = {}): DemoLocation {
  return {
    pathname,
    search: "",
    hash: "",
    state,
    key: id
  };
}

function paperReference(id: string) {
  return `/paper-reference/${id}.png`;
}

function scenario(
  id: string,
  flow: DemoFlow,
  title: string,
  paperPath: string,
  pathname: string,
  appState: AppStateValue,
  expectedText: string,
  state: Record<string, unknown> = {},
  options: Pick<DemoScenario, "canonical" | "variantOf" | "expectedVisibleText"> = {}
): DemoScenario {
  return {
    id,
    flow,
    title,
    paperPath,
    paperReference: paperReference(id),
    location: locationFor(id, pathname, state),
    appState,
    expectedText,
    canonical: options.canonical ?? true,
    variantOf: options.variantOf,
    expectedVisibleText: options.expectedVisibleText
  };
}

function variantScenario(
  id: string,
  variantOf: string,
  flow: DemoFlow,
  title: string,
  paperPath: string,
  pathname: string,
  appState: AppStateValue,
  expectedText: string,
  state: Record<string, unknown> = {}
): DemoScenario {
  return {
    ...scenario(id, flow, title, paperPath, pathname, appState, expectedText, state, { canonical: false, variantOf }),
    paperReference: paperReference(variantOf)
  };
}

const noProfiles = createDemoAppState({ profiles: [] });
const oneProfile = createDemoAppState({ profiles: [demoProfile] });
const multiProfiles = createDemoAppState({ profiles: demoProfiles.slice(0, 3) });
const manyProfiles = createDemoAppState({ profiles: demoProfiles });
/**
 * Used by the welcome-unlock-modal scenarios so that submitting the modal navigates
 * cleanly into a runnable dashboard view (per VAL-WEL-027).
 */
const multiProfilesWithActive = createDemoAppState({
  profiles: demoProfiles.slice(0, 3),
  activeProfile: demoProfile,
  runtimeStatus: demoRuntimeStatus
});
const dashboardState = createDemoAppState({
  profiles: [demoProfile],
  activeProfile: demoProfile,
  runtimeStatus: demoRuntimeStatus
});
const createKeysetState = createDemoAppState({ createSession: createDemoSession() });
// Shared Create Profile — retains the create-session keyset/localShare, but also
// marks the profile as created so the bridge snapshot carries `createdProfileId`
// forward. Without this, clicking "Continue to Distribute Shares" exits the
// demo shell into the real `AppStateProvider` where `DistributeSharesScreen`'s
// guard would short-circuit to `/create` (VAL-SHR-005).
const sharedProfileState = createDemoAppState({ activeProfile: demoProfile, createSession: createDemoSession({ profileCreated: true }) });
const sharedDistributeState = createDemoAppState({ activeProfile: demoProfile, createSession: createDemoSession({ profileCreated: true }) });
// Distribution Completion — includes `runtimeStatus` so that when the user
// clicks "Finish Distribution" the real `AppStateProvider` bridge carries the
// runtime status forward and `DashboardScreen` can render without redirecting
// back to `/` (VAL-SHR-011).
const sharedCompleteState = createDemoAppState({
  activeProfile: demoProfile,
  runtimeStatus: demoRuntimeStatus,
  createSession: createDemoSession({ profileCreated: true, distributed: true })
});

export const demoScenarios: DemoScenario[] = [
  scenario("welcome-first-time", "welcome", "Welcome - 1. Welcome", "screens/welcome/1-welcome", "/", noProfiles, "Igloo Web"),
  scenario("welcome-returning-single", "welcome", "Welcome - 1b. Returning", "screens/welcome/1b-returning", "/", oneProfile, "Welcome back."),
  scenario("welcome-returning-multi", "welcome", "Welcome - 1c. Returning (Multi)", "screens/welcome/1c-returning-multi", "/", multiProfiles, "Work Key"),
  scenario("welcome-returning-many", "welcome", "Welcome - 1d. Returning (Many)", "screens/welcome/1d-returning-many", "/", manyProfiles, "saved profiles"),
  scenario(
    "welcome-unlock-modal",
    "welcome",
    "Welcome - 1c-1. Unlock Profile (Modal)",
    "screens/welcome/1c-1-unlock-profile-modal",
    "/",
    multiProfilesWithActive,
    "Unlock Profile",
    { demoUi: { welcome: { unlockingProfileId: DEMO_PROFILE_ID, passwordPreset: DEMO_PASSWORD } } }
  ),
  scenario(
    "welcome-unlock-error-modal",
    "welcome",
    "Welcome - 1c-2. Unlock Error (Modal)",
    "screens/welcome/1c-2-unlock-error-modal",
    "/",
    multiProfilesWithActive,
    "Incorrect password",
    { demoUi: { welcome: { unlockingProfileId: DEMO_PROFILE_ID, unlockError: "Incorrect password. Please try again.", passwordPreset: DEMO_PASSWORD } } }
  ),
  variantScenario(
    "welcome-rotate-keyset-first",
    "welcome-returning-single",
    "welcome",
    "Welcome - Rotate Keyset First",
    "screens/welcome/1b-returning",
    "/",
    oneProfile,
    "Welcome back.",
    { demoUi: { welcome: { variant: "rotate-keyset-first" } } }
  ),
  variantScenario(
    "welcome-rotate-share-first",
    "welcome-first-time",
    "welcome",
    "Welcome - Rotate Share First",
    "screens/welcome/1-welcome",
    "/",
    noProfiles,
    "Replace a Share",
    { demoUi: { welcome: { variant: "rotate-share-first" } } }
  ),

  scenario("import-load-backup", "import", "Import - 1. Load Backup", "screens/import/1-load-backup", "/import", noProfiles, "Load Backup", { demoUi: { import: { backupPreset: DEMO_BFPROFILE } } }),
  scenario(
    "import-decrypt-backup",
    "import",
    "Import - 2. Decrypt Backup",
    "screens/import/2-decrypt-backup",
    "/import/decrypt",
    noProfiles,
    "Decrypt Backup",
    { backupString: DEMO_BFPROFILE, demoUi: { import: { backupPreset: DEMO_BFPROFILE, passwordPreset: DEMO_PASSWORD } } }
  ),
  scenario(
    "import-review-save-profile",
    "import",
    "Import - 3. Review & Save Profile",
    "screens/import/3-review-save-profile",
    "/import/review",
    noProfiles,
    "Review & Save Profile",
    { backupString: DEMO_BFPROFILE, password: DEMO_PASSWORD, demoUi: { import: { profilePasswordPreset: DEMO_PASSWORD } } }
  ),
  scenario("import-error", "import", "Import - Error", "screens/import/error", "/import/error", noProfiles, "Import Error", { backupString: DEMO_BFPROFILE, demoUi: { import: { errorVariant: "wrong-password" } } }),
  variantScenario("import-error-corrupted", "import-error", "import", "Import - Error: Backup Corrupted", "screens/import/error", "/import/error", noProfiles, "Backup Corrupted", { backupString: DEMO_BFPROFILE, demoUi: { import: { errorVariant: "corrupted" } } }),

  scenario("onboard-enter-package", "onboard", "Onboard - 1. Enter Package", "screens/onboard/1-enter-package", "/onboard", noProfiles, "Enter Onboarding Package", { demoUi: { onboard: { packagePreset: DEMO_BFONBOARD, passwordPreset: DEMO_PASSWORD } } }),
  scenario(
    "onboard-handshake",
    "onboard",
    "Onboard - 2. Handshake",
    "screens/onboard/2-handshake",
    "/onboard/handshake",
    noProfiles,
    "Onboarding...",
    { packageString: DEMO_BFONBOARD, password: DEMO_PASSWORD, demoUi: { progress: { frozen: true }, onboard: { packagePreset: DEMO_BFONBOARD } } }
  ),
  scenario("onboard-failed", "onboard", "Onboard - 2b. Onboarding Failed", "screens/onboard/2b-onboarding-failed", "/onboard/failed", noProfiles, "Onboarding Failed", { demoUi: { onboard: { failedVariant: "timeout" } } }),
  variantScenario("onboard-failed-rejected", "onboard-failed", "onboard", "Onboard - 2b. Onboarding Rejected", "screens/onboard/2b-onboarding-failed", "/onboard/failed", noProfiles, "Onboarding Rejected", { demoUi: { onboard: { failedVariant: "rejected" } } }),
  scenario(
    "onboard-complete",
    "onboard",
    "Onboard - 3. Onboarding Complete",
    "screens/onboard/3-onboarding-complete",
    "/onboard/complete",
    noProfiles,
    "Onboarding Complete",
    { fromHandshake: true, demoUi: { onboard: { passwordPreset: DEMO_PASSWORD } } }
  ),

  // `createKeysetState` (not `noProfiles`) primes the mock with a valid
  // createSession so that after the user submits the form, the bridge
  // snapshot carries enough state for the real app's GenerationProgressScreen
  // to render at /create/progress without bouncing back to /create (VAL-CRT-007,
  // VAL-CRT-012). The Create Keyset form itself does not read createSession,
  // so all existing content-parity assertions continue to hold.
  scenario("create-keyset", "create", "Create - 1. Create Keyset", "screens/create/1-create-keyset", "/create", createKeysetState, "Create New Keyset"),
  scenario(
    "create-validation-error",
    "create",
    "Create - 1b. Validation Error",
    "screens/create/1b-validation-error",
    "/create",
    noProfiles,
    "Invalid nsec format",
    { demoUi: { create: { validationError: true, nsecPreset: "not-a-valid-key" } } }
  ),
  scenario(
    "create-generation-progress",
    "create",
    "Create - 1c. Generation Progress",
    "screens/create/1c-generation-progress",
    "/create/progress",
    createKeysetState,
    "Generation Progress",
    { demoUi: { progress: { frozen: true, activeIndex: 1, completedCount: 1 } } }
  ),
  scenario("shared-create-profile", "shared", "Shared - 2. Create Profile", "screens/shared/2-create-profile", "/create/profile", sharedProfileState, "Create Profile", { demoUi: { shared: { profileNamePreset: "Igloo Web", passwordPreset: DEMO_PASSWORD, relayPreset: "wss://relay.example.com" } } }),
  scenario("shared-distribute-shares", "shared", "Shared - 3. Distribute Shares", "screens/shared/3-distribute-shares", "/create/distribute", sharedDistributeState, "Distribute Shares", { demoUi: { shared: { lockedPackageIndexes: [2] } } }),
  scenario("shared-distribution-completion", "shared", "Shared - 3b. Distribution Completion", "screens/shared/3b-distribution-completion", "/create/complete", sharedCompleteState, "Distribution Completion", { demoUi: { shared: { completionPreset: true } } }),

  scenario("dashboard-running", "dashboard", "Dashboard - 1. Signer Dashboard", "screens/dashboard/1-signer-dashboard", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signer Running", { demoUi: { dashboard: { state: "running", hideMockControls: true, paperPanels: true } } }),
  scenario("dashboard-connecting", "dashboard", "Dashboard - 1b. Connecting", "screens/dashboard/1b-connecting", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signer Connecting", { demoUi: { dashboard: { state: "connecting", hideMockControls: true } } }),
  scenario("dashboard-policies", "dashboard", "Dashboard - 1b. Policies", "screens/dashboard/1b-policies", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signer Policies", { demoUi: { dashboard: { showPolicies: true, hideMockControls: true } } }),
  scenario("dashboard-stopped", "dashboard", "Dashboard - 2. Stopped", "screens/dashboard/2-stopped", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signer Stopped", { demoUi: { dashboard: { state: "stopped", hideMockControls: true } } }),
  scenario("dashboard-relays-offline", "dashboard", "Dashboard - 2b. All Relays Offline", "screens/dashboard/2b-all-relays-offline", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "All Relays Offline", { demoUi: { dashboard: { state: "relays-offline", hideMockControls: true } } }),
  scenario("dashboard-signing-blocked", "dashboard", "Dashboard - 2c. Signing Blocked", "screens/dashboard/2c-signing-blocked", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signing Blocked", { demoUi: { dashboard: { state: "signing-blocked", hideMockControls: true } } }),
  scenario("dashboard-settings-lock-profile", "dashboard", "Dashboard - 3. Settings & Lock Profile", "screens/dashboard/3-settings-lock-profile", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Settings", { demoUi: { dashboard: { settingsOpen: true, hideMockControls: true, paperPanels: true } } }),
  scenario("dashboard-clear-credentials-modal", "dashboard", "Dashboard - 3b. Clear Credentials (Modal)", "screens/dashboard/3b-clear-credentials-modal", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Clear Credentials", { demoUi: { dashboard: { settingsOpen: true, modal: "clear-credentials", hideMockControls: true, paperPanels: true } } }),
  scenario("dashboard-export-profile", "dashboard", "Dashboard - 4. Export Profile", "screens/dashboard/4-export-profile", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Export Profile", { demoUi: { dashboard: { settingsOpen: true, modal: "export-profile", hideMockControls: true, paperPanels: true } } }),
  scenario("dashboard-export-complete", "dashboard", "Dashboard - 4b. Export Complete", "screens/dashboard/4b-export-complete", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Backup Ready", { demoUi: { dashboard: { settingsOpen: true, modal: "export-complete", hideMockControls: true, paperPanels: true } } }),
  scenario("dashboard-policy-prompt", "dashboard", "Dashboard - 5. Signer Policy Prompt", "screens/dashboard/5-signer-policy-prompt", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signer Policy", { demoUi: { dashboard: { modal: "policy-prompt", hideMockControls: true, paperPanels: true } } }),
  scenario("dashboard-signing-failed", "dashboard", "Dashboard - 6. Signing Failed", "screens/dashboard/6-signing-failed", `/dashboard/${DEMO_PROFILE_ID}`, dashboardState, "Signing Failed", { demoUi: { dashboard: { modal: "signing-failed", hideMockControls: true, paperPanels: true } } }),

  scenario("rotate-keyset-intake", "rotate-keyset", "Rotate Keyset - 1. Rotate Keyset", "screens/rotate-keyset/1-rotate-keyset", "/rotate-keyset", dashboardState, "Rotate Keyset", { profile: demoProfile }),
  scenario("rotate-keyset-review-generate", "rotate-keyset", "Rotate Keyset - 1d. Review & Generate", "screens/rotate-keyset/1d-review-generate", "/rotate-keyset/review", dashboardState, "Review & Generate", { demoUi: { rotateKeyset: { passwordPreset: DEMO_PASSWORD } } }),
  scenario("rotate-keyset-generation-progress", "rotate-keyset", "Rotate Keyset - 1e. Generation Progress", "screens/rotate-keyset/1e-generation-progress", "/rotate-keyset/progress", dashboardState, "Generation Progress", { demoUi: { progress: { frozen: true, activeIndex: 2, completedCount: 2 } } }),
  scenario("rotate-keyset-error-wrong-password", "rotate-keyset", "Rotate Keyset - Error: Wrong Password", "screens/rotate-keyset/error-wrong-password", "/rotate-keyset/error-password", dashboardState, "Wrong password"),
  scenario("rotate-keyset-error-group-mismatch", "rotate-keyset", "Rotate Keyset - Error: Group Mismatch", "screens/rotate-keyset/error-group-mismatch", "/rotate-keyset/error-mismatch", dashboardState, "Source Group Mismatch"),
  scenario("rotate-keyset-error-generation-failed", "rotate-keyset", "Rotate Keyset - Error: Generation Failed", "screens/rotate-keyset/error-generation-failed", "/rotate-keyset/error-failed", dashboardState, "Generation Failed"),

  scenario("rotate-share-enter-package", "rotate-share", "Rotate Share - 1. Enter Rotate Package", "screens/rotate-share/1-enter-rotate-package", "/rotate-share", dashboardState, "Enter Rotate Package", { demoUi: { rotateShare: { packagePreset: DEMO_BFONBOARD, passwordPreset: DEMO_PASSWORD } } }),
  scenario("rotate-share-applying", "rotate-share", "Rotate Share - 2. Applying Share Update", "screens/rotate-share/2-applying-share-update", "/rotate-share/applying", dashboardState, "Applying Share Update", { packageString: DEMO_BFONBOARD, password: DEMO_PASSWORD, demoUi: { progress: { frozen: true }, rotateShare: { packagePreset: DEMO_BFONBOARD } } }),
  scenario("rotate-share-failed", "rotate-share", "Rotate Share - 2b. Share Update Failed", "screens/rotate-share/2b-share-update-failed", "/rotate-share/failed", dashboardState, "Share Update Failed"),
  scenario("rotate-share-updated", "rotate-share", "Rotate Share - 3. Local Share Updated", "screens/rotate-share/3-local-share-updated", "/rotate-share/updated", dashboardState, "Local Share Updated", { fromApplying: true }),

  scenario("recover-collect-shares", "recover", "Recover - 1. Collect Shares", "screens/recover/1-collect-shares", `/recover/${DEMO_PROFILE_ID}`, dashboardState, "Recover NSEC", { demoUi: { recover: { variant: "incompatible-shares" } } }),
  scenario("recover-success", "recover", "Recover - 1b. Recover Success", "screens/recover/1b-recover-success", `/recover/${DEMO_PROFILE_ID}/success`, dashboardState, "Security Warning", { demoUi: { recover: { variant: "success", revealed: true, copied: true } } })
];

export const demoScenarioById = new Map(demoScenarios.map((entry) => [entry.id, entry]));
export const demoFlows: DemoFlow[] = ["welcome", "import", "onboard", "create", "shared", "dashboard", "rotate-keyset", "rotate-share", "recover"];
