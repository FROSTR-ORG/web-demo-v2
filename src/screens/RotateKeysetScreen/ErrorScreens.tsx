import { useLocation, useNavigate } from "react-router-dom";
import { AppShell, PageHeading } from "../../components/shell";
import { BackLink, Button, Stepper } from "../../components/ui";
import { MOCK_SOURCE_SHARE_1 } from "./mocks";
import { navigateWithRotateState } from "./utils";

export function RotateWrongPasswordScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    profileId?: string;
    errorMessage?: string;
    details?: {
      sourceIndex?: number;
      source?: string;
      packagePrefix?: string;
      relayChecked?: boolean;
    };
  } | null;
  const routeState = state?.profileId
    ? { profileId: state.profileId }
    : undefined;
  const sourceLabel =
    state?.details?.source === "saved_profile"
      ? "Source Share #1"
      : `Source Share #${state?.details?.sourceIndex ?? 2}`;
  const message =
    state?.errorMessage ??
    "Wrong password. Unable to decrypt this source package.";
  const paperAlignedMessage = message.replaceAll(
    "bfshare source package",
    "source package",
  );
  const failedPackageDisplay =
    state?.details?.packagePrefix ??
    "bfshare1qvz8k2afcqqszq...";

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink
          onClick={() =>
            navigateWithRotateState(navigate, "/rotate-keyset", routeState)
          }
        />
        <PageHeading
          title="Source Package Error"
          copy="One or more source packages could not be validated. Check the details below and retry."
        />

        {/* ---- Failed source share card ---- */}
        <div className="rotate-error-card wrong-password">
          <div className="rotate-error-card-header">
            <span className="rotate-error-card-title">{sourceLabel}</span>
            <span className="rotate-error-badge failed">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  stroke="#EF4444"
                  strokeWidth="1.2"
                />
                <path
                  d="M5 5l4 4M9 5l-4 4"
                  stroke="#EF4444"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              Failed
            </span>
          </div>

          <div className="rotate-error-field">
            <span className="rotate-error-field-mono">
              {failedPackageDisplay}
            </span>
          </div>
          <div className="rotate-error-field">
            <span className="rotate-error-field-mono">••••••••</span>
          </div>

          {/* Red error banner */}
          <div className="rotate-error-banner red">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="#EF4444"
                strokeWidth="1.2"
              />
              <path
                d="M7 4.5v3M7 9.5h.01"
                stroke="#EF4444"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span>{paperAlignedMessage}</span>
          </div>

          <div className="rotate-error-banner amber">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="#FBBF24"
                strokeWidth="1.2"
              />
              <path
                d="M7 4.5v3M7 9.5h.01"
                stroke="#FBBF24"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span>No share data found for this source package.</span>
          </div>
        </div>

        <Button
          type="button"
          size="full"
          onClick={() =>
            navigateWithRotateState(navigate, "/rotate-keyset", routeState)
          }
        >
          Retry
        </Button>
      </div>
    </AppShell>
  );
}

export function RotateGroupMismatchScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    profileId?: string;
    errorMessage?: string;
    details?: {
      groupPublicKey?: string;
      shareIndex?: number;
      sourceIndex?: number;
    };
  } | null;
  const routeState = state?.profileId
    ? { profileId: state.profileId }
    : undefined;
  const details = state?.details;

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        {/*
          Per VAL-RTK-008 and the Paper reference, this error screen renders
          NO top BackLink — the only way out is the "Back to Source Intake"
          primary CTA at the bottom.
        */}
        <PageHeading
          title="Source Group Mismatch"
          copy="The source packages do not match the same current group configuration and group public key."
        />

        {/* ---- Mismatch card ---- */}
        <div className="rotate-error-card mismatch">
          <div className="rotate-mismatch-header">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle
                cx="10"
                cy="10"
                r="8"
                stroke="#EF4444"
                strokeWidth="1.5"
              />
              <path
                d="M7 7l6 6M13 7l-6 6"
                stroke="#EF4444"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="rotate-mismatch-title">
              Sources belong to different groups
            </span>
          </div>

          <div className="rotate-mismatch-keys">
            <div className="rotate-mismatch-row">
              <span className="rotate-mismatch-label">Share #1 Group</span>
              <span className="rotate-mismatch-value blue">
                {formatMismatchGroup(details?.groupPublicKey)}
              </span>
            </div>
            <div className="rotate-mismatch-row last">
              <span className="rotate-mismatch-label">
                {mismatchLabel(details)}
              </span>
              <span className="rotate-mismatch-value red">
                {mismatchValue(details)}
              </span>
            </div>
          </div>

          <p className="rotate-mismatch-help">
            {state?.errorMessage ??
              "All bfshare source packages must match the same current group configuration and group public key. Replace one source and retry."}
          </p>
        </div>

        <Button
          type="button"
          size="full"
          onClick={() =>
            navigateWithRotateState(navigate, "/rotate-keyset", routeState)
          }
        >
          Back to Source Intake
        </Button>
      </div>
    </AppShell>
  );
}

export function RotateGenerationFailedScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    profileId?: string;
    errorMessage?: string;
    details?: { failedPhase?: string };
  } | null;
  const routeState = state?.profileId
    ? { profileId: state.profileId }
    : undefined;

  const failedPhases = generationFailurePhases(state?.details?.failedPhase);

  return (
    <AppShell headerMeta={MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink
          onClick={() =>
            navigateWithRotateState(navigate, "/rotate-keyset", routeState)
          }
        />
        <PageHeading
          title="Generation Failed"
          copy={
            state?.details?.failedPhase
              ? "Share generation failed at the phase shown below. No shares were modified. You may safely retry."
              : "Share generation failed. No shares were modified. You may safely retry."
          }
        />

        {/* ---- Phase list with failed phase ---- */}
        <div className="generation-progress-card">
          {failedPhases.map((phase) => (
            <div
              className={`generation-phase ${phase.state}`}
              key={phase.label}
            >
              {phase.state === "done" ? (
                <span className="gen-failed-dot done">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      cx="9"
                      cy="9"
                      r="7"
                      fill="rgba(34,197,94,0.2)"
                      stroke="#4ADE80"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M6 9l2 2 4-4"
                      stroke="#4ADE80"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : (
                <span className="gen-failed-dot failed">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      cx="9"
                      cy="9"
                      r="7"
                      fill="rgba(127,29,29,0.2)"
                      stroke="#EF4444"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M6.5 6.5l5 5M11.5 6.5l-5 5"
                      stroke="#EF4444"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              )}
              <span className="generation-phase-label">{phase.label}</span>
              {phase.state === "failed" && (
                <span className="generation-phase-status">Failed</span>
              )}
            </div>
          ))}
        </div>

        {/* ---- Green safety banner ---- */}
        <div className="rotate-safety-banner">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="8" cy="8" r="6" stroke="#4ADE80" strokeWidth="1.2" />
            <path
              d="M8 5v3M8 11h.01"
              stroke="#4ADE80"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <span>
            No shares were modified. Your current configuration is intact.
          </span>
        </div>

        <Button
          type="button"
          size="full"
          onClick={() =>
            navigateWithRotateState(
              navigate,
              "/rotate-keyset/review",
              routeState,
            )
          }
        >
          Retry Generation
        </Button>
      </div>
    </AppShell>
  );
}

export function formatMismatchGroup(groupPublicKey?: string): string {
  return groupPublicKey
    ? `${groupPublicKey.slice(0, 10)}...${groupPublicKey.slice(-4)}`
    : "npub1qe3...7kkm";
}

export function mismatchLabel(details?: {
  shareIndex?: number;
  sourceIndex?: number;
}): string {
  const sourceIndex = details?.sourceIndex ?? 2;
  return `Share #${sourceIndex}${details?.shareIndex !== undefined ? "" : " Group"}`;
}

export function mismatchValue(details?: {
  groupPublicKey?: string;
  shareIndex?: number;
}): string {
  return details?.shareIndex !== undefined
    ? `Index ${details.shareIndex}`
    : "npub1x7f...2mnp";
}

export function generationFailurePhases(
  failedPhase?: string,
): Array<{ label: string; state: "done" | "failed" }> {
  const labels = [
    "Decrypt sources",
    "Recover current profiles",
    "Verify same group config + group public key",
    "Reconstruct signing key",
    "Generate Fresh Shares",
  ];
  const target =
    failedPhase && labels.includes(failedPhase)
      ? failedPhase
      : "Reconstruct signing key";
  const failedIndex = labels.indexOf(target);
  return labels.slice(0, Math.max(failedIndex + 1, 1)).map((label, index) => ({
    label,
    state: index === failedIndex ? "failed" : "done",
  }));
}
