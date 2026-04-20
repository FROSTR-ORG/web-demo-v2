import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Check, Info } from "lucide-react";
import { SetupFlowError, useAppState } from "../../app/AppState";
import { AppShell, PageHeading } from "../../components/shell";
import { useDemoUi } from "../../demo/demoUi";
import { BackLink, Button, NumberStepper, Stepper } from "../../components/ui";
import { MOCK_SOURCE_SHARE_1 } from "./mocks";
import type { RotateSourceInput } from "./types";
import { navigateWithRotateState } from "./utils";

export function RotateKeysetFormScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const appState = useAppState();
  const demoUi = useDemoUi();
  const profiles = appState.profiles ?? [];
  const validateRotateKeysetSources = appState.validateRotateKeysetSources;
  const clearRotateKeysetSession = appState.clearRotateKeysetSession;
  const [profilePassword, setProfilePassword] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [totalShares, setTotalShares] = useState(3);
  const [sources, setSources] = useState<RotateSourceInput[]>([{ packageText: "", password: "" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const previousProfileIdRef = useRef<string | undefined>(undefined);

  /* Read profile data from location state (passed by WelcomeScreen Rotate button) */
  const locationState = location.state as { profileId?: string } | null;
  const existingRotateSession = appState.rotateKeysetSession;
  const selectedProfileId = locationState?.profileId ?? existingRotateSession?.sourceProfile.id;
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ??
    (existingRotateSession && existingRotateSession.sourceProfile.id === selectedProfileId ? existingRotateSession.sourceProfile : undefined);
  const demoMode = Boolean(demoUi.rotateKeyset || demoUi.progress);
  const locationProfile = selectedProfile;
  const sourceProfileValidated = Boolean(
    existingRotateSession?.sourcePayload &&
      existingRotateSession.sourceProfile.id === locationProfile?.id
  );
  const validatedLocalShare = sourceProfileValidated ? existingRotateSession?.sourceShares[0] : undefined;
  const sourceShare = {
    label: locationProfile?.label ?? MOCK_SOURCE_SHARE_1.label,
    deviceName: locationProfile?.deviceName ?? MOCK_SOURCE_SHARE_1.deviceName,
    sharePubkey: sourceProfileValidated ? `Share #${validatedLocalShare?.idx ?? locationProfile?.localShareIdx ?? 0}` : "Pending password",
    sharePubkeyDisplay: sourceProfileValidated ? `Share #${validatedLocalShare?.idx ?? locationProfile?.localShareIdx ?? 0}` : "Pending password",
    profileId: locationProfile?.id ?? MOCK_SOURCE_SHARE_1.profileId,
    relays: locationProfile?.relays?.length ?? MOCK_SOURCE_SHARE_1.relays,
    threshold: locationProfile?.threshold ?? 2,
    memberCount: locationProfile?.memberCount ?? 3
  };
  const requiredExternalSources = Math.max(1, sourceShare.threshold - 1);
  const routeState = selectedProfile ? { profileId: selectedProfile.id } : undefined;
  const filledSources = sources.filter((source) => source.packageText.trim() && source.password.trim()).length;
  const canValidate = Boolean(
    sourceShare.profileId &&
    profilePassword.trim() &&
    sources.length >= requiredExternalSources &&
    sources.every((source) => source.packageText.trim() && source.password.trim())
  );

  useEffect(() => {
    if (previousProfileIdRef.current && previousProfileIdRef.current !== sourceShare.profileId) {
      clearRotateKeysetSession();
    }
    previousProfileIdRef.current = sourceShare.profileId;
    setThreshold(sourceShare.threshold);
    setTotalShares(Math.max(sourceShare.memberCount, sourceShare.threshold, 2));
    setSources((current) => Array.from({ length: requiredExternalSources }, (_, index) => current[index] ?? { packageText: "", password: "" }));
  }, [clearRotateKeysetSession, sourceShare.profileId, sourceShare.threshold, sourceShare.memberCount, requiredExternalSources]);

  useEffect(() => {
    if (!selectedProfile && !demoMode) {
      clearRotateKeysetSession();
    }
  }, [clearRotateKeysetSession, demoMode, selectedProfile]);

  if (!selectedProfile && !demoMode) {
    return (
      <Navigate
        to="/"
        replace
        state={{
          setupNotice: {
            code: "rotate_selection_missing",
            message: "Choose a saved profile before rotating its keyset."
          }
        }}
      />
    );
  }

  function clearValidatedRotateSession() {
    if (appState.rotateKeysetSession) {
      clearRotateKeysetSession();
    }
    if (error) {
      setError("");
    }
  }

  function updateSource(index: number, patch: Partial<RotateSourceInput>) {
    clearValidatedRotateSession();
    setSources((current) => current.map((source, idx) => (idx === index ? { ...source, ...patch } : source)));
  }

  async function handleValidate() {
    if (!validateRotateKeysetSources) {
      setError("Rotate keyset validation is unavailable in this session.");
      return;
    }
    if (!canValidate) {
      setError(`Enter the saved profile password and ${requiredExternalSources} bfshare source package${requiredExternalSources === 1 ? "" : "s"} before continuing.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await validateRotateKeysetSources({
        profileId: sourceShare.profileId,
        profilePassword,
        sourcePackages: sources,
        threshold,
        count: totalShares
      });
      navigateWithRotateState(navigate, "/rotate-keyset/review", routeState);
    } catch (err) {
      if (err instanceof SetupFlowError) {
        if (err.code === "group_mismatch" || err.code === "duplicate_share") {
          navigate("/rotate-keyset/error-mismatch", { state: { ...routeState, errorMessage: err.message, details: err.details } });
          return;
        }
        if (err.code === "wrong_password" || err.code === "invalid_package") {
          navigate("/rotate-keyset/error-password", { state: { ...routeState, errorMessage: err.message, details: err.details } });
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Unable to validate source shares.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell headerMeta={sourceShare.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => {
          clearRotateKeysetSession();
          navigate("/");
        }} />
        <PageHeading
          title="Rotate Keyset"
          copy="This keyset rotation started from the selected saved profile, which already counts as Source Share #1. Add the remaining threshold bfshare packages to refresh device shares for the same group public key, then continue into shared profile creation and share distribution."
        />

        {/* ---- Source Share #1 ---- */}
        <div className={`source-share-card${sourceProfileValidated ? " validated" : ""}`}>
          <div className="source-share-header">
            <span className="source-share-title">Source Share #1</span>
            {sourceProfileValidated ? (
              <span className="source-share-badge validated">
                <Check size={14} />
                Validated
              </span>
            ) : (
              <span className="source-share-status">Password required</span>
            )}
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">Saved Profile</span>
            <div className="source-share-value validated">{sourceShare.label}</div>
          </div>
          <div className="source-share-field">
            <span className="source-share-field-label">Profile Password</span>
            <input
              type="password"
              className="input"
              placeholder="Enter saved profile password"
              value={profilePassword}
              onChange={(event) => {
                clearValidatedRotateSession();
                setProfilePassword(event.target.value);
              }}
            />
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
              {sourceProfileValidated ? (
                <span className="source-share-detail-val match">
                  <Check size={10} />
                  Belongs to current group
                </span>
              ) : (
                <span className="source-share-detail-val">Pending password</span>
              )}
            </div>
          </div>
        </div>

        {sources.map((source, index) => (
          <div className="source-share-card" key={index}>
            <div className="source-share-header">
              <span className="source-share-title">Source Share #{index + 2}</span>
              <span className="source-share-status">{source.packageText && source.password ? "Ready to validate" : "Waiting for input"}</span>
            </div>
            <div className="source-share-field">
              <span className="source-share-field-label">bfshare Package</span>
              <textarea
                className="source-share-textarea"
                placeholder="Paste bfshare from another device or backup..."
                value={source.packageText}
                onChange={(e) => updateSource(index, { packageText: e.target.value })}
                rows={2}
              />
            </div>
            <div className="source-share-field">
              <span className="source-share-field-label">Package Password</span>
              <input
                type="password"
                className="input"
                placeholder="Enter password to decrypt"
                value={source.password}
                onChange={(e) => updateSource(index, { password: e.target.value })}
              />
            </div>
          </div>
        ))}

        {/* ---- Shares Collected progress ---- */}
        <div className="shares-collected">
          <div className="shares-collected-header">
            <span className="shares-collected-label">Shares Collected</span>
            <span className="shares-collected-count">{Math.min(sourceShare.threshold, 1 + filledSources)} of {sourceShare.threshold} required</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${Math.min(100, ((1 + filledSources) / sourceShare.threshold) * 100)}%` }} />
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
            <NumberStepper
              label="Threshold"
              value={threshold}
              min={2}
              max={totalShares}
              onChange={(next) => {
                clearValidatedRotateSession();
                setThreshold(next);
              }}
            />
            <div className="divider-text">/</div>
            <NumberStepper
              label="Total Shares"
              value={totalShares}
              min={threshold}
              max={10}
              onChange={(next) => {
                clearValidatedRotateSession();
                setTotalShares(next);
                if (threshold > next) setThreshold(next);
              }}
            />
          </div>
          <span className="help">
            Any {threshold} of {totalShares} shares can sign — min threshold is 2, min shares is 2
          </span>
        </div>

        {/*
          Validate & Continue keeps the Paper disabled visual until the saved
          profile and required external bfshare packages are ready.
        */}
        {error ? <div className="error">{error}</div> : null}
        <Button
          type="button"
          size="full"
          aria-disabled={!canValidate}
          className={!canValidate ? "button-disabled-visual bg-[#2563EB40]" : undefined}
          disabled={busy || !canValidate}
          onClick={() => void handleValidate()}
        >
          {busy ? "Validating..." : "Validate & Continue"}
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
