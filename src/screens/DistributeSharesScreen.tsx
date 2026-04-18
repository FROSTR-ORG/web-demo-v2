import { Check, Lock } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, CopyBlock, QrButton, SecretDisplay, StatusPill, Stepper } from "../components/ui";
import { shortHex } from "../lib/bifrost/format";

export function DistributeSharesScreen() {
  const navigate = useNavigate();
  const { createSession, updatePackageState } = useAppState();

  if (!createSession?.keyset || !createSession.localShare || !createSession.createdProfileId) {
    return <Navigate to="/create" replace />;
  }

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <section className="distribute-column">
        <Stepper current={3} variant="shared" />
        <BackLink onClick={() => navigate("/create/profile")} />
        <PageHeading
          title="Distribute Shares"
          copy="Distribute the remaining bfonboard adoption packages to remote devices. Recipient devices use the standard onboarding flow to paste or scan them."
        />

        <div className="package-card saved">
          <div className="package-head">
            <div className="package-title-row">
              <div className="package-title">Share {createSession.localShare.idx + 1}</div>
              <div className="package-index">Index {createSession.localShare.idx}</div>
            </div>
            <StatusPill tone="success" marker="check">
              Saved to Igloo Web
            </StatusPill>
          </div>
          <SecretDisplay value="Saved securely in this browser" />
        </div>

        <div className="package-stack">
          {createSession.onboardingPackages.map((pkg) => {
            const distributed = pkg.copied || pkg.qrShown;
            return (
              <div className="package-card" key={pkg.idx}>
                <div className="package-head">
                  <div className="package-title-row">
                    <div className="package-title">Share {pkg.idx + 1}</div>
                    <div className="package-index">Index {pkg.idx}</div>
                  </div>
                  <StatusPill tone={distributed ? "success" : "warning"}>{distributed ? "Distributed" : "Not distributed"}</StatusPill>
                </div>
                <div className="help">Member {shortHex(pkg.memberPubkey)}</div>
                <CopyBlock value={pkg.packageText} onCopied={() => updatePackageState(pkg.idx, { copied: true })} />
                <div className="field">
                  <span className="kicker">Package Password</span>
                  <div className="password-lock-row">
                    <SecretDisplay value={pkg.password} masked title="Package password" />
                    <Lock size={14} color="#64748b" />
                  </div>
                </div>
                <div className="package-actions">
                  <QrButton value={pkg.packageText} onShown={() => updatePackageState(pkg.idx, { qrShown: true })} />
                </div>
              </div>
            );
          })}
        </div>

        <Button type="button" size="full" onClick={() => navigate("/create/complete")}>
          Continue to Completion
        </Button>
      </section>
    </AppShell>
  );
}
