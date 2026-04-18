import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "../components/shell";
import { PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";

/* ---------- Mock data for the review screen ---------- */

const MOCK_REVIEW_DATA = {
  groupName: "My Signing Key",
  threshold: "2 of 3",
  shareKey: "#1 (Index 1)",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  peerPolicies: "3 configured",
  backupCreated: "Mar 8, 2026"
};

/* ---------- Validation helpers ---------- */

function validateBackupString(value: string): { valid: boolean; message: string } {
  if (!value.trim()) {
    return { valid: false, message: "" };
  }
  if (value.trim().startsWith("bfprofile1")) {
    return {
      valid: true,
      message: `Valid backup — Group: ${MOCK_REVIEW_DATA.groupName} (${MOCK_REVIEW_DATA.threshold}) · Share ${MOCK_REVIEW_DATA.shareKey}`
    };
  }
  return {
    valid: false,
    message: "Invalid backup — String must begin with bfprofile1 prefix."
  };
}

/* ==========================================================
   Screen 1 — Load Backup (/import)
   ========================================================== */

export function LoadBackupScreen() {
  const navigate = useNavigate();
  const [backupString, setBackupString] = useState("");
  const validation = validateBackupString(backupString);

  function handleContinue() {
    if (!validation.valid) return;
    navigate("/import/decrypt", { state: { backupString: backupString.trim() } });
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/")} />
        <PageHeading
          title="Load Backup"
          copy="Load a bfprofile1 device profile backup from text or file to continue."
        />

        <div className="field">
          <label className="label" htmlFor="backup-input">
            Profile Backup
          </label>
          <p className="help">Paste a bfprofile1... backup string or upload a backup file.</p>
          <textarea
            id="backup-input"
            className="input import-textarea"
            placeholder="bfprofile1..."
            value={backupString}
            onChange={(e) => setBackupString(e.target.value)}
            rows={3}
          />
          <button type="button" className="button button-ghost button-md import-upload-btn">
            Upload Backup File
          </button>
          {validation.message && (
            <span className={validation.valid ? "import-validation-ok" : "import-validation-error"}>
              {validation.message}
            </span>
          )}
        </div>

        <Button type="button" size="full" disabled={!validation.valid} onClick={handleContinue}>
          Continue
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Decrypt Backup (/import/decrypt)
   ========================================================== */

export function DecryptBackupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const backupString = (location.state as { backupString?: string } | null)?.backupString ?? "";
  const [password, setPassword] = useState("");

  /* Guard: redirect if no backup loaded */
  if (!backupString) {
    return <Navigate to="/import" replace />;
  }

  const validation = validateBackupString(backupString);

  function handleDecrypt() {
    if (!password.trim()) return;
    /* Mock: navigate to review on success, or error if password is "wrong" */
    if (password === "wrong") {
      navigate("/import/error", { state: { backupString } });
    } else {
      navigate("/import/review", { state: { backupString, password } });
    }
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/import")} />
        <PageHeading
          title="Decrypt Backup"
          copy="Decrypt the loaded bfprofile1 backup using its backup password."
        />

        <div className="field">
          <span className="label">Profile Backup</span>
          <div className="import-backup-display">
            <span className="import-backup-text">{truncate(backupString, 60)}</span>
          </div>
          {validation.valid && (
            <span className="import-validation-ok">{validation.message}</span>
          )}
        </div>

        <div className="import-divider" />

        <PasswordField
          label="Backup Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter backup password"
        />

        <Button type="button" size="full" onClick={handleDecrypt}>
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
  const state = location.state as { backupString?: string; password?: string } | null;
  const [profilePassword, setProfilePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  /* Guard: redirect if no prior decrypt step */
  if (!state?.backupString) {
    return <Navigate to="/import" replace />;
  }

  const passwordsMatch = profilePassword.length > 0 && profilePassword === confirmPassword;

  function handleImport() {
    /* Mock: navigate to welcome (simulating saved profile) */
    navigate("/");
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/import/decrypt", { state: { backupString: state.backupString } })} />
        <PageHeading
          title="Review & Save Profile"
          copy="Review the imported profile and set a local password before launching the signer."
        />

        {/* Group Profile card */}
        <div className="import-review-card">
          <div className="import-review-card-header">Group Profile</div>
          <div className="import-review-row">
            <span className="import-review-label">Keyset Name</span>
            <span className="import-review-value">{MOCK_REVIEW_DATA.groupName}</span>
          </div>
          <div className="import-review-row">
            <span className="import-review-label">Threshold</span>
            <span className="import-review-value">{MOCK_REVIEW_DATA.threshold}</span>
          </div>
        </div>

        {/* Device Profile card */}
        <div className="import-review-card">
          <div className="import-review-card-header">Device Profile</div>
          <div className="import-review-row">
            <span className="import-review-label">Share Key</span>
            <span className="import-review-value">{MOCK_REVIEW_DATA.shareKey}</span>
          </div>
          <div className="import-review-row import-review-row-stacked">
            <span className="import-review-label">Relays</span>
            <span className="import-review-relays">
              {MOCK_REVIEW_DATA.relays.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </span>
          </div>
          <div className="import-review-row">
            <span className="import-review-label">Peer Policies</span>
            <span className="import-review-value">{MOCK_REVIEW_DATA.peerPolicies}</span>
          </div>
        </div>

        {/* Metadata bar */}
        <div className="import-meta-bar">
          <span className="import-meta-label">Import-specific meta stays outside the cards.</span>
          <span className="import-meta-value">Backup Created · {MOCK_REVIEW_DATA.backupCreated}</span>
        </div>

        <div className="import-divider" />

        {/* Password section */}
        <div className="import-password-section">
          <div className="import-password-header">
            <span className="section-title">Profile Password</span>
            <p className="help">
              This password encrypts your profile on this device. You'll need it each time you unlock it.
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

        <Button type="button" size="full" onClick={handleImport}>
          Import &amp; Launch Signer
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
  const backupString = (location.state as { backupString?: string } | null)?.backupString ?? "";

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/import")} />
        <PageHeading
          title="Import Error"
          copy="We couldn't import this profile backup. Resolve the issue below and try again."
        />

        <div className="import-error-alert">
          <div className="import-error-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="import-error-body">
            <div className="import-error-title">Incorrect Password</div>
            <div className="import-error-description">
              The password you entered could not decrypt this backup. Check the backup password and try again.
            </div>
          </div>
        </div>

        <div className="inline-actions">
          <Button type="button" onClick={() => navigate("/import/decrypt", { state: { backupString } })}>
            Try Again
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/import")}>
            Back to Import
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/* ---------- Helpers ---------- */

function truncate(str: string, len: number) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}


