import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../../../app/AppState";
import { PROFILE_NAME_MAX_LENGTH } from "../../../app/AppStateTypes";
import {
  RELAY_DUPLICATE_ERROR,
  RELAY_INVALID_URL_ERROR,
  isValidRelayUrl,
  normalizeRelayKey,
  validateRelayUrl,
} from "../../../lib/relay/relayUrl";
import { paperGroupKey } from "../mocks";

/**
 * Human-readable inline validation messages shown by the Profile Name
 * edit flow (VAL-SETTINGS-002 / VAL-SETTINGS-025). Exported so component
 * tests can assert on the exact strings without re-hardcoding them.
 */
export const PROFILE_NAME_EMPTY_ERROR = "Name cannot be empty.";
export const PROFILE_NAME_TOO_LONG_ERROR = `Name must be at most ${PROFILE_NAME_MAX_LENGTH} characters.`;
export { PROFILE_NAME_MAX_LENGTH };

/**
 * Canonical inline-validation copy surfaced by the relay list editor.
 * Re-exported so component tests can assert on the exact strings without
 * re-hardcoding them (VAL-SETTINGS-004 / VAL-SETTINGS-023).
 */
export { RELAY_DUPLICATE_ERROR, RELAY_INVALID_URL_ERROR };

/**
 * Minimum length enforced on the Change Password flow. Matches the
 * length enforced in `AppStateProvider.changeProfilePassword` so the
 * UI can reject sub-minimum inputs before dispatch (VAL-SETTINGS-028).
 */
export const CHANGE_PASSWORD_MIN_LENGTH = 8;

/**
 * Inline-validation copy surfaced by the Change Password flow. Exported
 * so component tests can assert on the exact strings (and so the UI /
 * provider error normaliser share a single canonical message).
 *
 * - `*_TOO_SHORT`: new password fails `length >= CHANGE_PASSWORD_MIN_LENGTH`
 *   (VAL-SETTINGS-028).
 * - `*_MISMATCH`:  confirm-new-password differs from new password
 *   (VAL-SETTINGS-027).
 * - `*_SAME_AS_CURRENT`: new password equals current password
 *   (VAL-SETTINGS-026).
 * - `*_WRONG_CURRENT`: current password did not decrypt the stored
 *   profile (VAL-SETTINGS-019).
 */
export const CHANGE_PASSWORD_TOO_SHORT_ERROR =
  `New password must be at least ${CHANGE_PASSWORD_MIN_LENGTH} characters.`;
export const CHANGE_PASSWORD_MISMATCH_ERROR = "Passwords do not match.";
export const CHANGE_PASSWORD_SAME_AS_CURRENT_ERROR =
  "New password must differ from current.";
export const CHANGE_PASSWORD_WRONG_CURRENT_ERROR =
  "Current password is incorrect.";

/**
 * Placeholder shown in the Group Profile "Created" / "Updated" cells
 * when the active profile lacks a timestamp entirely (e.g. pre-bridge
 * demo fixtures). Keeps the row layout stable without rendering a
 * literal "Invalid Date" or "NaN" string (VAL-SETTINGS-008).
 */
export const MISSING_PROFILE_DATE_PLACEHOLDER = "—";

/**
 * Copy surfaced by the confirm-unsaved-changes dialog that guards
 * navigation away from Settings while there is a pending Profile
 * Name edit or an in-flight Change Password form (VAL-SETTINGS-029).
 * Exported so component tests can pin on the exact strings without
 * re-hardcoding them.
 *
 * The chosen approach is "confirm dialog on navigate-away" (option
 * (a) of VAL-SETTINGS-029) — see
 * `docs/runtime-deviations-from-paper.md` for the rationale.
 */
export const UNSAVED_CHANGES_TITLE = "Discard unsaved changes?";
export const UNSAVED_CHANGES_DESCRIPTION =
  "You have unsaved changes in Settings. Close without saving?";
export const UNSAVED_CHANGES_KEEP_LABEL = "Keep editing";
export const UNSAVED_CHANGES_DISCARD_LABEL = "Discard";

/**
 * Format an epoch-ms timestamp as a human-readable Gregorian date
 * (e.g. "Feb 24, 2026"). Returns {@link MISSING_PROFILE_DATE_PLACEHOLDER}
 * when the input is missing or non-finite so the Group Profile rows
 * never render "NaN" / "Invalid Date" (VAL-SETTINGS-008).
 *
 * Uses the runtime's default locale (no forced `en-US`) so copy
 * respects the user's locale while still displaying a real stored
 * timestamp. Tests pin the locale via the same formatter to match.
 */
export function formatProfileDate(timestampMs: number | undefined): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
    return MISSING_PROFILE_DATE_PLACEHOLDER;
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return MISSING_PROFILE_DATE_PLACEHOLDER;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface SettingsSidebarProps {
  profile: { groupName: string; deviceName: string };
  relays: string[];
  groupPublicKey: string;
  threshold: number;
  memberCount: number;
  shareIdx: number;
  onClose: () => void;
  onLock: () => void;
  onClearCredentials: () => void;
  onExport: () => void;
  onExportShare: () => void;
  /**
   * m6-backup-publish — opens the PublishBackupModal which drives the
   * encrypted kind-10000 publish flow (VAL-BACKUP-001 through
   * VAL-BACKUP-007). Optional so existing demo/test callers that
   * predate the feature continue to render without providing the
   * handler; callers that OMIT it will hide the action row.
   */
  onPublishBackup?: () => void;
}

export function SettingsSidebar({
  profile,
  relays: initialRelays,
  groupPublicKey,
  threshold,
  memberCount,
  shareIdx,
  onClose,
  onLock,
  onClearCredentials,
  onExport,
  onExportShare,
  onPublishBackup,
}: SettingsSidebarProps) {
  const navigate = useNavigate();
  const {
    activeProfile,
    changeProfilePassword,
    updateProfileName,
    updateRelays,
  } = useAppState();
  // Source of truth for the rendered relay list: prefer the live
  // activeProfile (which the AppStateProvider mutator mirrors after a
  // successful persistence round-trip) and fall back to the prop
  // threaded from DashboardScreen before context hydrates. Local edit
  // state (`newRelay`, `editingIndex`, error strings) layers on top.
  const relays = useMemo(
    () => activeProfile?.relays ?? initialRelays ?? [],
    [activeProfile?.relays, initialRelays],
  );
  const [newRelay, setNewRelay] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingError, setEditingError] = useState("");
  const [editingSaving, setEditingSaving] = useState(false);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  // Source-of-truth for the rendered profile name: prefer the live
  // activeProfile (which is mutated by updateProfileName after a successful
  // IndexedDB write) and fall back to the prop that the Dashboard threads
  // through before the context has hydrated.
  const persistedDeviceName = activeProfile?.deviceName ?? profile.deviceName;
  // Source-of-truth for every Group Profile row. Prefer the live
  // activeProfile (VAL-SETTINGS-009 — "sourced from real active
  // profile") and fall back to the props that DashboardScreen threads
  // through before the context hydrates, so this component still
  // renders useful content when mounted from demo fixtures that only
  // pass the props path.
  const groupKeysetName = activeProfile?.groupName ?? profile.groupName;
  const groupPublicKeyDisplay =
    activeProfile?.groupPublicKey ?? groupPublicKey;
  const groupThreshold = activeProfile?.threshold ?? threshold;
  const groupMemberCount = activeProfile?.memberCount ?? memberCount;
  // VAL-SETTINGS-008 — render Created / Updated from the stored
  // profile's real epoch-ms timestamps. `updatedAt` is optional on
  // legacy records written before the field existed; fall back to
  // `createdAt` so those records still render a sane "Updated" value.
  // `formatProfileDate` returns an em-dash when the timestamp is
  // missing entirely so we never print "NaN" / "Invalid Date".
  const createdAtText = formatProfileDate(activeProfile?.createdAt);
  const updatedAtText = formatProfileDate(
    activeProfile?.updatedAt ?? activeProfile?.createdAt,
  );
  const [draftDeviceName, setDraftDeviceName] = useState(persistedDeviceName);
  const [editingDeviceName, setEditingDeviceName] = useState(false);
  const [deviceNameError, setDeviceNameError] = useState("");
  const [savingDeviceName, setSavingDeviceName] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  /**
   * VAL-SETTINGS-029 — tracks which navigation-away action the user
   * attempted while a pending edit (Profile Name draft or Change
   * Password form with any typed content) was dirty. The confirm
   * dialog renders when this is non-null; clicking "Discard" runs
   * the pending action, clicking "Keep editing" clears it and
   * leaves the sidebar open.
   */
  const [pendingNavAction, setPendingNavAction] =
    useState<null | "close" | "lock" | "clearCredentials" | "replaceShare">(
      null,
    );

  // Keep the draft in sync with the persisted name whenever the user is
  // NOT actively editing. Without this, a rename persisted from another
  // surface (e.g. a different tab, a profile import) would leave the
  // sidebar showing a stale value until the user opened the field.
  useEffect(() => {
    if (!editingDeviceName) {
      setDraftDeviceName(persistedDeviceName);
    }
  }, [persistedDeviceName, editingDeviceName]);

  // Re-validate the current draft whenever it changes so the inline
  // error + disabled-save state reflect the typed value without waiting
  // for a click.
  const trimmedDraft = draftDeviceName.trim();
  const draftValidationError = (() => {
    if (trimmedDraft.length === 0) return PROFILE_NAME_EMPTY_ERROR;
    if (trimmedDraft.length > PROFILE_NAME_MAX_LENGTH)
      return PROFILE_NAME_TOO_LONG_ERROR;
    return "";
  })();
  // Surface whichever error applies — persistence errors take priority
  // over live validation messages, but validation takes priority over an
  // empty "no message yet" state so an invalid draft never silently
  // leaves Save disabled with no explanation.
  const inlineNameError = deviceNameError || draftValidationError;
  const saveDeviceNameDisabled =
    savingDeviceName || draftValidationError.length > 0;

  function beginEditDeviceName() {
    setDraftDeviceName(persistedDeviceName);
    setDeviceNameError("");
    setEditingDeviceName(true);
  }

  function cancelEditDeviceName() {
    setDraftDeviceName(persistedDeviceName);
    setDeviceNameError("");
    setEditingDeviceName(false);
  }

  async function saveDeviceName() {
    const next = draftDeviceName.trim();
    if (next.length === 0) {
      setDeviceNameError(PROFILE_NAME_EMPTY_ERROR);
      return;
    }
    if (next.length > PROFILE_NAME_MAX_LENGTH) {
      setDeviceNameError(PROFILE_NAME_TOO_LONG_ERROR);
      return;
    }
    if (!updateProfileName) {
      setDeviceNameError(
        "Unable to persist profile name: feature unavailable.",
      );
      return;
    }
    try {
      setSavingDeviceName(true);
      setDeviceNameError("");
      await updateProfileName(next);
      setEditingDeviceName(false);
    } catch (err) {
      setDeviceNameError(
        err instanceof Error ? err.message : "Unable to save profile name.",
      );
    } finally {
      setSavingDeviceName(false);
    }
  }

  // Live-validation state for the Change Password flow. Each error
  // message is canonical (exported from this module) so component tests
  // and VAL-SETTINGS-018 / 019 / 026 / 027 / 028 evidence can pin on
  // identical strings.
  //
  // The submit button is disabled when the form is definitely not
  // dispatchable (empty current, short new, confirm mismatch, new ===
  // current). Inline errors surface regardless of disabled state so the
  // user understands why the action is blocked. The "wrong current"
  // message is set only after a dispatched change fails with a
  // `wrong_password` error so it never appears before any submit.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const newPasswordTooShort =
    newPassword.length > 0 && newPassword.length < CHANGE_PASSWORD_MIN_LENGTH;
  const confirmMismatch =
    confirmNewPassword.length > 0 && confirmNewPassword !== newPassword;
  const newSameAsCurrent =
    oldPassword.length > 0 &&
    newPassword.length > 0 &&
    newPassword === oldPassword;
  // Hide "same as current" error until the user has actually typed a
  // full new password (>= min length and matching confirm) — otherwise
  // the message flashes while the user is mid-typing which is noise
  // rather than signal. The dispatch-time guard still enforces the
  // invariant on a click-through (see `handleChangePassword`).
  const showSameAsCurrent =
    newSameAsCurrent &&
    newPassword.length >= CHANGE_PASSWORD_MIN_LENGTH &&
    confirmNewPassword === newPassword;
  const changePasswordDisabled =
    oldPassword.length === 0 ||
    newPassword.length === 0 ||
    confirmNewPassword.length === 0 ||
    newPasswordTooShort ||
    confirmMismatch ||
    newSameAsCurrent;
  const liveValidationError: string = newPasswordTooShort
    ? CHANGE_PASSWORD_TOO_SHORT_ERROR
    : confirmMismatch
    ? CHANGE_PASSWORD_MISMATCH_ERROR
    : showSameAsCurrent
    ? CHANGE_PASSWORD_SAME_AS_CURRENT_ERROR
    : "";
  const inlinePasswordError = passwordError || liveValidationError;

  /**
   * Normalise a thrown error into the canonical "Current password is
   * incorrect." copy when the backend rejects with `wrong_password`
   * (from `decodeProfilePackage`), or when an upstream surface has
   * already mapped to that copy. This lets the UI display a stable,
   * user-facing message regardless of whether the mutator throws a
   * `BifrostPackageError` directly or a generic Error.
   */
  function mapChangePasswordError(err: unknown): string {
    // BifrostPackageError carries a structured `code` field.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "wrong_password"
    ) {
      return CHANGE_PASSWORD_WRONG_CURRENT_ERROR;
    }
    const message =
      err instanceof Error ? err.message : "Unable to change password.";
    // The backend also normalises its own wrong-current error to this
    // canonical message; keep it stable.
    if (message === CHANGE_PASSWORD_WRONG_CURRENT_ERROR) {
      return message;
    }
    // Heuristic fallback: any message containing "wrong password" or
    // "incorrect" near "password" → canonical copy.
    if (/wrong\s*password|incorrect.*password|password.*incorrect/i.test(message)) {
      return CHANGE_PASSWORD_WRONG_CURRENT_ERROR;
    }
    return message;
  }

  async function handleChangePassword() {
    setSubmitAttempted(true);
    setPasswordError("");
    setPasswordSuccess("");

    if (oldPassword.length === 0) {
      return;
    }
    if (newPassword.length < CHANGE_PASSWORD_MIN_LENGTH) {
      setPasswordError(CHANGE_PASSWORD_TOO_SHORT_ERROR);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(CHANGE_PASSWORD_MISMATCH_ERROR);
      return;
    }
    if (newPassword === oldPassword) {
      setPasswordError(CHANGE_PASSWORD_SAME_AS_CURRENT_ERROR);
      return;
    }
    try {
      await changeProfilePassword(oldPassword, newPassword);
      setPasswordSuccess("Password changed successfully.");
      setOldPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setSubmitAttempted(false);
      setTimeout(() => setChangingPassword(false), 1500);
    } catch (err) {
      setPasswordError(mapChangePasswordError(err));
    }
  }

  /**
   * Shared persistence helper used by Add / Remove / Edit flows. Wraps
   * the AppState mutator with an error-surfacing hook so every caller
   * can route both validation errors (invalid URL / duplicate) and
   * persistence errors (IDB write failure) into the right inline slot.
   * Returns `true` on a successful round-trip so callers can reset
   * their local edit state.
   */
  async function persistRelayList(
    next: string[],
    onError: (message: string) => void,
  ): Promise<boolean> {
    if (!updateRelays) {
      onError("Relay list persistence is unavailable.");
      return false;
    }
    try {
      await updateRelays(next);
      return true;
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Unable to save relay list.",
      );
      return false;
    }
  }

  async function handleAddRelay() {
    const trimmed = newRelay.trim();
    if (trimmed.length === 0) {
      setAddError(RELAY_INVALID_URL_ERROR);
      return;
    }
    if (!isValidRelayUrl(trimmed)) {
      setAddError(RELAY_INVALID_URL_ERROR);
      return;
    }
    const newKey = normalizeRelayKey(trimmed);
    if (relays.some((existing) => normalizeRelayKey(existing) === newKey)) {
      setAddError(RELAY_DUPLICATE_ERROR);
      return;
    }
    const next = [...relays, trimmed];
    setAddSaving(true);
    setAddError("");
    const ok = await persistRelayList(next, setAddError);
    setAddSaving(false);
    if (ok) {
      setNewRelay("");
    }
  }

  async function handleRemoveRelay(index: number) {
    if (index < 0 || index >= relays.length) return;
    if (relays.length <= 1) {
      setAddError("At least one relay is required.");
      return;
    }
    const next = relays.filter((_, i) => i !== index);
    setRemovingIndex(index);
    const ok = await persistRelayList(next, setAddError);
    setRemovingIndex(null);
    if (ok && editingIndex === index) {
      setEditingIndex(null);
      setEditingDraft("");
      setEditingError("");
    }
  }

  function beginEditRelay(index: number) {
    setEditingIndex(index);
    setEditingDraft(relays[index] ?? "");
    setEditingError("");
  }

  function cancelEditRelay() {
    setEditingIndex(null);
    setEditingDraft("");
    setEditingError("");
  }

  /**
   * VAL-SETTINGS-029 — evaluates whether the user has a pending edit
   * that would be silently lost if we honored a navigate-away action
   * without confirmation. Two sources are tracked:
   *   1. The Profile Name draft differs from the persisted value while
   *      the inline editor is open.
   *   2. The Change Password form is open AND any of the three
   *      password inputs has non-empty content.
   * Relay add/edit rows are not tracked here: relay mutations persist
   * immediately on Save/Remove and do not carry a discard-on-close
   * failure mode (the list always reflects the persisted state once
   * the mutator resolves).
   */
  function hasUnsavedChanges(): boolean {
    if (
      editingDeviceName &&
      draftDeviceName.trim() !== persistedDeviceName.trim()
    ) {
      return true;
    }
    if (
      changingPassword &&
      (oldPassword.length > 0 ||
        newPassword.length > 0 ||
        confirmNewPassword.length > 0)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Wrap an outbound navigation action (close, lock, clearCredentials)
   * with the confirm-unsaved-changes gate. When there are unsaved
   * edits, we hold the action in `pendingNavAction` and surface the
   * confirm dialog; the caller's handler only runs after the user
   * clicks "Discard" (see {@link confirmDiscardPending}). When
   * nothing is dirty the handler fires immediately — zero-cost for
   * the happy path.
   */
  function guardNav(
    action: "close" | "lock" | "clearCredentials" | "replaceShare",
    run: () => void,
  ): void {
    if (!hasUnsavedChanges()) {
      run();
      return;
    }
    setPendingNavAction(action);
  }

  function confirmDiscardPending(): void {
    const action = pendingNavAction;
    setPendingNavAction(null);
    // Clear any transient form state so a re-open of the sidebar /
    // re-start of the edit flow begins from persisted values.
    if (editingDeviceName) {
      setDraftDeviceName(persistedDeviceName);
      setDeviceNameError("");
      setEditingDeviceName(false);
    }
    if (changingPassword) {
      setOldPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordError("");
      setPasswordSuccess("");
      setSubmitAttempted(false);
      setChangingPassword(false);
    }
    if (action === "close") {
      onClose();
    } else if (action === "lock") {
      onLock();
    } else if (action === "clearCredentials") {
      onClearCredentials();
    } else if (action === "replaceShare") {
      // Mirrors the zero-dirty Replace Share onClick: dismiss the
      // sidebar first so the route transition unmounts cleanly, then
      // navigate to the Replace Share flow.
      onClose();
      navigate("/replace-share");
    }
  }

  function keepEditing(): void {
    setPendingNavAction(null);
  }

  async function saveEditRelay() {
    if (editingIndex === null) return;
    const trimmed = editingDraft.trim();
    if (trimmed.length === 0 || !isValidRelayUrl(trimmed)) {
      setEditingError(RELAY_INVALID_URL_ERROR);
      return;
    }
    const newKey = normalizeRelayKey(trimmed);
    const conflict = relays.some(
      (existing, i) =>
        i !== editingIndex && normalizeRelayKey(existing) === newKey,
    );
    if (conflict) {
      setEditingError(RELAY_DUPLICATE_ERROR);
      return;
    }
    const next = relays.map((relay, i) => (i === editingIndex ? trimmed : relay));
    setEditingSaving(true);
    setEditingError("");
    const ok = await persistRelayList(next, setEditingError);
    setEditingSaving(false);
    if (ok) {
      setEditingIndex(null);
      setEditingDraft("");
    }
  }

  return (
    <>
      {/* Scrim — stacked above dashboard content (z-index: 100) */}
      <div
        className="settings-scrim"
        onClick={() => guardNav("close", onClose)}
        data-testid="settings-scrim"
        style={{ zIndex: 100 }}
      />

      {/* Sidebar panel — stacked above the scrim and dashboard peer actions so it
          overlays the dashboard primary panel without clipping. */}
      <div
        className="settings-sidebar"
        role="dialog"
        aria-label="Settings"
        data-testid="settings-sidebar"
        style={{ zIndex: 103 }}
      >
        <div className="settings-sidebar-scroll">
          {/* Header */}
          <div className="settings-header">
            <div
              className="settings-title"
              // Inline font-family mirrors the `.settings-title` rule in
              // global.css (`Share Tech Mono`) so VAL-DSH-012 is observable
              // in jsdom where the CSS stylesheet is not applied.
              style={{ fontFamily: "'Share Tech Mono', system-ui, sans-serif" }}
            >
              Settings
            </div>
            <button
              type="button"
              className="settings-close"
              onClick={() => guardNav("close", onClose)}
              aria-label="Close settings"
            >
              <X size={16} />
            </button>
          </div>

          {/* DEVICE PROFILE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Device Profile</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Profile Name</span>
                <div className="settings-row-value">
                  {editingDeviceName ? (
                    <input
                      className="settings-inline-input"
                      aria-label="Profile Name"
                      value={draftDeviceName}
                      maxLength={PROFILE_NAME_MAX_LENGTH}
                      onChange={(event) => {
                        setDraftDeviceName(event.target.value);
                        if (deviceNameError) {
                          setDeviceNameError("");
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveDeviceName();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEditDeviceName();
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <span>{persistedDeviceName}</span>
                  )}
                  {editingDeviceName ? (
                    <>
                      <button
                        type="button"
                        className="settings-change-btn"
                        aria-label="Save profile name"
                        onClick={() => void saveDeviceName()}
                        disabled={saveDeviceNameDisabled}
                      >
                        {savingDeviceName ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="settings-change-btn"
                        aria-label="Cancel profile name edit"
                        onClick={cancelEditDeviceName}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="settings-edit-icon"
                      aria-label="Edit profile name"
                      onClick={beginEditDeviceName}
                    >
                      ✎
                    </button>
                  )}
                </div>
              </div>
              {editingDeviceName && inlineNameError && (
                <div
                  className="settings-row settings-row-error"
                  role="alert"
                >
                  <span className="field-error-text">{inlineNameError}</span>
                </div>
              )}
              <div className="settings-row">
                <span className="settings-row-label">Profile Password</span>
                <div className="settings-row-value">
                  <span>••••••••</span>
                  <button
                    type="button"
                    className="settings-change-btn"
                    aria-label={
                      changingPassword
                        ? "Cancel change password"
                        : "Change password"
                    }
                    onClick={() => {
                      setChangingPassword((prev) => !prev);
                      // Reset transient state so toggling Change → Cancel → Change
                      // never leaves stale errors or partially typed material.
                      setPasswordError("");
                      setPasswordSuccess("");
                      setSubmitAttempted(false);
                      setOldPassword("");
                      setNewPassword("");
                      setConfirmNewPassword("");
                    }}
                  >
                    {changingPassword ? "Cancel" : "Change"}
                  </button>
                </div>
              </div>
              {changingPassword && (
                <div className="settings-password-change">
                  <input
                    type="password"
                    className="input"
                    placeholder="Current password"
                    aria-label="Current password"
                    value={oldPassword}
                    onChange={(e) => {
                      setOldPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                  />
                  <input
                    type="password"
                    className="input"
                    placeholder="New password"
                    aria-label="New password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                  />
                  <input
                    type="password"
                    className="input"
                    placeholder="Confirm new password"
                    aria-label="Confirm new password"
                    value={confirmNewPassword}
                    onChange={(e) => {
                      setConfirmNewPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                  />
                  {inlinePasswordError && (
                    <span
                      className="field-error-text"
                      role="alert"
                      data-testid="settings-change-password-error"
                    >
                      {inlinePasswordError}
                    </span>
                  )}
                  {passwordSuccess && (
                    <span className="import-validation-ok" role="status">
                      {passwordSuccess}
                    </span>
                  )}
                  <button
                    type="button"
                    className="button button-primary button-sm"
                    aria-label="Update password"
                    onClick={handleChangePassword}
                    disabled={changePasswordDisabled}
                  >
                    Update Password
                  </button>
                </div>
              )}
              {/* Relays */}
              <div className="settings-relays">
                {relays.map((relay, idx) => {
                  const isEditing = editingIndex === idx;
                  const isRemoving = removingIndex === idx;
                  return (
                    <div
                      className="settings-relay-row"
                      key={`${relay}-${idx}`}
                      data-testid={`settings-relay-row-${idx}`}
                    >
                      {isEditing ? (
                        <>
                          <input
                            className="settings-relay-input"
                            type="text"
                            aria-label={`Edit ${relay}`}
                            value={editingDraft}
                            onChange={(event) => {
                              setEditingDraft(event.target.value);
                              if (editingError) setEditingError("");
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveEditRelay();
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelEditRelay();
                              }
                            }}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="settings-relay-add"
                            aria-label={`Save ${relay}`}
                            onClick={() => void saveEditRelay()}
                            disabled={editingSaving}
                          >
                            {editingSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            className="settings-relay-remove"
                            aria-label={`Cancel edit of ${relay}`}
                            onClick={cancelEditRelay}
                            disabled={editingSaving}
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="settings-relay-url">{relay}</div>
                          <button
                            type="button"
                            className="settings-relay-add"
                            aria-label={`Edit ${relay}`}
                            onClick={() => beginEditRelay(idx)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="settings-relay-remove"
                            aria-label={`Remove ${relay}`}
                            onClick={() => void handleRemoveRelay(idx)}
                            disabled={isRemoving || relays.length <= 1}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {editingError && (
                  <div
                    className="settings-row settings-row-error"
                    role="alert"
                    data-testid="settings-relay-edit-error"
                  >
                    <span className="field-error-text">{editingError}</span>
                  </div>
                )}
                <div className="settings-relay-row">
                  <input
                    className="settings-relay-input"
                    type="text"
                    aria-label="Add relay URL"
                    placeholder="wss://..."
                    value={newRelay}
                    onChange={(e) => {
                      setNewRelay(e.target.value);
                      if (addError) setAddError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddRelay();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="settings-relay-add"
                    onClick={() => void handleAddRelay()}
                    disabled={addSaving}
                  >
                    {addSaving ? "Adding…" : "Add"}
                  </button>
                </div>
                {addError && (
                  <div
                    className="settings-row settings-row-error"
                    role="alert"
                    data-testid="settings-relay-add-error"
                  >
                    <span className="field-error-text">{addError}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="settings-hint">
              Configuration for this device's share (Share #{shareIdx})
            </div>
          </div>

          {/* GROUP PROFILE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Group Profile</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Keyset Name</span>
                <span className="settings-row-text">{groupKeysetName}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Keyset npub</span>
                <span className="settings-row-npub">{paperGroupKey(groupPublicKeyDisplay)}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Threshold</span>
                <span className="settings-row-text">{groupThreshold} of {groupMemberCount}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Created</span>
                <span className="settings-row-text">{createdAtText}</span>
              </div>
              <div className="settings-row settings-row-last">
                <span className="settings-row-label">Updated</span>
                <span className="settings-row-text">{updatedAtText}</span>
              </div>
            </div>
            <div className="settings-hint">
              Shared across all peers. Synced via Nostr.
            </div>
          </div>

          {/* REPLACE SHARE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Replace Share</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-row">
              <div className="settings-action-info">
                <div className="settings-action-name">Replace Share</div>
                <div className="settings-action-desc">
                  Import a bfonboard package to replace only this device's local share while keeping the same group public key and profile.
                </div>
              </div>
              <button
                type="button"
                className="settings-btn-blue"
                onClick={() =>
                  guardNav("replaceShare", () => {
                    onClose();
                    navigate("/replace-share");
                  })
                }
              >
                Replace Share
              </button>
            </div>

          </div>

          {/* EXPORT & BACKUP */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Export &amp; Backup</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-group">
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Export Profile</div>
                  <div className="settings-action-desc">
                    Encrypted backup of your share and configuration
                  </div>
                </div>
                <button type="button" className="settings-btn-blue" onClick={onExport}>Export</button>
              </div>
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Export Share</div>
                  <div className="settings-action-desc">
                    Password-protected bfshare package
                  </div>
                </div>
                <button type="button" className="settings-btn-blue" onClick={onExportShare}>
                  Export
                </button>
              </div>
              {/*
                m6-backup-publish — "Publish Backup to Relay" action row
                (VAL-BACKUP-001). Clicking opens the PublishBackupModal
                which collects a password + confirm, validates strength,
                and dispatches publishProfileBackup. Rendered only when
                the parent supplies the handler so demo/test callers
                that predate the feature keep working unchanged.
              */}
              {onPublishBackup && (
                <div className="settings-action-row">
                  <div className="settings-action-info">
                    <div className="settings-action-name">
                      Publish Backup to Relay
                    </div>
                    <div className="settings-action-desc">
                      Publish an encrypted kind-10000 backup to every
                      configured relay
                    </div>
                  </div>
                  <button
                    type="button"
                    className="settings-btn-blue"
                    onClick={onPublishBackup}
                    data-testid="settings-publish-backup-btn"
                  >
                    Publish
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* PROFILE SECURITY */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Profile Security</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-group">
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Lock Profile</div>
                  <div className="settings-action-desc">
                    Return to profile list to open another profile
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-btn-red"
                  onClick={() => guardNav("lock", onLock)}
                >
                  Lock
                </button>
              </div>
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Clear Credentials</div>
                  <div className="settings-action-desc">
                    Delete this device's saved profile, share, password, and relay configuration
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-btn-red"
                  onClick={() =>
                    guardNav("clearCredentials", onClearCredentials)
                  }
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/*
        VAL-SETTINGS-029 — confirm-unsaved-changes dialog.

        Surfaces when the user attempts to navigate away (Close, Lock,
        Clear Credentials) while there is a dirty Profile Name draft
        or a non-empty Change Password form. Blocks the action until
        the user either Discards (action proceeds, form cleared) or
        Keeps editing (dialog dismissed, sidebar stays open).

        Structure + styles reuse the `.clear-creds-*` modal family so
        visual weight matches other destructive/confirmation dialogs
        in Settings without introducing a new CSS footprint.
      */}
      {pendingNavAction !== null && (
        <div
          className="clear-creds-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-unsaved-title"
          data-testid="settings-unsaved-confirm"
          style={{ zIndex: 210 }}
        >
          <div
            className="clear-creds-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="clear-creds-header">
              <div className="clear-creds-title-group">
                <h2
                  className="clear-creds-title"
                  id="settings-unsaved-title"
                >
                  {UNSAVED_CHANGES_TITLE}
                </h2>
              </div>
              <button
                type="button"
                className="clear-creds-close"
                onClick={keepEditing}
                aria-label="Close unsaved changes dialog"
              >
                <X size={16} />
              </button>
            </div>
            <div className="clear-creds-body">
              <p className="clear-creds-description">
                {UNSAVED_CHANGES_DESCRIPTION}
              </p>
            </div>
            <div className="clear-creds-actions">
              <button
                type="button"
                className="clear-creds-cancel"
                onClick={keepEditing}
                data-testid="settings-unsaved-keep-editing"
              >
                {UNSAVED_CHANGES_KEEP_LABEL}
              </button>
              <button
                type="button"
                className="clear-creds-confirm"
                onClick={confirmDiscardPending}
                data-testid="settings-unsaved-discard"
              >
                {UNSAVED_CHANGES_DISCARD_LABEL}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
