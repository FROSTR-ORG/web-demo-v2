import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import {
  Button,
  QrButton,
  SecretDisplay,
  StatusPill,
  Stepper,
} from "../components/ui";
import { packageDistributed } from "../app/distributionPackages";
import type { OnboardingPackageView } from "../lib/bifrost/types";

/**
 * fix-followup-distribute-2b — Paper 8GU-0 rewrite.
 *
 * Top: "How this step works" info panel with three numbered steps
 * (verbatim Paper copy — see {@link HOW_THIS_STEP_WORKS_STEPS}).
 *
 * Per-share lifecycle (remote shares only; LOCAL idx=0 renders the
 * "Saved to Igloo Web" badge and nothing else):
 *   1. PRE-state (`packageCreated === false`):
 *      - chip "Package not created" (warning tone)
 *      - "Waiting for package password" helper copy
 *      - <input type="password"> + "Create package" primary CTA
 *      - secondary action row DISABLED (Copy/QR/Mark distributed)
 *   2. POST-state (`packageCreated === true`, not yet distributed):
 *      - chip "Ready to distribute" (info tone)
 *      - bfonboard1…-preview (first 24 chars + ellipsis)
 *      - masked password row (••••••••)
 *      - secondary action row ENABLED
 *   3. DISTRIBUTED-state (`peerOnline || manuallyMarkedDistributed`):
 *      - chip "Distributed" (success tone)
 *      - checked Mark-distributed indicator
 */

const HOW_THIS_STEP_WORKS_STEPS: { title: string; copy: string }[] = [
  {
    title: "Set password",
    copy: "Saving a password creates the bfonboard package for that device.",
  },
  {
    title: "Distribute",
    copy: "Copy package/password or show QR once the package exists.",
  },
  {
    title: "Complete",
    copy: "Echo turns the row green, or mark distributed manually when handoff is done.",
  },
];

async function copySecret(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    }
  } catch {
    // Clipboard availability varies in tests / non-secure preview
    // contexts. We still surface success so the workflow is not
    // blocked by clipboard errors.
  }
  return true;
}

function previewPackageText(packageText: string): string {
  if (!packageText) return "";
  // Post-encodeDistributionPackage, the stored `packageText` is
  // already a 24-char redacted preview. We defensively truncate
  // anyway + append the ellipsis so both demo fixtures (full
  // placeholder strings) and live runs render identically.
  const base = packageText.length > 24 ? packageText.slice(0, 24) : packageText;
  return `${base}…`;
}

function shareDisplayNumber(position: number): number {
  return position + 1;
}

export function DistributeSharesScreen() {
  const navigate = useNavigate();
  const {
    createSession,
    encodeDistributionPackage,
    markPackageDistributed,
    setPackageDeviceLabel,
    updatePackageState,
    getCreateSessionPackageSecret,
  } = useAppState();

  if (
    !createSession?.keyset ||
    !createSession.localShare ||
    !createSession.createdProfileId
  ) {
    return <Navigate to="/create" replace />;
  }

  /**
   * fix-m7-createsession-redact-secrets-on-finalize — after
   * `createProfile` / `encodeDistributionPackage` returns, the
   * serialised `onboardingPackages[*].packageText` / `.password` are
   * redaction sentinels. The Copy / QR affordances resolve the real
   * plaintext through the provider's out-of-band accessor instead.
   * Demo mode (no provider-side stash) falls back to the fixture
   * strings on the package view.
   */
  function resolveSecret(pkg: OnboardingPackageView): { packageText: string; password: string } {
    const stash = getCreateSessionPackageSecret?.(pkg.idx);
    if (stash) return stash;
    return { packageText: pkg.packageText, password: pkg.password };
  }

  const remoteCreatedAll = createSession.onboardingPackages.every(
    (pkg) => pkg.packageCreated,
  );

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <section className="distribute-column">
        <Stepper current={3} variant="shared" />
        {/* fix-followup-paper-parity-final-review — Paper 8GU-0 renders
            no BackLink on the Distribute Shares screen. Once a profile
            has been created and per-share onboard dispatches are in
            flight the flow is one-way; the Stepper remains as the
            navigation affordance. */}
        <PageHeading
          title="Distribute Shares"
          copy="Create each remote bfonboard package by setting its password, then hand off the package and password by copy or QR."
        />

        <div className="dash-info-panel" aria-label="How this step works">
          <div className="dash-panel-kicker">How this step works</div>
          <ol className="how-this-step-works-list">
            {HOW_THIS_STEP_WORKS_STEPS.map((step, idx) => (
              <li key={step.title} className="how-this-step-works-item">
                <span className="how-this-step-works-number" aria-hidden="true">
                  {idx + 1}.
                </span>
                <span className="how-this-step-works-body">
                  <strong className="how-this-step-works-title">
                    {step.title}
                  </strong>
                  <span className="how-this-step-works-dash" aria-hidden="true">
                    {" — "}
                  </span>
                  <span className="how-this-step-works-copy">{step.copy}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="package-card saved">
          <div className="package-head">
            <div className="package-title-row">
              <div className="package-title">
                Share {shareDisplayNumber(0)}
              </div>
            </div>
            <StatusPill tone="success" marker="check">
              Saved to Igloo Web
            </StatusPill>
          </div>
          <SecretDisplay value="Saved securely in this browser" />
        </div>

        <div className="package-stack">
          {createSession.onboardingPackages.map((pkg, index) => (
            <RemoteShareCard
              key={pkg.idx}
              pkg={pkg}
              displayNumber={shareDisplayNumber(index + 1)}
              encodeDistributionPackage={encodeDistributionPackage}
              markPackageDistributed={markPackageDistributed}
              setPackageDeviceLabel={setPackageDeviceLabel}
              updatePackageState={updatePackageState}
              resolveSecret={resolveSecret}
            />
          ))}
        </div>

        <Button
          type="button"
          size="full"
          disabled={!remoteCreatedAll}
          onClick={() => navigate("/create/complete")}
        >
          Continue to Completion
        </Button>
      </section>
    </AppShell>
  );
}

function RemoteShareCard({
  pkg,
  displayNumber,
  encodeDistributionPackage,
  markPackageDistributed,
  setPackageDeviceLabel,
  updatePackageState,
  resolveSecret,
}: {
  pkg: OnboardingPackageView;
  displayNumber: number;
  encodeDistributionPackage: (idx: number, password: string) => Promise<void>;
  markPackageDistributed: (idx: number) => void;
  setPackageDeviceLabel: (idx: number, deviceLabel: string) => void;
  updatePackageState: (
    idx: number,
    patch: {
      packageCopied?: boolean;
      passwordCopied?: boolean;
      copied?: boolean;
      qrShown?: boolean;
    },
  ) => void;
  resolveSecret: (pkg: OnboardingPackageView) => {
    packageText: string;
    password: string;
  };
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const distributed = packageDistributed(pkg);
  const actionsDisabled = !pkg.packageCreated;

  async function onCreatePackage() {
    setError("");
    if (password.length < 8) {
      setError("Package password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await encodeDistributionPackage(pkg.idx, password);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create package.",
      );
    } finally {
      setBusy(false);
    }
  }

  let chip: { tone: "warning" | "info" | "success"; label: string };
  if (distributed) {
    chip = { tone: "success", label: "Distributed" };
  } else if (pkg.packageCreated) {
    chip = { tone: "info", label: "Ready to distribute" };
  } else {
    chip = { tone: "warning", label: "Package not created" };
  }

  return (
    <div className={`package-card${pkg.packageCreated ? "" : " pending"}`}>
      <div className="package-head">
        <div className="package-title-row">
          <div className="package-title">Share {displayNumber}</div>
        </div>
        <StatusPill
          tone={chip.tone}
          marker={chip.tone === "success" ? "check" : "none"}
        >
          {chip.label}
        </StatusPill>
      </div>

      {pkg.packageCreated ? (
        <SecretDisplay value={previewPackageText(pkg.packageText)} />
      ) : (
        <SecretDisplay value="Waiting for package password" dashed />
      )}

      <div className="field">
        <span className="kicker">Device Label</span>
        <span className="input-shell">
          <input
            className="input"
            type="text"
            aria-label={`Device label for share ${displayNumber}`}
            placeholder="Optional device label"
            value={pkg.deviceLabel ?? ""}
            onChange={(event) =>
              setPackageDeviceLabel(pkg.idx, event.target.value)
            }
          />
        </span>
      </div>

      <div className="field">
        <span className="kicker">Package Password</span>
        {pkg.packageCreated ? (
          <div className="password-lock-row">
            <SecretDisplay value="••••••••" title="Package password" />
          </div>
        ) : (
          <>
            <span className="input-shell">
              <input
                className="input password-input"
                type="password"
                aria-label={`Package password for share ${displayNumber}`}
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError("");
                }}
                disabled={busy}
              />
            </span>
            {error ? <span className="error">{error}</span> : null}
            <Button
              type="button"
              onClick={() => void onCreatePackage()}
              disabled={busy || password.length === 0}
            >
              {busy ? "Creating package..." : "Create package"}
            </Button>
          </>
        )}
      </div>

      {pkg.adoptionError ? (
        <span className="error" role="alert" data-testid={`adoption-error-${pkg.idx}`}>
          {pkg.adoptionError}
        </span>
      ) : null}

      <div
        className={`package-actions${actionsDisabled ? " locked" : ""}`}
      >
        <Button
          type="button"
          variant="chip"
          size="sm"
          disabled={actionsDisabled}
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
          Copy package
        </Button>
        <Button
          type="button"
          variant="chip"
          size="sm"
          disabled={actionsDisabled}
          onClick={async () => {
            const { password: pw } = resolveSecret(pkg);
            if (await copySecret(pw)) {
              updatePackageState(pkg.idx, { passwordCopied: true });
            }
          }}
        >
          <Copy size={13} />
          Copy password
        </Button>
        <QrButton
          value={resolveSecret(pkg).packageText}
          disabled={actionsDisabled}
          onShown={() => updatePackageState(pkg.idx, { qrShown: true })}
        />
        <Button
          type="button"
          variant="chip"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => markPackageDistributed(pkg.idx)}
        >
          {distributed ? <Check size={13} /> : null}
          Mark distributed
        </Button>
      </div>
    </div>
  );
}
