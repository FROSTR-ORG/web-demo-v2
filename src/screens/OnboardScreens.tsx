import { useState, useEffect, useCallback } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, QrCode } from "lucide-react";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";

/* ---------- Mock data ---------- */

const MOCK_REVIEW_DATA = {
  groupName: "My Signing Key",
  threshold: "2 of 3",
  shareKey: "#1 (Index 1)",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  peerPolicies: "3 total"
};

/* ---------- Validation helpers ---------- */

function validatePackageString(value: string): { valid: boolean; message: string } {
  if (!value.trim()) {
    return { valid: false, message: "" };
  }
  if (value.trim().startsWith("bfonboard1")) {
    return {
      valid: true,
      message: `Valid package — Keyset: ${MOCK_REVIEW_DATA.groupName} (${MOCK_REVIEW_DATA.threshold}) · Share ${MOCK_REVIEW_DATA.shareKey}`
    };
  }
  return {
    valid: false,
    message: "Invalid package — String must begin with bfonboard1 prefix."
  };
}

/* ==========================================================
   Screen 1 — Enter Onboarding Package (/onboard)
   ========================================================== */

export function EnterPackageScreen() {
  const navigate = useNavigate();
  const [packageString, setPackageString] = useState("");
  const [password, setPassword] = useState("");
  const validation = validatePackageString(packageString);

  function handleBeginOnboarding() {
    if (!validation.valid) return;
    navigate("/onboard/handshake", { state: { packageString: packageString.trim(), password } });
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/")} />
        <PageHeading
          title="Enter Onboarding Package"
          copy="Enter the onboarding package from a source device to receive this device's share."
        />

        <div className="field">
          <label className="label" htmlFor="onboard-package-input">
            Onboarding Package
          </label>
          <p className="help">Paste a bfonboard1... package from the source device or scan its QR code.</p>
          <textarea
            id="onboard-package-input"
            className="input import-textarea"
            placeholder="bfonboard1..."
            value={packageString}
            onChange={(e) => setPackageString(e.target.value)}
            rows={3}
          />
          <button type="button" className="button button-chip button-sm onboard-scan-btn">
            <QrCode size={14} />
            Scan QR
          </button>
          {validation.message && (
            <span className={validation.valid ? "import-validation-ok" : "import-validation-error"}>
              {validation.message}
            </span>
          )}
        </div>

        <div className="import-divider" />

        <PasswordField
          label="Package Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter package password"
        />

        <Button type="button" size="full" disabled={!validation.valid} onClick={handleBeginOnboarding}>
          Begin Onboarding
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Handshake (/onboard/handshake)
   ========================================================== */

type HandshakeStep = "pending" | "active" | "done";

interface TimelineStep {
  label: string;
  detail?: string;
  state: HandshakeStep;
}

export function HandshakeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { packageString?: string; password?: string } | null;

  /* Guard: redirect if no package loaded */
  if (!state?.packageString) {
    return <Navigate to="/onboard" replace />;
  }

  return <HandshakeContent packageString={state.packageString} navigate={navigate} />;
}

function HandshakeContent({
  packageString,
  navigate
}: {
  packageString: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [steps, setSteps] = useState<TimelineStep[]>([
    { label: "Connected to relays", detail: "wss://relay.primal.net, wss://relay.damus.io", state: "done" },
    { label: "Found source device", detail: "02a3f8c2d1...8f2c", state: "done" },
    { label: "Receiving keyset data", state: "active" },
    { label: "Saving to device", state: "pending" }
  ]);

  const [simulateFailure, setSimulateFailure] = useState(false);

  const advanceHandshake = useCallback(() => {
    setSteps((prev) => {
      const activeIdx = prev.findIndex((s) => s.state === "active");
      if (activeIdx === -1) return prev;
      const next = prev.map((s, i) => {
        if (i === activeIdx) return { ...s, state: "done" as const };
        if (i === activeIdx + 1) return { ...s, state: "active" as const };
        return s;
      });
      return next;
    });
  }, []);

  /* Auto-advance handshake steps every 1.5s */
  useEffect(() => {
    const allDone = steps.every((s) => s.state === "done");
    const hasActive = steps.some((s) => s.state === "active");

    if (allDone) {
      /* All steps done → go to complete */
      const timer = window.setTimeout(() => {
        navigate("/onboard/complete", { replace: true, state: { fromHandshake: true } });
      }, 500);
      return () => window.clearTimeout(timer);
    }

    if (simulateFailure && hasActive) {
      const timer = window.setTimeout(() => {
        navigate("/onboard/failed", { replace: true });
      }, 1200);
      return () => window.clearTimeout(timer);
    }

    if (hasActive) {
      const timer = window.setTimeout(advanceHandshake, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [steps, simulateFailure, navigate, advanceHandshake]);

  const truncatedPackage = packageString.length > 14
    ? `${packageString.slice(0, 11)}•••`
    : packageString;

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/onboard")} />
        <div className="screen-heading">
          <h1 className="page-title">Onboarding...</h1>
          <p className="page-copy">
            Connecting to your source device to receive group configuration and share data.
          </p>
        </div>

        {/* Vertical timeline */}
        <div className="onboard-timeline">
          {steps.map((step, i) => (
            <div key={step.label} className="onboard-timeline-step">
              <div className="onboard-timeline-indicator">
                <TimelineDot state={step.state} />
                {i < steps.length - 1 && <div className="onboard-timeline-line" />}
              </div>
              <div className="onboard-timeline-content">
                <span className={`onboard-step-label ${step.state}`}>
                  {step.label}
                </span>
                {step.detail && step.state === "done" && (
                  <span className="onboard-step-detail">{step.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary bar */}
        <div className="onboard-summary-bar">
          <span className="onboard-summary-package">Onboarding package: {truncatedPackage}</span>
          <span className="onboard-summary-sep">·</span>
          <span className="onboard-summary-share">Share #1</span>
        </div>

        {/* Cancel button */}
        <Button type="button" variant="ghost" size="full" onClick={() => navigate("/onboard")}>
          Cancel Onboarding
        </Button>

        {/* Simulate failure toggle for testing */}
        <button
          type="button"
          className="button button-chip button-sm"
          style={{ alignSelf: "center", marginTop: "8px" }}
          onClick={() => setSimulateFailure(true)}
          data-testid="simulate-failure"
        >
          Simulate Failure
        </button>
      </div>
    </AppShell>
  );
}

function TimelineDot({ state }: { state: HandshakeStep }) {
  if (state === "done") {
    return (
      <div className="onboard-dot done">
        <Check size={12} strokeWidth={3} color="#fff" />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="onboard-dot active">
        <span className="onboard-dot-ellipsis">...</span>
      </div>
    );
  }
  return <div className="onboard-dot pending" />;
}

/* ==========================================================
   Screen 3 — Onboarding Failed (/onboard/failed)
   ========================================================== */

export function OnboardingFailedScreen() {
  const navigate = useNavigate();

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink onClick={() => navigate("/onboard")} />
        <div className="screen-heading">
          <h1 className="page-title">Onboarding Failed</h1>
        </div>

        <div className="onboard-error-alert">
          <div className="onboard-error-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="onboard-error-body">
            <div className="onboard-error-title">Onboarding Timed Out</div>
            <div className="onboard-error-description">
              Onboarding peer did not respond within 30 seconds. They may be offline or unreachable.
            </div>
          </div>
        </div>

        <div className="inline-actions">
          <Button type="button" onClick={() => navigate("/onboard/handshake", { state: { packageString: "bfonboard1retry", password: "" } })}>
            Retry
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/onboard")}>
            Back to Onboarding
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 4 — Onboarding Complete (/onboard/complete)
   ========================================================== */

export function OnboardingCompleteScreen() {
  const location = useLocation();
  const state = location.state as { fromHandshake?: boolean } | null;

  /* Guard: redirect if not arriving from handshake */
  if (!state?.fromHandshake) {
    return <Navigate to="/onboard" replace />;
  }

  return <OnboardingCompleteContent />;
}

function OnboardingCompleteContent() {
  const navigate = useNavigate();
  const [profilePassword, setProfilePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordsMatch = profilePassword.length > 0 && profilePassword === confirmPassword;

  function handleSave() {
    /* Mock: navigate to welcome (simulating saved profile) */
    navigate("/");
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        {/* No Back link — terminal success state */}

        {/* Success header */}
        <div className="onboard-complete-header">
          <div className="onboard-complete-check">
            <Check size={20} strokeWidth={2.5} color="#fff" />
          </div>
          <h1 className="page-title">Onboarding Complete</h1>
        </div>

        <p className="page-copy">
          You've successfully applied the onboarding package. Review your configuration and set or confirm a local password before launching the signer.
        </p>

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
          <div className="import-review-row">
            <span className="import-review-label">Relays</span>
            <span className="import-review-value">2 connected</span>
          </div>
          <div className="import-review-row">
            <span className="import-review-label">Peer Policies</span>
            <span className="import-review-value">{MOCK_REVIEW_DATA.peerPolicies}</span>
          </div>
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

        <Button type="button" size="full" onClick={handleSave}>
          Save &amp; Launch Signer
        </Button>
      </div>
    </AppShell>
  );
}


