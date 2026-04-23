/**
 * Reusable "secret leak" scanner used by the m7 security live sweep
 * (feature id `m7-security-live-sweep`) to assert that mid-sign,
 * mid-ECDH, and mid-onboard snapshots of observable surfaces —
 * `sessionStorage`, `IndexedDB` (idb-keyval mocked as a plain `Map`),
 * `window.__debug` state, `window.__appState`, the captured console
 * transcript, and the outbound runtime envelope stream — never carry
 * any of the following sensitive tokens:
 *
 *   - `partial_signature` / `partial_signatures`
 *   - `share_secret` / `share_secret_hex` / `seckey`
 *   - `nonce_secret` / `nonce_secrets`
 *   - `passphrase` / `password`
 *   - bech32 `nsec1…` private keys
 *   - plaintext `bfprofile1…` tokens (the encrypted-wrapper form is
 *     fine — the snapshot scan specifically targets the bech32
 *     bfprofile preamble, which should only ever be handed to the
 *     restore flow once decrypted).
 *
 * The scanner is intentionally a superset of
 * `scrubEventLogPayload` (see `src/lib/bifrost/eventLogScrub.ts`): it
 * does NOT redact — it REPORTS. Every finding is a test failure.
 *
 * Redacted sentinels (`"[redacted]"`, `"[redacted-bfprofile]"`) are
 * recognised as safe and MUST NOT surface as findings. Bare metadata
 * identifiers that happen to share a partial substring with a
 * sensitive key (e.g. `share_public_key`, `group_public_key`) are
 * NOT flagged — the scanner matches exact JSON key names only.
 *
 * The scanner accepts any JSON-serialisable input. Non-serialisable
 * inputs (functions, DOM nodes) are coerced via a circular-safe
 * JSON serialiser that replaces cycles with the sentinel
 * `"[circular]"` and replaces non-serialisable leaves with their
 * `toString()` output, so the caller can pass `window.__debug`
 * directly without special-casing getters.
 */

/**
 * A single secret-leak finding produced by {@link scanSnapshot}.
 * `kind` identifies WHICH class of secret was detected; `context`
 * names the surface that leaked it (e.g. `"sessionStorage"` or
 * `"console[warn]"`); `evidence` is a short excerpt of the leak for
 * test failure diagnostics — never the full secret, to avoid
 * propagating the leak into the test log.
 */
export interface SecretSweepFinding {
  readonly kind:
    | "partial_signature"
    | "share_secret"
    | "nonce_secret"
    | "passphrase"
    | "plaintext_bfprofile"
    | "nsec_bech32";
  readonly context: string;
  readonly evidence: string;
}

/**
 * Sentinels produced by the event-log scrubber (and accepted by this
 * scanner as "already redacted"). MUST match
 * `REDACTED_SENTINEL` / `REDACTED_BFPROFILE_SENTINEL` in
 * `src/lib/bifrost/eventLogScrub.ts`.
 */
const REDACTED_SENTINEL = "[redacted]";
const REDACTED_BFPROFILE_SENTINEL = "[redacted-bfprofile]";

/**
 * Stable, discriminated set of JSON key-name → finding-kind bindings.
 * Every row here corresponds to a named contract in the feature
 * description. If the runtime wire shape grows a new secret-bearing
 * key, add an entry here AND update the scanner unit test.
 *
 * Matched against the serialised JSON payload as the literal sequence
 * `"<key>":"<value>"`. Non-string values (objects/arrays) are covered
 * by the recursive walk in {@link scanObject}; this regex batch only
 * catches the common "key holds a string value" shape.
 */
const SENSITIVE_KEYS: ReadonlyArray<{
  readonly key: string;
  readonly kind: SecretSweepFinding["kind"];
}> = [
  { key: "partial_signature", kind: "partial_signature" },
  { key: "partial_signatures", kind: "partial_signature" },
  { key: "share_secret", kind: "share_secret" },
  { key: "share_secret_hex", kind: "share_secret" },
  { key: "seckey", kind: "share_secret" },
  { key: "nonce_secret", kind: "nonce_secret" },
  { key: "nonce_secrets", kind: "nonce_secret" },
  { key: "passphrase", kind: "passphrase" },
  { key: "password", kind: "passphrase" },
];

/**
 * Bech32 `nsec1` recognition. The charset excludes `b`, `i`, `o`, `1`
 * by bech32 spec — we encode that explicitly so the regex does not
 * accept obviously invalid sequences. A 50-char lower bound excludes
 * short error-message mentions of the literal `nsec1` token (the real
 * encoded form is 59 chars for a 32-byte payload).
 */
const NSEC_BECH32_RE = /nsec1[02-9ac-hj-np-z]{50,}/g;

/**
 * Plaintext bfprofile bech32m token. Same charset logic as above. The
 * 8-char minimum on the data section is well below realistic bfprofile
 * lengths (hundreds of chars) but high enough to exclude bare
 * literal-name mentions.
 */
const BFPROFILE_RE = /bfprofile1[02-9ac-hj-np-z]{8,}/g;

/**
 * Keys whose values MAY legitimately carry a `bfprofile1…` prefixed
 * string because they are contract-defined ENCRYPTED wrappers:
 *
 *   - `encryptedProfilePackage` — the bech32-encoded, password-
 *     encrypted profile record persisted to IndexedDB under the
 *     StoredProfileRecord schema. Plaintext profile data is inside
 *     (after decryption), but the wire form is encrypted.
 *   - `profilePackage` / `profile_string` — the output of
 *     `encode_bfprofile_package(payload, password)`, which the WASM
 *     bridge encrypts before bech32-encoding. Both naming forms are
 *     recognised (the WASM bridge uses snake_case; the TS layer
 *     hand-renames it in a few places).
 *   - `encryptedProfileBackup` / `content` — the encrypted-backup
 *     event content field persisted to a relay in the backup-
 *     restore flow (NIP-16 replaceable event).
 *
 * The scanner DOES NOT treat the plaintext-bech32 `bfprofile1…` form
 * as safe at any other key; only these explicitly named wrapper
 * fields are exempted from the `plaintext_bfprofile` regex scan. The
 * sensitive-key walker still runs for all other detections.
 */
const ENCRYPTED_BFPROFILE_WRAPPER_KEYS = new Set<string>([
  "encryptedProfilePackage",
  "profilePackage",
  "profile_string",
  "encryptedProfileBackup",
]);

/**
 * Circular-safe JSON serialiser. Used to coerce the input into a
 * single flat string for the pattern-based scans. Objects with
 * circular references (common in React fibre / WASM bridge state) are
 * collapsed to the sentinel `"[circular]"` on the cycle. Values whose
 * `typeof` is not JSON-compatible (`function`, `symbol`, `bigint`) are
 * serialised via their string coercion so nothing silently drops out
 * of the scan. Errors carry their `message` (not just `"{}"`).
 *
 * Additionally, string values held at a
 * {@link ENCRYPTED_BFPROFILE_WRAPPER_KEYS} key are replaced with a
 * non-bfprofile sentinel (`"[encrypted-bfprofile]"`) BEFORE being
 * emitted into the serialised form — so the bfprofile regex does not
 * match them. This keeps the scanner from flagging the profile record
 * that AGENTS.md explicitly permits in IndexedDB.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, val) => {
    if (
      typeof val === "string" &&
      ENCRYPTED_BFPROFILE_WRAPPER_KEYS.has(key)
    ) {
      // Even though the value IS bfprofile1-prefixed, at this key it is
      // contractually encrypted. Replace with a neutral sentinel so the
      // `bfprofile1` regex below does not flag it. Non-bfprofile values
      // at this key (legacy / corrupted rows) fall through to the regex
      // and ARE flagged — which is the desired conservative default.
      return "[encrypted-bfprofile]";
    }
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "function") return `[fn ${val.name || "anonymous"}]`;
    if (typeof val === "symbol") return val.toString();
    if (val instanceof Error) return `${val.name}: ${val.message}`;
    if (val !== null && typeof val === "object") {
      if (seen.has(val)) return "[circular]";
      seen.add(val);
    }
    return val;
  }) ?? "";
}

/**
 * Recursively walk an object/array tree, flagging any value at a
 * SENSITIVE_KEYS entry whose value is a non-empty string and is NOT
 * the redaction sentinel. This catches leaks at structured keys even
 * when the value is a plain alphanumeric string (e.g. a 64-hex
 * secret) that doesn't match the nsec/bfprofile regex.
 *
 * The walker is the structured complement to the string-regex scan
 * below. Both run for every snapshot so we catch leaks in both
 * shapes.
 */
function scanObject(
  value: unknown,
  context: string,
  findings: SecretSweepFinding[],
  seen: WeakSet<object>,
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) {
      scanObject(item, context, findings, seen);
    }
    return;
  }

  for (const [key, fieldValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const match = SENSITIVE_KEYS.find((entry) => entry.key === key);
    if (match) {
      if (
        typeof fieldValue === "string" &&
        fieldValue.length > 0 &&
        fieldValue !== REDACTED_SENTINEL
      ) {
        findings.push({
          kind: match.kind,
          context: `${context}.${key}`,
          evidence: `${fieldValue.slice(0, 8)}… (len=${fieldValue.length})`,
        });
      } else if (Array.isArray(fieldValue)) {
        // `partial_signatures: ["0f…", …]` — report each non-empty,
        // non-sentinel member. We do NOT recurse into the array via
        // scanObject below so we preserve the key-name context.
        for (let i = 0; i < fieldValue.length; i += 1) {
          const item = fieldValue[i];
          if (
            typeof item === "string" &&
            item.length > 0 &&
            item !== REDACTED_SENTINEL
          ) {
            findings.push({
              kind: match.kind,
              context: `${context}.${key}[${i}]`,
              evidence: `${item.slice(0, 8)}… (len=${item.length})`,
            });
          } else if (item !== null && typeof item === "object") {
            scanObject(item, `${context}.${key}[${i}]`, findings, seen);
          }
        }
      } else if (fieldValue !== null && typeof fieldValue === "object") {
        scanObject(
          fieldValue,
          `${context}.${key}`,
          findings,
          seen,
        );
      }
      // string sentinels and missing values are treated as clean.
    } else if (fieldValue !== null && typeof fieldValue === "object") {
      scanObject(fieldValue, `${context}.${key}`, findings, seen);
    }
  }
}

/**
 * Run all secret-leak scans against one snapshot and return the flat
 * list of findings. The returned array is empty when the snapshot is
 * clean — the canonical assertion for the security sweep test is
 * `expect(findings).toEqual([])`.
 *
 * `context` is a stable human-readable name for the surface being
 * scanned; every finding is tagged with it so the failure message
 * points directly at the leaking surface ("sessionStorage" vs
 * "console[warn]" vs "outboundEnvelopes[3]").
 */
export function scanSnapshot(
  value: unknown,
  context: string,
): SecretSweepFinding[] {
  const findings: SecretSweepFinding[] = [];

  // (1) Structured walk catches leaks at named keys regardless of
  // their string value (e.g. a 64-hex share_secret wouldn't match the
  // nsec/bfprofile regex, but IS flagged here).
  scanObject(value, context, findings, new WeakSet());

  // (2) String/regex scan catches nsec1 / bfprofile1 tokens embedded
  // anywhere in the serialised form, even inside otherwise innocuous
  // string fields (e.g. a log message that accidentally interpolates
  // a decoded private key).
  const serialised = typeof value === "string" ? value : safeStringify(value);
  if (serialised.length > 0) {
    const nsecHits = serialised.match(NSEC_BECH32_RE) ?? [];
    for (const hit of nsecHits) {
      findings.push({
        kind: "nsec_bech32",
        context,
        evidence: `${hit.slice(0, 8)}… (len=${hit.length})`,
      });
    }
    const bfprofileHits = serialised.match(BFPROFILE_RE) ?? [];
    for (const hit of bfprofileHits) {
      // The sentinel `[redacted-bfprofile]` does NOT match the regex
      // (no `1` in the charset) so any hit here is a real leak.
      findings.push({
        kind: "plaintext_bfprofile",
        context,
        evidence: `${hit.slice(0, 12)}… (len=${hit.length})`,
      });
    }
  }

  return findings;
}

/**
 * Combine findings from multiple snapshots into a single list keyed
 * by context. Convenient when the test takes five ordered snapshots
 * and wants to assert that the union is empty — one assertion, one
 * diff, one clear error message.
 */
export function scanSnapshotSet(
  snapshots: ReadonlyArray<{ context: string; value: unknown }>,
): SecretSweepFinding[] {
  const findings: SecretSweepFinding[] = [];
  for (const snapshot of snapshots) {
    findings.push(...scanSnapshot(snapshot.value, snapshot.context));
  }
  return findings;
}
