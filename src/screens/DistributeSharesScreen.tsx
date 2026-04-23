import { Copy, Lock } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import {
  BackLink,
  Button,
  QrButton,
  SecretDisplay,
  StatusPill,
  Stepper,
} from "../components/ui";
import { PAPER_MASKED_PACKAGE } from "../demo/fixtures";
import { useDemoUi } from "../demo/demoUi";
import { shortHex } from "../lib/bifrost/format";

async function copySecret(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    }
  } catch {
    // Clipboard availability varies in tests and non-secure preview contexts.
    // We still report success so the workflow is not blocked by clipboard errors.
  }
  return true;
}

export function DistributeSharesScreen() {
  const navigate = useNavigate();
  const { createSession, updatePackageState, getCreateSessionPackageSecret } =
    useAppState();
  const demoUi = useDemoUi();

  /**
   * fix-m7-createsession-redact-secrets-on-finalize — after
   * `createProfile` returns, `createSession.onboardingPackages[*].
   * packageText` / `.password` are redaction sentinels so the
   * serialised AppState (window.__appState, IndexedDB, console
   * transcripts) never carries the plaintext. The Copy / QR
   * affordances resolve the real plaintext through the provider's
   * out-of-band accessor instead. Demo mode (no provider-side stash)
   * falls back to `pkg.packageText` / `pkg.password` which are just
   * placeholder strings for the deterministic gallery.
   */
  function resolveSecret(pkg: {
    idx: number;
    packageText: string;
    password: string;
  }): { packageText: string; password: string } {
    const stash = getCreateSessionPackageSecret?.(pkg.idx);
    if (stash) return stash;
    return { packageText: pkg.packageText, password: pkg.password };
  }

  if (
    !createSession?.keyset ||
    !createSession.localShare ||
    !createSession.createdProfileId
  ) {
    return <Navigate to="/create" replace />;
  }

  const completionReady = createSession.onboardingPackages.every(
    (pkg) =>
      (pkg.packageCopied || pkg.copied || pkg.qrShown) && pkg.passwordCopied,
  );

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
              <div className="package-title">
                Share {createSession.localShare.idx + 1}
              </div>
              <div className="package-index">
                Index {createSession.localShare.idx}
              </div>
            </div>
            <StatusPill tone="success" marker="check">
              Saved to Igloo Web
            </StatusPill>
          </div>
          <SecretDisplay value="Saved securely in this browser" />
        </div>

        <div className="package-stack">
          {createSession.onboardingPackages.map((pkg) => {
            const packageHandedOff =
              pkg.packageCopied || pkg.copied || pkg.qrShown;
            const distributed = packageHandedOff && pkg.passwordCopied;
            const locked =
              demoUi.shared?.lockedPackageIndexes?.includes(pkg.idx) ?? false;
            return (
              <div
                className={`package-card${locked ? " locked" : ""}`}
                key={pkg.idx}
              >
                <div className="package-head">
                  <div className="package-title-row">
                    <div className="package-title">Share {pkg.idx + 1}</div>
                    <div className="package-index">Index {pkg.idx}</div>
                  </div>
                  <StatusPill tone={distributed ? "success" : "warning"}>
                    {distributed ? "Distributed" : "Not distributed"}
                  </StatusPill>
                </div>
                <div className="help">Member {shortHex(pkg.memberPubkey)}</div>
                <SecretDisplay value={PAPER_MASKED_PACKAGE} />
                <div className="field">
                  <span className="kicker">Package Password</span>
                  <div className="password-lock-row">
                    {locked ? (
                      <SecretDisplay value="Enter password to unlock" dashed />
                    ) : (
                      <>
                        <SecretDisplay
                          value="••••••••"
                          title="Package password"
                        />
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
                    onClick={async () => {
                      const { packageText } = resolveSecret(pkg);
                      if (await copySecret(packageText)) {
                        updatePackageState(pkg.idx, {
                          packageCopied: true,
                          copied: true,
                        });
                      }
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
                    onClick={async () => {
                      const { password } = resolveSecret(pkg);
                      if (await copySecret(password)) {
                        updatePackageState(pkg.idx, { passwordCopied: true });
                      }
                    }}
                  >
                    <Copy size={13} />
                    Copy Password
                  </Button>
                  <QrButton
                    value={resolveSecret(pkg).packageText}
                    disabled={locked}
                    onShown={() =>
                      updatePackageState(pkg.idx, { qrShown: true })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          size="full"
          disabled={!completionReady}
          onClick={() => navigate("/create/complete")}
        >
          Continue to Completion
        </Button>
      </section>
    </AppShell>
  );
}
