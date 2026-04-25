import { Check, ChevronLeft, Copy, Eye } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import { AppShell } from "../../components/shell";
import { Button } from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
import { LoadedShareDisplay } from "./LoadedShareDisplay";
import { RecoveredNsecBlock } from "./RecoveredNsecBlock";
import { RecoverHeader } from "./RecoverHeader";
import { RecoveryWarning } from "./RecoveryWarning";
import { ShareBlock } from "./ShareBlock";
import { MOCK_LOCAL_SHARE, MOCK_RECOVERED_NSEC } from "./mocks";
import { maskNsec, maskShare } from "./recoverUtils";

interface DemoRecoverSuccessContentProps {
  profileId: string;
  copied?: boolean;
  showBackLink?: boolean;
  onBack?: () => void;
  onClear?: () => void;
}

export function DemoRecoverSuccessContent({
  profileId,
  copied: copiedInitial = false,
  showBackLink = false,
  onBack,
  onClear,
}: DemoRecoverSuccessContentProps) {
  const { activeProfile } = useAppState();
  const [copied, setCopied] = useState(Boolean(copiedInitial));
  const [revealed, setRevealed] = useState(Boolean(copiedInitial));

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return null;
  }

  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;

  async function handleCopy() {
    if (!revealed) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(MOCK_RECOVERED_NSEC);
    } catch {
      // clipboard may not be available in all contexts
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="screen-column">
      {showBackLink ? (
        <button
          type="button"
          className="back-link"
          onClick={onBack}
        >
          <ChevronLeft size={14} />
          Back to Signer
        </button>
      ) : null}

      <div className="screen-heading">
        <h1 className="page-title">Recover NSEC</h1>
        <p className="page-copy">
          Recovering your nsec requires {threshold} of your {totalShares}{" "}
          shares. Your local share is preloaded.
        </p>
      </div>

      <ShareBlock label="Share #0 — This Browser" loaded>
        <LoadedShareDisplay active={false}>
          {maskShare(MOCK_LOCAL_SHARE)}
        </LoadedShareDisplay>
      </ShareBlock>

      <ShareBlock label="Share #1 — Pasted" loaded mono>
        <LoadedShareDisplay>{maskShare(MOCK_LOCAL_SHARE)}</LoadedShareDisplay>
      </ShareBlock>

      <Button type="button" variant="primary" size="full" disabled>
        Recover NSEC
      </Button>

      <div className="recover-divider" />

      <RecoveryWarning secondsRemaining={60} />

      <RecoveredNsecBlock
        label="Recovered NSEC:"
        valueClassName="recover-nsec-masked"
      >
        {maskNsec(MOCK_RECOVERED_NSEC)}
      </RecoveredNsecBlock>

      <RecoveredNsecBlock
        label="Recovered NSEC (revealed):"
        valueClassName="recover-nsec-revealed"
      >
        {revealed ? MOCK_RECOVERED_NSEC : maskNsec(MOCK_RECOVERED_NSEC)}
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
          onClick={() => {
            if (onClear) {
              onClear();
              return;
            }
            setRevealed(false);
          }}
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
  );
}

export function DemoRecoverSuccessScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile } = useAppState();
  const demoUi = useDemoUi();

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  const currentProfileId = profileId;

  return (
    <AppShell
      mainVariant="flow"
      headerMeta={<RecoverHeader keysetName={activeProfile.groupName} />}
    >
      <DemoRecoverSuccessContent
        profileId={currentProfileId}
        copied={demoUi.recover?.copied}
        showBackLink
        onBack={() => navigate(`/dashboard/${currentProfileId}`)}
      />
    </AppShell>
  );
}
