/**
 * Deep-redact sensitive fields from a runtime event-log payload before
 * it is JSON-stringified into the Event Log panel's expanded body.
 *
 * The feature contract (m4-event-log-panel) lists five classes of
 * secrets that MUST not land in the DOM regardless of which drain
 * channel produced the entry:
 *
 *   - `partial_signature` — FROST partial signature shares (never
 *     user-visible).
 *   - `share_secret`      — raw per-device share material.
 *   - `nonce_secret`      — FROST pre-commitments / nonce pool secrets.
 *   - `passphrase`        — any user-entered password / passphrase.
 *   - `bfprofile1…`       — plaintext bfprofile1-prefixed profile
 *                           backup strings (only the encrypted form is
 *                           safe to surface).
 *
 * The redactor walks objects / arrays recursively, replacing values at
 * matching keys with the sentinel string `"[redacted]"`. It also
 * string-scans every primitive string for embedded `bfprofile1q…`
 * tokens, replacing them with `"[redacted-bfprofile]"`. Non-object /
 * non-string primitives pass through unchanged.
 *
 * The returned value is always a *new* object/array — the input is
 * never mutated so callers can pass live runtime payloads directly.
 *
 * See VAL-EVENTLOG-019 for the contract assertion.
 */
const REDACTED_SENTINEL = "[redacted]";
const REDACTED_BFPROFILE_SENTINEL = "[redacted-bfprofile]";

/**
 * Keys whose values MUST be redacted wherever they appear in the
 * payload tree. Matched case-sensitively because the runtime wire
 * protocol uses snake_case consistently.
 */
const SENSITIVE_KEYS = new Set<string>([
  "partial_signature",
  "partial_signatures",
  "share_secret",
  "share_secret_hex",
  "nonce_secret",
  "nonce_secrets",
  "passphrase",
  "password",
]);

/**
 * Regex that matches a bfprofile1-prefixed backup string. bfprofile
 * strings use the bech32m charset (lowercase alphanumeric minus
 * `b`, `i`, `o`, `1`). A modest length lower-bound (8+ chars after the
 * `bfprofile1` marker) avoids false positives on bare error messages
 * that mention the literal marker token, while still catching any
 * realistic serialised backup (the real tokens run into the hundreds
 * of characters).
 */
const BFPROFILE_TOKEN_RE = /bfprofile1[02-9ac-hj-np-z]{8,}/g;

function scrubString(value: string): string {
  if (!value.includes("bfprofile1")) return value;
  // Preserve a pure-token input cleanly: the whole string becomes the
  // sentinel rather than a concatenation of prefix + sentinel + suffix.
  const fullMatch = value.match(BFPROFILE_TOKEN_RE);
  if (fullMatch && fullMatch[0] === value) return REDACTED_BFPROFILE_SENTINEL;
  return value.replace(BFPROFILE_TOKEN_RE, REDACTED_BFPROFILE_SENTINEL);
}

/**
 * Recursively clone `input`, replacing sensitive-key values with the
 * `[redacted]` sentinel and rewriting bfprofile tokens found in any
 * string leaf. Safe for arbitrarily nested payloads (runtime events,
 * completions, failures) — handles arrays, plain objects, and mixed
 * primitives. Non-plain-object values (Date, Map, functions, etc.) are
 * returned as-is; bifrost-rs drain payloads never carry those.
 */
export function scrubEventLogPayload(input: unknown): unknown {
  if (typeof input === "string") return scrubString(input);
  if (input === null) return null;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => scrubEventLogPayload(item));
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = REDACTED_SENTINEL;
    } else {
      out[key] = scrubEventLogPayload(value);
    }
  }
  return out;
}
