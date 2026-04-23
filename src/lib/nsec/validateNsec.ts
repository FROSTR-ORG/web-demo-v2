/**
 * Structural validator for NIP-19 nsec1 bech32 strings.
 *
 * The bifrost-bridge-wasm surface exposes `create_keyset_bundle_from_nsec`
 * which can decode an nsec but is an expensive, side-effectful call
 * (it generates a full threshold keyset). For cheap input-stage
 * validation we want a pure, synchronous bech32 checksum check.
 *
 * This module implements BIP-173 bech32 decoding sufficient to verify:
 *   1. Prefix is exactly `nsec` (human-readable part).
 *   2. Separator `1` is present at position 4.
 *   3. All data characters are in the bech32 charset.
 *   4. The trailing 6-character polymod checksum equals the bech32
 *      constant (1).
 *   5. The payload decodes to exactly 32 bytes (NIP-19 secret key).
 *
 * Case-insensitive but mixed case is rejected per BIP-173.
 * No part of the input is ever written to console/localStorage by this
 * module — callers must never log the value themselves either.
 *
 * See feature `fix-m6-nsec-structural-validation` (m6-backup milestone).
 */

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const NSEC_HRP = "nsec";
const NSEC_SECRET_KEY_BYTES = 32;

function polymod(values: readonly number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/**
 * Convert 5-bit groups back to 8-bit bytes per BIP-173. Fails closed
 * (returns null) on any invalid padding.
 */
function from5To8(data: readonly number[]): number[] | null {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  const maxv = (1 << 8) - 1;
  for (const v of data) {
    if (v < 0 || v >> 5 !== 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits >= 5) return null;
  if ((acc << (8 - bits)) & maxv) return null;
  return out;
}

/**
 * Returns true only when `input` is a syntactically and checksum-valid
 * NIP-19 `nsec1…` bech32 string wrapping a 32-byte secret key.
 *
 * This function does NOT trim whitespace — callers must trim before
 * calling so the trim decision stays explicit at the UI layer.
 *
 * Security: never logs any portion of `input`.
 */
export function isValidNsec(input: string): boolean {
  if (typeof input !== "string") return false;
  if (input.length === 0) return false;

  // BIP-173: entire string must be uniformly lowercase OR uppercase.
  const hasLower = /[a-z]/.test(input);
  const hasUpper = /[A-Z]/.test(input);
  if (hasLower && hasUpper) return false;

  const lower = input.toLowerCase();
  if (!lower.startsWith(`${NSEC_HRP}1`)) return false;

  const sepPos = lower.lastIndexOf("1");
  // For `nsec` (4 chars) the separator must be at index 4; payload + 6-char
  // checksum must fit after it.
  if (sepPos !== NSEC_HRP.length) return false;
  if (sepPos + 7 > lower.length) return false;

  const hrp = lower.slice(0, sepPos);
  if (hrp !== NSEC_HRP) return false;

  const data: number[] = [];
  for (let i = sepPos + 1; i < lower.length; i++) {
    const idx = BECH32_CHARSET.indexOf(lower[i]);
    if (idx === -1) return false;
    data.push(idx);
  }

  if (polymod(hrpExpand(hrp).concat(data)) !== 1) return false;

  const payload = data.slice(0, -6);
  const bytes = from5To8(payload);
  if (!bytes) return false;
  if (bytes.length !== NSEC_SECRET_KEY_BYTES) return false;

  return true;
}
