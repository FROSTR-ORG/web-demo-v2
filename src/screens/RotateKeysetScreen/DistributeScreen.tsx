import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Copy, Lock } from "lucide-react";
import { useAppState } from "../../app/AppState";
import { AppShell, PageHeading } from "../../components/shell";
import { BackLink, Button, QrButton, SecretDisplay, StatusPill, Stepper } from "../../components/ui";
import { PAPER_MASKED_PACKAGE } from "../../demo/fixtures";
import { useDemoUi } from "../../demo/demoUi";
import { MOCK_REMOTE_PACKAGES, MOCK_SOURCE_SHARE_1 } from "./mocks";
import { copySecret, navigateWithRotateState, rotatePhaseAtLeast } from "./utils";

export function RotateDistributeSharesScreen() {
  const navigate = useNavigate();
  const { rotateKeysetSession, updateRotatePackageState } = useAppState();
  const demoUi = useDemoUi();
  const demoDistribute = Boolean(demoUi.rotateKeyset || demoUi.shared || demoUi.progress);
  const [packageStates, setPackageStates] = useState(
    MOCK_REMOTE_PACKAGES.map((p) => ({ ...p, copied: false, qrShown: false }))
  );
  const remotePackages = rotateKeysetSession?.onboardingPackages ?? packageStates;
  const localIdx = rotateKeysetSession?.localShare?.idx ?? 0;
  const blocked = !rotatePhaseAtLeast(rotateKeysetSession, "profile_created") && !demoDistribute;
  const routeState = rotateKeysetSession ? { profileId: rotateKeysetSession.sourceProfile.id } : undefined;
  const completionReady = rotateKeysetSession
    ? remotePackages.every((pkg) => (pkg.packageCopied || pkg.copied || pkg.qrShown) && pkg.passwordCopied)
    : true;

  const updatePkg = (idx: number, patch: { copied?: boolean; packageCopied?: boolean; passwordCopied?: boolean; qrShown?: boolean }) => {
    if (rotateKeysetSession && updateRotatePackageState) {
      updateRotatePackageState(idx, patch);
      return;
    }
    const normalizedPatch = patch.copied ? { ...patch, packageCopied: true } : patch;
    setPackageStates((prev) => prev.map((p) => (p.idx === idx ? { ...p, ...normalizedPatch } : p)));
  };

  if (blocked) {
    return <Navigate to="/rotate-keyset/profile" replace />;
  }

  return (
    <AppShell headerMeta={rotateKeysetSession?.sourceProfile.label ?? MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <section className="distribute-column">
        <Stepper current={3} variant="rotate-keyset" />
        <BackLink onClick={() => navigateWithRotateState(navigate, "/rotate-keyset/profile", routeState)} />
        <PageHeading
          title="Distribute Shares"
          copy="Distribute the remaining bfonboard adoption packages to remote devices. Recipient devices adopt their fresh share through the standard onboarding flow."
        />

        {/* ---- Local share card ---- */}
        <div className="package-card saved">
          <div className="package-head">
              <div className="package-title-row">
                <div className="package-title">Share {localIdx + 1}</div>
                <div className="package-index">Index {localIdx}</div>
            </div>
            <StatusPill tone="success" marker="check">
              Saved to Igloo Web
            </StatusPill>
          </div>
          <SecretDisplay value="Saved securely in this browser" />
        </div>

        {/* ---- Remote package cards ---- */}
        <div className="package-stack">
	          {remotePackages.map((pkg) => {
	            const packageHandedOff = pkg.packageCopied || pkg.copied || pkg.qrShown;
	            const distributed = packageHandedOff && pkg.passwordCopied;
            /* VAL-RTK-005: Share 3 (index 2) renders in locked visual state —
               dashed "Enter password to unlock" placeholder and reduced-opacity
               Copy/QR controls until the package password is entered. */
            const locked = !rotateKeysetSession && pkg.idx === 2;
            return (
              <div className={`package-card${locked ? " locked" : ""}`} key={pkg.idx}>
                <div className="package-head">
                  <div className="package-title-row">
                    <div className="package-title">Share {pkg.idx + 1}</div>
                    <div className="package-index">Index {pkg.idx}</div>
                  </div>
                  <StatusPill tone={distributed ? "success" : "warning"}>
                    {distributed ? "Distributed" : "Not distributed"}
                  </StatusPill>
                </div>
                <SecretDisplay value={PAPER_MASKED_PACKAGE} />
                <div className="field">
                  <span className="kicker">Package Password</span>
                  <div className="password-lock-row">
                    {locked ? (
                      <SecretDisplay value="Enter password to unlock" dashed />
                    ) : (
                      <>
                        <SecretDisplay value="••••••••" title="Package password" />
                        <Lock size={14} color="#64748b" />
                      </>
                    )}
                  </div>
                </div>
                <div className={`package-actions${locked ? " locked" : ""}`}>
                  <Button
                    type="button"
                    variant="chip"
                    size="sm"
                    disabled={locked}
	                    onClick={() => {
	                      void copySecret(pkg.packageText);
	                      updatePkg(pkg.idx, { packageCopied: true, copied: true });
	                    }}
	                  >
	                    <Copy size={13} />
	                    Copy Package
	                  </Button>
	                  <Button
	                    type="button"
	                    variant="chip"
	                    size="sm"
	                    disabled={locked}
	                    onClick={() => {
	                      void copySecret(pkg.password);
	                      updatePkg(pkg.idx, { passwordCopied: true });
	                    }}
	                  >
	                    <Copy size={13} />
	                    Copy Password
	                  </Button>
                  <QrButton
                    value={pkg.packageText}
                    disabled={locked}
                    onShown={() => updatePkg(pkg.idx, { qrShown: true })}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Button type="button" size="full" disabled={!completionReady} onClick={() => navigateWithRotateState(navigate, "/rotate-keyset/complete", routeState)}>
          Continue to Completion
        </Button>
      </section>
    </AppShell>
  );
}
