import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Info } from "lucide-react";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, NumberStepper, PasswordField, Stepper } from "../components/ui";

/* ---------- Mock data for source share cards ---------- */

const MOCK_SOURCE_SHARE_1 = {
  label: "My Signing Key",
  deviceName: "Igloo Web",
  sharePubkey: "02a3f8...8f2c",
  profileId: "prof_8f2c4a",
  relays: 3
};

/* ==========================================================
   Rotate Keyset Form Screen
   ========================================================== */

export function RotateKeysetFormScreen() {
  const navigate = useNavigate();
  const [bfshare, setBfshare] = useState("");
  const [pkgPassword, setPkgPassword] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [totalShares, setTotalShares] = useState(3);

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
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
            <div className="source-share-value validated">{MOCK_SOURCE_SHARE_1.label}</div>
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">Profile Password</span>
            <div className="source-share-value validated">••••••••</div>
          </div>
          <div className="source-share-details">
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Device Name</span>
              <span className="source-share-detail-val">{MOCK_SOURCE_SHARE_1.deviceName}</span>
            </div>
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Share Public Key</span>
              <span className="source-share-detail-val">{MOCK_SOURCE_SHARE_1.sharePubkey}</span>
            </div>
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Profile ID</span>
              <span className="source-share-detail-val">{MOCK_SOURCE_SHARE_1.profileId}</span>
            </div>
            <div className="source-share-detail-row">
              <span className="source-share-detail-key">Relays</span>
              <span className="source-share-detail-val">{MOCK_SOURCE_SHARE_1.relays} configured</span>
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

        {/* ---- Validate & Continue button ---- */}
        <Button
          type="button"
          size="full"
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
  const [distPassword, setDistPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
