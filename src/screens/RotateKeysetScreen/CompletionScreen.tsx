import { Navigate, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useAppState } from "../../app/AppState";
import { AppShell, PageHeading } from "../../components/shell";
import { BackLink, Button, Stepper } from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
import { MOCK_SOURCE_SHARE_1, ROTATE_COMPLETION_ROWS } from "./mocks";
import { navigateWithRotateState, rotatePhaseAtLeast } from "./utils";

export function RotateDistributionCompleteScreen() {
  const navigate = useNavigate();
  const { activeProfile, rotateKeysetSession, finishRotateDistribution } = useAppState();
  const demoUi = useDemoUi();
  const demoComplete = Boolean(demoUi.rotateKeyset || demoUi.shared || demoUi.progress);

  const sessionPackages = rotateKeysetSession?.onboardingPackages ?? [];
	  const rows = sessionPackages.length
	    ? sessionPackages.map((pkg) => ({
	        title: `Member #${pkg.idx} — Igloo Device`,
	        device: "New Device",
	        statuses: [
	          (pkg.packageCopied || pkg.copied) ? "Package copied" : "",
	          pkg.passwordCopied ? "Password copied" : "",
	          pkg.qrShown ? "QR shown" : ""
	        ].filter(Boolean)
	      }))
	    : ROTATE_COMPLETION_ROWS;
	  const total = rows.length;
  /* Paper reference shows all members accounted for (per success callout).
     We treat every row as distributed so the CTA is enabled and the
     success banner renders as "All packages distributed". */
	  const accounted = sessionPackages.length
	    ? sessionPackages.filter((pkg) => (pkg.packageCopied || pkg.copied || pkg.qrShown) && pkg.passwordCopied).length
	    : total;
  const complete = accounted === total;
  const blocked = !rotatePhaseAtLeast(rotateKeysetSession, "distribution_ready") && !demoComplete;
  const routeState = rotateKeysetSession ? { profileId: rotateKeysetSession.sourceProfile.id } : undefined;

  const handleFinish = async () => {
    if (rotateKeysetSession && finishRotateDistribution) {
      const profileId = await finishRotateDistribution();
      navigate(`/dashboard/${profileId}`);
      return;
    }
    navigate(activeProfile ? `/dashboard/${activeProfile.id}` : "/");
  };

  if (blocked) {
    return <Navigate to="/rotate-keyset/distribute" replace />;
  }

  return (
    <AppShell headerMeta={rotateKeysetSession?.sourceProfile.label ?? MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <section className="screen-column">
        <Stepper current={3} variant="rotate-keyset" />
        <BackLink onClick={() => navigateWithRotateState(navigate, "/rotate-keyset/distribute", routeState)} />
        <PageHeading
          title="Distribution Completion"
          copy="Track which remote bfonboard adoption packages have been distributed. Finish when each target device is ready to adopt its fresh share through the standard onboarding flow."
        />

        <div className="completion-card">
          <div className="kicker">Distribution Status</div>
          <div className="completion-list">
            {rows.map((row) => (
              <div className="completion-row" key={row.title}>
                <div className="completion-main">
                  <span className="completion-check">
                    <Check size={13} />
                  </span>
                  <span>
                    <span className="value">{row.title}</span>
                    <span className="help">{row.device}</span>
                  </span>
                </div>
                <div className="inline-actions">
                  {row.statuses.map((status) => (
                    <span key={status} className="completion-status-ok">
                      {status}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="success-callout">
          <strong>{complete ? "All packages distributed" : "Distribution can continue"}</strong>
          <span>
            {accounted} of {total} remote bfonboard packages have been accounted for. Continue when device adoption handoff can proceed.
          </span>
        </div>

        <Button type="button" size="full" disabled={!complete} onClick={() => void handleFinish()}>
          Finish Distribution
        </Button>
      </section>
    </AppShell>
  );
}
