import { Check } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, Stepper } from "../components/ui";
import { useDemoUi } from "../demo/demoUi";

export function DistributionCompleteScreen() {
  const navigate = useNavigate();
  const { createSession, finishDistribution } = useAppState();
  const demoUi = useDemoUi();

  if (!createSession?.createdProfileId) {
    return <Navigate to="/" replace />;
  }

  const accounted = createSession.onboardingPackages.filter((pkg) => pkg.copied || pkg.qrShown).length;
  const total = createSession.onboardingPackages.length;
  const complete = accounted === total;

  async function finish() {
    /*
     * VAL-SHR-011 — ensure we always navigate to a concrete
     * `/dashboard/{profileId}` URL even if the async finishDistribution()
     * throws or resolves to an empty value (e.g. when the demo bridge
     * momentarily omits createdProfileId). We prefer the value returned by
     * finishDistribution(), then fall back to the createSession's own
     * createdProfileId so the dashboard route always has a valid param.
     */
    let profileId = createSession?.createdProfileId ?? "";
    try {
      const resolved = await finishDistribution();
      if (resolved) {
        profileId = resolved;
      }
    } catch {
      // Swallow — we still navigate below using the fallback.
    }
    if (!profileId) {
      return;
    }
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
            {createSession.onboardingPackages.map((pkg, index) => {
              const distributed = pkg.copied || pkg.qrShown;
              const paperRows: { title: string; device: string; statuses: string[] }[] = [
                { title: "Member #1 - Igloo Mobile", device: "Existing Device", statuses: ["Copied", "QR shown"] },
                { title: "Member #2 - Igloo Desktop", device: "New Device", statuses: ["QR shown"] }
              ];
              const paperRow = demoUi.shared?.completionPreset ? paperRows[index] : undefined;
              return (
                <div className="completion-row" key={pkg.idx}>
                  <div className="completion-main">
                    <span className={`completion-check ${paperRow || distributed ? "" : "pending"}`}>
                      <Check size={13} />
                    </span>
                    <span>
                      <span className="value">{paperRow?.title ?? `Member #${pkg.idx + 1} - Igloo Device`}</span>
                      <span className="help">{paperRow?.device ?? "New Device"}</span>
                    </span>
                  </div>
                  <div className="inline-actions">
                    {paperRow
                      ? paperRow.statuses.map((status) => (
                          <span key={status} className="completion-status-ok">
                            {status}
                          </span>
                        ))
                      : null}
                    {!paperRow && pkg.copied ? <span className="completion-status-ok">Copied</span> : null}
                    {!paperRow && pkg.qrShown ? <span className="completion-status-ok">QR shown</span> : null}
                    {!paperRow && !distributed ? <span className="help">Pending</span> : null}
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
