import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import { SetupFlowError, useAppState } from "../../app/AppState";
import { AppShell, PageHeading } from "../../components/shell";
import { BackLink, PasswordField, Stepper } from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
import { MOCK_SOURCE_SHARE_1 } from "./mocks";
import { navigateWithRotateState, rotatePhaseAtLeast } from "./utils";

export function ReviewGenerateScreen() {
  const navigate = useNavigate();
  const { rotateKeysetSession, generateRotatedKeyset } = useAppState();
  const demoUi = useDemoUi();
  const demoReview = Boolean(demoUi.rotateKeyset?.passwordPreset);
  const presetPassword = demoUi.rotateKeyset?.passwordPreset ?? "";
  const [distPassword, setDistPassword] = useState(presetPassword);
  const [confirmPassword, setConfirmPassword] = useState(presetPassword);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const passwordsMatch = distPassword.length > 0 && distPassword === confirmPassword;
  const routeState = rotateKeysetSession ? { profileId: rotateKeysetSession.sourceProfile.id } : undefined;

  if (!rotatePhaseAtLeast(rotateKeysetSession, "sources_validated") && !demoReview) {
    return <Navigate to="/rotate-keyset" replace />;
  }

  async function handleGenerate() {
    if (!rotateKeysetSession) {
      navigateWithRotateState(navigate, "/rotate-keyset/progress", routeState);
      return;
    }
    if (!generateRotatedKeyset) {
      setError("Rotate keyset generation is unavailable in this session.");
      return;
    }
    if (!passwordsMatch) {
      setError("Distribution passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await generateRotatedKeyset(distPassword);
      navigateWithRotateState(navigate, "/rotate-keyset/progress", routeState);
    } catch (err) {
      if (err instanceof SetupFlowError && err.code === "generation_failed") {
        navigateWithRotateState(navigate, "/rotate-keyset/error-failed", routeState);
        return;
      }
      setError(err instanceof Error ? err.message : "Unable to rotate this keyset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell headerMeta={rotateKeysetSession?.sourceProfile.label ?? MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigateWithRotateState(navigate, "/rotate-keyset", routeState)} />
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

	        {rotateKeysetSession?.sourcePayload ? (
	          <div className="info-callout">
	            <span className="info-callout-icon">
	              <Info size={14} />
	            </span>
	            <div className="info-callout-body">
	              <span className="info-callout-title">Group public key will be preserved</span>
	              <p className="info-callout-copy">
	                {rotateKeysetSession.sourcePayload.group_package.group_pk.slice(0, 12)}...
	                {rotateKeysetSession.sourcePayload.group_package.group_pk.slice(-6)}
	              </p>
	            </div>
	          </div>
	        ) : null}

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
          disabled={busy || !passwordsMatch}
          onClick={() => void handleGenerate()}
        >
          {busy ? "Generating..." : "Rotate & Generate Keyset"}
        </button>
        {error ? <div className="error">{error}</div> : null}
      </div>
    </AppShell>
  );
}
