import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import { AppShell } from "../../components/shell";
import { Button } from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
import { LoadedShareDisplay } from "./LoadedShareDisplay";
import { RecoverHeader } from "./RecoverHeader";
import { ShareBlock } from "./ShareBlock";
import { MOCK_LOCAL_SHARE } from "./mocks";
import { maskShare } from "./recoverUtils";

interface DemoCollectSharesContentProps {
  profileId: string;
  variant?: "incompatible-shares";
  showBackLink?: boolean;
  onBack?: () => void;
  onRecovered: () => void;
}

export function DemoCollectSharesContent({
  profileId,
  variant,
  showBackLink = false,
  onBack,
  onRecovered,
}: DemoCollectSharesContentProps) {
  const { activeProfile } = useAppState();
  const incompatible = variant === "incompatible-shares";
  const [pastedShare, setPastedShare] = useState(incompatible ? MOCK_LOCAL_SHARE : "");

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return null;
  }

  const pasteValid = pastedShare.trim().length >= 32;
  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;
  const sharesLoaded = pasteValid ? 2 : 1;
  const canRecover = sharesLoaded >= threshold && !incompatible;

  function handleRecover() {
    if (canRecover) {
      onRecovered();
    }
  }

  return (
    <div className="screen-column">
      {showBackLink ? (
        <button type="button" className="back-link" onClick={onBack}>
          <ChevronLeft size={14} />
          Back to Signer
        </button>
      ) : null}

      <div className="screen-heading">
        <h1 className="page-title">Recover NSEC</h1>
        <p className="page-copy">
          Recovering your nsec requires {threshold} of your {totalShares} shares. Your local share is preloaded.
        </p>
      </div>

      <ShareBlock label="Share #0 — This Browser" loaded>
        <LoadedShareDisplay active={false}>{maskShare(MOCK_LOCAL_SHARE)}</LoadedShareDisplay>
      </ShareBlock>

      <ShareBlock label="Share #1 — Pasted" loaded={pasteValid} mono>
        <input
          className={pasteValid ? "recover-share-input loaded" : "recover-share-input"}
          type="text"
          placeholder="Paste share hex..."
          aria-label="Paste share hex"
          value={pastedShare}
          onChange={(e) => setPastedShare(e.target.value)}
        />
      </ShareBlock>

      <Button type="button" variant="primary" size="full" disabled={!canRecover} onClick={handleRecover}>
        Recover NSEC
      </Button>

      <div className="recover-divider" />

      {incompatible ? (
        <div className="recover-error-panel">
          <div className="recover-error-icon">!</div>
          <div className="recover-error-content">
            <div className="recover-error-title">Incompatible Shares</div>
            <div className="recover-error-copy">The provided shares belong to different keysets and cannot be combined.</div>
            <div className="recover-error-share-row">
              <span>Share 1:</span>
              <strong>02a3f8c2d1e4...9k2m</strong>
            </div>
            <div className="recover-error-share-row">
              <span>Share 2:</span>
              <strong>03b7e1f9d2c8...4j8w</strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DemoCollectSharesScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile } = useAppState();
  const demoUi = useDemoUi();

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  const currentProfileId = profileId;
  const variant =
    demoUi.recover?.variant === "incompatible-shares"
      ? "incompatible-shares"
      : undefined;

  return (
    <AppShell mainVariant="flow" headerMeta={<RecoverHeader keysetName={activeProfile.groupName} />}>
      <DemoCollectSharesContent
        profileId={currentProfileId}
        variant={variant}
        showBackLink
        onBack={() => navigate(`/dashboard/${currentProfileId}`)}
        onRecovered={() => navigate(`/recover/${currentProfileId}/success`)}
      />
    </AppShell>
  );
}
