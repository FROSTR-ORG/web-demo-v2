import { Check, Copy, Download, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { ExportMode } from "../types";

export function ExportCompleteModal({
  mode,
  packageText,
  onDone,
}: {
  mode: ExportMode;
  packageText: string;
  onDone: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const prefix = mode === "profile" ? "bfprofile1" : "bfshare1";
  const maskedValue = `${prefix}${"•".repeat(28)}`;
  const displayValue = revealed ? packageText : maskedValue;
  const title = mode === "profile" ? "Profile Backup Ready" : "Share Package Ready";
  const filename = mode === "profile" ? "igloo-profile-backup.txt" : "igloo-share-backup.txt";
  const warning =
    mode === "profile"
      ? "Store this backup in a safe place. Anyone with this file and the password can control your share."
      : "Store this bfshare package safely. Anyone with it and the password can use this share.";

  function handleCopy() {
    navigator.clipboard?.writeText(packageText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([packageText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="export-modal-backdrop" role="dialog" aria-modal="true" data-testid="export-complete-modal">
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header with green checkmark */}
        <div className="export-complete-header">
          <div className="export-complete-icon">
            <Check size={12} strokeWidth={3} />
          </div>
          <div className="export-complete-title">{title}</div>
        </div>

        {/* Backup string with reveal toggle */}
        <div className="export-backup-field">
          <span className="export-backup-text" data-testid="backup-string">{displayValue}</span>
          <button
            type="button"
            className="export-backup-toggle"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide backup string" : "Reveal backup string"}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {/* Copy + Download buttons */}
        <div className="export-complete-actions-row">
          <button type="button" className="export-action-btn" onClick={handleCopy}>
            <Copy size={14} />
            {copied ? "Copied!" : "Copy"}
          </button>
          <button type="button" className="export-action-btn" onClick={handleDownload}>
            <Download size={14} />
            Download
          </button>
        </div>

        {/* Security warning */}
        <p className="export-security-warning">
          {warning}
        </p>

        {/* Done button */}
        <button type="button" className="export-done-btn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
