import { Check, ChevronLeft, Copy, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import { AppShell } from "../../components/shell";
import { Button } from "../../components/ui";
import { LoadedShareDisplay } from "./LoadedShareDisplay";
import { RecoveredNsecBlock } from "./RecoveredNsecBlock";
import { RecoverHeader } from "./RecoverHeader";
import { RecoveryWarning } from "./RecoveryWarning";
import { ShareBlock } from "./ShareBlock";
import { maskNsec, shortPubkey } from "./recoverUtils";

export function ProductRecoverSuccessScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const {
    activeProfile,
    recoverSession,
    clearRecoverSession,
    expireRecoveredNsec,
  } = useAppState();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const session =
    profileId &&
    recoverSession?.sourceProfile.id === profileId &&
    recoverSession.recovered
      ? recoverSession
      : null;
  const recovered = session?.recovered;
  const expiresAt = session?.expiresAt;

  useEffect(() => {
    if (!expiresAt || !profileId) return;
    setNow(Date.now());

    // Use a short polling interval instead of a single setTimeout so that
    // background-tab throttling does not delay the auto-clear.
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) {
        window.clearInterval(timer);
        setExiting(true);
        expireRecoveredNsec();
        navigate(`/dashboard/${profileId}`, { replace: true });
      }
    }, 250);

    // When the user returns to the tab, immediately check expiry.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && expiresAt && Date.now() >= expiresAt) {
        window.clearInterval(timer);
        setExiting(true);
        expireRecoveredNsec();
        navigate(`/dashboard/${profileId}`, { replace: true });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [expireRecoveredNsec, expiresAt, navigate, profileId]);

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  if (exiting) {
    return null;
  }

  if (!session || !recovered) {
    return <Navigate to={`/recover/${profileId}`} replace />;
  }

  const recoveredNsec = recovered.nsec;
  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;
  const sources = session.sources;
  const secondsRemaining = expiresAt
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : 60;

  async function handleCopy() {
    if (!revealed) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(recoveredNsec);
    } catch {
      // clipboard may not be available in all contexts
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function handleBack() {
    setExiting(true);
    clearRecoverSession();
    navigate(`/dashboard/${profileId}`);
  }

  function handleClear() {
    setExiting(true);
    clearRecoverSession();
    navigate(`/dashboard/${profileId}`);
  }

  return (
    <AppShell
      mainVariant="flow"
      headerMeta={<RecoverHeader keysetName={activeProfile.groupName} />}
    >
      <div className="screen-column">
        <button type="button" className="back-link" onClick={handleBack}>
          <ChevronLeft size={14} />
          Back to Signer
        </button>

        <div className="screen-heading">
          <h1 className="page-title">Recover NSEC</h1>
          <p className="page-copy">
            Recovering your nsec requires {threshold} of your {totalShares}{" "}
            shares.
          </p>
        </div>

        {sources.map((source, index) => (
          <ShareBlock
            label={`Source Share #${index + 1} — ${index === 0 ? "This Browser" : "bfshare"}`}
            loaded
            mono={index !== 0}
            key={`${source.idx}-${index}`}
          >
            <LoadedShareDisplay>
              {shortPubkey(source.memberPubkey)}
            </LoadedShareDisplay>
          </ShareBlock>
        ))}

        <Button type="button" variant="primary" size="full" disabled>
          Recover NSEC
        </Button>

        <div className="recover-divider" />

        <RecoveryWarning secondsRemaining={secondsRemaining} />

        <RecoveredNsecBlock
          label="Recovered NSEC:"
          valueClassName="recover-nsec-masked"
        >
          {maskNsec(recoveredNsec)}
        </RecoveredNsecBlock>

        <RecoveredNsecBlock
          label="Recovered NSEC (revealed):"
          valueClassName="recover-nsec-revealed"
        >
          {revealed ? recoveredNsec : maskNsec(recoveredNsec)}
        </RecoveredNsecBlock>

        <div className="recover-actions">
          <button
            type="button"
            className="recover-btn-copy"
            onClick={handleCopy}
            disabled={!revealed}
          >
            <Copy size={14} />
            Copy to Clipboard
          </button>
          <button
            type="button"
            className="recover-btn-reveal"
            onClick={() => setRevealed((prev) => !prev)}
          >
            <Eye size={14} />
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button
            type="button"
            className="recover-btn-clear"
            onClick={handleClear}
          >
            Clear
          </button>
          {copied ? (
            <span className="recover-copied-badge">
              <Check size={14} strokeWidth={2.5} />
              Copied!
            </span>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
