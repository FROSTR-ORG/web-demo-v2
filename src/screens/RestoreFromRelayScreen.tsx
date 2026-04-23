/**
 * m6-backup-restore — Welcome → "Restore from Relay" screen.
 *
 * Mirrors the Import flow styling (AppShell + BackLink + PageHeading +
 * TextField/PasswordField) and drives the restore via
 * {@link AppStateValue.restoreProfileFromRelay}. See the mutator's
 * JSDoc for the full flow contract.
 *
 * Validation model (VAL-BACKUP-008..013 / VAL-BACKUP-030 / VAL-BACKUP-032):
 *   - Relay list seeded from the shared DEFAULT_RESTORE_RELAYS constant;
 *     one wss:// per line, validated on every keystroke. Any invalid
 *     entry disables submit and surfaces an inline error next to the
 *     textarea (VAL-BACKUP-032).
 *   - bfshare package must start with `bfshare1` before submit is
 *     enabled (cheap upfront validation to avoid a round-trip).
 *   - Password must be ≥ 8 chars (matches the bfshare package
 *     password rules).
 *   - "No backup found" timeout (≥3 s inside the mutator) surfaces
 *     the dedicated empty state (VAL-BACKUP-012).
 *   - "Invalid password" copy renders next to the password field on
 *     wrong password / share-secret mismatch (VAL-BACKUP-011).
 */

import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField } from "../components/ui";
import {
  RELAY_INVALID_URL_ERROR,
  isValidRelayUrl,
} from "../lib/relay/relayUrl";
import { RELAY_EMPTY_ERROR } from "../app/AppStateTypes";

const DEFAULT_RESTORE_RELAYS = [
  "wss://relay.primal.net",
  "wss://relay.damus.io",
].join("\n");

function parseRelayList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function RestoreFromRelayScreen() {
  const navigate = useNavigate();
  const { restoreProfileFromRelay } = useAppState();
  const [relays, setRelays] = useState(DEFAULT_RESTORE_RELAYS);
  const [bfshare, setBfshare] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [relayError, setRelayError] = useState<string | null>(null);
  const [emptyStateMessage, setEmptyStateMessage] = useState<string | null>(
    null,
  );
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { relayList, relayListValid, relayListError } = useMemo(() => {
    const entries = parseRelayList(relays);
    if (entries.length === 0) {
      return {
        relayList: entries,
        relayListValid: false,
        relayListError: RELAY_EMPTY_ERROR,
      };
    }
    for (const entry of entries) {
      if (!isValidRelayUrl(entry)) {
        return {
          relayList: entries,
          relayListValid: false,
          relayListError: RELAY_INVALID_URL_ERROR,
        };
      }
    }
    return { relayList: entries, relayListValid: true, relayListError: null };
  }, [relays]);

  const bfshareValid = bfshare.trim().startsWith("bfshare1");
  const passwordValid = password.length >= 8;
  const canSubmit =
    !submitting && relayListValid && bfshareValid && passwordValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setPasswordError("");
    setRelayError(null);
    setEmptyStateMessage(null);
    setGeneralError(null);
    setSuccessMessage(null);
    try {
      const { profile, alreadyExisted } = await restoreProfileFromRelay({
        bfshare: bfshare.trim(),
        bfsharePassword: password,
        backupPassword: password,
        relays: relayList,
      });
      setSuccessMessage(
        alreadyExisted
          ? `Already restored — "${profile.label}" is up-to-date.`
          : `Restored "${profile.label}" successfully. Unlock it from Welcome.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Invalid password/i.test(message)) {
        setPasswordError(
          "Invalid password — could not decrypt this backup.",
        );
      } else if (/No backup found/i.test(message)) {
        setEmptyStateMessage("No backup found for this share.");
      } else if (/Relay URL/i.test(message)) {
        setRelayError(message);
      } else {
        setGeneralError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell mainVariant="flow">
      <div className="screen-column">
        <BackLink
          onClick={() => navigate("/")}
          label="Back to Welcome"
        />
        <PageHeading
          title="Restore from Relay"
          copy="Fetch an encrypted profile backup published to one of your relays. You'll need the bfshare1... package for the device that published it."
        />

        <form onSubmit={handleSubmit} className="screen-column">
          <div className="field">
            <span className="label">Relays</span>
            <p className="help">
              One wss:// URL per line. We'll query each relay in parallel.
            </p>
            <textarea
              className={`input import-textarea${
                relayListError && relays.trim().length > 0
                  ? " input-error"
                  : ""
              }`}
              placeholder={"wss://relay.example.com\nwss://another.example.com"}
              value={relays}
              onChange={(e) => setRelays(e.target.value)}
              rows={3}
            />
            {relayListError && relays.trim().length > 0 ? (
              <span className="field-error-text">{relayListError}</span>
            ) : null}
            {relayError ? (
              <span className="field-error-text">{relayError}</span>
            ) : null}
          </div>

          <div className="field">
            <span className="label">Share Package</span>
            <p className="help">
              Paste the bfshare1... package for the device whose backup you
              want to restore. The package is decrypted locally with the
              password below — the password is never transmitted.
            </p>
            <textarea
              id="restore-bfshare-input"
              className="input import-textarea"
              placeholder="bfshare1..."
              value={bfshare}
              onChange={(e) => setBfshare(e.target.value)}
              rows={3}
            />
            {bfshare.trim().length > 0 && !bfshareValid ? (
              <span className="field-error-text">
                Invalid share — string must begin with bfshare1 prefix.
              </span>
            ) : null}
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Share package password"
            error={passwordError}
          />

          {emptyStateMessage ? (
            <div
              role="status"
              className="import-validation-error"
              data-testid="restore-empty-state"
            >
              {emptyStateMessage}
            </div>
          ) : null}
          {generalError ? (
            <div role="alert" className="import-validation-error">
              {generalError}
            </div>
          ) : null}
          {successMessage ? (
            <div role="status" className="import-validation-ok">
              {successMessage}
            </div>
          ) : null}

          <Button
            type="submit"
            size="full"
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
          >
            {submitting ? "Restoring…" : "Restore from Relay"}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
