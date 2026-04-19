import { AlertTriangle, Check, ChevronLeft, Copy, Eye, Lock } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button } from "../components/ui";
import { PAPER_MASKED_NSEC, PAPER_RECOVERED_NSEC } from "../demo/fixtures";
import { useDemoUi } from "../demo/demoUi";

/* ============================
   Mock data for demo
   ============================ */

const MOCK_LOCAL_SHARE = "a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4c5d6e7f8a9b0c1d2e3f4a5";
const MOCK_RECOVERED_NSEC = PAPER_RECOVERED_NSEC;

function maskShare(hex: string): string {
  return hex.slice(0, 12) + "•".repeat(45);
}

function maskNsec(nsec: string): string {
  if (nsec === PAPER_RECOVERED_NSEC) {
    return PAPER_MASKED_NSEC;
  }
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
  const demoUi = useDemoUi();
  const incompatible = demoUi.recover?.variant === "incompatible-shares";
  const [pastedShare, setPastedShare] = useState(incompatible ? MOCK_LOCAL_SHARE : "");

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  const pasteValid = pastedShare.trim().length >= 32;
  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;
  const sharesLoaded = pasteValid ? 2 : 1;
  const canRecover = sharesLoaded >= threshold && !incompatible;

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
  const demoUi = useDemoUi();
  const [copied, setCopied] = useState(Boolean(demoUi.recover?.copied));
  const [revealed, setRevealed] = useState(Boolean(demoUi.recover?.revealed));

  if (!profileId || !activeProfile || activeProfile.id !== profileId) {
    return <Navigate to="/" replace />;
  }

  const threshold = activeProfile.threshold;
  const totalShares = activeProfile.memberCount;

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(MOCK_RECOVERED_NSEC);
    } catch {
      // clipboard may not be available in all contexts
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function handleReveal() {
    setRevealed(true);
  }

  function handleClear() {
    // Per VAL-REC-003: Clear removes the revealed text and returns the
    // display to the masked state (NOT blank). Both nsec panels continue
    // to render; the second panel flips back to the masked form.
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
            <span className="recover-nsec-masked">{maskNsec(MOCK_RECOVERED_NSEC)}</span>
          </div>
        </div>

        {/* Recovered NSEC — Revealed (or masked when not revealed) */}
        <div className="recover-nsec-block">
          <span className="recover-nsec-label">Recovered NSEC (revealed):</span>
          <div className="recover-nsec-display">
            <span className="recover-nsec-revealed">
              {revealed ? MOCK_RECOVERED_NSEC : maskNsec(MOCK_RECOVERED_NSEC)}
            </span>
          </div>
        </div>

        {/* Action Buttons — labels are static per Paper; "Copied!" confirmation
            is an additional green pill that appears after clicking Copy. */}
        <div className="recover-actions">
          <button type="button" className="recover-btn-copy" onClick={handleCopy}>
            <Copy size={14} />
            Copy to Clipboard
          </button>
          <button type="button" className="recover-btn-reveal" onClick={handleReveal}>
            <Eye size={14} />
            Reveal
          </button>
          <button type="button" className="recover-btn-clear" onClick={handleClear}>
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
