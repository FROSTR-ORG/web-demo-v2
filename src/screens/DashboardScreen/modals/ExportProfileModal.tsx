import { Check, X } from "lucide-react";
import { useState } from "react";

function getPasswordStrength(pw: string): number {
  if (pw.length === 0) return 0;
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score += 1;
  return Math.min(score, 3);
}

export function ExportProfileModal({
  groupName,
  threshold: _threshold,
  memberCount: _memberCount,
  shareIdx,
  relayCount,
  peerCount,
  onCancel,
  onExport,
}: {
  groupName: string;
  threshold: number;
  memberCount: number;
  shareIdx: number;
  relayCount: number;
  peerCount: number;
  onCancel: () => void;
  onExport: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const passwordsMatch = password.length > 0 && password === confirm;
  const strength = getPasswordStrength(password);

  const strengthColors = ["#EF4444", "#F59E0B", "#22C55E"];
  const canExport = passwordsMatch && password.length >= 1;

  return (
    <div className="export-modal-backdrop" role="dialog" aria-modal="true" data-testid="export-profile-modal">
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="export-modal-header">
          <div className="export-modal-title">Export Profile</div>
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
          Create an encrypted backup of your share and all configuration. You'll need this password to restore on another device.
        </p>

        {/* Profile summary */}
        <div className="export-modal-summary">
          Share #{shareIdx} (Index {shareIdx}) · Keyset: {groupName} · {relayCount} relays · {peerCount} peers
        </div>

        {/* Password fields */}
        <div className="export-field">
          <label className="export-field-label" htmlFor="export-password">Export Password</label>
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

        {/* Actions */}
        <div className="export-modal-actions">
          <button type="button" className="export-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="export-btn-submit"
            disabled={!canExport}
            onClick={onExport}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
