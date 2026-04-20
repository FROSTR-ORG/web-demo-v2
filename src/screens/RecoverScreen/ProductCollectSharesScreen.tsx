import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import { AppShell } from "../../components/shell";
import { Button } from "../../components/ui";
import { LoadedShareDisplay } from "./LoadedShareDisplay";
import { RecoverHeader } from "./RecoverHeader";
import { ShareBlock } from "./ShareBlock";
import { errorMessage, isValidatedSession, shortPubkey } from "./recoverUtils";
import type { SourceInput } from "./types";

export function ProductCollectSharesScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile, recoverSession, validateRecoverSources, recoverNsec, clearRecoverSession } = useAppState();
  const externalCount = activeProfile ? Math.max(0, activeProfile.threshold - 1) : 0;
  const [profilePassword, setProfilePassword] = useState("");
  const [sourceInputs, setSourceInputs] = useState<SourceInput[]>(
    () => Array.from({ length: externalCount }, () => ({ packageText: "", password: "" }))
  );
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    setSourceInputs((current) =>
      Array.from({ length: externalCount }, (_, index) => current[index] ?? { packageText: "", password: "" })
    );
  }, [externalCount]);

  const canValidate =
    profilePassword.trim().length > 0 &&
    sourceInputs.every((source) => source.packageText.trim().length > 0 && source.password.length > 0);

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }
  const currentProfileId = profileId;
  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;
  const validated = isValidatedSession(recoverSession, currentProfileId, threshold);

  function updateSource(index: number, patch: Partial<SourceInput>) {
    clearRecoverSession();
    setError(null);
    setSourceInputs((current) => current.map((source, sourceIndex) => (sourceIndex === index ? { ...source, ...patch } : source)));
  }

  async function handleValidate() {
    if (!canValidate) return;
    setValidating(true);
    setError(null);
    try {
      await validateRecoverSources({
        profileId: currentProfileId,
        profilePassword,
        sourcePackages: sourceInputs
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setValidating(false);
    }
  }

  async function handleRecover() {
    if (!validated) return;
    setRecovering(true);
    setError(null);
    try {
      await recoverNsec();
      navigate(`/recover/${currentProfileId}/success`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRecovering(false);
    }
  }

  function handleBack() {
    clearRecoverSession();
    navigate(`/dashboard/${currentProfileId}`);
  }

  return (
    <AppShell mainVariant="flow" headerMeta={<RecoverHeader keysetName={activeProfile.groupName} />}>
      <div className="screen-column">
        <button type="button" className="back-link" onClick={handleBack}>
          <ChevronLeft size={14} />
          Back to Signer
        </button>

        <div className="screen-heading">
          <h1 className="page-title">Recover NSEC</h1>
          <p className="page-copy">
            Recovering your nsec requires {threshold} of your {totalShares} shares.
          </p>
        </div>

        <ShareBlock label="Source Share #1 — This Browser" loaded={validated}>
          <input
            className={validated ? "recover-share-input loaded" : "recover-share-input"}
            type="password"
            placeholder="Saved profile password"
            aria-label="Saved profile password"
            value={profilePassword}
            onChange={(event) => {
              clearRecoverSession();
              setError(null);
              setProfilePassword(event.target.value);
            }}
          />
          {validated && recoverSession.sources[0] ? (
            <LoadedShareDisplay>{shortPubkey(recoverSession.sources[0].memberPubkey)}</LoadedShareDisplay>
          ) : null}
        </ShareBlock>

        {sourceInputs.map((source, index) => {
          const sourceNumber = index + 2;
          const loadedSource = validated ? recoverSession.sources[index + 1] : null;
          return (
            <ShareBlock label={`Source Share #${sourceNumber} — bfshare`} loaded={Boolean(loadedSource)} mono key={sourceNumber}>
              <textarea
                className={loadedSource ? "recover-share-input loaded" : "recover-share-input"}
                placeholder="Paste bfshare package..."
                aria-label={`Source Share #${sourceNumber} bfshare package`}
                value={source.packageText}
                onChange={(event) => updateSource(index, { packageText: event.target.value })}
                rows={4}
              />
              <input
                className={loadedSource ? "recover-share-input loaded" : "recover-share-input"}
                type="password"
                placeholder="Package password"
                aria-label={`Source Share #${sourceNumber} package password`}
                value={source.password}
                onChange={(event) => updateSource(index, { password: event.target.value })}
              />
              {loadedSource ? <LoadedShareDisplay>{shortPubkey(loadedSource.memberPubkey)}</LoadedShareDisplay> : null}
            </ShareBlock>
          );
        })}

        <Button type="button" variant="secondary" size="full" disabled={!canValidate || validating} onClick={handleValidate}>
          {validating ? "Validating Sources..." : "Validate Sources"}
        </Button>
        <Button type="button" variant="primary" size="full" disabled={!validated || recovering} onClick={handleRecover}>
          {recovering ? "Recovering NSEC..." : "Recover NSEC"}
        </Button>

        <div className="recover-divider" />

        {error ? (
          <div className="recover-error-panel">
            <div className="recover-error-icon">!</div>
            <div className="recover-error-content">
              <div className="recover-error-title">Recovery Error</div>
              <div className="recover-error-copy">{error}</div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
