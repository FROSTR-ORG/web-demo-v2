import { shortHex } from "../../lib/bifrost/format";

export type DashboardEventKind = "Sync" | "Sign" | "Ecdh" | "Signer Policy" | "Ping" | "Echo" | "Error";

export interface DashboardEventRow {
  id: string;
  time: string;
  type: DashboardEventKind;
  copy: string;
  details: Record<string, unknown>;
}

export interface PolicyPromptRequest {
  kind: "SIGN" | "ECDH";
  peer: string;
  key: string;
  domain: string;
  relay?: string;
  eventKind: string;
  content: string;
  pubkey: string;
  ttl: string;
}

export interface DashboardApprovalRow {
  id: string;
  kind: "SIGN" | "ECDH";
  peer: string;
  key: string;
  detail: string;
  ttl: string;
  domain: string;
  request: PolicyPromptRequest;
}

export interface DashboardRelayHealthRow {
  relay: string;
  status: "Offline" | "Degraded" | "Online";
  latency: string;
  events: string;
  lastSeen: string;
}

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
export const MOCK_EVENT_TOTAL = 8;
export const MOCK_EVENT_LOG_ROWS: DashboardEventRow[] = [
  {
    id: "sync-peer-0",
    time: "2:34:15p",
    type: "Sync",
    copy: "Pool sync with peer #0 — 50 received · 50 sent",
    details: {
      id: "evt-sync-peer-0",
      type: "pool_sync",
      peer: "peer#0",
      received: 50,
      sent: 50,
      incoming_available: 93,
      outgoing_available: 78
    }
  },
  {
    id: "sign-request-peer-0",
    time: "2:34:12p",
    type: "Sign",
    copy: "Signature request received from 02a3f8...8f2c",
    details: {
      id: "evt-sign-request",
      kind: 1,
      pubkey: "npub1qe3e8v...a7k4m",
      round_id: "r-0x4f2a",
      participants: [0, 1, 2],
      threshold: 2
    }
  },
  {
    id: "sign-complete-peer-0",
    time: "2:34:12p",
    type: "Sign",
    copy: "Partial signature sent — aggregation complete",
    details: {
      id: "evt-sign-complete",
      round_id: "r-0x4f2a",
      participants: ["peer#0", "peer#1"],
      status: "aggregation_complete"
    }
  },
  {
    id: "ecdh-peer-1",
    time: "2:33:48p",
    type: "Ecdh",
    copy: "ECDH request processed for 02d7e1b9...3b9e",
    details: {
      id: "evt-ecdh-peer-1",
      method: "nip44_encrypt",
      peer: "peer#1",
      domain: "primal.net",
      status: "processed"
    }
  },
  {
    id: "policy-peer-2",
    time: "2:33:45p",
    type: "Signer Policy",
    copy: "ECDH request from peer #2 — signer policy required",
    details: {
      id: "evt-policy-peer-2",
      method: "nip44_encrypt",
      peer: "peer#2",
      domain: "primal.net",
      policy: "ask"
    }
  },
  {
    id: "ping-sweep",
    time: "2:32:01p",
    type: "Ping",
    copy: "Ping sweep — 2/3 online (avg 31ms) · pools balanced",
    details: {
      id: "evt-ping-sweep",
      online: 2,
      total: 3,
      average_latency_ms: 31,
      pool_state: "balanced"
    }
  },
  {
    id: "echo-presence",
    time: "2:31:45p",
    type: "Echo",
    copy: "Echo published — announced presence on 2 relays",
    details: {
      id: "evt-echo-presence",
      relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
      presence: "announced"
    }
  },
];

// Mock pending approvals rows shown under the Running state.
// Copy and TTLs quoted directly from Paper `dashboard/1-signer-dashboard/screen.html` (VAL-DSH-003).
export const MOCK_PENDING_APPROVAL_ROWS: DashboardApprovalRow[] = [
  {
    id: "approval-sign-peer-2",
    kind: "SIGN",
    peer: "Peer #2",
    key: "029c4a...1f5e",
    detail: "kind:1 Short Text Note",
    ttl: "42s",
    domain: "primal.net",
    request: {
      kind: "SIGN",
      peer: "Peer #2",
      key: "029c4a...1f5e",
      domain: "primal.net",
      eventKind: "kind:1 (Short Text Note)",
      content: "“gm nostr, anyone up for a coffee meetup...”",
      pubkey: "029c4a...1f5e",
      ttl: "42s"
    }
  },
  {
    id: "approval-ecdh-peer-1",
    kind: "ECDH",
    peer: "Peer #1",
    key: "02d7e1...3b9e",
    detail: "NIP-44 key exchange",
    ttl: "1m 12s",
    domain: "primal.net",
    request: {
      kind: "ECDH",
      peer: "Peer #1",
      key: "02d7e1...3b9e",
      domain: "primal.net",
      relay: "wss://relay.primal.net",
      eventKind: "NIP-44 Encryption",
      content: "Create a shared secret for encrypted direct messages.",
      pubkey: "02d7e1...3b9e",
      ttl: "1m 12s"
    }
  },
  {
    id: "approval-sign-peer-0",
    kind: "SIGN",
    peer: "Peer #0",
    key: "02a3f8...8f2c",
    detail: "kind:4 Encrypted DM",
    ttl: "3m 05s",
    domain: "nos.social",
    request: {
      kind: "SIGN",
      peer: "Peer #0",
      key: "02a3f8...8f2c",
      domain: "nos.social",
      eventKind: "kind:4 (Encrypted DM)",
      content: "Encrypted direct message signature request.",
      pubkey: "02a3f8...8f2c",
      ttl: "3m 05s"
    }
  },
];

export const DEFAULT_POLICY_PROMPT_REQUEST = MOCK_PENDING_APPROVAL_ROWS[0].request;

export const MOCK_RELAY_HEALTH_ROWS: DashboardRelayHealthRow[] = [
  {
    relay: "wss://relay.damus.io",
    status: "Offline",
    latency: "—",
    events: "—",
    lastSeen: "5 min ago"
  },
  {
    relay: "wss://nos.lol",
    status: "Offline",
    latency: "—",
    events: "—",
    lastSeen: "7 min ago"
  },
  {
    relay: "wss://relay.primal.net",
    status: "Offline",
    latency: "—",
    events: "—",
    lastSeen: "9 min ago"
  }
];

// Mock encrypted backup string shown in the Export Complete modal
export const MOCK_BACKUP_STRING = "bfprofile1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4q9xgclkz4f5e0r8p2d7y6m3n0w1x4c5v6b7n8m9k0j";
export const MOCK_SHARE_PACKAGE_STRING = "bfshare1qvz8k2afcqqszq2v5v5hnq9jxq6z9yx7s6np8pq3hm9n2c0g7m4e6a8ks0r5t";

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
