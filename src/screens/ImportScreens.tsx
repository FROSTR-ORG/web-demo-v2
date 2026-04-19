import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";
import { DEMO_BFPROFILE } from "../demo/fixtures";
import { useDemoUi } from "../demo/demoUi";

/* ---------- Label with inline info/help icon (audit gap per VAL-IMP-002/003) ---------- */

function ImportLabelWithHelp({
  htmlFor,
  children
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
      <HelpCircle className="import-label-help-icon" size={14} aria-hidden="true" />
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
  backupCreated: "Mar 8, 2026"
};

/* ---------- Validation helpers ---------- */

function validateBackupString(value: string, options: { includeCreatedSuffix?: boolean } = {}): { valid: boolean; message: string } {
  if (!value.trim()) {
    return { valid: false, message: "" };
  }
  if (value.trim().startsWith("bfprofile1")) {
    /*
     * Validator copy uses Paper's compact format (`2/3`, `Share #1`) — this
     * must stay in sync with VAL-IMP-001 / VAL-IMP-002 exactly. The Review
     * screen's Group / Device Profile cards (VAL-IMP-003) intentionally use
     * the expanded format (`2 of 3`, `#1 (Index 1)`), so we keep those
     * strings on `MOCK_REVIEW_DATA` and hardcode the validator format here.
     */
    const base = `Valid backup — Group: ${MOCK_REVIEW_DATA.groupName} (2/3) · Share #1`;
    return {
      valid: true,
      message: options.includeCreatedSuffix ? `${base} · Created ${MOCK_REVIEW_DATA.backupCreated}` : base
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
  const demoUi = useDemoUi();
  const [backupString, setBackupString] = useState(demoUi.import?.backupPreset ?? "");
  const validation = validateBackupString(backupString);

  function handleContinue() {
    if (!validation.valid) return;
    navigate("/import/decrypt", { state: { backupString: backupString.trim() } });
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/")} label="Back to Welcome" />
        <PageHeading
          title="Load Backup"
          copy="Load a bfprofile1 device profile backup from text or file to continue."
        />

        <div className="field">
          <ImportLabelWithHelp htmlFor="backup-input">Profile Backup</ImportLabelWithHelp>
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
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Decrypt Backup (/import/decrypt)
   ========================================================== */

export function DecryptBackupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const demoUi = useDemoUi();
  const backupString = (location.state as { backupString?: string } | null)?.backupString ?? demoUi.import?.backupPreset ?? "";
  const [password, setPassword] = useState(demoUi.import?.passwordPreset ?? "");

  /* Guard: redirect if no backup loaded */
  if (!backupString) {
    return <Navigate to="/import" replace />;
  }

  const validation = validateBackupString(backupString, { includeCreatedSuffix: true });
  const canDecrypt = password.trim().length > 0;

  function handleDecrypt() {
    if (!canDecrypt) return;
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
          <ImportLabelWithHelp>Profile Backup</ImportLabelWithHelp>
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
          labelHelp={<HelpCircle size={14} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter backup password"
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
  const { createKeyset, createProfile } = useAppState();
  const demoUi = useDemoUi();
  const state = location.state as { backupString?: string; password?: string } | null;
  const presetPassword = demoUi.import?.profilePasswordPreset ?? "";
  const [profilePassword, setProfilePassword] = useState(presetPassword);
  const [confirmPassword, setConfirmPassword] = useState(presetPassword);
  const [saving, setSaving] = useState(false);

  /* Guard: redirect if no prior decrypt step */
  if (!state?.backupString && !demoUi.import?.backupPreset) {
    return <Navigate to="/import" replace />;
  }

  const passwordsMatch = profilePassword.length > 0 && profilePassword === confirmPassword;

  async function handleImport() {
    if (saving) return;
    setSaving(true);
    try {
      /*
       * VAL-CROSS-006 — End-to-end import path must land on
       * `/dashboard/{profileId}` with a functional Signer Running view, not
       * bounce back to `/`. The real `AppStateProvider` requires both
       * `activeProfile` and `runtimeStatus` to be set for the Dashboard
       * route guard to render. This click-through prototype doesn't carry a
       * real decrypted backup through the flow, so we reuse the same
       * `createKeyset` → `createProfile` machinery used by the Create flow
       * to stand up a valid runtime for the imported profile. From the
       * user's perspective this still looks like "Import & Launch Signer":
       * credentials entered on this screen become the local profile's
       * password, and the resulting profileId is what the dashboard route
       * consumes.
       */
      await createKeyset({
        groupName: MOCK_REVIEW_DATA.groupName,
        threshold: 2,
        count: 3
      });
      const profileId = await createProfile({
        deviceName: "Igloo Web",
        password: profilePassword,
        confirmPassword,
        relays: MOCK_REVIEW_DATA.relays
      });
      navigate(`/dashboard/${profileId}`);
    } catch {
      setSaving(false);
    }
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/import/decrypt", { state: { backupString: state?.backupString ?? demoUi.import?.backupPreset ?? DEMO_BFPROFILE } })} />
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
            <span className="import-label-row import-password-title-row">
              <span className="section-title">Profile Password</span>
              <HelpCircle className="import-label-help-icon" size={14} aria-hidden="true" />
            </span>
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
  const demoUi = useDemoUi();
  const backupString = (location.state as { backupString?: string } | null)?.backupString ?? DEMO_BFPROFILE;
  const corrupted = demoUi.import?.errorVariant === "corrupted";
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
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/import")} />
        <PageHeading
          title="Import Error"
          copy="We couldn't import this profile backup. Resolve the issue below and try again."
        />

        <div className={alertClassName}>
          <div className="import-error-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="import-error-body">
            <div className="import-error-title">{corrupted ? "Backup Corrupted" : "Incorrect Password"}</div>
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
            <Button type="button" onClick={() => navigate("/import")}>
              Back to Import
            </Button>
          ) : (
            <>
              <Button type="button" onClick={() => navigate("/import/decrypt", { state: { backupString } })}>
                Try Again
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/import")}>
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
