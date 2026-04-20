import type { RecoverSession } from "../../app/AppState";
import { PAPER_MASKED_NSEC, PAPER_RECOVERED_NSEC } from "../../demo/fixtures";

export function maskShare(hex: string): string {
  return hex.slice(0, 12) + "•".repeat(45);
}

export function maskNsec(nsec: string): string {
  if (nsec === PAPER_RECOVERED_NSEC) {
    return PAPER_MASKED_NSEC;
  }
  return nsec.slice(0, 8) + "•".repeat(42) + "...";
}

export function shortPubkey(pubkey: string): string {
  return pubkey.length > 18 ? `${pubkey.slice(0, 10)}...${pubkey.slice(-8)}` : pubkey;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Recovery failed.";
}

export function isValidatedSession(session: RecoverSession | null, profileId: string, threshold: number): session is RecoverSession {
  return Boolean(
    session?.sourceProfile.id === profileId &&
      session.localShare &&
      session.sources.length >= threshold &&
      !session.recovered
  );
}
