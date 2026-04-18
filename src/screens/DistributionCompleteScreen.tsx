import { Check } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, Stepper } from "../components/ui";

export function DistributionCompleteScreen() {
  const navigate = useNavigate();
  const { createSession, finishDistribution } = useAppState();

  if (!createSession?.createdProfileId) {
    return <Navigate to="/" replace />;
  }

  const accounted = createSession.onboardingPackages.filter((pkg) => pkg.copied || pkg.qrShown).length;
  const total = createSession.onboardingPackages.length;
  const complete = accounted === total;

  async function finish() {
    const profileId = await finishDistribution();
    navigate(`/dashboard/${profileId}`);
  }

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <section className="screen-column">
        <Stepper current={3} variant="shared" />
        <BackLink onClick={() => navigate("/create/distribute")} />
        <PageHeading
          title="Distribution Completion"
          copy="Track which remote bfonboard adoption packages have been distributed. Finish when each target device is ready to adopt its fresh share through the standard onboarding flow."
        />
        <div className="completion-card">
          <div className="kicker">Distribution Status</div>
          <div className="completion-list">
            {createSession.onboardingPackages.map((pkg) => {
              const distributed = pkg.copied || pkg.qrShown;
              return (
                <div className="completion-row" key={pkg.idx}>
                  <div className="completion-main">
                    <span className={`completion-check ${distributed ? "" : "pending"}`}>
                      <Check size={13} />
                    </span>
                    <span>
                      <span className="value">Member #{pkg.idx + 1} - Igloo Device</span>
                      <span className="help">New Device</span>
                    </span>
                  </div>
                  <div className="inline-actions">
                    {pkg.copied ? <span className="completion-status-ok">Copied</span> : null}
                    {pkg.qrShown ? <span className="completion-status-ok">QR shown</span> : null}
                    {!distributed ? <span className="help">Pending</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="success-callout">
          <strong>{complete ? "All packages distributed" : "Distribution can continue"}</strong>
          <span>
            {accounted} of {total} remote bfonboard packages have been accounted for. Continue when device adoption handoff can proceed.
          </span>
        </div>
        <Button type="button" size="full" disabled={!complete} onClick={() => void finish()}>
          Finish Distribution
        </Button>
      </section>
    </AppShell>
  );
}
