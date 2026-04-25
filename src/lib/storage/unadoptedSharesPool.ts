import { DEMO_PASSWORD_MIN_LENGTH } from "../../app/AppStateTypes";

/**
 * fix-m7-onboard-distinct-share-allocation — encrypted "unadopted
 * shares" pool.
 *
 * The Create flow generates k-of-n keyset shares; the sponsor keeps
 * exactly ONE share (the local share) and the remaining (n-1) share
 * secrets must be handed off to other devices during onboarding. To
 * avoid the self-peer-rejection bug (the sponsor's bfonboard package
 * previously encoded the sponsor's OWN share secret, so the requester
 * adopted the sponsor's identity and bifrost-rs's `process_event`
 * rejected the handshake as `UnknownPeer(self)`), the sponsor keeps
 * the un-adopted remote share secrets in a password-encrypted pool.
 *
 * The Dashboard "Onboard a Device" flow decrypts the pool momentarily
 * using the profile password, allocates one unadopted share, encodes
 * it into a `bfonboard1…` hand-off package, and tracks the allocation
 * state in a (non-sensitive, unencrypted) ledger so later completions
 * and failures can be reconciled without requiring a second password
 * prompt.
 *
 * Security invariants:
 *   1. Share SECRETS never leave the encrypted pool envelope at rest.
 *      The only time they are decrypted is inside
 *      `createOnboardSponsorPackage`, directly before being passed to
 *      the WASM `encode_bfonboard_package` bridge. The decrypted pool
 *      is never written to React state, React refs, window.__debug,
 *      `sessionStorage`, `localStorage`, or any IndexedDB store other
 *      than the encrypted envelope.
 *   2. The allocation ledger contains only share INDICES +
 *      allocation/request metadata — no share secrets, no passwords,
 *      no decoded payloads. It can therefore be serialised without
 *      encryption.
 *   3. Encryption uses Web Crypto AES-GCM with a PBKDF2-derived key
 *      (SHA-256, 210 000 iterations, 32-byte salt). Each envelope
 *      carries its own random salt and IV so re-encryption of the
 *      same pool yields a fresh ciphertext.
 *
 * See `docs/runtime-deviations-from-paper.md > M7 onboard unadopted
 * share pool` for the architectural write-up and `AGENTS.md` for
 * cross-mission guidance.
 */

import { z } from "zod";

/** Maximum number of unadopted shares a single profile's pool can
 *  hold. Matches the protocol-level bound (n-1 for a k-of-n keyset),
 *  but the schema uses a generous upper limit so the check is a
 *  safety net rather than a business rule. */
const MAX_POOL_SHARES = 64;

export const UNADOPTED_POOL_VERSION = 1 as const;

/** One unadopted share secret + the public member metadata required
 *  to address it on the runtime's dispatch path. */
export const UnadoptedShareEntrySchema = z.object({
  /** Share index inside the keyset group package. */
  idx: z.number().int().nonnegative(),
  /** 64-hex share secret (private). Sensitive — never logged. */
  share_secret: z.string().length(64),
  /** x-only (32-byte, 64-hex) pubkey of the member holding this share. */
  member_pubkey_x_only: z.string().length(64),
});

export type UnadoptedShareEntry = z.infer<typeof UnadoptedShareEntrySchema>;

export const UnadoptedSharesPoolSchema = z.object({
  version: z.literal(UNADOPTED_POOL_VERSION),
  shares: z.array(UnadoptedShareEntrySchema).max(MAX_POOL_SHARES),
});

export type UnadoptedSharesPool = z.infer<typeof UnadoptedSharesPoolSchema>;

/**
 * Status tracked for a single allocation of a pool share. Allocation
 * is the act of handing a pool share off to a new device via the
 * "Onboard a Device" flow; the status evolves as the runtime surfaces
 * Onboard completions, failures, or the sponsor cancels.
 *
 *  - "awaiting_adoption" — sponsor has dispatched; requester has not
 *                          yet completed the FROST handshake.
 *  - "completed"         — onboard completion drained; share is now
 *                          permanently held by the requester and
 *                          cannot be re-allocated.
 *  - "failed"            — onboard failed (wrong password, timeout,
 *                          protocol rejection). The share RETURNS to
 *                          the pool (can be re-allocated).
 *  - "cancelled"         — sponsor cancelled the handoff screen. The
 *                          share RETURNS to the pool.
 *
 * "Available" shares (returned by {@link availableUnadoptedShares})
 * are those whose `idx` is not already claimed by an `awaiting_adoption`
 * or `completed` entry in the ledger.
 */
export type ShareAllocationStatus =
  | "awaiting_adoption"
  | "completed"
  | "failed"
  | "cancelled";

export const ShareAllocationEntrySchema = z.object({
  share_idx: z.number().int().nonnegative(),
  request_id: z.string().min(1),
  device_label: z.string(),
  /** Epoch-ms wall-clock when the allocation was created. */
  allocated_at: z.number().int().nonnegative(),
  /** Epoch-ms wall-clock when the allocation reached a terminal state. */
  terminal_at: z.number().int().nonnegative().optional(),
  status: z.enum([
    "awaiting_adoption",
    "completed",
    "failed",
    "cancelled",
  ]),
  /** Optional runtime-provided failure reason / code. Null on happy
   *  path. */
  failure_reason: z.string().optional(),
});

export type ShareAllocationEntry = z.infer<typeof ShareAllocationEntrySchema>;

/**
 * Compute the subset of pool shares that are available for a new
 * sponsor allocation. A share is available iff the allocation ledger
 * has no `"awaiting_adoption"` or `"completed"` entry for its
 * `share_idx`. Failed / cancelled allocations effectively RETURN the
 * share to the pool so a subsequent sponsor attempt can re-use it
 * (VAL-ONBOARD-014).
 */
export function availableUnadoptedShares(
  pool: UnadoptedSharesPool,
  ledger: ShareAllocationEntry[],
): UnadoptedShareEntry[] {
  const unavailable = new Set<number>();
  for (const entry of ledger) {
    if (
      entry.status === "awaiting_adoption" ||
      entry.status === "completed"
    ) {
      unavailable.add(entry.share_idx);
    }
  }
  return pool.shares.filter((share) => !unavailable.has(share.idx));
}

/* ==========================================================
   Pool crypto — Web Crypto AES-GCM + PBKDF2 password derivation.

   The envelope is a canonical JSON string with base64-encoded
   binary fields:
       {
         "v": 1,
         "kdf": "PBKDF2-SHA256",
         "iter": 210000,
         "salt": "<base64 32-byte salt>",
         "iv":   "<base64 12-byte iv>",
         "ct":   "<base64 AES-GCM-encrypted JSON(payload)>",
       }
   Decryption is symmetric — supply the same password and the nested
   payload round-trips byte-for-byte.
   ========================================================== */

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_HASH = "SHA-256" as const;
const AES_KEY_BITS = 256 as const;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1 as const;

/** Minimum characters required on the password used to encrypt the
 *  pool. Matches the UI gate on the OnboardSponsorConfigScreen / the
 *  profile-unlock password so pool decryption never uses a weaker
 *  secret than the profile it belongs to. */
export const UNADOPTED_POOL_MIN_PASSWORD_LENGTH = DEMO_PASSWORD_MIN_LENGTH;

function isSubtleAvailable(): boolean {
  return (
    typeof globalThis.crypto === "object" &&
    globalThis.crypto !== null &&
    typeof globalThis.crypto.subtle === "object" &&
    globalThis.crypto.subtle !== null
  );
}

function assertSubtleAvailable(): void {
  if (!isSubtleAvailable()) {
    throw new Error(
      "Web Crypto (`crypto.subtle`) is unavailable — unadopted " +
        "share pool encryption requires a secure context.",
    );
  }
}

function toBase64(bytes: Uint8Array): string {
  // atob/btoa are browser globals; Node 20+ exposes them too. When
  // unavailable (tests on older runtimes), fall back to Buffer.
  if (typeof btoa === "function") {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
      );
    }
    return btoa(binary);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeBuffer: any = (globalThis as any).Buffer;
  if (nodeBuffer) return nodeBuffer.from(bytes).toString("base64");
  throw new Error("No base64 encoder available.");
}

function fromBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeBuffer: any = (globalThis as any).Buffer;
  if (nodeBuffer) {
    return new Uint8Array(nodeBuffer.from(value, "base64"));
  }
  throw new Error("No base64 decoder available.");
}

function uint8ToBuffer(bytes: Uint8Array): ArrayBuffer {
  // Copy the byte range into a tight ArrayBuffer so the returned
  // buffer is always a pure `ArrayBuffer` — guards against
  // `Uint8Array<SharedArrayBuffer>` at the TS level and means
  // `crypto.subtle.*` always gets a `BufferSource` that matches its
  // narrowed overload signature.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const pwBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    uint8ToBuffer(pwBytes),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: uint8ToBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

interface EnvelopeV1 {
  v: typeof ENVELOPE_VERSION;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

/**
 * Encrypt a pool payload using PBKDF2+AES-GCM under `password`. The
 * returned string is a canonical JSON envelope suitable for storing
 * alongside the profile record. A fresh random salt + IV is generated
 * on every call, so re-encrypting the same pool yields a different
 * ciphertext — downstream equality checks must round-trip through
 * {@link decryptUnadoptedSharesPool}.
 *
 * Throws when `crypto.subtle` is unavailable or the password is
 * shorter than {@link UNADOPTED_POOL_MIN_PASSWORD_LENGTH}.
 */
export async function encryptUnadoptedSharesPool(
  pool: UnadoptedSharesPool,
  password: string,
): Promise<string> {
  assertSubtleAvailable();
  if (password.length < UNADOPTED_POOL_MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${UNADOPTED_POOL_MIN_PASSWORD_LENGTH} characters to encrypt the unadopted share pool.`,
    );
  }
  // Parse through the schema so we never accidentally serialize
  // unexpected fields into the envelope.
  const canonical = UnadoptedSharesPoolSchema.parse(pool);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(canonical));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: uint8ToBuffer(iv) },
      key,
      uint8ToBuffer(plaintext),
    ),
  );
  const envelope: EnvelopeV1 = {
    v: ENVELOPE_VERSION,
    kdf: "PBKDF2-SHA256",
    iter: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt a pool envelope produced by
 * {@link encryptUnadoptedSharesPool}. Throws when:
 *   - The envelope is malformed or the AES-GCM authentication tag
 *     fails (wrong password).
 *   - `crypto.subtle` is unavailable.
 *
 * On the wrong-password path the thrown error message matches
 * {@link UNADOPTED_POOL_WRONG_PASSWORD_ERROR} so UI surfaces can
 * surface a uniform "incorrect password" copy.
 */
export async function decryptUnadoptedSharesPool(
  envelopeText: string,
  password: string,
): Promise<UnadoptedSharesPool> {
  assertSubtleAvailable();
  let envelope: EnvelopeV1;
  try {
    envelope = JSON.parse(envelopeText) as EnvelopeV1;
  } catch {
    throw new Error(UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR);
  }
  if (
    !envelope ||
    envelope.v !== ENVELOPE_VERSION ||
    envelope.kdf !== "PBKDF2-SHA256" ||
    typeof envelope.salt !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ct !== "string"
  ) {
    throw new Error(UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR);
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ct);
  const key = await deriveKey(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: uint8ToBuffer(iv) },
      key,
      uint8ToBuffer(ciphertext),
    );
  } catch {
    throw new Error(UNADOPTED_POOL_WRONG_PASSWORD_ERROR);
  }
  const text = new TextDecoder().decode(plaintext);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR);
  }
  return UnadoptedSharesPoolSchema.parse(raw);
}

/** Canonical error copy surfaced when the wrong password is supplied
 *  to decrypt the pool. Exported so UI callers can recognise the
 *  message without string-matching on arbitrary copy. */
export const UNADOPTED_POOL_WRONG_PASSWORD_ERROR =
  "Incorrect profile password — could not decrypt the unadopted share pool.";

/** Canonical error copy surfaced when the envelope JSON is malformed
 *  (truncated, tampered, or stored by an unsupported version). */
export const UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR =
  "Unadopted share pool envelope is malformed or from an unsupported version.";

/** Canonical error copy surfaced when the sponsor attempts to onboard
 *  a new device but the pool has no available shares left (every
 *  non-self share has been adopted or is currently awaiting adoption).
 *  VAL-ONBOARD-020 asserts the user sees this phrasing verbatim. */
export const UNADOPTED_POOL_EXHAUSTED_ERROR = "No remaining share slots.";

/* ==========================================================
   Ledger helpers — pure functions operating on a ShareAllocationEntry[].
   The ledger is stored unencrypted on the profile record (no share
   secrets), so every mutation is a trivial array copy + replace.
   ========================================================== */

/**
 * Upsert an allocation ledger entry keyed by `request_id`. If an entry
 * with the same `request_id` already exists it is replaced; otherwise
 * the new entry is appended.
 */
export function upsertShareAllocation(
  ledger: ShareAllocationEntry[],
  entry: ShareAllocationEntry,
): ShareAllocationEntry[] {
  const existingIdx = ledger.findIndex(
    (e) => e.request_id === entry.request_id,
  );
  if (existingIdx === -1) return [...ledger, entry];
  const next = ledger.slice();
  next[existingIdx] = entry;
  return next;
}

/**
 * Transition an allocation ledger entry to a terminal status. No-op
 * when no entry matches `request_id`. Returns a NEW ledger (never
 * mutates the input).
 */
export function updateShareAllocationStatus(
  ledger: ShareAllocationEntry[],
  requestId: string,
  status: ShareAllocationStatus,
  options: {
    failureReason?: string;
    now?: number;
  } = {},
): ShareAllocationEntry[] {
  const now = options.now ?? Date.now();
  let changed = false;
  const next = ledger.map((entry) => {
    if (entry.request_id !== requestId) return entry;
    changed = true;
    return {
      ...entry,
      status,
      terminal_at: status === "awaiting_adoption" ? entry.terminal_at : now,
      failure_reason:
        status === "failed" || status === "cancelled"
          ? options.failureReason ?? entry.failure_reason
          : undefined,
    };
  });
  return changed ? next : ledger;
}
