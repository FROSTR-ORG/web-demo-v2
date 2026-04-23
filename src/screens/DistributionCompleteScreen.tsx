import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, StatusPill, Stepper } from "../components/ui";
import {
  allPackagesDistributed,
  packageDistributed,
} from "../app/distributionPackages";
import { shortHex } from "../lib/bifrost/format";

/**
 * fix-followup-distribute-2b — Paper LN7-0 rewrite.
 *
 * Header: "Distribution Completion"
 * Subhead (EXACT): "Track which remote bfonboard adoption packages
 *   have been distributed. Finish when each target device is ready
 *   to adopt its fresh share through the standard onboarding flow."
 * Per-member row: recipient pubkey suffix + 'Marked distributed'
 *   green chip (pre-distribution rows expose a Mark-distributed
 *   fallback per VAL-FOLLOWUP-005).
 * Success callout (EXACT): 'All packages distributed — N of N remote
 *   bfonboard packages have been marked distributed. Continue when
 *   device adoption handoff can proceed.'
 * Finish Distribution primary CTA ENABLED iff allPackagesDistributed().
 */

export const DISTRIBUTION_COMPLETION_SUBHEAD =
  "Track which remote bfonboard adoption packages have been distributed. Finish when each target device is ready to adopt its fresh share through the standard onboarding flow.";

export function DistributionCompleteScreen() {
  const navigate = useNavigate();
  const { createSession, finishDistribution, clearCreateSession, markPackageDistributed } =
    useAppState();
  const [handoffStarted, setHandoffStarted] = useState(false);
  const handoffStartedRef = useRef(false);

  if (!createSession?.createdProfileId) {
    return handoffStarted ? null : <Navigate to="/" replace />;
  }

  const packages = createSession.onboardingPackages;
  const total = packages.length;
  const complete = allPackagesDistributed(packages);
  const distributedCount = packages.filter(packageDistributed).length;

  function completionLabel(pkg: (typeof packages)[number]): string {
    const deviceLabel = pkg.deviceLabel?.trim();
    return deviceLabel && deviceLabel.length > 0
      ? deviceLabel
      : shortHex(pkg.memberPubkey, 8, 4);
  }

  async function finish() {
    if (handoffStartedRef.current) {
      return;
    }
    handoffStartedRef.current = true;
    setHandoffStarted(true);
    /*
     * VAL-SHR-011 — always navigate to a concrete
     * `/dashboard/{profileId}` URL even if the async
     * finishDistribution() throws or resolves to an empty value.
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
      handoffStartedRef.current = false;
      setHandoffStarted(false);
      return;
    }
    navigate(`/dashboard/${profileId}`);
    window.setTimeout(clearCreateSession, 0);
  }

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <section className="screen-column">
        <Stepper current={3} variant="shared" />
        <BackLink onClick={() => navigate("/create/distribute")} />
        <PageHeading
          title="Distribution Completion"
          copy={DISTRIBUTION_COMPLETION_SUBHEAD}
        />
        <div className="completion-card">
          <div className="kicker">Distribution Status</div>
          <div className="completion-list">
            {packages.map((pkg) => {
              const distributed = packageDistributed(pkg);
              return (
                <div className="completion-row" key={pkg.idx}>
                  <div className="completion-main">
                    <span
                      className={`completion-check${distributed ? "" : " pending"}`}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="value">
                        Member #{pkg.idx + 1}
                        {" — "}
                        {completionLabel(pkg)}
                      </span>
                    </span>
                  </div>
                  <div className="inline-actions">
                    {distributed ? (
                      // fix-followup-paper-parity-final-review — Paper LN7-0
                      // distinguishes the two distributed sub-states: an
                      // echoed package (peerOnline === true) renders
                      // "Echo received" while a manual handoff renders
                      // "Marked distributed". Both tones are success/green.
                      // If BOTH flags are set (echo arrived AND user hit
                      // Mark distributed), prefer "Echo received" since
                      // the peer genuinely came online.
                      <StatusPill tone="success" marker="check">
                        {pkg.peerOnline ? "Echo received" : "Marked distributed"}
                      </StatusPill>
                    ) : (
                      <Button
                        type="button"
                        variant="chip"
                        size="sm"
                        onClick={() => markPackageDistributed(pkg.idx)}
                      >
                        Mark distributed
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {complete ? (
          <div className="success-callout">
            {/* fix-followup-paper-parity-final-review — Paper LN7-0
                renders a "All remote packages complete" title above
                the callout body. The body copy below is pinned by
                VAL-FOLLOWUP-012's exact-text assertion (see
                docs/runtime-deviations-from-paper.md > "Distribution
                Completion callout body"). */}
            <strong className="success-callout-title">
              All remote packages complete
            </strong>
            <span>
              All packages distributed — {distributedCount} of {total} remote
              bfonboard packages have been marked distributed. Continue when
              device adoption handoff can proceed.
            </span>
          </div>
        ) : null}
        <Button
          type="button"
          size="full"
          disabled={!complete || handoffStarted}
          onClick={() => void finish()}
        >
          Finish Distribution
        </Button>
      </section>
    </AppShell>
  );
}
