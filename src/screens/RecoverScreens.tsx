import { AlertTriangle, Check, ChevronLeft, Copy, Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button } from "../components/ui";

/* ============================
   Mock data for demo
   ============================ */

const MOCK_LOCAL_SHARE = "a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4c5d6e7f8a9b0c1d2e3f4a5";
const MOCK_RECOVERED_NSEC = "nsec1qqqqqzpwk6m3ags7frv0j8dkwmxcf0klhfja3yd4rqlzgn64c4hq7y4ms9";

function maskShare(hex: string): string {
  return hex.slice(0, 12) + "•".repeat(45);
}

function maskNsec(nsec: string): string {
  return nsec.slice(0, 8) + "•".repeat(42) + "...";
}

/* ============================
   Simplified header for Recover flow
   ============================ */

function RecoverHeader({ keysetName }: { keysetName: string }) {
  return (
    <div className="recover-header-meta">
      <span className="recover-header-keyset">{keysetName}</span>
    </div>
  );
}

/* ============================
   Screen 1: Collect Shares
   ============================ */

export function CollectSharesScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile } = useAppState();
  const [pastedShare, setPastedShare] = useState("");

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  const pasteValid = pastedShare.trim().length >= 32;
  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;
  const sharesLoaded = pasteValid ? 2 : 1;
  const canRecover = sharesLoaded >= threshold;

  function handleRecover() {
    if (canRecover) {
      navigate(`/recover/${profileId}/success`);
    }
  }

  return (
    <AppShell
      mainVariant="flow"
      headerMeta={<RecoverHeader keysetName={activeProfile.groupName} />}
    >
      <div className="screen-column">
        <button
          type="button"
          className="back-link"
          onClick={() => navigate(`/dashboard/${profileId}`)}
        >
          <ChevronLeft size={14} />
          Back to Signer
        </button>

        <div className="screen-heading">
          <h1 className="page-title">Recover NSEC</h1>
          <p className="page-copy">
            Recovering your nsec requires {threshold} of your {totalShares} shares. Your local share is preloaded.
          </p>
        </div>

        {/* Share #0 — This Browser (preloaded) */}
        <div className="recover-share-block">
          <div className="recover-share-header">
            <span className="recover-share-label">Share #0 — This Browser</span>
            <span className="recover-loaded-badge">
              <Check size={12} strokeWidth={2.5} />
              Loaded
            </span>
          </div>
          <div className="recover-share-display loaded">
            <span className="recover-share-hex">{maskShare(MOCK_LOCAL_SHARE)}</span>
            <Lock size={14} className="recover-share-icon" />
          </div>
        </div>

        {/* Share #1 — Paste */}
        <div className="recover-share-block">
          <div className="recover-share-header">
            <span className="recover-share-label-mono">Share #1 — Pasted</span>
            {pasteValid ? (
              <span className="recover-loaded-badge">
                <Check size={12} strokeWidth={2.5} />
                Loaded
              </span>
            ) : null}
          </div>
          {pasteValid ? (
            <div className="recover-share-display loaded">
              <span className="recover-share-hex-active">{maskShare(pastedShare)}</span>
              <Lock size={14} className="recover-share-icon" />
            </div>
          ) : (
            <input
              className="recover-share-input"
              type="text"
              placeholder="Paste share hex..."
              value={pastedShare}
              onChange={(e) => setPastedShare(e.target.value)}
            />
          )}
        </div>

        {/* Recover NSEC button */}
        <Button
          type="button"
          variant="primary"
          size="full"
          disabled={!canRecover}
          onClick={handleRecover}
        >
          Recover NSEC
        </Button>

        <div className="recover-divider" />
      </div>
    </AppShell>
  );
}

/* ============================
   Screen 2: Recover Success
   ============================ */

export function RecoverSuccessScreen() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const { activeProfile } = useAppState();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [cleared, setCleared] = useState(false);

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;

  async function handleCopy() {
    if (cleared) return;
    try {
      await navigator.clipboard?.writeText(MOCK_RECOVERED_NSEC);
    } catch {
      // clipboard may not be available in all contexts
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function handleClear() {
    setCleared(true);
    setRevealed(false);
  }

  return (
    <AppShell
      mainVariant="flow"
      headerMeta={<RecoverHeader keysetName={activeProfile.groupName} />}
    >
      <div className="screen-column">
        <button
          type="button"
          className="back-link"
          onClick={() => navigate(`/dashboard/${profileId}`)}
        >
          <ChevronLeft size={14} />
          Back to Signer
        </button>

        <div className="screen-heading">
          <h1 className="page-title">Recover NSEC</h1>
          <p className="page-copy">
            Recovering your nsec requires {threshold} of your {totalShares} shares. Your local share is preloaded.
          </p>
        </div>

        {/* Share #0 — This Browser (preloaded, read-only) */}
        <div className="recover-share-block">
          <div className="recover-share-header">
            <span className="recover-share-label">Share #0 — This Browser</span>
            <span className="recover-loaded-badge">
              <Check size={12} strokeWidth={2.5} />
              Loaded
            </span>
          </div>
          <div className="recover-share-display loaded">
            <span className="recover-share-hex">{maskShare(MOCK_LOCAL_SHARE)}</span>
            <Lock size={14} className="recover-share-icon" />
          </div>
        </div>

        {/* Share #1 — Pasted (read-only on success) */}
        <div className="recover-share-block">
          <div className="recover-share-header">
            <span className="recover-share-label-mono">Share #1 — Pasted</span>
            <span className="recover-loaded-badge">
              <Check size={12} strokeWidth={2.5} />
              Loaded
            </span>
          </div>
          <div className="recover-share-display loaded">
            <span className="recover-share-hex-active">{maskShare(MOCK_LOCAL_SHARE)}</span>
            <Lock size={14} className="recover-share-icon" />
          </div>
        </div>

        {/* Recover NSEC button (disabled, already recovered) */}
        <Button type="button" variant="primary" size="full" disabled>
          Recover NSEC
        </Button>

        <div className="recover-divider" />

        {/* Security Warning Panel */}
        <div className="recover-warning-panel">
          <AlertTriangle size={20} className="recover-warning-icon" />
          <div className="recover-warning-content">
            <div className="recover-warning-title">Security Warning</div>
            <ul className="recover-warning-list">
              <li>Your private key will auto-clear in 60 seconds</li>
              <li>Do not screenshot or share this key</li>
              <li>Copy to a secure password manager</li>
            </ul>
          </div>
        </div>

        {/* Recovered NSEC — Masked */}
        <div className="recover-nsec-block">
          <span className="recover-nsec-label">Recovered NSEC:</span>
          <div className="recover-nsec-display">
            <span className="recover-nsec-masked">
              {cleared ? "—" : maskNsec(MOCK_RECOVERED_NSEC)}
            </span>
          </div>
        </div>

        {/* Recovered NSEC — Revealed */}
        <div className="recover-nsec-block">
          <span className="recover-nsec-label">Recovered NSEC (revealed):</span>
          <div className="recover-nsec-display">
            <span className="recover-nsec-revealed">
              {cleared ? "—" : (revealed ? MOCK_RECOVERED_NSEC : maskNsec(MOCK_RECOVERED_NSEC))}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="recover-actions">
          <button type="button" className="recover-btn-copy" onClick={handleCopy} disabled={cleared}>
            {copied ? (
              <>
                <Check size={14} strokeWidth={2.5} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={14} />
                Copy to Clipboard
              </>
            )}
          </button>
          <button
            type="button"
            className="recover-btn-reveal"
            onClick={() => setRevealed((v) => !v)}
            disabled={cleared}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button type="button" className="recover-btn-clear" onClick={handleClear} disabled={cleared}>
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
