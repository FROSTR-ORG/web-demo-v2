import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { useAppState } from "../../app/AppState";
import {
  allPackagesDistributed,
  normalizePackageStatePatch,
  packageDistributed,
} from "../../app/distributionPackages";
import { AppShell, PageHeading } from "../../components/shell";
import {
  BackLink,
  Button,
  QrButton,
  SecretDisplay,
  StatusPill,
  Stepper,
} from "../../components/ui";
import type { OnboardingPackageView } from "../../lib/bifrost/types";
import { useDemoUi } from "../../demo/demoUi";
import { MOCK_REMOTE_PACKAGES, MOCK_SOURCE_SHARE_1 } from "./mocks";
import {
  copySecret,
  navigateWithRotateState,
  rotatePhaseAtLeast,
} from "./utils";

function previewPackageText(packageText: string): string {
  if (!packageText) return "";
  const base = packageText.length > 24 ? packageText.slice(0, 24) : packageText;
  return `${base}…`;
}

export function RotateDistributeSharesScreen() {
  const navigate = useNavigate();
  const {
    rotateKeysetSession,
    encodeRotateDistributionPackage,
    markRotatePackageDistributed,
    updateRotatePackageState,
    getRotateSessionPackageSecret,
  } = useAppState();
  const demoUi = useDemoUi();
  const demoDistribute = Boolean(
    demoUi.rotateKeyset || demoUi.shared || demoUi.progress,
  );
  const [packageStates, setPackageStates] = useState(MOCK_REMOTE_PACKAGES);
  const remotePackages =
    rotateKeysetSession?.onboardingPackages ?? packageStates;
  const localIdx = rotateKeysetSession?.localShare?.idx ?? 0;
  const blocked =
    !rotatePhaseAtLeast(rotateKeysetSession, "profile_created") &&
    !demoDistribute;
  const routeState = rotateKeysetSession
    ? { profileId: rotateKeysetSession.sourceProfile.id }
    : undefined;
  const completionReady = allPackagesDistributed(remotePackages);

  const updatePkg = (
    idx: number,
    patch: {
      copied?: boolean;
      packageCopied?: boolean;
      passwordCopied?: boolean;
      qrShown?: boolean;
    },
  ) => {
    if (rotateKeysetSession && updateRotatePackageState) {
      updateRotatePackageState(idx, patch);
      return;
    }
    const normalizedPatch = normalizePackageStatePatch(patch);
    setPackageStates((prev) =>
      prev.map((pkg) => (pkg.idx === idx ? { ...pkg, ...normalizedPatch } : pkg)),
    );
  };

  const markDistributed = (idx: number) => {
    if (rotateKeysetSession && markRotatePackageDistributed) {
      markRotatePackageDistributed(idx);
      return;
    }
    setPackageStates((prev) =>
      prev.map((pkg) =>
        pkg.idx === idx ? { ...pkg, manuallyMarkedDistributed: true } : pkg,
      ),
    );
  };

  const createPackage = async (idx: number, password: string) => {
    if (rotateKeysetSession && encodeRotateDistributionPackage) {
      await encodeRotateDistributionPackage(idx, password);
      return;
    }
    setPackageStates((prev) =>
      prev.map((pkg) =>
        pkg.idx === idx
          ? {
              ...pkg,
              packageText: `bfonboard1demo-rotate-${idx}`,
              password,
              packageCreated: true,
            }
          : pkg,
      ),
    );
  };

  function resolveSecret(pkg: OnboardingPackageView) {
    const stash = getRotateSessionPackageSecret?.(pkg.idx);
    if (stash) return stash;
    return { packageText: pkg.packageText, password: pkg.password };
  }

  if (blocked) {
    return <Navigate to="/rotate-keyset/profile" replace />;
  }

  return (
    <AppShell
      headerMeta={
        rotateKeysetSession?.sourceProfile.label ?? MOCK_SOURCE_SHARE_1.label
      }
      mainVariant="flow"
    >
      <section className="distribute-column">
        <Stepper current={3} variant="rotate-keyset" />
        <BackLink
          onClick={() =>
            navigateWithRotateState(
              navigate,
              "/rotate-keyset/profile",
              routeState,
            )
          }
        />
        <PageHeading
          title="Distribute Shares"
          copy="Create each remote bfonboard package by setting its password, then hand off the package and password by copy or QR. Mark each share distributed once the device has what it needs to adopt its fresh share."
        />

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

        <div className="package-stack">
          {remotePackages.map((pkg) => (
            <RotateRemoteShareCard
              key={pkg.idx}
              pkg={pkg}
              distributed={packageDistributed(pkg)}
              actionsDisabled={!pkg.packageCreated}
              resolveSecret={() => resolveSecret(pkg)}
              onCreatePackage={createPackage}
              onMarkDistributed={markDistributed}
              onUpdatePkg={updatePkg}
            />
          ))}
        </div>

        <Button
          type="button"
          size="full"
          disabled={!completionReady}
          onClick={() =>
            navigateWithRotateState(
              navigate,
              "/rotate-keyset/complete",
              routeState,
            )
          }
        >
          Continue to Completion
        </Button>
      </section>
    </AppShell>
  );
}

function RotateRemoteShareCard({
  pkg,
  distributed,
  actionsDisabled,
  resolveSecret,
  onCreatePackage,
  onMarkDistributed,
  onUpdatePkg,
}: {
  pkg: OnboardingPackageView;
  distributed: boolean;
  actionsDisabled: boolean;
  resolveSecret: () => { packageText: string; password: string };
  onCreatePackage: (idx: number, password: string) => Promise<void>;
  onMarkDistributed: (idx: number) => void;
  onUpdatePkg: (
    idx: number,
    patch: {
      copied?: boolean;
      packageCopied?: boolean;
      passwordCopied?: boolean;
      qrShown?: boolean;
    },
  ) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  let chip: { tone: "warning" | "info" | "success"; label: string };
  if (distributed) {
    chip = { tone: "success", label: "Distributed" };
  } else if (pkg.packageCreated) {
    chip = { tone: "info", label: "Ready to distribute" };
  } else {
    chip = { tone: "warning", label: "Package not created" };
  }

  async function handleCreatePackage() {
    setError("");
    if (password.length < 8) {
      setError("Package password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await onCreatePackage(pkg.idx, password);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create package.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`package-card${pkg.packageCreated ? "" : " pending"}`}>
      <div className="package-head">
        <div className="package-title-row">
          <div className="package-title">Share {pkg.idx + 1}</div>
          <div className="package-index">Index {pkg.idx}</div>
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
                aria-label={`Package password for share ${pkg.idx + 1}`}
                value={password}
                disabled={busy}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError("");
                }}
              />
            </span>
            {error ? <span className="error">{error}</span> : null}
            <Button
              type="button"
              disabled={busy || password.length === 0}
              onClick={() => void handleCreatePackage()}
            >
              {busy ? "Creating package..." : "Create package"}
            </Button>
          </>
        )}
      </div>

      <div className={`package-actions${actionsDisabled ? " locked" : ""}`}>
        <Button
          type="button"
          variant="chip"
          size="sm"
          disabled={actionsDisabled}
          onClick={async () => {
            const { packageText } = resolveSecret();
            if (await copySecret(packageText)) {
              onUpdatePkg(pkg.idx, {
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
          disabled={actionsDisabled}
          onClick={async () => {
            const { password: packagePassword } = resolveSecret();
            if (await copySecret(packagePassword)) {
              onUpdatePkg(pkg.idx, { passwordCopied: true });
            }
          }}
        >
          <Copy size={13} />
          Copy Password
        </Button>
        <QrButton
          value={resolveSecret().packageText}
          disabled={actionsDisabled}
          onShown={() => onUpdatePkg(pkg.idx, { qrShown: true })}
        />
        <Button
          type="button"
          variant="chip"
          size="sm"
          disabled={actionsDisabled}
          onClick={() => onMarkDistributed(pkg.idx)}
        >
          {distributed ? <Check size={13} /> : null}
          Mark distributed
        </Button>
      </div>
    </div>
  );
}
