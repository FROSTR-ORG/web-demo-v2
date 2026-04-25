/**
 * m7-onboard-sponsor-ui — Dashboard-side sponsorship flow.
 *
 * There is no Paper reference artboard for the source-side onboard
 * flow (the Paper export only covers the requester side); this screen
 * is therefore built on the existing design-system primitives
 * (`.settings-section`, `.field`, `.button-*`, `.settings-btn-*`) so
 * the layout, typography and color tokens remain aligned with the
 * dashboard settings surface. See
 * `docs/runtime-deviations-from-paper.md` for the dedicated deviation
 * entry.
 *
 * Surface contracts covered here (VAL-ONBOARD-*):
 *   - 001 / 002: this file implements the source-side configure and
 *     handoff screens.
 *   - 003: form fields + CTA gating (label / password / relay overrides).
 *   - 004 / 025: Copy button writes the exact bfonboard1… string.
 *   - 005: monospace textarea + Copy + QR (rendered on `<canvas>` via
 *     `qrcode`).
 *   - 014 / 022: Cancel confirmation; keyboard-reachable (Escape / Tab).
 *   - 018: duplicate label produces an inline warning (not a hard error
 *     by default — see VAL-ONBOARD-018 "or — if allowed — completes
 *     successfully").
 *   - 019: empty / invalid relay overrides blocked inline with canonical
 *     "Relay URL must start with wss://" copy.
 *   - 021: threshold misuse (t=0 or t>n) surfaces inline error and the
 *     CTA stays disabled so no invalid package is ever encoded.
 *   - 023: textarea Tab key does NOT insert a tab — default browser
 *     Tab behaviour moves focus to the next control.
 *   - 024: entry point + CTA blocked while `signerPaused === true`.
 */

import { Copy, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import {
  ONBOARD_SPONSOR_DUPLICATE_LABEL_WARNING,
  ONBOARD_SPONSOR_LABEL_EMPTY_ERROR,
  ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH,
  ONBOARD_SPONSOR_PASSWORD_MISMATCH_ERROR,
  ONBOARD_SPONSOR_PASSWORD_TOO_SHORT_ERROR,
  ONBOARD_SPONSOR_PROFILE_PASSWORD_ERROR,
  ONBOARD_SPONSOR_RELAY_EMPTY_ERROR,
  ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR,
  ONBOARD_SPONSOR_THRESHOLD_INVALID_ERROR,
  type OnboardSponsorSession,
} from "../app/AppStateTypes";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField, TextField } from "../components/ui";
import {
  RELAY_DUPLICATE_ERROR,
  RELAY_INVALID_URL_ERROR,
  isValidRelayUrl,
  normalizeRelayKey,
  validateRelayUrl,
} from "../lib/relay/relayUrl";

/* ---------- Password strength helper ---------- */

/**
 * Simple heuristic password strength indicator (VAL-ONBOARD-003 —
 * "password with strength"). Strength is categorical rather than
 * entropy-based so the label renders deterministically in tests.
 */
export function passwordStrengthLabel(password: string): "weak" | "ok" | "strong" {
  if (!password) return "weak";
  if (password.length < ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH) return "weak";
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const categories = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean)
    .length;
  if (password.length >= 14 && categories >= 3) return "strong";
  if (categories >= 2) return "ok";
  return "weak";
}

function sponsorStatusCopy(
  session: OnboardSponsorSession,
): { title: string; description: string; tone: "waiting" | "done" | "failed" } {
  switch (session.status ?? "awaiting_adoption") {
    case "completed":
      return {
        title: "Device onboarded",
        description:
          "The source device received the onboarding confirmation echo.",
        tone: "done",
      };
    case "failed":
      return {
        title: "Onboarding failed",
        description:
          session.failureReason ??
          "The source device did not receive a valid onboarding confirmation.",
        tone: "failed",
      };
    case "cancelled":
      return {
        title: "Sponsorship cancelled",
        description:
          "Late onboarding responses from this package will be rejected.",
        tone: "failed",
      };
    case "awaiting_adoption":
    default:
      return {
        title: "Waiting for new device...",
        description:
          "Keep this page open while the new device saves the share and sends its confirmation.",
        tone: "waiting",
      };
  }
}

/* ==========================================================
   Screen 1 — Onboard Sponsor Configure (/onboard-sponsor)
   ========================================================== */

export function OnboardSponsorConfigScreen() {
  const navigate = useNavigate();
  const {
    activeProfile,
    signerPaused,
    createOnboardSponsorPackage,
    clearOnboardSponsorSession,
  } = useAppState();

  // VAL-ONBOARD-019 — relay list defaults to the active profile's
  // relays (user can add / remove `wss://…`).
  const initialRelays = activeProfile?.relays ?? [];
  const [relays, setRelays] = useState<string[]>(initialRelays);
  const [newRelay, setNewRelay] = useState("");
  const [newRelayError, setNewRelayError] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Clear any lingering sponsor session on mount so this screen always
  // starts from a fresh slate (cancelled sessions, back-navigation from
  // handoff, etc.).
  useEffect(() => {
    clearOnboardSponsorSession();
  }, [clearOnboardSponsorSession]);

  const trimmedLabel = label.trim();
  const labelError = trimmedLabel.length === 0
    ? ONBOARD_SPONSOR_LABEL_EMPTY_ERROR
    : "";

  const passwordError = password.length === 0
    ? ""
    : password.length < ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH
      ? ONBOARD_SPONSOR_PASSWORD_TOO_SHORT_ERROR
      : "";
  const confirmError = confirmPassword.length === 0
    ? ""
    : confirmPassword !== password
      ? ONBOARD_SPONSOR_PASSWORD_MISMATCH_ERROR
      : "";

  const relayListError = relays.length === 0
    ? ONBOARD_SPONSOR_RELAY_EMPTY_ERROR
    : "";

  // VAL-ONBOARD-021 — surface threshold misuse if the active profile's
  // stored record is malformed so the CTA never produces a package.
  const thresholdInvalid = (() => {
    if (!activeProfile) return false;
    const t = activeProfile.threshold;
    const n = activeProfile.memberCount;
    if (!Number.isFinite(t) || !Number.isFinite(n)) return true;
    return t <= 0 || n <= 0 || t > n;
  })();

  // VAL-ONBOARD-018 — duplicate-label warning. Compare the trimmed
  // label against the active profile's own deviceName (the only label
  // we can observe from the source side; peer labels are not indexed
  // on the StoredProfileSummary in this scope). Surface a non-blocking
  // warning — the user can still proceed.
  const duplicateLabelWarning =
    trimmedLabel.length > 0 &&
    (activeProfile?.deviceName ?? "").trim().toLowerCase() ===
      trimmedLabel.toLowerCase()
      ? ONBOARD_SPONSOR_DUPLICATE_LABEL_WARNING
      : "";

  const strengthLabel = useMemo(
    () => passwordStrengthLabel(password),
    [password],
  );

  const profilePasswordError =
    profilePassword.length === 0
      ? ""
      : profilePassword.length < ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH
        ? ONBOARD_SPONSOR_PROFILE_PASSWORD_ERROR
        : "";

  const canSubmit =
    !submitting &&
    !signerPaused &&
    !thresholdInvalid &&
    trimmedLabel.length > 0 &&
    password.length >= ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH &&
    confirmPassword === password &&
    profilePassword.length >= ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH &&
    relays.length > 0;

  const headerMeta = activeProfile?.groupName ?? "Onboard a Device";

  function tryAddRelay() {
    const trimmed = newRelay.trim();
    if (trimmed.length === 0) {
      setNewRelayError(RELAY_INVALID_URL_ERROR);
      return;
    }
    if (!isValidRelayUrl(trimmed)) {
      setNewRelayError(RELAY_INVALID_URL_ERROR);
      return;
    }
    const key = normalizeRelayKey(trimmed);
    if (relays.some((r) => normalizeRelayKey(r) === key)) {
      setNewRelayError(RELAY_DUPLICATE_ERROR);
      return;
    }
    // Round-trip once more via validateRelayUrl so the persisted
    // value is byte-identical to the mutator's expectations.
    const validated = validateRelayUrl(trimmed);
    setRelays((prev) => [...prev, validated]);
    setNewRelay("");
    setNewRelayError("");
  }

  function removeRelay(index: number) {
    setRelays((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreatePackage() {
    setSubmitAttempted(true);
    if (!canSubmit) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      await createOnboardSponsorPackage({
        deviceLabel: trimmedLabel,
        password,
        relays,
        profilePassword,
      });
      navigate("/onboard-sponsor/handoff");
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Unable to create the onboard package.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell mainVariant="flow" headerMeta={headerMeta}>
      <div className="screen-column" data-testid="onboard-sponsor-config">
        <BackLink
          onClick={() => {
            clearOnboardSponsorSession();
            navigate(-1);
          }}
          label="Back"
        />
        <PageHeading
          title="Onboard a Device"
          copy="Sponsor a new device to join this keyset. The package below is encrypted with the password you choose; share both with the new device to onboard it."
        />

        {signerPaused && (
          <div
            className="field-error-text"
            role="alert"
            data-testid="onboard-sponsor-signer-paused"
          >
            {ONBOARD_SPONSOR_SIGNER_PAUSED_ERROR}
          </div>
        )}

        {thresholdInvalid && (
          <div
            className="field-error-text"
            role="alert"
            data-testid="onboard-sponsor-threshold-invalid"
          >
            {ONBOARD_SPONSOR_THRESHOLD_INVALID_ERROR}
          </div>
        )}

        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-label">New Device</span>
            <span className="settings-section-rule" />
          </div>
          <TextField
            label="Device Label"
            placeholder="e.g. Alice's iPhone"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            data-testid="onboard-sponsor-label-input"
            error={submitAttempted ? labelError : undefined}
            help={duplicateLabelWarning || undefined}
            aria-invalid={Boolean(submitAttempted && labelError)}
            id="onboard-sponsor-label"
          />
          {duplicateLabelWarning && (
            <span
              className="help"
              data-testid="onboard-sponsor-duplicate-warning"
            >
              {duplicateLabelWarning}
            </span>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-label">Onboarding Password</span>
            <span className="settings-section-rule" />
          </div>
          <PasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`Minimum ${ONBOARD_SPONSOR_PASSWORD_MIN_LENGTH} characters`}
            data-testid="onboard-sponsor-password-input"
            id="onboard-sponsor-password"
            error={passwordError || undefined}
            help={
              password.length > 0
                ? `Strength: ${strengthLabel}`
                : undefined
            }
          />
          <PasswordField
            label="Confirm Password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Re-enter password"
            data-testid="onboard-sponsor-confirm-input"
            id="onboard-sponsor-confirm"
            error={confirmError || undefined}
          />
          <span
            className="help"
            data-testid="onboard-sponsor-password-strength"
            data-strength={strengthLabel}
          >
            Strength: {strengthLabel}
          </span>
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-label">Profile Password</span>
            <span className="settings-section-rule" />
          </div>
          <PasswordField
            label="Profile Password"
            value={profilePassword}
            onChange={(event) => setProfilePassword(event.target.value)}
            placeholder="Profile password (to unlock the share pool)"
            data-testid="onboard-sponsor-profile-password-input"
            id="onboard-sponsor-profile-password"
            error={profilePasswordError || undefined}
            help="Used once to unlock the encrypted pool of remaining shares."
          />
        </div>

        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-label">Relay Overrides</span>
            <span className="settings-section-rule" />
          </div>
          <ul
            className="settings-card"
            data-testid="onboard-sponsor-relay-list"
            aria-label="Configured relays"
          >
            {relays.length === 0 ? (
              <li className="settings-row">
                <span className="settings-row-text">
                  No relays configured.
                </span>
              </li>
            ) : (
              relays.map((relay, i) => (
                <li
                  key={`${relay}-${i}`}
                  className="settings-row"
                  data-testid="onboard-sponsor-relay-row"
                >
                  <span className="settings-row-text">{relay}</span>
                  <button
                    type="button"
                    className="settings-change-btn"
                    aria-label={`Remove ${relay}`}
                    onClick={() => removeRelay(i)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="field" style={{ marginTop: 8 }}>
            <label className="label" htmlFor="onboard-sponsor-new-relay">
              Add Relay
            </label>
            <input
              id="onboard-sponsor-new-relay"
              className={`input${newRelayError ? " input-error" : ""}`}
              placeholder="wss://relay.example.net"
              value={newRelay}
              onChange={(event) => {
                setNewRelay(event.target.value);
                if (newRelayError) setNewRelayError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  tryAddRelay();
                }
              }}
              data-testid="onboard-sponsor-add-relay-input"
            />
            {newRelayError && (
              <span
                className="field-error-text"
                data-testid="onboard-sponsor-add-relay-error"
              >
                {newRelayError}
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={tryAddRelay}
              data-testid="onboard-sponsor-add-relay-btn"
            >
              Add Relay
            </Button>
          </div>
          {relayListError && (
            // fix-m7-scrutiny-r1-sponsor-ui-relay-validation — surface
            // the empty-relay error eagerly. The CTA is already disabled
            // while `relays.length === 0`, so the submit-gated branch
            // that previously guarded this error was dead code: the
            // user could never trigger submit to flip `submitAttempted`.
            // Removing all relays (or loading a profile with none)
            // should immediately flag the inline error below the relay
            // section so the user knows why the CTA is disabled.
            <span
              className="field-error-text"
              data-testid="onboard-sponsor-relay-empty-error"
            >
              {relayListError}
            </span>
          )}
        </div>

        {submitError && (
          <div
            className="field-error-text"
            role="alert"
            data-testid="onboard-sponsor-submit-error"
          >
            {submitError}
          </div>
        )}

        <Button
          type="button"
          size="full"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          data-testid="onboard-sponsor-create-btn"
          onClick={handleCreatePackage}
        >
          {submitting ? "Creating…" : "Create Onboard Package"}
        </Button>
      </div>
    </AppShell>
  );
}

/* ==========================================================
   Screen 2 — Onboard Sponsor Handoff (/onboard-sponsor/handoff)
   ========================================================== */

export function OnboardSponsorHandoffScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeProfile,
    onboardSponsorSession,
    clearOnboardSponsorSession,
  } = useAppState();
  const [copied, setCopied] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const triggerActiveElementRef = useRef<HTMLElement | null>(null);

  // Capture the previously-focused element on mount so Cancel / Escape can
  // restore focus per VAL-ONBOARD-022.
  useEffect(() => {
    triggerActiveElementRef.current =
      (location.state as { triggerActiveElement?: HTMLElement } | null)
        ?.triggerActiveElement ?? null;
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [location.state]);

  // Package text is sourced lazily so hooks that depend on it can be
  // declared unconditionally BEFORE the session-null guard below —
  // satisfying React's Rules of Hooks when `clearOnboardSponsorSession`
  // transitions the session from present → absent mid-lifecycle
  // (confirmCancel path, VAL-ONBOARD-022). We fall back to an empty
  // string so QRCode.toCanvas is a no-op in the redirected render.
  const packageText = onboardSponsorSession?.packageText ?? "";

  useEffect(() => {
    if (!packageText) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // VAL-ONBOARD-005 — QR canvas ≥ 256×256 CSS px and matches the
    // exact `bfonboard1…` string. Errors are caught and rendered as a
    // fallback message so a QR failure does not crash the screen.
    QRCode.toCanvas(canvas, packageText, {
      width: 288,
      margin: 1,
      errorCorrectionLevel: "M",
    }).catch(() => {
      // swallow — canvas stays blank, textarea is still the source of
      // truth for the hand-off.
    });
  }, [packageText]);

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(packageText);
    } catch {
      // Clipboard write can fail in non-secure contexts or when the
      // user denied permission. The visual confirmation still fires
      // so tests can assert the transient state even when the real
      // clipboard is unavailable — matching the DistributeShares /
      // Backup copy-block convention.
    }
    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    // VAL-ONBOARD-025 — transient "Copied" indicator ≤ 3 s. We use
    // 1600ms (matches the `.copy-block` convention elsewhere) which
    // comfortably stays under the 3 s budget.
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 1600);
  }

  function handleCancel() {
    setConfirmingCancel(true);
  }

  function confirmCancel() {
    clearOnboardSponsorSession();
    setConfirmingCancel(false);
    // Restore focus to the dashboard trigger if available so VAL-
    // ONBOARD-022's keyboard trace closes cleanly.
    navigate(-1);
    // Best-effort focus restoration after the navigation settles.
    queueMicrotask(() => {
      triggerActiveElementRef.current?.focus?.();
    });
  }

  function dismissCancelDialog() {
    setConfirmingCancel(false);
  }

  /**
   * VAL-ONBOARD-023 — the textarea is read-only AND must not trap
   * focus. Pressing Tab should move focus to the next control
   * (browser default). We intercept the keydown only to prevent the
   * default insert-tab behaviour that some browsers exhibit on
   * editable textareas; since this textarea is read-only the default
   * already moves focus, but keeping the guard is cheap insurance.
   */
  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key === "Tab") {
      // Explicitly allow the browser default (focus move). Do NOT call
      // preventDefault — that would trap focus.
      return;
    }
  }

  // VAL-ONBOARD-022 — Escape on any handoff-screen focus target opens
  // the cancel confirm dialog. Registered unconditionally (above the
  // session-null guard below) so the listener count is stable across
  // a session-clear transition — satisfying React's Rules of Hooks.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmingCancel(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Guard: if there's no session we got here by deep-link or a stale
  // back-navigation. Redirect to the config screen so the user can
  // restart cleanly. Placed AFTER all hooks to keep hook counts
  // stable when the session transitions null mid-lifecycle
  // (confirmCancel path, VAL-ONBOARD-022).
  if (!onboardSponsorSession) {
    return <Navigate to="/onboard-sponsor" replace />;
  }

  const headerMeta = activeProfile?.groupName ?? "Onboard a Device";
  const statusCopy = sponsorStatusCopy(onboardSponsorSession);

  return (
    <AppShell mainVariant="flow" headerMeta={headerMeta}>
      <div className="screen-column" data-testid="onboard-sponsor-handoff">
        <PageHeading
          title="Onboard Package Ready"
          copy={`Hand the package below to ${onboardSponsorSession.deviceLabel}. They will enter the password you chose to complete onboarding.`}
        />

        <div
          className={`onboard-sponsor-status ${statusCopy.tone}`}
          data-testid="onboard-sponsor-status"
        >
          <span className="onboard-sponsor-status-title">
            {statusCopy.title}
          </span>
          <span className="onboard-sponsor-status-copy">
            {statusCopy.description}
          </span>
        </div>

        <div className="field">
          <label className="label" htmlFor="onboard-sponsor-package">
            Onboarding Package
          </label>
          <textarea
            ref={textareaRef}
            id="onboard-sponsor-package"
            className="input import-textarea"
            data-testid="onboard-sponsor-package-textarea"
            value={packageText}
            readOnly
            onKeyDown={handleTextareaKeyDown}
            rows={4}
            style={{ fontFamily: "'Share Tech Mono', ui-monospace, monospace" }}
            aria-label="Onboard package string"
          />
        </div>

        <div
          className="package-actions"
          data-testid="onboard-sponsor-handoff-actions"
        >
          <Button
            type="button"
            variant="chip"
            size="sm"
            onClick={handleCopy}
            data-testid="onboard-sponsor-copy-btn"
          >
            <Copy size={13} />
            {copied ? "Copied" : "Copy Package"}
          </Button>
        </div>

        <div className="field">
          <span className="label">QR Code</span>
          <canvas
            ref={canvasRef}
            data-testid="onboard-sponsor-qr-canvas"
            width={288}
            height={288}
            style={{ width: 288, height: 288, background: "#fff" }}
            aria-label="Onboard package QR code"
          />
          <span className="help">
            <QrCode size={12} /> Scan this QR from the new device to receive
            the package.
          </span>
        </div>

        {onboardSponsorSession.status === "failed" && (
          <Button
            type="button"
            variant="secondary"
            size="full"
            onClick={() => {
              clearOnboardSponsorSession();
              navigate("/onboard-sponsor");
            }}
            data-testid="onboard-sponsor-retry-btn"
          >
            Create Another Package
          </Button>
        )}

        <Button
          type="button"
          variant="secondary"
          size="full"
          onClick={handleCancel}
          data-testid="onboard-sponsor-cancel-btn"
        >
          Cancel Sponsorship
        </Button>
      </div>

      {confirmingCancel && (
        <div
          className="clear-creds-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboard-sponsor-cancel-title"
          data-testid="onboard-sponsor-cancel-confirm"
          style={{ zIndex: 210 }}
        >
          <div className="clear-creds-modal">
            <div
              className="clear-creds-title"
              id="onboard-sponsor-cancel-title"
            >
              Cancel sponsorship?
            </div>
            <div className="clear-creds-description">
              The generated package will be discarded. The new device will
              not be able to onboard with it.
            </div>
            <div className="clear-creds-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={dismissCancelDialog}
                data-testid="onboard-sponsor-cancel-keep"
              >
                Keep package
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={confirmCancel}
                data-testid="onboard-sponsor-cancel-confirm-btn"
              >
                Discard
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
