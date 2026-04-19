import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Info, Lock, X } from "lucide-react";
import { useAppState } from "../app/AppState";
import { shortHex } from "../lib/bifrost/format";
import { AppShell, PageHeading } from "../components/shell";
import { useDemoUi } from "../demo/demoUi";
import {
  BackLink,
  Button,
  CopyBlock,
  NumberStepper,
  PasswordField,
  PermissionBadge,
  QrButton,
  SecretDisplay,
  SectionHeader,
  StatusPill,
  Stepper,
  TextField
} from "../components/ui";

/* ---------- Mock data for source share cards ---------- */

const MOCK_SOURCE_SHARE_1 = {
  label: "My Signing Key",
  deviceName: "Igloo Web",
  sharePubkey: "02a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4c5d6e7f8a9b0c1d28f2c",
  sharePubkeyDisplay: "02a3f8...8f2c",
  profileId: "prof_8f2c4a",
  relays: 3
};

/* ==========================================================
   Rotate Keyset Form Screen
   ========================================================== */

export function RotateKeysetFormScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [bfshare, setBfshare] = useState("");
  const [pkgPassword, setPkgPassword] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [totalShares, setTotalShares] = useState(3);

  /* Read profile data from location state (passed by WelcomeScreen Rotate button) */
  const locationProfile = (location.state as { profile?: { id?: string; label?: string; deviceName?: string; groupPublicKey?: string; relays?: string[] } } | null)?.profile;
  const sourceShare = {
    label: locationProfile?.label ?? MOCK_SOURCE_SHARE_1.label,
    deviceName: locationProfile?.deviceName ?? MOCK_SOURCE_SHARE_1.deviceName,
    sharePubkey: MOCK_SOURCE_SHARE_1.sharePubkey,
    sharePubkeyDisplay: MOCK_SOURCE_SHARE_1.sharePubkeyDisplay,
    profileId: locationProfile?.id === "demo-profile" ? MOCK_SOURCE_SHARE_1.profileId : locationProfile?.id ?? MOCK_SOURCE_SHARE_1.profileId,
    relays: locationProfile?.relays?.length ? 3 : MOCK_SOURCE_SHARE_1.relays
  };

  return (
    <AppShell headerMeta={sourceShare.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/")} />
        <PageHeading
          title="Rotate Keyset"
          copy="This keyset rotation started from the selected saved profile, which already counts as Source Share #1. Add the remaining threshold bfshare packages to refresh device shares for the same group public key, then continue into shared profile creation and share distribution."
        />

        {/* ---- Source Share #1 (validated) ---- */}
        <div className="source-share-card validated">
          <div className="source-share-header">
            <span className="source-share-title">Source Share #1</span>
            <span className="source-share-badge validated">
              <Check size={14} />
              Validated
            </span>
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">Saved Profile</span>
            <div className="source-share-value validated">{sourceShare.label}</div>
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">Profile Password</span>
            <div className="source-share-value validated">••••••••</div>
          </div>
          <div className="source-share-details">
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Device Name</span>
              <span className="source-share-detail-val">{sourceShare.deviceName}</span>
            </div>
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Share Public Key</span>
              <span className="source-share-detail-val">{sourceShare.sharePubkeyDisplay}</span>
            </div>
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Profile ID</span>
              <span className="source-share-detail-val">{sourceShare.profileId}</span>
            </div>
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Relays</span>
              <span className="source-share-detail-val">{sourceShare.relays} configured</span>
            </div>
            <div className="source-share-detail-row last">
              <span className="source-share-detail-key">Group Match</span>
              <span className="source-share-detail-val match">
                <Check size={10} />
                Belongs to current group
              </span>
            </div>
          </div>
        </div>

        {/* ---- Source Share #2 (input) ---- */}
        <div className="source-share-card">
          <div className="source-share-header">
            <span className="source-share-title">Source Share #2</span>
            <span className="source-share-status">Waiting for input</span>
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">bfshare Package</span>
            <textarea
              className="source-share-textarea"
              placeholder="Paste bfshare from another device or backup..."
              value={bfshare}
              onChange={(e) => setBfshare(e.target.value)}
              rows={2}
            />
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">Package Password</span>
            <input
              type="password"
              className="input"
              placeholder="Enter password to decrypt"
              value={pkgPassword}
              onChange={(e) => setPkgPassword(e.target.value)}
            />
          </div>
        </div>

        {/* ---- Shares Collected progress ---- */}
        <div className="shares-collected">
          <div className="shares-collected-header">
            <span className="shares-collected-label">Shares Collected</span>
            <span className="shares-collected-count">1 of 2 required</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: "50%" }} />
          </div>
        </div>

        <p className="rotate-help-text">
          Old devices do not need to be online. Only threshold bfshare packages and their passwords are required.
        </p>

        {/* ---- Separator ---- */}
        <div className="rotate-separator" />

        {/* ---- New Configuration ---- */}
        <div className="new-config-section">
          <span className="new-config-title">New Configuration</span>
          <div className="field-row">
            <NumberStepper label="Threshold" value={threshold} min={2} max={totalShares} onChange={setThreshold} />
            <div className="divider-text">/</div>
            <NumberStepper
              label="Total Shares"
              value={totalShares}
              min={3}
              max={10}
              onChange={(next) => {
                setTotalShares(next);
                if (threshold > next) setThreshold(next);
              }}
            />
          </div>
          <span className="help">
            Any {threshold} of {totalShares} shares can sign — min threshold is 2, min shares is 3
          </span>
        </div>

        {/*
          Validate & Continue button — remains in disabled visual state per
          VAL-RTK-001 because only 1 of 2 required source shares have been
          collected. The disabled pseudo-class on .button-primary supplies the
          `bg-[#2563EB40]` + 40% text opacity tokens quoted in the contract.
          Clicking still advances to /rotate-keyset/review for demo
          click-through (the real protocol would enforce the gate).
        */}
        <Button
          type="button"
          size="full"
          aria-disabled="true"
          className="button-disabled-visual bg-[#2563EB40]"
          onClick={() => navigate("/rotate-keyset/review")}
        >
          Validate &amp; Continue
        </Button>

        {/* ---- Info callout ---- */}
        <div className="info-callout">
          <span className="info-callout-icon">
            <Info size={14} />
          </span>
          <div className="info-callout-body">
            <span className="info-callout-title">All shares change, group key stays the same</span>
            <p className="info-callout-copy">
              Rotation replaces all device shares for the same group public key. Next, create this device's local profile by setting its name, password, relays, and peer permissions before adoption.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Review & Generate Screen
   ========================================================== */

export function ReviewGenerateScreen() {
  const navigate = useNavigate();
  const demoUi = useDemoUi();
  const presetPassword = demoUi.rotateKeyset?.passwordPreset ?? "";
  const [distPassword, setDistPassword] = useState(presetPassword);
  const [confirmPassword, setConfirmPassword] = useState(presetPassword);

  const passwordsMatch = distPassword.length > 0 && distPassword === confirmPassword;

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset")} />
        <PageHeading
          title="Review & Generate"
          copy="This is the irreversible step in keyset rotation. Confirm the distribution password, then generate fresh device shares for the same group public key."
        />

        {/* ---- Amber warning callout ---- */}
        <div className="amber-warning-callout">
          <AlertTriangle size={24} className="amber-warning-icon" />
          <div className="amber-warning-body">
            <span className="amber-warning-title">Before generating fresh shares</span>
            <p className="amber-warning-copy">
              This will reconstruct the existing signing key from threshold bfshare sources, split it into fresh shares for the same group public key, replace the current local source profile, and prepare remote bfonboard packages that other devices must adopt.
            </p>
          </div>
        </div>

        {/* ---- Distribution Password section ---- */}
        <div className="dist-password-section">
          <span className="dist-password-heading">Distribution Password</span>
          <span className="dist-password-help">Set a password for the remote bfonboard packages.</span>
          <div className="field-row">
            <PasswordField
              label="Password"
              value={distPassword}
              onChange={(e) => setDistPassword(e.target.value)}
              placeholder="Enter password"
            />
            <PasswordField
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              checked={passwordsMatch}
            />
          </div>
        </div>

        {/* ---- Red action button ---- */}
        <button
          type="button"
          className="button button-full rotate-generate-btn"
          onClick={() => navigate("/rotate-keyset/progress")}
        >
          Rotate &amp; Generate Keyset
        </button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Rotation Generation Progress Screen (4 phases)
   ========================================================== */

interface RotatePhase {
  label: string;
  state: "done" | "active" | "pending";
}

const ROTATE_INITIAL_PHASES: RotatePhase[] = [
  { label: "Process Source Shares", state: "active" },
  { label: "Recover Existing Key", state: "pending" },
  { label: "Generate Fresh Shares", state: "pending" },
  { label: "Prepare Rotated Shares", state: "pending" }
];

export function RotateGenerationProgressScreen() {
  const navigate = useNavigate();
  const demoUi = useDemoUi();
  const [phases, setPhases] = useState<RotatePhase[]>(() => seedRotatePhases(ROTATE_INITIAL_PHASES, demoUi.progress?.completedCount, demoUi.progress?.activeIndex));

  const doneCount = phases.filter((p) => p.state === "done").length;
  const allDone = phases.every((p) => p.state === "done");

  const advancePhase = useCallback(() => {
    setPhases((prev) => {
      const activeIdx = prev.findIndex((p) => p.state === "active");
      if (activeIdx === -1) return prev;
      return prev.map((p, i) => {
        if (i === activeIdx) return { ...p, state: "done" as const };
        if (i === activeIdx + 1) return { ...p, state: "active" as const };
        return p;
      });
    });
  }, []);

  useEffect(() => {
    if (demoUi.progress?.frozen) {
      return;
    }

    if (allDone) {
      const timer = window.setTimeout(() => {
        navigate("/rotate-keyset/profile", { replace: true });
      }, 600);
      return () => window.clearTimeout(timer);
    }

    const hasActive = phases.some((p) => p.state === "active");
    if (hasActive) {
      const timer = window.setTimeout(advancePhase, 800);
      return () => window.clearTimeout(timer);
    }
  }, [phases, allDone, navigate, advancePhase, demoUi.progress?.frozen]);

  const progressPercent = (doneCount / phases.length) * 100;

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset/review")} />
        <PageHeading
          title="Generation Progress"
          copy="Reconstructing the current keyset and preparing fresh shares for the same group public key."
        />

        <div className="generation-progress-card">
          {phases.map((phase) => (
            <div className={`generation-phase ${phase.state}`} key={phase.label}>
              <RotatePhaseDot state={phase.state} />
              <span className="generation-phase-label">{phase.label}</span>
              {phase.state === "done" && <span className="generation-phase-status">Done</span>}
              {phase.state === "active" && <span className="generation-phase-status">Processing...</span>}
            </div>
          ))}
        </div>

        <div className="progress-bar-section">
          <div className="progress-bar-header">
            <span className="progress-bar-title">Overall Progress</span>
            <span className="progress-bar-count">{doneCount} of {phases.length} phases</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function seedRotatePhases(phases: RotatePhase[], completedCount?: number, activeIndex?: number): RotatePhase[] {
  if (completedCount === undefined && activeIndex === undefined) {
    return phases;
  }
  const doneLimit = completedCount ?? 0;
  const active = activeIndex ?? doneLimit;
  return phases.map((phase, index) => ({
    ...phase,
    state: index < doneLimit ? "done" : index === active ? "active" : "pending"
  }));
}

function RotatePhaseDot({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="generation-phase-dot done">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="7.5" stroke="#4ADE80" strokeWidth="1.5" />
          <path d="M6.75 10.25L8.9 12.35L13.25 7.95" stroke="#4ADE80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return <span className="generation-phase-dot active" />;
  }
  return <span className="generation-phase-dot pending" />;
}

/* ==========================================================
   Error: Wrong Password Screen
   ========================================================== */

export function RotateWrongPasswordScreen() {
  const navigate = useNavigate();

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset")} />
        <PageHeading
          title="Source Share Error"
          copy="One or more bfshare source packages could not be validated. Check the details below and retry."
        />

        {/* ---- Failed source share card ---- */}
        <div className="rotate-error-card wrong-password">
          <div className="rotate-error-card-header">
            <span className="rotate-error-card-title">Source Share #2</span>
            <span className="rotate-error-badge failed">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="7" cy="7" r="5.5" stroke="#EF4444" strokeWidth="1.2" />
                <path d="M5 5l4 4M9 5l-4 4" stroke="#EF4444" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Failed
            </span>
          </div>

          <div className="rotate-error-field">
            <span className="rotate-error-field-mono">bfshare1qvz8k2afcqqszq...</span>
          </div>
          <div className="rotate-error-field">
            <span className="rotate-error-field-mono">••••••••</span>
          </div>

          {/* Red error banner */}
          <div className="rotate-error-banner red">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="7" cy="7" r="5.5" stroke="#EF4444" strokeWidth="1.2" />
              <path d="M7 4.5v3M7 9.5h.01" stroke="#EF4444" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>Wrong password. Unable to decrypt this bfshare source package.</span>
          </div>

          {/* Amber backup warning */}
          <div className="rotate-error-banner amber">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="7" cy="7" r="5.5" stroke="#FBBF24" strokeWidth="1.2" />
              <path d="M7 4.5v3M7 9.5h.01" stroke="#FBBF24" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>No encrypted backup found on relays for this share.</span>
          </div>
        </div>

        <Button type="button" size="full" onClick={() => navigate("/rotate-keyset")}>
          Retry
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Error: Group Mismatch Screen
   ========================================================== */

export function RotateGroupMismatchScreen() {
  const navigate = useNavigate();

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        {/*
          Per VAL-RTK-008 and the Paper reference, this error screen renders
          NO top BackLink — the only way out is the "Back to Source Intake"
          primary CTA at the bottom.
        */}
        <PageHeading
          title="Source Group Mismatch"
          copy="The source packages do not match the same current group configuration and group public key."
        />

        {/* ---- Mismatch card ---- */}
        <div className="rotate-error-card mismatch">
          <div className="rotate-mismatch-header">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="10" cy="10" r="8" stroke="#EF4444" strokeWidth="1.5" />
              <path d="M7 7l6 6M13 7l-6 6" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="rotate-mismatch-title">Sources belong to different groups</span>
          </div>

          <div className="rotate-mismatch-keys">
            <div className="rotate-mismatch-row">
              <span className="rotate-mismatch-label">Share #1 Group</span>
              <span className="rotate-mismatch-value blue">npub1qe3...7kkm</span>
            </div>
            <div className="rotate-mismatch-row last">
              <span className="rotate-mismatch-label">Share #2 Group</span>
              <span className="rotate-mismatch-value red">npub1x7f...2mnp</span>
            </div>
          </div>

          <p className="rotate-mismatch-help">
            All bfshare source packages must match the same current group configuration and group public key. Replace one source and retry.
          </p>
        </div>

        <Button type="button" size="full" onClick={() => navigate("/rotate-keyset")}>
          Back to Source Intake
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Error: Generation Failed Screen
   ========================================================== */

export function RotateGenerationFailedScreen() {
  const navigate = useNavigate();

  const failedPhases = [
    { label: "Decrypt sources", state: "done" as const },
    { label: "Recover current profiles", state: "done" as const },
    { label: "Verify same group config + group public key", state: "done" as const },
    { label: "Reconstruct signing key", state: "failed" as const }
  ];

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset")} />
        <PageHeading
          title="Generation Failed"
          copy="Share generation failed at the phase shown below. No shares were modified. You may safely retry."
        />

        {/* ---- Phase list with failed phase ---- */}
        <div className="generation-progress-card">
          {failedPhases.map((phase) => (
            <div className={`generation-phase ${phase.state}`} key={phase.label}>
              {phase.state === "done" ? (
                <span className="gen-failed-dot done">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="9" cy="9" r="7" fill="rgba(34,197,94,0.2)" stroke="#4ADE80" strokeWidth="1.2" />
                    <path d="M6 9l2 2 4-4" stroke="#4ADE80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : (
                <span className="gen-failed-dot failed">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="9" cy="9" r="7" fill="rgba(127,29,29,0.2)" stroke="#EF4444" strokeWidth="1.2" />
                    <path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="#EF4444" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </span>
              )}
              <span className="generation-phase-label">{phase.label}</span>
              {phase.state === "failed" && <span className="generation-phase-status">Failed</span>}
            </div>
          ))}
        </div>

        {/* ---- Green safety banner ---- */}
        <div className="rotate-safety-banner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" stroke="#4ADE80" strokeWidth="1.2" />
            <path d="M8 5v3M8 11h.01" stroke="#4ADE80" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span>No shares were modified. Your current configuration is intact.</span>
        </div>

        <Button type="button" size="full" onClick={() => navigate("/rotate-keyset/review")}>
          Retry Generation
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Rotate: Create Profile Screen (mock, shared-screen wrapper)
   ========================================================== */

const MOCK_ROTATE_MEMBERS = [
  { idx: 0, label: "Peer #0 (Local)" },
  { idx: 1, label: "Peer #1" },
  { idx: 2, label: "Peer #2" }
];

export function RotateCreateProfileScreen() {
  const navigate = useNavigate();
  const [deviceName, setDeviceName] = useState("Igloo Web");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [relays, setRelays] = useState(["wss://relay.primal.net", "wss://relay.damus.io"]);
  const [relayInput, setRelayInput] = useState("wss://");

  const confirmMatches = password.length > 0 && password === confirmPassword;

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={2} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset/progress")} />
        <PageHeading
          title="Create Profile"
          copy="Set the local profile name, password, relays, and peer permissions for the assigned share before distributing the remaining device packages."
        />

        <SectionHeader title="Profile Name" copy="A name for this profile to identify it in the peer list." />
        <TextField label="Profile Name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />

        <div className="assigned-share-card">
          <div className="assigned-share-head">
            <span className="check-disc">
              <Check size={15} />
            </span>
            <div>
              <div className="value">Assigned Local Share</div>
              <div className="help">The local share for this device is already assigned and ready for profile creation.</div>
            </div>
          </div>
          <div className="kv-row">
            <div>
              <div className="kicker">Local Share</div>
              <div className="value">Share #0, Encrypted</div>
            </div>
            <div>
              <div className="kicker">Keyset</div>
              <div className="value">{MOCK_SOURCE_SHARE_1.label}</div>
            </div>
          </div>
        </div>

        <div className="password-group">
          <SectionHeader title="Profile Password" copy="This password encrypts your profile on this device. You'll need it each time you unlock it." />
          <div className="profile-password-row">
            <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordField
              label="Confirm Password"
              value={confirmPassword}
              checked={confirmMatches}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>

        <SectionHeader title="Relays" />
        <div className="relay-list">
          {relays.map((relay, index) => (
            <div className="relay-row" key={relay}>
              <div className="relay-details">
                <span className="value">{relay}</span>
                {index === 0 ? <span className="relay-status">Connected - 24ms latency</span> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setRelays((cur) => cur.filter((r) => r !== relay))}
                aria-label={`Remove ${relay}`}
              >
                <X size={14} />
              </Button>
            </div>
          ))}
          <div className="relay-row relay-add-row">
            <span className="input-shell">
              <input className="input" value={relayInput} onChange={(e) => setRelayInput(e.target.value)} />
            </span>
            <Button
              type="button"
              className="relay-add-button"
              onClick={() => {
                const r = relayInput.trim();
                if (r && !relays.includes(r)) {
                  setRelays((cur) => [...cur, r]);
                  setRelayInput("wss://");
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <SectionHeader title="Peer Permissions" copy="Set default permissions for each peer. You can change these later in Settings." />
        <div className="permission-list">
          {MOCK_ROTATE_MEMBERS.map((member) => (
            <div className="permission-row" key={member.idx}>
              <div className="permission-main">
                <span className="value">{member.label}</span>
                {member.idx !== 0 ? <span className="help">02a3f8...8f2c</span> : null}
              </div>
              <div className="inline-actions">
                <PermissionBadge>SIGN</PermissionBadge>
                <PermissionBadge tone="info" muted={member.idx === 1}>ECDH</PermissionBadge>
                <PermissionBadge tone="ping" muted={member.idx === 2}>PING</PermissionBadge>
                <PermissionBadge tone="onboard" muted={member.idx === 0 || member.idx === 2}>ONBOARD</PermissionBadge>
              </div>
            </div>
          ))}
        </div>

        <Button type="button" size="full" onClick={() => navigate("/rotate-keyset/distribute")}>
          Continue to Distribute Shares
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Rotate: Distribute Shares Screen (mock, shared-screen wrapper)
   ========================================================== */

const MOCK_REMOTE_PACKAGES = [
  { idx: 1, memberPubkey: "03b7d2...a91e", packageText: "bfonboard1qxy7...mock", password: "rotate-pkg-1" },
  { idx: 2, memberPubkey: "02c4e8...f3b7", packageText: "bfonboard1qzw9...mock", password: "rotate-pkg-2" }
];

export function RotateDistributeSharesScreen() {
  const navigate = useNavigate();
  const [packageStates, setPackageStates] = useState(
    MOCK_REMOTE_PACKAGES.map((p) => ({ ...p, copied: false, qrShown: false }))
  );

  const updatePkg = (idx: number, patch: { copied?: boolean; qrShown?: boolean }) => {
    setPackageStates((prev) => prev.map((p) => (p.idx === idx ? { ...p, ...patch } : p)));
  };

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <section className="distribute-column">
        <Stepper current={3} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset/profile")} />
        <PageHeading
          title="Distribute Shares"
          copy="Distribute the remaining bfonboard adoption packages to remote devices. Recipient devices use the standard onboarding flow to paste or scan them."
        />

        {/* ---- Local share card ---- */}
        <div className="package-card saved">
          <div className="package-head">
            <div className="package-title-row">
              <div className="package-title">Share 1</div>
              <div className="package-index">Index 0</div>
            </div>
            <StatusPill tone="success" marker="check">
              Saved to Igloo Web
            </StatusPill>
          </div>
          <SecretDisplay value="Saved securely in this browser" />
        </div>

        {/* ---- Remote package cards ---- */}
        <div className="package-stack">
          {packageStates.map((pkg) => {
            const distributed = pkg.copied || pkg.qrShown;
            return (
              <div className="package-card" key={pkg.idx}>
                <div className="package-head">
                  <div className="package-title-row">
                    <div className="package-title">Share {pkg.idx + 1}</div>
                    <div className="package-index">Index {pkg.idx}</div>
                  </div>
                  <StatusPill tone={distributed ? "success" : "warning"}>
                    {distributed ? "Distributed" : "Not distributed"}
                  </StatusPill>
                </div>
                <div className="help">Member {pkg.memberPubkey}</div>
                <CopyBlock value={pkg.packageText} onCopied={() => updatePkg(pkg.idx, { copied: true })} />
                <div className="field">
                  <span className="kicker">Package Password</span>
                  <div className="password-lock-row">
                    <SecretDisplay value={pkg.password} masked title="Package password" />
                    <Lock size={14} color="#64748b" />
                  </div>
                </div>
                <div className="package-actions">
                  <QrButton value={pkg.packageText} onShown={() => updatePkg(pkg.idx, { qrShown: true })} />
                </div>
              </div>
            );
          })}
        </div>

        <Button type="button" size="full" onClick={() => navigate("/rotate-keyset/complete")}>
          Continue to Completion
        </Button>
      </section>
    </AppShell>
  );
}

/* ==========================================================
   Rotate: Distribution Complete Screen (mock, shared-screen wrapper)
   ========================================================== */

export function RotateDistributionCompleteScreen() {
  const navigate = useNavigate();
  const { activeProfile } = useAppState();
  const [pkgStates] = useState(
    MOCK_REMOTE_PACKAGES.map((p) => ({ ...p, copied: true, qrShown: false }))
  );

  const accounted = pkgStates.filter((p) => p.copied || p.qrShown).length;
  const total = pkgStates.length;
  const complete = accounted === total;

  const handleFinish = () => {
    if (activeProfile) {
      navigate(`/dashboard/${activeProfile.id}`);
    } else {
      navigate("/");
    }
  };

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <section className="screen-column">
        <Stepper current={3} variant="rotate-keyset" />
        <BackLink onClick={() => navigate("/rotate-keyset/distribute")} />
        <PageHeading
          title="Distribution Completion"
          copy="Track which remote bfonboard adoption packages have been distributed. Finish when each target device is ready to adopt its fresh share through the standard onboarding flow."
        />

        <div className="completion-card">
          <div className="kicker">Distribution Status</div>
          <div className="completion-list">
            {pkgStates.map((pkg) => {
              const distributed = pkg.copied || pkg.qrShown;
              return (
                <div className="completion-row" key={pkg.idx}>
                  <div className="completion-main">
                    <span className={`completion-check ${distributed ? "" : "pending"}`}>
                      <Check size={13} />
                    </span>
                    <span>
                      <span className="value">Member #{pkg.idx + 1} - Igloo Device</span>
                      <span className="help">New Device</span>
                    </span>
                  </div>
                  <div className="inline-actions">
                    {pkg.copied ? <span className="completion-status-ok">Copied</span> : null}
                    {pkg.qrShown ? <span className="completion-status-ok">QR shown</span> : null}
                    {!distributed ? <span className="help">Pending</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="success-callout">
          <strong>{complete ? "All packages distributed" : "Distribution can continue"}</strong>
          <span>
            {accounted} of {total} remote bfonboard packages have been accounted for. Continue when device adoption handoff can proceed.
          </span>
        </div>

        <Button type="button" size="full" onClick={handleFinish}>
          Finish Distribution
        </Button>
      </section>
    </AppShell>
  );
}
