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
 * Options accepted by {@link normalizeRelayList}.
 */
export interface NormalizeRelayListOptions {
  /**
   * How to treat a duplicate (case-insensitive, trailing-slash-normalised)
   * relay URL after the first occurrence.
   *
   *  - `"skip"` (default): silently drop the duplicate.
   *  - `"throw"`: throw `new Error(RELAY_DUPLICATE_ERROR)` so the caller
   *    can surface the canonical inline-validation copy verbatim.
   */
  onDuplicate?: "skip" | "throw";

  /**
   * Custom validator. Takes the trimmed input string and returns the value
   * to persist (or throws a {@link RelayValidationError} / any other Error
   * on failure). Defaults to {@link validateRelayUrl} which enforces the
   * strict `wss://` contract.
   *
   * Optional custom validator used by callers that need to preserve the
   * normalise/deduplicate behaviour while applying a narrower URL policy.
   */
  validator?: (url: string) => string;

  /**
   * How to treat validator errors.
   *
   *  - `"throw"` (default): propagate the validator's Error to the caller
   *    so the canonical inline-validation copy renders verbatim.
   *  - `"skip"`: silently drop the offending entry when importing a
   *    trusted or legacy relay list where malformed entries should not
   *    block the rest of the list.
   */
  onValidatorError?: "throw" | "skip";
}

/**
 * Trim, validate, and deduplicate a list of user-supplied relay URLs
 * into the canonical shape that `AppStateProvider` / `MockAppStateProvider`
 * persist and hand to the relay pump.
 *
 * Rules:
 *   - Non-string or empty-after-trim entries are dropped silently.
 *   - Each remaining entry is validated through `options.validator`
 *     (defaults to {@link validateRelayUrl}). A validator throw
 *     propagates unchanged so callers render the canonical error copy.
 *   - Duplicates (by {@link normalizeRelayKey}) are either skipped
 *     (default) or rejected via `throw new Error(RELAY_DUPLICATE_ERROR)`
 *     when `options.onDuplicate === "throw"`.
 *   - Returns the validated-in-order list. Empty input yields an empty
 *     array — callers that require at least one relay must enforce that
 *     separately using {@link RELAY_EMPTY_ERROR} from `AppStateTypes`.
 */
export function normalizeRelayList(
  raws: readonly unknown[],
  options?: NormalizeRelayListOptions,
): string[] {
  const onDuplicate = options?.onDuplicate ?? "skip";
  const onValidatorError = options?.onValidatorError ?? "throw";
  const validator = options?.validator ?? validateRelayUrl;
  const result: string[] = [];
  const seenKeys = new Set<string>();
  for (const raw of raws) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length === 0) continue;
    let validated: string;
    try {
      validated = validator(trimmed);
    } catch (err) {
      if (onValidatorError === "throw") throw err;
      continue;
    }
    const key = normalizeRelayKey(validated);
    if (seenKeys.has(key)) {
      if (onDuplicate === "throw") {
        throw new Error(RELAY_DUPLICATE_ERROR);
      }
      continue;
    }
    seenKeys.add(key);
    result.push(validated);
  }
  return result;
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
