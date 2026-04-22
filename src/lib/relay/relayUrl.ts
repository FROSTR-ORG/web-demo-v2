/**
 * Validation and normalisation helpers for user-supplied relay URLs.
 *
 * Used by the Settings sidebar relay-list editor (feature
 * `m5-relay-list-persist`) and by `AppStateProvider.updateRelays()` to
 * reject malformed or duplicate relay entries before they are written to
 * the stored profile.
 *
 * Rules (see VAL-SETTINGS-004, VAL-SETTINGS-023):
 *   - Must be a non-empty string after trimming.
 *   - Must start with the exact prefix `wss://` (case-insensitive on the
 *     scheme, but we preserve the user's casing in the returned value).
 *     `ws://`, `http://`, `https://`, or bare hostnames are rejected.
 *   - Must parse via the standard URL constructor and have a non-empty
 *     hostname.
 *   - Duplicate detection uses the lowercased origin with any single
 *     trailing slash on the pathname stripped. `WSS://Relay.Example.com`
 *     and `wss://relay.example.com/` collapse to the same key.
 *
 * These helpers are pure and have no runtime dependencies beyond the
 * standard URL API so they are safe to import from Vitest/jsdom as well
 * as from the production bundle.
 */

/** Exact inline-validation message shown next to an invalid relay input. */
export const RELAY_INVALID_URL_ERROR = "Relay URL must start with wss://";

/** Exact inline-validation message shown when the user tries to add or
 *  edit a relay URL that already exists in the list (case-insensitive,
 *  trailing-slash normalised). */
export const RELAY_DUPLICATE_ERROR = "Relay already configured";

/**
 * Error thrown by {@link validateRelayUrl} when the supplied string is
 * not a syntactically valid wss:// URL. Carries the canonical
 * user-facing message as its `message` so callers can render it
 * verbatim in an inline field error without re-mapping.
 */
export class RelayValidationError extends Error {
  constructor(message: string = RELAY_INVALID_URL_ERROR) {
    super(message);
    this.name = "RelayValidationError";
  }
}

/**
 * Validate a single user-supplied relay URL string. Returns the trimmed
 * string (the value the caller should persist / display) on success, or
 * throws a {@link RelayValidationError} with the canonical inline
 * validation message on failure.
 *
 * Note: validation does NOT rewrite the URL (no forced lowercase, no
 * trailing-slash stripping) so the user-visible form matches what they
 * typed. Use {@link normalizeRelayKey} for duplicate detection.
 */
export function validateRelayUrl(value: string): string {
  if (typeof value !== "string") {
    throw new RelayValidationError();
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new RelayValidationError();
  }
  if (!/^wss:\/\//i.test(trimmed)) {
    throw new RelayValidationError();
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new RelayValidationError();
  }
  if (parsed.protocol.toLowerCase() !== "wss:") {
    throw new RelayValidationError();
  }
  if (!parsed.hostname) {
    throw new RelayValidationError();
  }
  return trimmed;
}

/**
 * Lightweight non-throwing counterpart of {@link validateRelayUrl}.
 * Returns `true` iff the supplied string passes validation.
 */
export function isValidRelayUrl(value: string): boolean {
  try {
    validateRelayUrl(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Produce a canonical duplicate-detection key for a relay URL. Callers
 * should pass the raw user-supplied string; the key is lowercased and
 * any single trailing slash on the pathname is stripped, matching
 * VAL-SETTINGS-023's "case-insensitive, ignoring trailing slash"
 * requirement.
 *
 * Invalid URLs fall back to a best-effort lowercased / trimmed
 * representation so duplicate detection still works on in-progress
 * input that hasn't yet passed validation.
 */
export function normalizeRelayKey(value: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return "";
  try {
    const parsed = new URL(trimmed);
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname;
    const strippedPath =
      pathname.length > 1 && pathname.endsWith("/")
        ? pathname.slice(0, -1)
        : pathname;
    return `${parsed.protocol.toLowerCase()}//${host}${strippedPath}${parsed.search}`;
  } catch {
    const lower = trimmed.toLowerCase();
    return lower.endsWith("/") && lower.length > 1
      ? lower.slice(0, -1)
      : lower;
  }
}
