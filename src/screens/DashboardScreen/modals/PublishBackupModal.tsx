import { Check, X } from "lucide-react";
import { useState } from "react";

/**
 * m6-backup-publish — minimum password length accepted by the Publish
 * Backup flow. Mirrors `AppStateProvider.publishProfileBackup`'s
 * defense-in-depth guard so the UI rejects sub-minimum inputs before
 * dispatch (VAL-BACKUP-002 / VAL-BACKUP-025). Exported so component
 * tests can pin on the identical threshold.
 */
export const PUBLISH_BACKUP_MIN_PASSWORD_LENGTH = 8;

/**
 * Canonical user-facing inline-error copy surfaced by the Publish
 * Backup modal. Exported so component tests can assert on the exact
 * strings without re-hardcoding them (VAL-BACKUP-007 / VAL-BACKUP-024).
 */
export const PUBLISH_BACKUP_NO_RELAYS_ERROR =
  "No relays available to publish to.";
export const PUBLISH_BACKUP_MISMATCH_ERROR = "Passwords do not match.";
export const PUBLISH_BACKUP_TOO_SHORT_ERROR =
  "Password must be at least 8 characters.";

/**
 * Password strength score (0-3) used to render the 3-segment meter.
 * Mirrors the scoring used by `ExportProfileModal.getPasswordStrength`
 * so VAL-BACKUP-025's "weak/medium/strong" states remain consistent
 * across the two password-collection surfaces. Exported so tests and
 * future consumers can reproduce the mapping:
 *   - `0` — empty (no meter segments filled)
 *   - `1` — length < 10, no mixed class (weak)
 *   - `2` — length >= 10 (medium)
 *   - `3` — length >= 10 AND contains an upper-case letter and a digit
 *           (strong)
 */
export function publishBackupPasswordStrength(pw: string): number {
  if (pw.length === 0) return 0;
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score += 1;
  return Math.min(score, 3);
}

export interface PublishBackupResult {
  reached: string[];
  eventId: string;
  createdAt: number;
}

export interface PublishBackupModalProps {
  groupName: string;
  shareIdx: number;
  relayCount: number;
  onCancel: () => void;
  onPublish: (password: string) => Promise<PublishBackupResult>;
}

export function PublishBackupModal({
  groupName,
  shareIdx,
  relayCount,
  onCancel,
  onPublish,
}: PublishBackupModalProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishBackupResult | null>(null);

  const strength = publishBackupPasswordStrength(password);
  const strengthColors = ["#EF4444", "#F59E0B", "#22C55E"];
  const strengthLabel =
    strength === 0
      ? ""
      : strength === 1
      ? "Weak"
      : strength === 2
      ? "Medium"
      : "Strong";
  const passwordsMatch = password.length > 0 && password === confirm;
  const passwordTooShort =
    password.length > 0 && password.length < PUBLISH_BACKUP_MIN_PASSWORD_LENGTH;
  const confirmMismatch = confirm.length > 0 && !passwordsMatch;
  const noRelaysConfigured = relayCount === 0;
  const canPublish =
    !publishing &&
    !noRelaysConfigured &&
    password.length >= PUBLISH_BACKUP_MIN_PASSWORD_LENGTH &&
    passwordsMatch;

  // Live inline-validation copy. Priority (highest first):
  //   1. No-relay error — cannot publish from this state at all
  //   2. Password too short — blocks the happy path
  //   3. Confirm mismatch — blocks the happy path
  //   4. Dispatch-time error surfaced from the mutator
  const liveError: string | null = noRelaysConfigured
    ? PUBLISH_BACKUP_NO_RELAYS_ERROR
    : passwordTooShort
    ? PUBLISH_BACKUP_TOO_SHORT_ERROR
    : confirmMismatch
    ? PUBLISH_BACKUP_MISMATCH_ERROR
    : null;
  const inlineError = error ?? liveError;

  async function handlePublish() {
    if (!canPublish) return;
    setPublishing(true);
    setError(null);
    try {
      const outcome = await onPublish(password);
      setResult(outcome);
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish backup.",
      );
    } finally {
      setPublishing(false);
    }
  }

  if (result) {
    // Completion state — Paper parity with `4b-export-complete`
    // (VAL-BACKUP-005). Relay count is the authoritative "how many
    // relays have the backup" indicator since only online relays
    // accepted the publish.
    return (
      <div
        className="export-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Backup Published"
        data-testid="publish-backup-modal-success"
      >
        <div
          className="export-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="export-modal-header">
            <div className="export-modal-title">Backup Published</div>
            <button
              type="button"
              className="export-modal-close"
              onClick={onCancel}
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>
          <p className="export-modal-description">
            Backup published to {result.reached.length}{" "}
            {result.reached.length === 1 ? "relay" : "relays"}.
          </p>
          <div
            className="export-modal-summary"
            data-testid="publish-backup-reached-list"
          >
            {result.reached.join(" · ")}
          </div>
          <div className="export-modal-actions">
            <button
              type="button"
              className="export-btn-submit"
              onClick={onCancel}
              data-testid="publish-backup-done"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="export-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Publish Backup to Relay"
      data-testid="publish-backup-modal"
    >
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <div className="export-modal-title">Publish Backup to Relay</div>
          <button
            type="button"
            className="export-modal-close"
            onClick={onCancel}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        <p className="export-modal-description">
          Publish an encrypted backup of your profile to every configured
          relay. Restoring on another device requires this password.
        </p>

        <div className="export-modal-summary">
          Share #{shareIdx} · Keyset: {groupName} · {relayCount} relays
        </div>

        <div className="export-field">
          <label className="export-field-label" htmlFor="publish-backup-password">
            Backup Password
          </label>
          <div className="export-input-shell">
            <input
              id="publish-backup-password"
              className="export-input"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter backup password"
              autoComplete="new-password"
              data-testid="publish-backup-password-input"
            />
          </div>
        </div>

        <div className="export-field">
          <label className="export-field-label" htmlFor="publish-backup-confirm">
            Confirm Password
          </label>
          <div
            className={`export-input-shell ${passwordsMatch ? "matched" : ""}`}
          >
            <input
              id="publish-backup-confirm"
              className="export-input"
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Confirm password"
              autoComplete="new-password"
              data-testid="publish-backup-confirm-input"
            />
            {passwordsMatch && (
              <span className="export-match-icon">
                <Check size={14} />
              </span>
            )}
          </div>
        </div>

        <div
          className="export-strength-bar"
          data-testid="publish-backup-strength-bar"
          data-strength={strength}
          data-strength-label={strengthLabel.toLowerCase()}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="export-strength-segment"
              data-testid={`publish-backup-strength-segment-${i}`}
              data-filled={i < strength ? "true" : "false"}
              style={{
                background:
                  i < strength && strength > 0
                    ? strengthColors[strength - 1]
                    : "#374151",
              }}
            />
          ))}
        </div>

        {inlineError && (
          <div
            className="export-error"
            role="alert"
            data-testid="publish-backup-error"
          >
            {inlineError}
          </div>
        )}

        <div className="export-modal-actions">
          <button
            type="button"
            className="export-btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="export-btn-submit"
            disabled={!canPublish}
            onClick={handlePublish}
            data-testid="publish-backup-submit"
          >
            {publishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
