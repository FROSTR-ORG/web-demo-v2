export interface NostrTextNoteEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 1;
  tags: string[][];
  content: string;
  sig: string;
}

export type UnsignedNostrTextNoteEvent = Omit<NostrTextNoteEvent, "id" | "sig">;

export interface BuildTextNoteInput {
  pubkey: string;
  content: string;
  createdAt?: number;
}

const HEX_64_RE = /^[0-9a-f]{64}$/;
const HEX_128_RE = /^[0-9a-f]{128}$/;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function normalizeNostrPubkey(pubkey: string): string {
  const normalized = pubkey.trim().toLowerCase();
  if (!HEX_64_RE.test(normalized)) {
    throw new Error("Nostr publish requires a 64-character hex group public key.");
  }
  return normalized;
}

export function normalizeSchnorrSignature(signature: string): string {
  const normalized = signature.trim().toLowerCase();
  if (!HEX_128_RE.test(normalized)) {
    throw new Error("Nostr publish requires a 128-character hex Schnorr signature.");
  }
  return normalized;
}

export function buildUnsignedTextNote({
  pubkey,
  content,
  createdAt = Math.floor(Date.now() / 1000),
}: BuildTextNoteInput): UnsignedNostrTextNoteEvent {
  return {
    pubkey: normalizeNostrPubkey(pubkey),
    created_at: createdAt,
    kind: 1,
    tags: [],
    content,
  };
}

export function serializeNostrEventForId(
  event: UnsignedNostrTextNoteEvent,
): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

export async function computeNostrEventId(
  event: UnsignedNostrTextNoteEvent,
): Promise<string> {
  const bytes = new TextEncoder().encode(serializeNostrEventForId(event));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildTextNoteForSigning(
  input: BuildTextNoteInput,
): Promise<UnsignedNostrTextNoteEvent & { id: string }> {
  const event = buildUnsignedTextNote(input);
  return {
    ...event,
    id: await computeNostrEventId(event),
  };
}

export function finalizeTextNoteEvent(
  event: UnsignedNostrTextNoteEvent & { id: string },
  signature: string,
): NostrTextNoteEvent {
  return {
    ...event,
    sig: normalizeSchnorrSignature(signature),
  };
}

export function encodeMinimalNevent(eventId: string): string {
  const normalized = normalizeNostrEventId(eventId);
  const eventIdBytes = hexToBytes(normalized);
  const tlvBytes = [0, eventIdBytes.length, ...eventIdBytes];
  return bech32Encode("nevent", tlvBytes);
}

export function normalizeNostrEventId(eventId: string): string {
  const normalized = eventId.trim().toLowerCase();
  if (!HEX_64_RE.test(normalized)) {
    throw new Error("Nostr nevent requires a 64-character hex event id.");
  }
  return normalized;
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let offset = 0; offset < hex.length; offset += 2) {
    bytes.push(Number.parseInt(hex.slice(offset, offset + 2), 16));
  }
  return bytes;
}

function bech32Encode(hrp: string, bytes: number[]): string {
  const data = convertBits(bytes, 8, 5, true);
  const combined = data.concat(createChecksum(hrp, data));
  return `${hrp}1${combined.map((value) => BECH32_CHARSET[value]).join("")}`;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    checksum.push((mod >> (5 * (5 - index))) & 31);
  }
  return checksum;
}

function hrpExpand(hrp: string): number[] {
  return [
    ...Array.from(hrp, (char) => char.charCodeAt(0) >> 5),
    0,
    ...Array.from(hrp, (char) => char.charCodeAt(0) & 31),
  ];
}

function polymod(values: number[]): number {
  const generators = [
    0x3b6a57b2,
    0x26508e6d,
    0x1ea119fa,
    0x3d4233dd,
    0x2a1462b3,
  ];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index += 1) {
      if (((top >> index) & 1) === 1) {
        chk ^= generators[index];
      }
    }
  }
  return chk;
}

function convertBits(
  bytes: number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;
  for (const value of bytes) {
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad && bits > 0) {
    result.push((accumulator << (toBits - bits)) & maxValue);
  }
  return result;
}
