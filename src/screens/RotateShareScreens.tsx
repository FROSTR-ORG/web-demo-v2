import { useState, useEffect, useCallback } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Info, QrCode } from "lucide-react";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";
import { useAppState } from "../app/AppState";
import { useDemoUi } from "../demo/demoUi";

/* ---------- Mock data ---------- */

const MOCK_KEYSET_NAME = "My Signing Key";

const MOCK_IDENTITY = {
  groupPublicKey: "npub1qe3...7kkm",
  oldSharePublicKey: "02a3f8...8f2c",
  newSharePublicKey: "03b7d9...2e5a",
  oldProfileId: "prof_8f2c4a",
  newProfileId: "prof_2e5a19"
};

/* ---------- Validation helpers ---------- */

function validateRotatePackage(value: string): { valid: boolean; message: string } {
  if (!value.trim()) {
    return { valid: false, message: "" };
  }
  if (value.trim().startsWith("bfonboard1")) {
    return {
      valid: true,
      message: `Valid package — ${MOCK_KEYSET_NAME} (2/3) · replacement for Share #0`
    };
  }
  return {
    valid: false,
    message: "Invalid package — String must begin with bfonboard1 prefix."
  };
}

/* ==========================================================
   Screen 1 — Enter Rotate Package (/rotate-share)
   ========================================================== */

export function EnterRotatePackageScreen() {
  const navigate = useNavigate();
  const demoUi = useDemoUi();
  const [packageString, setPackageString] = useState(demoUi.rotateShare?.packagePreset ?? "");
  const [password, setPassword] = useState(demoUi.rotateShare?.passwordPreset ?? "");
  const validation = validateRotatePackage(packageString);

  function handleApplyShareUpdate() {
    if (!validation.valid) return;
    navigate("/rotate-share/applying", {
      state: { packageString: packageString.trim(), password }
    });
  }

  return (
    <AppShell mainVariant="flow" headerMeta={MOCK_KEYSET_NAME}>
      <div className="screen-column">
        <BackLink onClick={() => navigate(-1)} label="Back to Settings" />
        <PageHeading
          title="Enter Rotate Package"
          copy="Enter the rotate package from a source device to replace this device's local share while keeping the same group public key."
        />

        <div className="field">
          <div className="rotate-share-label-row">
            <label className="label" htmlFor="rotate-package-input">
              Rotate Package
            </label>
            <span className="rotate-share-info-tooltip" title="Paste the bfonboard rotate package from the source device or scan its QR code.">
              <Info size={12} />
            </span>
          </div>
          <p className="help">Paste the bfonboard rotate package from the source device or scan its QR code.</p>
          <textarea
            id="rotate-package-input"
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

        <Button type="button" size="full" disabled={!validation.valid} onClick={handleApplyShareUpdate}>
          Apply Share Update
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Applying Share Update (/rotate-share/applying)
   ========================================================== */

type TimelineState = "pending" | "active" | "done";

interface TimelineStep {
  label: string;
  detail?: string;
  state: TimelineState;
}

export function ApplyingShareUpdateScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { packageString?: string; password?: string } | null;

  /* Guard: redirect if no package loaded */
  if (!state?.packageString) {
    return <Navigate to="/rotate-share" replace />;
  }

  return <ApplyingShareUpdateContent packageString={state.packageString} navigate={navigate} />;
}

function ApplyingShareUpdateContent({
  packageString,
  navigate
}: {
  packageString: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const demoUi = useDemoUi();
  const [steps, setSteps] = useState<TimelineStep[]>([
    { label: "Connected to relays", detail: "wss://relay.primal.net, wss://relay.damus.io", state: "done" },
    { label: "Verified rotate package", detail: `${MOCK_KEYSET_NAME} · Share #0 replacement`, state: "done" },
    { label: "Applying local share update", detail: "Replacing Share #0 and refreshing local identity material", state: "active" },
    { label: "Saving updated profile", state: "pending" }
  ]);

  const advanceTimeline = useCallback(() => {
    setSteps((prev) => {
      const activeIdx = prev.findIndex((s) => s.state === "active");
      if (activeIdx === -1) return prev;
      return prev.map((s, i) => {
        if (i === activeIdx) return { ...s, state: "done" as const };
        if (i === activeIdx + 1) return { ...s, state: "active" as const };
        return s;
      });
    });
  }, []);

  /* Auto-advance timeline steps every 1.5s */
  useEffect(() => {
    if (demoUi.progress?.frozen) {
      return;
    }

    const allDone = steps.every((s) => s.state === "done");
    const hasActive = steps.some((s) => s.state === "active");

    if (allDone) {
      const timer = window.setTimeout(() => {
        navigate("/rotate-share/updated", { replace: true, state: { fromApplying: true } });
      }, 500);
      return () => window.clearTimeout(timer);
    }

    if (hasActive) {
      const timer = window.setTimeout(advanceTimeline, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [steps, navigate, advanceTimeline, demoUi.progress?.frozen]);

  const truncatedPackage = demoUi.rotateShare?.packagePreset
    ? "bfonboard1••••"
    : packageString.length > 14
      ? `${packageString.slice(0, 11)}••••`
      : packageString;

  return (
    <AppShell mainVariant="flow" headerMeta={MOCK_KEYSET_NAME}>
      <div className="screen-column">
        <BackLink onClick={() => navigate(-1)} label="Back to Settings" />
        <PageHeading
          title="Applying Share Update"
          copy="Connecting to relays and applying the replacement share to this device. Your group public key will stay the same."
        />

        {/* Vertical timeline */}
        <div className="onboard-timeline">
          {steps.map((step, i) => (
            <div key={step.label} className="onboard-timeline-step">
              <div className="onboard-timeline-indicator">
                <RotateShareTimelineDot state={step.state} />
                {i < steps.length - 1 && <div className="onboard-timeline-line" />}
              </div>
              <div className="onboard-timeline-content">
                <span className={`onboard-step-label ${step.state}`}>
                  {step.label}
                </span>
                {step.detail && (step.state === "done" || step.state === "active") && (
                  <span className="onboard-step-detail">{step.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Package info bar */}
        <div className="onboard-summary-bar">
          <span className="onboard-summary-package">Rotate package: {truncatedPackage}</span>
          <span className="onboard-summary-sep">·</span>
          <span className="onboard-summary-share">Share #0</span>
        </div>

        {/* Cancel button */}
        <Button type="button" variant="ghost" size="full" onClick={() => navigate("/rotate-share")}>
          Cancel Share Update
        </Button>

      </div>
    </AppShell>
  );
}

function RotateShareTimelineDot({ state }: { state: TimelineState }) {
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
   Screen 3 — Share Update Failed (/rotate-share/failed)
   ========================================================== */

export function ShareUpdateFailedScreen() {
  const navigate = useNavigate();

  return (
    <AppShell mainVariant="flow" headerMeta={MOCK_KEYSET_NAME}>
      <div className="screen-column">
        <BackLink onClick={() => navigate("/rotate-share")} label="Back to Rotate Share" />
        <PageHeading
          title="Share Update Failed"
          copy="The replacement share could not be applied. Your current local share is still active and no runtime signing state was changed."
        />

        {/* Amber warning callout */}
        <div className="rotate-share-warning-callout">
          <div className="rotate-share-warning-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="rotate-share-warning-body">
            <div className="rotate-share-warning-title">Rotate package did not apply</div>
            <div className="rotate-share-warning-description">
              Check relay connectivity and confirm the package password, then retry the share update.
            </div>
          </div>
        </div>

        <div className="inline-actions">
          <Button
            type="button"
            onClick={() =>
              navigate("/rotate-share/applying", {
                state: { packageString: "bfonboard1retry", password: "" }
              })
            }
          >
            Retry
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/rotate-share")}>
            Back to Rotate Share
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 4 — Local Share Updated (/rotate-share/updated)
   ========================================================== */

export function LocalShareUpdatedScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromApplying?: boolean } | null;

  /* Guard: redirect if not arriving from applying */
  if (!state?.fromApplying) {
    return <Navigate to="/rotate-share" replace />;
  }

  return <LocalShareUpdatedContent navigate={navigate} />;
}

function LocalShareUpdatedContent({
  navigate
}: {
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { activeProfile } = useAppState();

  const handleReturnToSigner = () => {
    if (activeProfile) {
      navigate(`/dashboard/${activeProfile.id}`);
    } else {
      navigate("/");
    }
  };

  return (
    <AppShell mainVariant="flow" headerMeta={MOCK_KEYSET_NAME}>
      <div className="screen-column">
        {/* No Back link — terminal success state */}
        <div className="screen-heading">
          <h1 className="page-title">Local Share Updated</h1>
          <p className="page-copy">
            Your local share has been updated. Review the identity changes below before returning to the signer.
          </p>
        </div>

        {/* Green success banner */}
        <div className="rotate-share-success-banner">
          <div className="rotate-share-success-icon">
            <Check size={14} strokeWidth={2.5} />
          </div>
          <div className="rotate-share-success-body">
            <div className="rotate-share-success-title">Updated share is active on this device</div>
            <div className="rotate-share-success-description">
              Profile ID changes because it is derived from the refreshed share public key.
            </div>
          </div>
        </div>

        {/* IDENTITY CHANGES card */}
        <div className="rotate-share-identity-card">
          <div className="rotate-share-identity-header">IDENTITY CHANGES</div>

          {/* Group Public Key — Unchanged */}
          <div className="rotate-share-identity-row">
            <span className="rotate-share-identity-label">Group Public Key</span>
            <div className="rotate-share-identity-value-group">
              <span className="rotate-share-identity-value-mono blue">{MOCK_IDENTITY.groupPublicKey}</span>
              <span className="rotate-share-identity-unchanged-badge">Unchanged</span>
            </div>
          </div>

          {/* Share Public Key — old → new */}
          <div className="rotate-share-identity-row">
            <span className="rotate-share-identity-label">Share Public Key</span>
            <div className="rotate-share-identity-diff">
              <div className="rotate-share-identity-old-row">
                <span className="rotate-share-identity-old-value">{MOCK_IDENTITY.oldSharePublicKey}</span>
                <span className="rotate-share-identity-old-label">Old</span>
              </div>
              <div className="rotate-share-identity-new-row">
                <span className="rotate-share-identity-new-value">{MOCK_IDENTITY.newSharePublicKey}</span>
                <span className="rotate-share-identity-new-label">New</span>
              </div>
            </div>
          </div>

          {/* Profile ID — old → new */}
          <div className="rotate-share-identity-row rotate-share-identity-row-last">
            <span className="rotate-share-identity-label">Profile ID</span>
            <div className="rotate-share-identity-diff">
              <div className="rotate-share-identity-old-row">
                <span className="rotate-share-identity-old-value">{MOCK_IDENTITY.oldProfileId}</span>
                <span className="rotate-share-identity-old-label">Old</span>
              </div>
              <div className="rotate-share-identity-new-row">
                <span className="rotate-share-identity-new-value">{MOCK_IDENTITY.newProfileId}</span>
                <span className="rotate-share-identity-new-label">New</span>
              </div>
            </div>
          </div>
        </div>

        <Button type="button" size="full" onClick={handleReturnToSigner}>
          Return to Signer
        </Button>
      </div>
    </AppShell>
  );
}
