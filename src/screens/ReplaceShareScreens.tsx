import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Check, Info, QrCode } from "lucide-react";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { useAppState } from "../app/AppState";
import { useDemoUi } from "../demo/demoUi";
import { SetupFlowError } from "../app/AppStateTypes";

/* ---------- Validation helpers ---------- */

function hasBfonboardPrefix(value: string): boolean {
  return value.trim().startsWith("bfonboard1");
}

/* ==========================================================
   Screen 1 — Enter Replace Share Package (/replace-share)
   ========================================================== */

export function EnterReplacePackageScreen() {
  const navigate = useNavigate();
  const demoUi = useDemoUi();
  const { activeProfile, decodeReplaceSharePackage, replaceShareSession } =
    useAppState();
  const [packageString, setPackageString] = useState(
    demoUi.replaceShare?.packagePreset ?? "",
  );
  const [password, setPassword] = useState(
    demoUi.replaceShare?.passwordPreset ?? "",
  );
  const [profilePassword, setProfilePassword] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);

  const canSubmit =
    hasBfonboardPrefix(packageString) &&
    password.length > 0 &&
    profilePassword.length >= 8;

  async function handleApplyShareUpdate() {
    if (!canSubmit || decoding) return;
    setError(null);
    setDecoding(true);
    try {
      await decodeReplaceSharePackage(
        packageString.trim(),
        password,
        profilePassword,
      );
      navigate("/replace-share/applying");
    } catch (err) {
      if (err instanceof SetupFlowError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unable to decode the replace share package.");
      }
    } finally {
      setDecoding(false);
    }
  }

  const headerMeta = activeProfile?.groupName ?? "Replace Share";

  return (
    <AppShell mainVariant="flow" headerMeta={headerMeta}>
      <div className="screen-column">
        <BackLink onClick={() => navigate(-1)} label="Back to Settings" />
        <PageHeading
          title="Enter Onboarding Package"
          copy="Import a valid onboarding package to replace this device's local share while keeping the same group public key and Group Profile."
        />

        <div className="field">
          <div className="replace-share-label-row">
            <label className="label" htmlFor="onboarding-package-input">
              Onboarding Package
            </label>
            <span
              className="replace-share-info-tooltip"
              title="Paste a bfonboard1... package that was produced outside runtime, or scan its QR code."
            >
              <Info size={12} />
            </span>
          </div>
          <p className="help">
            Paste a bfonboard1... package that was produced outside runtime, or
            scan its QR code.
          </p>
          <textarea
            id="onboarding-package-input"
            className="input import-textarea"
            placeholder="bfonboard1..."
            value={packageString}
            onChange={(e) => {
              setPackageString(e.target.value);
              setError(null);
            }}
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
          {replaceShareSession?.phase === "decoded" && (
            <span className="import-validation-ok">
              Valid package — {activeProfile?.groupName} (
              {activeProfile?.threshold}/{activeProfile?.memberCount}) ·
              replacement for Share #{replaceShareSession.localShareIdx}
            </span>
          )}
          {error && <span className="import-validation-error">{error}</span>}
        </div>

        <div className="import-divider" />

        <PasswordField
          label="Package Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          placeholder="Enter package password"
        />

        <PasswordField
          label="Profile Password"
          value={profilePassword}
          onChange={(e) => {
            setProfilePassword(e.target.value);
            setError(null);
          }}
          placeholder="Enter your current profile password"
        />
        <p className="help">
          Your profile password is required to re-encrypt the updated profile.
        </p>

        <Button
          type="button"
          size="full"
          disabled={!canSubmit || decoding}
          onClick={handleApplyShareUpdate}
        >
          {decoding ? "Decoding..." : "Replace Share"}
        </Button>
      </div>
      {showQrScanner && (
        <QrScanner
          onScan={(data) => {
            setPackageString(data);
            setShowQrScanner(false);
          }}
          onClose={() => setShowQrScanner(false)}
          expectedPrefixes={["bfonboard1"]}
        />
      )}
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Applying Share Update (/replace-share/applying)
   ========================================================== */

type TimelineState = "pending" | "active" | "done";

interface TimelineStep {
  label: string;
  detail?: string;
  state: TimelineState;
}

export function ApplyingReplacementScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { replaceShareSession, applyReplaceShareUpdate, clearReplaceShareSession } =
    useAppState();
  const demoUi = useDemoUi();

  const locationState = location.state as {
    packageString?: string;
    password?: string;
  } | null;

  /* Guard: redirect if no decoded session and no demo location state */
  const hasSession =
    replaceShareSession && replaceShareSession.phase !== "idle";
  const hasDemoState = Boolean(locationState?.packageString);
  if (!hasSession && !hasDemoState) {
    return <Navigate to="/replace-share" replace />;
  }

  /* Demo fallback: synthesise a session-like object from location state */
  const effectiveSession = hasSession
    ? replaceShareSession
    : {
        phase: "decoded" as const,
        packageString: locationState!.packageString!,
        localShareIdx: 0,
      };

  return (
    <ApplyingShareUpdateContent
      replaceShareSession={effectiveSession}
      applyReplaceShareUpdate={applyReplaceShareUpdate}
      clearReplaceShareSession={clearReplaceShareSession}
      navigate={navigate}
      demoUi={demoUi}
    />
  );
}

function ApplyingShareUpdateContent({
  replaceShareSession,
  applyReplaceShareUpdate,
  clearReplaceShareSession,
  navigate,
  demoUi,
}: {
  replaceShareSession: {
    phase: string;
    packageString: string;
    localShareIdx?: number;
  };
  applyReplaceShareUpdate: () => Promise<void>;
  clearReplaceShareSession: () => void;
  navigate: ReturnType<typeof useNavigate>;
  demoUi: ReturnType<typeof useDemoUi>;
}) {
  const { activeProfile } = useAppState();
  const [steps, setSteps] = useState<TimelineStep[]>([
    {
      label: "Validated package",
      detail: `bfonboard1••• ${activeProfile?.groupName ?? ""}`,
      state: "done",
    },
    {
      label: "Matched Group Profile",
      detail: `${activeProfile?.groupName ?? ""} · Share #${replaceShareSession.localShareIdx ?? 0} replacement`,
      state: "done",
    },
    {
      label: "Replacing local share",
      detail: "Refreshing only this device's share public key",
      state: "active",
    },
    { label: "Saving updated local share", state: "pending" },
  ]);
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /* Real mode: execute the async replacement once */
  const [started, setStarted] = useState(false);
  if (!started && !demoUi.progress?.frozen && !failed) {
    setStarted(true);
    void (async () => {
      try {
        await applyReplaceShareUpdate();
      } catch (err) {
        setFailed(true);
        setErrorMessage(
          err instanceof Error ? err.message : "Share update failed.",
        );
      }
    })();
  }

  /* Demo mode: auto-advance timeline steps every 1.5s */
  const advanceTimeline = () => {
    setSteps((prev) => {
      const activeIdx = prev.findIndex((s) => s.state === "active");
      if (activeIdx === -1) return prev;
      return prev.map((s, i) => {
        if (i === activeIdx) return { ...s, state: "done" as const };
        if (i === activeIdx + 1) return { ...s, state: "active" as const };
        return s;
      });
    });
  };

  useState(() => {
    if (demoUi.progress?.frozen) return;
    const allDone = steps.every((s) => s.state === "done");
    if (allDone && !failed) {
      window.setTimeout(() => {
        navigate("/replace-share/replaced", {
          replace: true,
          state: { fromApplying: true },
        });
      }, 500);
    }
  });

  useState(() => {
    if (demoUi.progress?.frozen || failed) return;
    const hasActive = steps.some((s) => s.state === "active");
    if (hasActive) {
      const timer = window.setTimeout(advanceTimeline, 1500);
      return () => window.clearTimeout(timer);
    }
  });

  /* When the real operation updates the session phase, reflect it in steps */
  if (
    replaceShareSession.phase === "updated" &&
    !steps.every((s) => s.state === "done")
  ) {
    setSteps((prev) =>
      prev.map((s) => ({ ...s, state: "done" as TimelineState })),
    );
    window.setTimeout(() => {
      navigate("/replace-share/replaced", {
        replace: true,
        state: { fromApplying: true },
      });
    }, 500);
  }

  if (failed) {
    navigate("/replace-share/failed", {
      replace: true,
      state: { errorMessage },
    });
    return null;
  }

  const truncatedPackage = demoUi.replaceShare?.packagePreset
    ? "bfonboard1••••"
    : replaceShareSession.packageString.length > 14
      ? `${replaceShareSession.packageString.slice(0, 11)}••••`
      : replaceShareSession.packageString;

  return (
    <AppShell
      mainVariant="flow"
      headerMeta={activeProfile?.groupName ?? "Replace Share"}
    >
      <div className="screen-column">
        <BackLink onClick={() => navigate(-1)} label="Back to Settings" />
        <PageHeading
          title="Applying Replacement"
          copy="Validating the onboarding package and replacing this device's local share. The group public key and Group Profile stay the same."
        />

        {/* Vertical timeline */}
        <div className="onboard-timeline">
          {steps.map((step, i) => (
            <div key={step.label} className="onboard-timeline-step">
              <div className="onboard-timeline-indicator">
                <ReplaceShareTimelineDot state={step.state} />
                {i < steps.length - 1 && (
                  <div className="onboard-timeline-line" />
                )}
              </div>
              <div className="onboard-timeline-content">
                <span className={`onboard-step-label ${step.state}`}>
                  {step.label}
                </span>
                {step.detail &&
                  (step.state === "done" || step.state === "active") && (
                    <span className="onboard-step-detail">{step.detail}</span>
                  )}
              </div>
            </div>
          ))}
        </div>

        {/* Package info bar */}
        <div className="onboard-summary-bar">
          <span className="onboard-summary-package">
            Onboarding package: {truncatedPackage}
          </span>
          <span className="onboard-summary-sep">·</span>
          <span className="onboard-summary-share">
            Share #{replaceShareSession.localShareIdx ?? 0}
          </span>
        </div>

        {/* Cancel button */}
        <Button
          type="button"
          variant="ghost"
          size="full"
          onClick={() => {
            clearReplaceShareSession();
            navigate("/replace-share");
          }}
        >
          Cancel Replacement
        </Button>
      </div>
    </AppShell>
  );
}

function ReplaceShareTimelineDot({ state }: { state: TimelineState }) {
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
   Screen 3 — Replacement Failed (/replace-share/failed)
   ========================================================== */

export function ReplacementFailedScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearReplaceShareSession, applyReplaceShareUpdate } = useAppState();
  const state = location.state as { errorMessage?: string } | null;
  const errorMessage =
    state?.errorMessage ??
    "The onboarding package could not be applied. Your current local share, group public key, and Group Profile were not changed.";

  return (
    <AppShell mainVariant="flow" headerMeta="Replace Share">
      <div className="screen-column">
        {/* VAL-RTS-003: NO top Back/Back-to-Settings link on failed screen (audit gap). */}
        <PageHeading
          title="Replacement Failed"
          copy={errorMessage}
        />

        {/* Amber warning callout */}
        <div className="replace-share-warning-callout">
          <div className="replace-share-warning-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="replace-share-warning-body">
            <div className="replace-share-warning-title">
              Onboarding package did not apply
            </div>
            <div className="replace-share-warning-description">
              Check the package, password, group match, and current share state,
              then retry replacement.
            </div>
          </div>
        </div>

        <div className="inline-actions">
          <Button
            type="button"
            onClick={() => {
              void applyReplaceShareUpdate();
            }}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              clearReplaceShareSession();
              navigate("/replace-share");
            }}
          >
            Back to Replace Share
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 4 — Share Replaced (/replace-share/replaced)
   ========================================================== */

export function ShareReplacedScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromApplying?: boolean } | null;

  /* Guard: redirect if not arriving from applying */
  if (!state?.fromApplying) {
    return <Navigate to="/replace-share" replace />;
  }

  return <LocalShareUpdatedContent navigate={navigate} />;
}

function LocalShareUpdatedContent({
  navigate,
}: {
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { activeProfile, replaceShareSession } = useAppState();

  const handleReturnToSigner = () => {
    if (activeProfile) {
      navigate(`/dashboard/${activeProfile.id}`);
    } else {
      navigate("/");
    }
  };

  const oldProfileId = replaceShareSession?.oldProfileId ?? "—";
  const newProfileId = replaceShareSession?.newProfileId ?? activeProfile?.id ?? "—";
  const groupPublicKey = activeProfile?.groupPublicKey ?? "—";
  const headerMeta = activeProfile?.groupName ?? "Replace Share";

  const oldShareKey = replaceShareSession?.oldProfileId
    ? `${replaceShareSession.oldProfileId.slice(0, 6)}...${replaceShareSession.oldProfileId.slice(-4)}`
    : "";
  const newShareKey = activeProfile
    ? `${activeProfile.id.slice(0, 6)}...${activeProfile.id.slice(-4)}`
    : "—";

  return (
    <AppShell mainVariant="flow" headerMeta={headerMeta}>
      <div className="screen-column">
        {/* No Back link — terminal success state */}
        <div className="screen-heading">
          <h1 className="page-title">Share Replaced</h1>
          <p className="page-copy">
            Your local share has been replaced. The group public key and Group
            Profile are unchanged.
          </p>
        </div>

        {/* Green success banner */}
        <div className="replace-share-success-banner">
          <div className="replace-share-success-icon">
            <Check size={14} strokeWidth={2.5} />
          </div>
          <div className="replace-share-success-body">
            <div className="replace-share-success-title">
              Replacement share is active on this device
            </div>
            <div className="replace-share-success-description">
              Group Profile stays the same; only this device's share public key
              changed.
            </div>
          </div>
        </div>

        {/* REPLACEMENT SUMMARY card */}
        <div className="replace-share-identity-card">
          <div className="replace-share-identity-header">REPLACEMENT SUMMARY</div>

          {/* Group Public Key — Unchanged */}
          <div className="replace-share-identity-row">
            <span className="replace-share-identity-label">
              Group Public Key
            </span>
            <div className="replace-share-identity-value-group">
              <span className="replace-share-identity-value-mono blue">
                {groupPublicKey}
              </span>
              <span className="replace-share-identity-unchanged-badge">
                Unchanged
              </span>
            </div>
          </div>

          {/* Share Public Key — old → new */}
          <div className="replace-share-identity-row">
            <span className="replace-share-identity-label">
              Share Public Key
            </span>
            <div className="replace-share-identity-diff">
              <div className="replace-share-identity-old-row">
                <span className="replace-share-identity-old-value">
                  {oldShareKey || <span style={{ visibility: "hidden" }}>—</span>}
                </span>
                <span className="replace-share-identity-old-label">Old</span>
              </div>
              <div className="replace-share-identity-new-row">
                <span className="replace-share-identity-new-value">
                  {newShareKey}
                </span>
                <span className="replace-share-identity-new-label">New</span>
              </div>
            </div>
          </div>

          {/* Group Profile — unchanged */}
          <div className="replace-share-identity-row replace-share-identity-row-last">
            <span className="replace-share-identity-label">Group Profile</span>
            <div className="replace-share-identity-diff">
              <div className="replace-share-identity-old-row">
                <span className="replace-share-identity-old-value">
                  <span style={{ visibility: "hidden" }}>—</span>
                </span>
                <span className="replace-share-identity-old-label">Old</span>
              </div>
              <div className="replace-share-identity-new-row">
                <span className="replace-share-identity-new-value">
                  Unchanged
                </span>
                <span className="replace-share-identity-new-label">New</span>
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
