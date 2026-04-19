import type { AppStateValue, CreateSession } from "../app/AppState";
import type { KeysetBundle, RuntimeStatusSummary, StoredProfileSummary } from "../lib/bifrost/types";

const now = Date.UTC(2026, 2, 8, 12, 0, 0);

export const DEMO_PROFILE_ID = "demo-profile";
export const DEMO_GROUP_PK = "npub1qe3abcdefghijklmnopqrstuvwx7k4m";
export const DEMO_SHARE_PK = "02a3f8c2d1e2f3a4b5c6d7e8f9a0b1c28f2c4a";
export const DEMO_BFPROFILE = "bfprofile1qvz8k2afcqqszq2v5v5hnpfdk2auecfnhge355m0dh8g6ms4e2f4j9p0x7z";
export const DEMO_BFONBOARD = "bfonboard1qxy7k2afcqqszq2v5v5hnpfdk2auecfnhge355m0dh8g6ms4e";
export const DEMO_BFSHARE = "bfshare1qvz8k2afcqqszq2v5v5hnpfdk2auecfnhge355m0dh8g6ms4e";
export const PAPER_MASKED_PACKAGE = "bfonboard1•••••••••••••••••••••••••••••••••••";
export const PAPER_MASKED_NSEC = "nsec1abc•••••••••••••••••••••••••••••••••••...";
export const PAPER_RECOVERED_NSEC = "nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0";
export const DEMO_PASSWORD = "paperpass";

export const demoProfile: StoredProfileSummary = {
  id: DEMO_PROFILE_ID,
  label: "My Signing Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  groupPublicKey: DEMO_GROUP_PK,
  relays: ["wss://relay.primal.net", "wss://relay.damus.io"],
  createdAt: now,
  lastUsedAt: now
};

export const demoProfiles: StoredProfileSummary[] = [
  demoProfile,
  {
    ...demoProfile,
    id: "work-profile",
    label: "Work Key",
    deviceName: "Work Laptop",
    localShareIdx: 0,
    groupPublicKey: "npub1d8fabcdefghijklmnopqrstuvw9k2m"
  },
  {
    ...demoProfile,
    id: "backup-profile",
    label: "Backup Key",
    deviceName: "Vault Browser",
    threshold: 3,
    memberCount: 5,
    localShareIdx: 2,
    groupPublicKey: "npub1f7aabcdefghijklmnopqrstuvw4x1n"
  },
  {
    ...demoProfile,
    id: "cold-storage-profile",
    label: "Cold Storage",
    deviceName: "Vault Device",
    groupPublicKey: "npub1coldabcdefghijklmnopqrstuv8h6q"
  },
  {
    ...demoProfile,
    id: "family-profile",
    label: "Family Key",
    deviceName: "Family Laptop",
    groupPublicKey: "npub1famabcdefghijklmnopqrstuvw2d5r"
  },
  {
    ...demoProfile,
    id: "joint-profile",
    label: "Joint Key",
    deviceName: "Shared Workstation",
    groupPublicKey: "npub1jointabcdefghijklmnopqrstuv5m8t"
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    ...demoProfile,
    id: `archive-profile-${index + 1}`,
    label: `Archive Key ${index + 1}`,
    deviceName: `Archive Device ${index + 1}`,
    groupPublicKey: `npub1archive${index + 1}abcdefghijklmnop${index + 1}q9z`
  }))
];

export const demoKeyset: KeysetBundle = {
  group: {
    group_name: "My Signing Key",
    group_pk: DEMO_GROUP_PK,
    threshold: 2,
    members: [
      { idx: 0, pubkey: DEMO_SHARE_PK },
      { idx: 1, pubkey: "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d" },
      { idx: 2, pubkey: "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e" }
    ]
  },
  shares: [
    { idx: 0, seckey: "1".repeat(64) },
    { idx: 1, seckey: "2".repeat(64) },
    { idx: 2, seckey: "3".repeat(64) }
  ]
};

export function createDemoSession(options: { profileCreated?: boolean; distributed?: boolean } = {}): CreateSession {
  return {
    draft: { groupName: "My Signing Key", threshold: 2, count: 3 },
    keyset: demoKeyset,
    localShare: demoKeyset.shares[0],
    createdProfileId: options.profileCreated ? DEMO_PROFILE_ID : undefined,
    onboardingPackages: demoKeyset.shares.slice(1).map((share, index) => ({
      idx: share.idx,
      memberPubkey: demoKeyset.group.members[index + 1].pubkey,
      packageText: `${DEMO_BFONBOARD}${share.idx}`,
      password: DEMO_PASSWORD,
      copied: Boolean(options.distributed && share.idx === 1),
      qrShown: Boolean(options.distributed && share.idx === 2)
    }))
  };
}

export const demoRuntimeStatus: RuntimeStatusSummary = {
  status: {
    device_id: "demo-device",
    pending_ops: 0,
    last_active: now,
    known_peers: 3,
    request_seq: 42
  },
  metadata: {
    device_id: "demo-device",
    member_idx: 0,
    share_public_key: DEMO_SHARE_PK,
    group_public_key: DEMO_GROUP_PK,
    peers: demoKeyset.group.members.map((member) => member.pubkey)
  },
  readiness: {
    runtime_ready: true,
    restore_complete: true,
    sign_ready: true,
    ecdh_ready: true,
    threshold: 2,
    signing_peer_count: 2,
    ecdh_peer_count: 2,
    last_refresh_at: now,
    degraded_reasons: []
  },
  peers: [
    {
      idx: 0,
      pubkey: DEMO_SHARE_PK,
      known: true,
      last_seen: now,
      online: true,
      incoming_available: 93,
      outgoing_available: 78,
      outgoing_spent: 12,
      can_sign: true,
      should_send_nonces: true
    },
    {
      idx: 1,
      pubkey: "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d",
      known: true,
      last_seen: now - 16000,
      online: true,
      incoming_available: 18,
      outgoing_available: 12,
      outgoing_spent: 3,
      can_sign: true,
      should_send_nonces: false
    },
    {
      idx: 2,
      pubkey: "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e",
      known: true,
      last_seen: null,
      online: false,
      incoming_available: 0,
      outgoing_available: 0,
      outgoing_spent: 0,
      can_sign: false,
      should_send_nonces: false
    }
  ],
  peer_permission_states: [
    {
      pubkey: DEMO_SHARE_PK,
      manual_override: null,
      remote_observation: null,
      effective_policy: { sign: "allow", ecdh: "allow", ping: "allow", onboard: "deny" }
    },
    {
      pubkey: "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d",
      manual_override: null,
      remote_observation: null,
      effective_policy: { sign: "allow", ecdh: "ask", ping: "allow", onboard: "allow" }
    },
    {
      pubkey: "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e",
      manual_override: null,
      remote_observation: null,
      effective_policy: { sign: "ask", ecdh: "deny", ping: "allow", onboard: "deny" }
    }
  ],
  pending_operations: []
};

export function createDemoAppState(overrides: Partial<AppStateValue> = {}): AppStateValue {
  const state: AppStateValue = {
    profiles: [],
    activeProfile: null,
    runtimeStatus: null,
    signerPaused: false,
    createSession: null,
    reloadProfiles: async () => undefined,
    createKeyset: async () => undefined,
    createProfile: async () => DEMO_PROFILE_ID,
    updatePackageState: () => undefined,
    finishDistribution: async () => DEMO_PROFILE_ID,
    unlockProfile: async () => undefined,
    lockProfile: () => undefined,
    clearCredentials: async () => undefined,
    setSignerPaused: () => undefined,
    refreshRuntime: () => undefined
  };

  return { ...state, ...overrides };
}
