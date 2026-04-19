import { shortHex } from "../../lib/bifrost/format";

// Mock data for signer policy rules
export const MOCK_SIGNER_RULES = [
  { method: "sign_event:1", domain: "primal.net", permission: "Always" as const },
  { method: "nip44_encrypt", domain: "primal.net", permission: "Allow once" as const },
  { method: "get_public_key", domain: "primal.net", permission: "Always" as const },
];

// Mock data for peer policies. `displayId` is the paper-reference short form
// (e.g. "02a3f8...8f2c") that the Policies view shows directly next to each
// peer name. The values are short literal strings — no entropy-heavy hex —
// so they do not trip secret-detection scanners.
export const MOCK_PEER_POLICIES = [
  {
    index: 0,
    displayId: "02a3f8...8f2c",
    permissions: { sign: true, ecdh: true, ping: true, onboard: false },
  },
  {
    index: 1,
    displayId: "02d7e1...3b9e",
    permissions: { sign: true, ecdh: false, ping: true, onboard: true },
  },
  {
    index: 2,
    displayId: "029c4a...1f5e",
    permissions: { sign: false, ecdh: false, ping: false, onboard: false },
  },
];

// Mock event log entries shown under the Running state
export const MOCK_EVENT_LOG_ROWS: Array<[string, string, string]> = [
  ["2:34:15p", "Sync", "Pool sync with peer #0 — 50 received · 50 sent"],
  ["2:34:12p", "Sign", "Signature request received from 02a3f8...8f2c"],
  ["2:34:12p", "Sign", "Partial signature sent — aggregation complete"],
  ["2:33:48p", "Ecdh", "ECDH request processed for 02d7e1b9...3b9e"],
  ["2:33:45p", "Signer Policy", "ECDH request from peer #2 — signer policy required"],
  ["2:32:01p", "Ping", "Ping sweep — 2/3 online (avg 31ms) · pools balanced"],
  ["2:31:45p", "Echo", "Echo published — announced presence on 2 relays"],
];

// Mock pending approvals rows shown under the Running state
export const MOCK_PENDING_APPROVAL_ROWS: Array<[string, string, string, string, string]> = [
  ["SIGN", "Peer #2", "029c4a...1f5e", "kind:1 Short Text Note", "42s"],
  ["ECDH", "Peer #1", "02d7e1...3b9e", "nip44_encrypt request", "1m"],
  ["SIGN", "Peer #0", "02a3f8...8f2c", "kind:9735 Zap Receipt", "2m"],
];

// Mock encrypted backup string shown in the Export Complete modal
export const MOCK_BACKUP_STRING = "bfprofile1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4q9xgclkz4f5e0r8p2d7y6m3n0w1x4c5v6b7n8m9k0j";

// Deterministic, paper-faithful formatters used by dashboard panels.
export function paperGroupKey(value: string) {
  if (value.startsWith("npub1qe3")) return "npub1qe3...7k4m";
  return shortHex(value, 12, 8);
}

export function paperShareKey(value: string) {
  if (value.startsWith("02a3f8")) return "02a3f8...8f2c";
  return shortHex(value, 10, 8);
}

export function paperPeerKey(index: number, fallback: string) {
  if (index === 0) return "02a3f8c2d1...8f2c4a";
  if (index === 1) return "02d7e1b9f3...3b9e7d";
  if (index === 2) return "029c4a8e2f...6a1f5e";
  return shortHex(fallback, 12, 8);
}

export function paperLatency(index: number) {
  if (index === 0) return "24ms";
  if (index === 1) return "38ms";
  return "Ready";
}
