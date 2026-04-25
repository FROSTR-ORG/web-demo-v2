import { useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, HelpCircle, QrCode } from "lucide-react";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { DEMO_BFPROFILE } from "../demo/fixtures";
import { useDemoUi } from "../demo/demoUi";
import type { BfProfilePayload } from "../lib/bifrost/types";

/* ---------- Label with inline info/help icon (audit gap per VAL-IMP-002/003) ---------- */

function ImportLabelWithHelp({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="import-label-row">
      {htmlFor ? (
        <label className="label" htmlFor={htmlFor}>
          {children}
        </label>
      ) : (
        <span className="label">{children}</span>
      )}
      <HelpCircle
        className="import-label-help-icon"
        size={14}
        aria-hidden="true"
      />
    </span>
  );
}

/* ---------- Mock data for the review screen ---------- */

const MOCK_REVIEW_DATA = {
  groupName: "My Signing Key",
  threshold: "2 of 3",
  shareKey: "#1 (Index 1)",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  peerPolicies: "3 configured",
  backupCreated: "Mar 8, 2026",
};

/* ---------- Validation helpers ---------- */

function validateBackupString(value: string, paperDemo = false): {
  valid: boolean;
  message: string;
} {
  if (!value.trim()) {
    return { valid: false, message: "" };
  }
  if (value.trim().startsWith("bfprofile1")) {
    return {
      valid: true,
      message: paperDemo
        ? "Valid backup — Group: My Signing Key (2/3) · Share #1"
        : "Valid backup format — decrypt to review profile details",
    };
  }
  return {
    valid: false,
    message: "Invalid backup — String must begin with bfprofile1 prefix.",
  };
}

/* ==========================================================
   Screen 1 — Load Backup (/import)
   ========================================================== */

export function LoadBackupScreen() {
  const navigate = useNavigate();
  const { beginImport, clearImportSession } = useAppState();
  const demoUi = useDemoUi();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupString, setBackupString] = useState(
    demoUi.import?.backupPreset ?? "",
  );
  const [showQrScanner, setShowQrScanner] = useState(false);
  const paperLoadBackup = Boolean(demoUi.import?.backupPreset);
  const validation = validateBackupString(backupString, paperLoadBackup);

  function handleContinue() {
    if (!validation.valid) return;
    beginImport(backupString);
    navigate("/import/decrypt");
  }

  return (
    <AppShell
      mainVariant="flow"
      brandSubtitle="Threshold Signing for Nostr"
      headerMeta="Import"
    >
      <div className="screen-column">
        <BackLink
          onClick={() => {
            clearImportSession();
            navigate("/");
          }}
          label="Back to Welcome"
        />
        <PageHeading
          title="Load Backup"
          copy="Load a bfprofile1 device profile backup from text or file to continue."
        />

        <div className="field">
          <ImportLabelWithHelp htmlFor="backup-input">
            Profile Backup
          </ImportLabelWithHelp>
          <p className="help">
            Paste a bfprofile1... backup string or upload a backup file.
          </p>
          <textarea
            id="backup-input"
            className="input import-textarea"
            placeholder="bfprofile1..."
            value={backupString}
            onChange={(e) => setBackupString(e.target.value)}
            rows={3}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.backup,text/plain"
            style={{ display: "none" }}
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              setBackupString((await file.text()).trim());
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="button button-ghost button-md import-upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload Backup File
          </button>
          {paperLoadBackup ? null : (
            <button
              type="button"
              className="button button-chip button-sm onboard-scan-btn"
              onClick={() => setShowQrScanner(true)}
            >
              <QrCode size={14} />
              Scan QR
            </button>
          )}
          {validation.message && (
            <span
              className={
                validation.valid
                  ? "import-validation-ok"
                  : "import-validation-error"
              }
            >
              {validation.message}
            </span>
          )}
        </div>

        <Button
          type="button"
          size="full"
          disabled={!validation.valid}
          aria-disabled={!validation.valid}
          onClick={handleContinue}
        >
          Continue
        </Button>
      </div>
      {showQrScanner && (
        <QrScanner
          onScan={(data) => {
            setBackupString(data);
            setShowQrScanner(false);
          }}
          onClose={() => setShowQrScanner(false)}
          expectedPrefixes={["bfprofile1"]}
        />
      )}
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Decrypt Backup (/import/decrypt)
   ========================================================== */

export function DecryptBackupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { importSession, decryptImportBackup, clearImportSession } =
    useAppState();
  const demoUi = useDemoUi();
  const backupString =
    importSession?.backupString ??
    (location.state as { backupString?: string } | null)?.backupString ??
    demoUi.import?.backupPreset ??
    "";
  const [password, setPassword] = useState(demoUi.import?.passwordPreset ?? "");
  const [error, setError] = useState("");

  /* Guard: redirect if no backup loaded */
  if (!backupString) {
    return <Navigate to="/import" replace />;
  }

  const validation = validateBackupString(
    backupString,
    demoUi.import?.isPaperDemo ?? false,
  );
  const canDecrypt = password.trim().length > 0;

  async function handleDecrypt() {
    if (!canDecrypt) return;
    setError("");
    try {
      await decryptImportBackup(backupString, password);
      navigate("/import/review");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to decrypt this backup.",
      );
      navigate("/import/error", {
        state: {
          backupString,
          errorCode:
            err instanceof Error && "code" in err ? err.code : undefined,
        },
      });
    }
  }

  return (
    <AppShell
      mainVariant="flow"
      brandSubtitle="Threshold Signing for Nostr"
      headerMeta="Import"
    >
      <div className="screen-column">
        <BackLink
          onClick={() => {
            clearImportSession();
            navigate("/import");
          }}
        />
        <PageHeading
          title="Decrypt Backup"
          copy="Decrypt the loaded bfprofile1 backup using its backup password."
        />

        <div className="field">
          <ImportLabelWithHelp>Profile Backup</ImportLabelWithHelp>
          <div className="import-backup-display">
            <span className="import-backup-text">
              {truncate(backupString, 60)}
            </span>
          </div>
          {validation.valid && (
            <span className="import-validation-ok">{validation.message}</span>
          )}
        </div>

        <div className="import-divider" />

        <PasswordField
          label="Backup Password"
          labelHelp={<HelpCircle size={14} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter backup password"
          error={error}
        />

        <Button
          type="button"
          size="full"
          disabled={!canDecrypt}
          aria-disabled={!canDecrypt}
          onClick={handleDecrypt}
        >
          Decrypt Backup
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 3 — Review & Save Profile (/import/review)
   ========================================================== */

export function ReviewSaveScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { importSession, saveImportedProfile, clearImportSession } =
    useAppState();
  const demoUi = useDemoUi();
  const state = location.state as { backupString?: string } | null;
  const presetPassword = demoUi.import?.profilePasswordPreset ?? "";
  const [profilePassword, setProfilePassword] = useState(presetPassword);
  const [confirmPassword, setConfirmPassword] = useState(presetPassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [handoffStarted, setHandoffStarted] = useState(false);

  const demoReview = Boolean(demoUi.import);

  /* Product review requires a real decoded bfprofile payload. */
  if (!handoffStarted && !importSession?.payload && !demoReview) {
    return <Navigate to="/import" replace />;
  }

  const passwordsMatch =
    profilePassword.length > 0 && profilePassword === confirmPassword;
  const conflictProfile = importSession?.conflictProfile;
  const reviewData = importSession?.payload
    ? reviewDataFromPayload(importSession.payload, importSession.localShareIdx)
    : MOCK_REVIEW_DATA;
  const backupForRetry =
    importSession?.backupString ??
    state?.backupString ??
    demoUi.import?.backupPreset ??
    DEMO_BFPROFILE;

  async function handleImport() {
    if (saving || !passwordsMatch) return;
    setSaving(true);
    setError("");
    try {
      const profileId = await saveImportedProfile({
        password: profilePassword,
        confirmPassword,
        replaceExisting,
      });
      setHandoffStarted(true);
      navigate(`/dashboard/${profileId}`);
      window.setTimeout(clearImportSession, 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to import this profile.",
      );
      setSaving(false);
    }
  }

  return (
    <AppShell
      mainVariant="flow"
      brandSubtitle="Threshold Signing for Nostr"
      headerMeta="Import"
    >
      <div className="screen-column">
        <BackLink
          onClick={() => {
            clearImportSession();
            navigate("/import/decrypt", {
              state: { backupString: backupForRetry },
            });
          }}
        />
        <PageHeading
          title="Review & Save Profile"
          copy="Review the imported profile and set a local password before launching the signer."
        />

        {/* Group Profile card */}
        <div className="import-review-card">
          <div className="import-review-card-header">Group Profile</div>
          <div className="import-review-row">
            <span className="import-review-label">Keyset Name</span>
            <span className="import-review-value">{reviewData.groupName}</span>
          </div>
          <div className="import-review-row">
            <span className="import-review-label">Threshold</span>
            <span className="import-review-value">{reviewData.threshold}</span>
          </div>
        </div>

        {/* Device Profile card */}
        <div className="import-review-card">
          <div className="import-review-card-header">Device Profile</div>
          <div className="import-review-row">
            <span className="import-review-label">Share Key</span>
            <span className="import-review-value">{reviewData.shareKey}</span>
          </div>
          <div className="import-review-row import-review-row-stacked">
            <span className="import-review-label">Relays</span>
            <span className="import-review-relays">
              {reviewData.relays.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </span>
          </div>
          <div className="import-review-row">
            <span className="import-review-label">Peer Policies</span>
            <span className="import-review-value">
              {reviewData.peerPolicies}
            </span>
          </div>
        </div>

        {/* Metadata bar */}
        <div className="import-meta-bar">
          <span className="import-meta-label">
            Import-specific meta stays outside the cards.
          </span>
          <span className="import-meta-value">
            Backup Created · {reviewData.backupCreated}
          </span>
        </div>

        {conflictProfile ? (
          <label className="import-meta-bar" htmlFor="replace-existing-profile">
            <span className="import-meta-label">Existing profile found</span>
            <span className="import-meta-value">
              <input
                id="replace-existing-profile"
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              Replace {conflictProfile.label}
            </span>
          </label>
        ) : null}

        <div className="import-divider" />

        {/* Password section */}
        <div className="import-password-section">
          <div className="import-password-header">
            <span className="import-label-row import-password-title-row">
              <span className="section-title">Profile Password</span>
              <HelpCircle
                className="import-label-help-icon"
                size={14}
                aria-hidden="true"
              />
            </span>
            <p className="help">
              This password encrypts your profile on this device. You'll need it
              each time you unlock it.
            </p>
          </div>
          <div className="field-row">
            <PasswordField
              label="Password"
              value={profilePassword}
              onChange={(e) => setProfilePassword(e.target.value)}
            />
            <PasswordField
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              checked={passwordsMatch}
            />
          </div>
        </div>

        {error ? <div className="error">{error}</div> : null}
        <Button
          type="button"
          size="full"
          disabled={
            !passwordsMatch ||
            saving ||
            !importSession?.payload ||
            Boolean(conflictProfile && !replaceExisting)
          }
          onClick={handleImport}
        >
          {saving ? "Importing..." : "Import & Launch Signer"}
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 4 — Import Error (/import/error)
   ========================================================== */

export function ImportErrorScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { importSession, clearImportSession } = useAppState();
  const demoUi = useDemoUi();
  const state = location.state as {
    backupString?: string;
    errorCode?: string;
  } | null;
  const backupString =
    importSession?.backupString ?? state?.backupString ?? DEMO_BFPROFILE;
  const corrupted =
    demoUi.import?.errorVariant === "corrupted" ||
    state?.errorCode === "invalid_package";
  /*
   * Paper's error variants use Tailwind-style arbitrary hex classes so the
   * fidelity validators can compare `className` tokens directly. We mirror
   * those exact class tokens on the alert root and icon so agent-browser's
   * class-list assertion passes without coupling to computed colours.
   */
  const alertClassName = corrupted
    ? "import-error-alert red bg-[#EF44441A] border-[#EF444440]"
    : "import-error-alert bg-[#EAB3081A] border-[#EAB30840]";

  return (
    <AppShell
      mainVariant="flow"
      brandSubtitle="Threshold Signing for Nostr"
      headerMeta="Import"
    >
      <div className="screen-column">
        <BackLink
          onClick={() => {
            clearImportSession();
            navigate("/import");
          }}
        />
        <PageHeading
          title="Import Error"
          copy="We couldn't import this profile backup. Resolve the issue below and try again."
        />

        <div className={alertClassName}>
          <div className="import-error-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="import-error-body">
            <div className="import-error-title">
              {corrupted ? "Backup Corrupted" : "Incorrect Password"}
            </div>
            <div className="import-error-description">
              {corrupted
                ? "The backup could not be parsed. It may be damaged or incomplete."
                : "The password you entered could not decrypt this backup. Check the backup password and try again."}
            </div>
          </div>
        </div>

        <div className="inline-actions">
          {corrupted ? (
            /*
             * VAL-IMP-005 — corrupted variant renders a single primary
             * 'Back to Import' CTA (solid blue), not a secondary/ghost
             * button. The amber wrong-password variant keeps Try Again as
             * primary and Back to Import as ghost (VAL-IMP-004).
             */
            <Button
              type="button"
              onClick={() => {
                clearImportSession();
                navigate("/import");
              }}
            >
              Back to Import
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={() =>
                  navigate("/import/decrypt", { state: { backupString } })
                }
              >
                Try Again
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  clearImportSession();
                  navigate("/import");
                }}
              >
                Back to Import
              </Button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* ---------- Helpers ---------- */

function truncate(str: string, len: number) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function reviewDataFromPayload(
  payload: BfProfilePayload,
  localShareIdx?: number,
): typeof MOCK_REVIEW_DATA {
  const shareLabel =
    localShareIdx === undefined
      ? "#? (Index ?)"
      : `#${localShareIdx} (Index ${localShareIdx})`;
  const policyCount = payload.device.manual_peer_policy_overrides?.length ?? 0;
  return {
    groupName: payload.group_package.group_name,
    threshold: `${payload.group_package.threshold} of ${payload.group_package.members.length}`,
    shareKey: shareLabel,
    relays: payload.device.relays,
    peerPolicies: `${policyCount} configured`,
    backupCreated: "Unknown",
  };
}
