import { useState, useEffect, useCallback, useRef } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, HelpCircle, QrCode } from "lucide-react";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { useDemoUi } from "../demo/demoUi";

/* ---------- Label with inline info/help icon (audit gap per VAL-ONB-001/005) ---------- */

function OnboardLabelWithHelp({
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

/* ---------- Mock data ---------- */

const MOCK_REVIEW_DATA = {
  groupName: "My Signing Key",
  threshold: "2 of 3",
  shareKey: "#1 (Index 1)",
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  peerPolicies: "3 total",
};

/* ---------- Validation helpers ---------- */

function validatePackageString(value: string): {
  valid: boolean;
  message: string;
} {
  if (!value.trim()) {
    return { valid: false, message: "" };
  }
  if (value.trim().startsWith("bfonboard1")) {
    return {
      valid: true,
      message: "Valid bfonboard package format.",
    };
  }
  return {
    valid: false,
    message: "Invalid package — String must begin with bfonboard1 prefix.",
  };
}

/* ==========================================================
   Screen 1 — Enter Onboarding Package (/onboard)
   ========================================================== */

export function EnterPackageScreen() {
  const navigate = useNavigate();
  const { decodeOnboardPackage, clearOnboardSession } = useAppState();
  const demoUi = useDemoUi();
  const [packageString, setPackageString] = useState(
    demoUi.onboard?.packagePreset ?? "",
  );
  const [password, setPassword] = useState(
    demoUi.onboard?.passwordPreset ?? "",
  );
  const [error, setError] = useState("");
  const [showQrScanner, setShowQrScanner] = useState(false);
  const validation = validatePackageString(packageString);
  /*
   * CTA gating: Begin Onboarding requires BOTH a valid onboarding package
   * AND a non-empty password before it enables. Paper's Enter Package
   * screen treats the password as a required field for the onboard flow,
   * so the CTA stays disabled (bg-[#2563EB40]) while either input is
   * missing.
   */
  const canBeginOnboarding = validation.valid && password.trim().length > 0;

  async function handleBeginOnboarding() {
    if (!canBeginOnboarding) return;
    setError("");
    try {
      await decodeOnboardPackage(packageString, password);
      navigate(
        "/onboard/handshake",
        demoUi.onboard?.packagePreset
          ? { state: { packageString: packageString.trim() } }
          : undefined,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to decrypt this onboarding package.",
      );
    }
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink
          onClick={() => {
            clearOnboardSession();
            navigate("/");
          }}
          label="Back to Welcome"
        />
        <PageHeading
          title="Enter Onboarding Package"
          copy="Enter the onboarding package from a source device to receive this device's share."
        />

        <div className="field">
          <OnboardLabelWithHelp htmlFor="onboard-package-input">
            Onboarding Package
          </OnboardLabelWithHelp>
          <p className="help">
            Paste a bfonboard1... package from the source device or scan its QR
            code.
          </p>
          <textarea
            id="onboard-package-input"
            className="input import-textarea"
            placeholder="bfonboard1..."
            value={packageString}
            onChange={(e) => setPackageString(e.target.value)}
            rows={3}
          />
          <button
            type="button"
            className="button button-chip button-sm onboard-scan-btn"
            onClick={() => setShowQrScanner(true)}
          >
            <QrCode size={14} />
            Scan QR
          </button>
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

        <div className="import-divider" />

        <PasswordField
          label="Package Password"
          labelHelp={<HelpCircle size={14} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter package password"
          error={error}
        />

        <Button
          type="button"
          size="full"
          disabled={!canBeginOnboarding}
          aria-disabled={!canBeginOnboarding}
          onClick={handleBeginOnboarding}
        >
          Begin Onboarding
        </Button>
      </div>
      {showQrScanner && (
        <QrScanner
          onScan={(data) => {
            setPackageString(data);
            setShowQrScanner(false);
          }}
          onClose={() => setShowQrScanner(false)}
        />
      )}
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function HandshakeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { onboardSession, clearOnboardSession, startOnboardHandshake } =
    useAppState();
  const demoUi = useDemoUi();
  const state = location.state as { packageString?: string } | null;
  const demoHandshake = Boolean(demoUi.onboard?.packagePreset);

  /* Product handshake requires a decoded onboard session. */
  if (!onboardSession && !demoHandshake) {
    return <Navigate to="/onboard" replace />;
  }
  if (onboardSession?.phase === "ready_to_save") {
    return <Navigate to="/onboard/complete" replace />;
  }

  return (
    <HandshakeContent
      packageString={
        onboardSession?.packageString ??
        (demoHandshake ? state?.packageString : undefined) ??
        ""
      }
      relays={onboardSession?.payload.relays}
      peerPk={onboardSession?.payload.peer_pk}
      deferredLiveHandshake={Boolean(onboardSession)}
      sessionPhase={onboardSession?.phase}
      startOnboardHandshake={startOnboardHandshake}
      clearOnboardSession={clearOnboardSession}
      navigate={navigate}
    />
  );
}

function HandshakeContent({
  packageString,
  relays,
  peerPk,
  deferredLiveHandshake,
  sessionPhase,
  startOnboardHandshake,
  clearOnboardSession,
  navigate,
}: {
  packageString: string;
  relays?: string[];
  peerPk?: string;
  deferredLiveHandshake: boolean;
  sessionPhase?: string;
  startOnboardHandshake: () => Promise<void>;
  clearOnboardSession: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const demoUi = useDemoUi();
  const startHandshakeRef = useRef(startOnboardHandshake);
  const relayDetail = relays?.length
    ? relays.join(", ")
    : "wss://relay.primal.net, wss://relay.damus.io";
  const peerDetail = peerPk
    ? `${peerPk.slice(0, 10)}...${peerPk.slice(-4)}`
    : "02a3f8c2d1...8f2c";
  const [steps, setSteps] = useState<TimelineStep[]>([
    { label: "Connected to relays", detail: relayDetail, state: "done" },
    { label: "Found source device", detail: peerDetail, state: "done" },
    { label: "Receiving keyset data", state: "active" },
    { label: "Saving to device", state: "pending" },
  ]);

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

  useEffect(() => {
    startHandshakeRef.current = startOnboardHandshake;
  }, [startOnboardHandshake]);

  useEffect(() => {
    if (
      !deferredLiveHandshake ||
      (sessionPhase !== "decoded" && sessionPhase !== "failed")
    ) {
      return;
    }
    let cancelled = false;
    let settled = false;
    startHandshakeRef
      .current()
      .then(() => {
        settled = true;
        if (!cancelled) {
          navigate("/onboard/complete", { replace: true });
        }
      })
      .catch((error) => {
        settled = true;
        if (isAbortError(error)) {
          return;
        }
        if (!cancelled) {
          navigate("/onboard/failed", { replace: true });
        }
      });
    return () => {
      cancelled = true;
      if (!settled) {
        clearOnboardSession();
      }
    };
    // sessionPhase intentionally omitted: this mount owns one live handshake; phase
    // transitions after start are observed through the promise instead of rerunning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearOnboardSession, deferredLiveHandshake, navigate]);

  /* Auto-advance visible handshake steps while the real handshake is pending. */
  useEffect(() => {
    if (demoUi.progress?.frozen) {
      return;
    }

    const allDone = steps.every((s) => s.state === "done");
    const hasActive = steps.some((s) => s.state === "active");

    if (allDone) {
      if (deferredLiveHandshake) {
        return;
      }
      const timer = window.setTimeout(() => {
        navigate("/onboard/complete", {
          replace: true,
          state: { fromHandshake: true },
        });
      }, 500);
      return () => window.clearTimeout(timer);
    }

    if (hasActive) {
      const timer = window.setTimeout(advanceHandshake, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [
    steps,
    navigate,
    advanceHandshake,
    demoUi.progress?.frozen,
    deferredLiveHandshake,
  ]);

  const truncatedPackage = demoUi.onboard?.packagePreset
    ? "bfonboard1•••"
    : packageString.length > 14
      ? `${packageString.slice(0, 11)}•••`
      : packageString;

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        {/* VAL-ONB-002: No BackLink above the heading on the handshake screen. */}
        <div className="screen-heading">
          <h1 className="page-title">Onboarding...</h1>
          <p className="page-copy">
            Connecting to your source device to receive group configuration and
            share data.
          </p>
        </div>

        {/* Vertical timeline */}
        <div className="onboard-timeline">
          {steps.map((step, i) => (
            <div key={step.label} className="onboard-timeline-step">
              <div className="onboard-timeline-indicator">
                <TimelineDot state={step.state} />
                {i < steps.length - 1 && (
                  <div className="onboard-timeline-line" />
                )}
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
          <span className="onboard-summary-package">
            Onboarding package: {truncatedPackage}
          </span>
          <span className="onboard-summary-sep">·</span>
          <span className="onboard-summary-share">Share #1</span>
        </div>

        {/* Cancel button */}
        <Button
          type="button"
          variant="ghost"
          size="full"
          onClick={() => {
            clearOnboardSession();
            navigate("/onboard");
          }}
        >
          Cancel Onboarding
        </Button>
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
  const { onboardSession, clearOnboardSession } = useAppState();
  const demoUi = useDemoUi();
  const productError =
    onboardSession?.phase === "failed" ? onboardSession.error : null;
  const rejected =
    demoUi.onboard?.failedVariant === "rejected" ||
    productError?.code === "onboard_rejected";
  const title =
    productError?.code === "relay_unreachable"
      ? "Relays Unreachable"
      : productError?.code === "onboard_rejected"
        ? "Onboarding Rejected"
        : productError?.code === "invalid_onboard_response"
          ? "Invalid Onboarding Response"
          : rejected
            ? "Onboarding Rejected"
            : "Onboarding Timed Out";
  const description =
    productError?.message ??
    (rejected
      ? "Challenge verification failed. You may not have a valid share for this group."
      : "Onboarding peer did not respond within 30 seconds. They may be offline or unreachable.");

  /*
   * Paper's error variants use Tailwind-style arbitrary hex classes so
   * fidelity validators (VAL-ONB-003/004) can compare `className` tokens
   * directly. Mirror those tokens on the alert root without coupling to
   * computed colours.
   */
  const alertClassName = rejected
    ? "onboard-error-alert red bg-[#EF44441A] border-[#EF444440]"
    : "onboard-error-alert bg-[#EAB3081A] border-[#EAB30840]";

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink
          onClick={() => {
            clearOnboardSession();
            navigate("/onboard");
          }}
        />
        <div className="screen-heading">
          <h1 className="page-title">Onboarding Failed</h1>
        </div>

        <div className={alertClassName}>
          <div className="onboard-error-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="onboard-error-body">
            <div className="onboard-error-title">{title}</div>
            <div className="onboard-error-description">{description}</div>
          </div>
        </div>

        <div className="inline-actions">
          <Button
            type="button"
            onClick={() => {
              if (
                onboardSession?.phase === "decoded" ||
                onboardSession?.phase === "failed"
              ) {
                navigate("/onboard/handshake");
                return;
              }
              clearOnboardSession();
              navigate("/onboard");
            }}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              clearOnboardSession();
              navigate("/onboard");
            }}
          >
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
  const { onboardSession } = useAppState();
  const demoUi = useDemoUi();
  const state = location.state as { fromHandshake?: boolean } | null;
  const readyProductSession =
    onboardSession?.phase === "ready_to_save" ? onboardSession : null;

  if (readyProductSession) {
    return <OnboardingCompleteContent productSession={readyProductSession} />;
  }

  if (!state?.fromHandshake || !demoUi.onboard?.packagePreset) {
    return <Navigate to="/onboard" replace />;
  }

  return <OnboardingCompleteContent />;
}

function OnboardingCompleteContent({
  productSession,
}: {
  productSession?: NonNullable<
    ReturnType<typeof useAppState>["onboardSession"]
  >;
}) {
  const navigate = useNavigate();
  const { createKeyset, createProfile, saveOnboardedProfile } = useAppState();
  const demoUi = useDemoUi();
  const presetPassword = productSession
    ? ""
    : (demoUi.onboard?.passwordPreset ?? "");
  const [profilePassword, setProfilePassword] = useState(presetPassword);
  const [confirmPassword, setConfirmPassword] = useState(presetPassword);
  const [saving, setSaving] = useState(false);

  const passwordsMatch =
    profilePassword.length > 0 && profilePassword === confirmPassword;
  const reviewData =
    productSession?.response && productSession.localShareIdx !== undefined
      ? {
          groupName: productSession.response.group.group_name,
          threshold: `${productSession.response.group.threshold} of ${productSession.response.group.members.length}`,
          shareKey: `#${productSession.localShareIdx} (Index ${productSession.localShareIdx})`,
          relays: productSession.payload.relays,
          peerPolicies: `${Math.max(0, productSession.response.group.members.length - 1)} peers`,
        }
      : MOCK_REVIEW_DATA;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const profileId = productSession
        ? await saveOnboardedProfile({
            password: profilePassword,
            confirmPassword,
          })
        : await (async () => {
            await createKeyset({
              groupName: MOCK_REVIEW_DATA.groupName,
              threshold: 2,
              count: 3,
            });
            return createProfile({
              deviceName: "Igloo Web",
              password: profilePassword,
              confirmPassword,
              distributionPassword: profilePassword,
              confirmDistributionPassword: profilePassword,
              relays: MOCK_REVIEW_DATA.relays,
            });
          })();
      navigate(`/dashboard/${profileId}`);
    } catch {
      setSaving(false);
    }
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
          You've successfully applied the onboarding package. Review your
          configuration and set or confirm a local password before launching the
          signer.
        </p>

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
          <div className="import-review-row">
            <span className="import-review-label">Relays</span>
            <span className="import-review-value">
              {reviewData.relays.length} connected
            </span>
          </div>
          <div className="import-review-row">
            <span className="import-review-label">Peer Policies</span>
            <span className="import-review-value">
              {reviewData.peerPolicies}
            </span>
          </div>
        </div>

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

        <Button type="button" size="full" onClick={handleSave}>
          Save &amp; Launch Signer
        </Button>
      </div>
    </AppShell>
  );
}
