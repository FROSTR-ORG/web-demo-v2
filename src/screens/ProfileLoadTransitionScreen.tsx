import { FileText, Settings, SlidersHorizontal } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button } from "../components/ui";

type ProfileLoadTransitionVariant = "loading" | "error";

interface ProfileLoadTransitionProfile {
  id: string;
  label: string;
  groupName?: string;
  threshold: number;
  memberCount: number;
  localShareIdx: number;
  groupPublicKey: string;
}

interface ProfileLoadTransitionScreenProps {
  variant?: ProfileLoadTransitionVariant;
  profile?: ProfileLoadTransitionProfile | null;
  onRetry?: () => void;
  onBackToProfiles?: () => void;
}

export function ProfileLoadTransitionScreen({
  variant = "loading",
  profile: profileProp,
  onRetry,
  onBackToProfiles,
}: ProfileLoadTransitionScreenProps) {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile, profiles } = useAppState();
  const resolvedProfile =
    profileProp ??
    (profileId
      ? activeProfile?.id === profileId
        ? activeProfile
        : profiles.find((profile) => profile.id === profileId)
      : null);

  if (!resolvedProfile) {
    if (profileId && profiles.length === 0) {
      return null;
    }
    return <Navigate to="/" replace />;
  }

  const handleRetry = onRetry ?? (() => navigate("/", { replace: true }));
  const handleBackToProfiles = onBackToProfiles ?? (() => navigate("/", { replace: true }));

  return (
    <AppShell
      mainVariant="dashboard"
      headerActions={
        <>
          <Button type="button" variant="header" aria-disabled="true" tabIndex={-1}>
            <FileText size={14} />
            Recover
          </Button>
          <Button type="button" variant="header" aria-disabled="true" tabIndex={-1}>
            <SlidersHorizontal size={14} />
            Policies
          </Button>
        </>
      }
      headerSettingsAction={
        <Button
          type="button"
          variant="header"
          size="icon"
          aria-label="Settings"
          aria-disabled="true"
          tabIndex={-1}
        >
          <Settings size={14} />
        </Button>
      }
    >
      <section className="dashboard-column profile-load-transition">
        <div className="dashboard-context-strip" aria-label="Active keyset context">
          <span className="dashboard-context-primary">
            {resolvedProfile.groupName ?? resolvedProfile.label}
          </span>
          <span className="dashboard-context-separator">·</span>
          <span>
            {resolvedProfile.threshold}/{resolvedProfile.memberCount}
          </span>
          <span className="dashboard-context-separator">·</span>
          {isAuthoritativeGroupFingerprint(resolvedProfile.groupPublicKey) ? (
            <>
              <span>{resolvedProfile.groupPublicKey}</span>
              <span className="dashboard-context-divider" aria-hidden="true" />
            </>
          ) : null}
          <span>Share #{resolvedProfile.localShareIdx}</span>
        </div>

        <div
          className={`profile-load-stage ${variant === "error" ? "profile-load-stage-error" : ""}`}
          role={variant === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {variant === "loading" ? (
            <div className="profile-load-module">
              <span className="profile-load-spinner" aria-hidden="true" />
              <div className="profile-load-copy">
                <h1>Loading profile...</h1>
                <p>Preparing your dashboard.</p>
              </div>
            </div>
          ) : (
            <div className="profile-load-module profile-load-error-module">
              <span className="profile-load-error-icon" aria-hidden="true">
                !
              </span>
              <div className="profile-load-copy">
                <h1>Couldn’t load profile</h1>
                <p>Try again, or return to your profiles.</p>
              </div>
              <div className="profile-load-actions">
                <Button type="button" onClick={handleRetry}>
                  Try Again
                </Button>
                <Button type="button" variant="ghost" onClick={handleBackToProfiles}>
                  Back to Profiles
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function isAuthoritativeGroupFingerprint(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}
