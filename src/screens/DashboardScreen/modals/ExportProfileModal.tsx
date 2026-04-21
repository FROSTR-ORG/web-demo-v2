import { Check, X } from "lucide-react";
import { useState } from "react";
import type { ExportMode } from "../types";

function getPasswordStrength(pw: string): number {
  if (pw.length === 0) return 0;
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score += 1;
  return Math.min(score, 3);
}

export function ExportProfileModal({
  mode,
  groupName,
  threshold: _threshold,
  memberCount: _memberCount,
  shareIdx,
  relayCount,
  peerCount,
  onCancel,
  onExport,
}: {
  mode: ExportMode;
  groupName: string;
  threshold: number;
  memberCount: number;
  shareIdx: number;
  relayCount: number;
  peerCount: number;
  onCancel: () => void;
  onExport: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordsMatch = password.length > 0 && password === confirm;
  const strength = getPasswordStrength(password);

  const strengthColors = ["#EF4444", "#F59E0B", "#22C55E"];
  const canExport = passwordsMatch && password.length >= 8 && !exporting;
  const title = mode === "profile" ? "Export Profile" : "Export Share";
  const passwordLabel = mode === "profile" ? "Export Password" : "Share Export Password";
  const description =
    mode === "profile"
      ? "Create an encrypted backup of your share and all configuration. You'll need this password to restore on another device."
      : "Create a password-protected bfshare package for this device's share. Use it as a source package during keyset rotation.";

  async function handleExport() {
    if (!canExport) {
      return;
    }
    setExporting(true);
    setError(null);
    try {
      await onExport(password);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Unable to export this package.",
      );
      setExporting(false);
    }
  }

  return (
    <div className="export-modal-backdrop" role="dialog" aria-modal="true" data-testid="export-profile-modal">
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="export-modal-header">
          <div className="export-modal-title">{title}</div>
          <button
            type="button"
            className="export-modal-close"
            onClick={onCancel}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Description */}
        <p className="export-modal-description">
          {description}
        </p>

        {/* Profile summary */}
        <div className="export-modal-summary">
          Share #{shareIdx} (Index {shareIdx}) · Keyset: {groupName} · {relayCount} relays · {peerCount} peers
        </div>

        {/* Password fields */}
        <div className="export-field">
          <label className="export-field-label" htmlFor="export-password">{passwordLabel}</label>
          <div className="export-input-shell">
            <input
              id="export-password"
              className="export-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter export password"
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="export-field">
          <label className="export-field-label" htmlFor="export-confirm">Confirm Password</label>
          <div className={`export-input-shell ${passwordsMatch ? "matched" : ""}`}>
            <input
              id="export-confirm"
              className="export-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
            />
            {passwordsMatch && (
              <span className="export-match-icon">
                <Check size={14} />
              </span>
            )}
          </div>
        </div>

        {/* Strength bar */}
        <div className="export-strength-bar" data-testid="password-strength-bar">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="export-strength-segment"
              style={{ background: i < strength ? strengthColors[strength - 1] : "#374151" }}
            />
          ))}
        </div>

        {error ? <div className="export-error" role="alert">{error}</div> : null}

        {/* Actions */}
        <div className="export-modal-actions">
          <button type="button" className="export-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="export-btn-submit"
            disabled={!canExport}
            onClick={handleExport}
          >
            {exporting ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
