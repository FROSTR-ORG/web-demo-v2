import type { AppStateValue, CreateSession } from "../app/AppState";
import type {
  KeysetBundle,
  RuntimeStatusSummary,
  StoredProfileSummary,
} from "../lib/bifrost/types";

const now = Date.UTC(2026, 2, 8, 12, 0, 0);

export const DEMO_PROFILE_ID = "demo-profile";
export const DEMO_GROUP_PK = "npub1qe3abcdefghijklmnopqrstuvwx7k4m";
export const DEMO_SHARE_PK = "02a3f8c2d1e2f3a4b5c6d7e8f9a0b1c28f2c4a";

/**
 * Protocol-grade identifiers used inside the mock `demoKeyset`. The bifrost
 * WASM bridge validates that every `group_pk` is 32 bytes (64 hex chars,
 * x-only) and every member `pubkey` is 33 bytes (66 hex chars, compressed
 * secp256k1). Without this, the Create → Create Profile flow entered from
 * `/demo/create-keyset` fails with
 * "invalid input: Invalid group package: invalid byte length: expected 33,
 * got 19" the moment `createProfile` calls `create_profile_package_pair`.
 *
 * These values are synthetic — they pass the bridge's byte-length and
 * uniqueness checks but are not derived from any real share secret. The
 * bridge does not cross-validate member pubkeys against share secrets during
 * profile creation or runtime bootstrap, so synthetic keys are safe for the
 * click-through demo.
 */
export const DEMO_GROUP_PK_HEX =
  "3a4e7c1fa9b2c5d8e0f3a6b9c2d5e8f1a4b7c0d3e6f9a2b5c8dbe0f3a6b9ccff";
export const DEMO_SHARE_PK_HEX_0 =
  "02a3f8c2d1e2f3a4b5c6d7e8f9a0b1c28f2c4a0000000000000000000000000000";
export const DEMO_SHARE_PK_HEX_1 =
  "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d000000000000000000000000000000";
export const DEMO_SHARE_PK_HEX_2 =
  "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e0000000000000000000000000000000";
export const DEMO_BFPROFILE =
  "bfprofile1qvz8k2afcqqszq2v5v5hnpfdk2auecfnhge355m0dh8g6ms4e2f4j9p0x7z";
export const DEMO_BFONBOARD =
  "bfonboard1qxy7k2afcqqszq2v5v5hnpfdk2auecfnhge355m0dh8g6ms4e";
export const DEMO_BFSHARE =
  "bfshare1qvz8k2afcqqszq2v5v5hnpfdk2auecfnhge355m0dh8g6ms4e";
export const PAPER_MASKED_PACKAGE =
  "bfonboard1•••••••••••••••••••••••••••••••••••";
export const PAPER_MASKED_NSEC =
  "nsec1abc•••••••••••••••••••••••••••••••••••...";
export const PAPER_RECOVERED_NSEC =
  "nsec1abcpaperrecoveredprivatekeymock7k4m9x2p5s8q3v6w0";
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
  lastUsedAt: now,
};

export const demoProfiles: StoredProfileSummary[] = [
  demoProfile,
  {
    ...demoProfile,
    id: "work-profile",
    label: "Work Key",
    deviceName: "Work Laptop",
    localShareIdx: 0,
    groupPublicKey: "npub1d8fabcdefghijklmnopqrstuvw9k2m",
  },
  {
    ...demoProfile,
    id: "backup-profile",
    label: "Backup Key",
    deviceName: "Vault Browser",
    threshold: 3,
    memberCount: 5,
    localShareIdx: 2,
    groupPublicKey: "npub1f7aabcdefghijklmnopqrstuvw4x1n",
  },
  {
    ...demoProfile,
    id: "cold-storage-profile",
    label: "Cold Storage",
    deviceName: "Vault Device",
    groupPublicKey: "npub1coldabcdefghijklmnopqrstuv8h6q",
  },
  {
    ...demoProfile,
    id: "family-profile",
    label: "Family Key",
    deviceName: "Family Laptop",
    groupPublicKey: "npub1famabcdefghijklmnopqrstuvw2d5r",
  },
  {
    ...demoProfile,
    id: "joint-profile",
    label: "Joint Key",
    deviceName: "Shared Workstation",
    groupPublicKey: "npub1jointabcdefghijklmnopqrstuv5m8t",
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    ...demoProfile,
    id: `archive-profile-${index + 1}`,
    label: `Archive Key ${index + 1}`,
    deviceName: `Archive Device ${index + 1}`,
    groupPublicKey: `npub1archive${index + 1}abcdefghijklmnop${index + 1}q9z`,
  })),
];

export const demoKeyset: KeysetBundle = {
  group: {
    group_name: "My Signing Key",
    // NOTE: `group_pk` must be a 32-byte x-only hex string and member
    // `pubkey`s must be 33-byte compressed-secp256k1 hex strings so the
    // bifrost WASM bridge's byte-length check passes when `createProfile`
    // runs after the demo handoff from `/demo/create-keyset`. Display code
    // uses hardcoded paper strings (see `paperGroupKey`/`paperPeerKey` in
    // DashboardScreen and WelcomeScreen) keyed off index/prefix, so the
    // raw hex values below never surface in content-parity assertions.
    group_pk: DEMO_GROUP_PK_HEX,
    threshold: 2,
    members: [
      { idx: 0, pubkey: DEMO_SHARE_PK_HEX_0 },
      { idx: 1, pubkey: DEMO_SHARE_PK_HEX_1 },
      { idx: 2, pubkey: DEMO_SHARE_PK_HEX_2 },
    ],
  },
  shares: [
    { idx: 0, seckey: "1".repeat(64) },
    { idx: 1, seckey: "2".repeat(64) },
    { idx: 2, seckey: "3".repeat(64) },
  ],
};

export function createDemoSession(
  options: { profileCreated?: boolean; distributed?: boolean } = {},
): CreateSession {
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
      packageCopied: Boolean(options.distributed && share.idx === 1),
      passwordCopied: Boolean(options.distributed),
      copied: Boolean(options.distributed && share.idx === 1),
      qrShown: Boolean(options.distributed && share.idx === 2),
    })),
  };
}

export const demoRuntimeStatus: RuntimeStatusSummary = {
  status: {
    device_id: "demo-device",
    pending_ops: 0,
    last_active: now,
    known_peers: 3,
    request_seq: 42,
  },
  metadata: {
    device_id: "demo-device",
    member_idx: 0,
    share_public_key: DEMO_SHARE_PK,
    group_public_key: DEMO_GROUP_PK,
    peers: demoKeyset.group.members.map((member) => member.pubkey),
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
    degraded_reasons: [],
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
      should_send_nonces: true,
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
      should_send_nonces: false,
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
      should_send_nonces: false,
    },
  ],
  peer_permission_states: [
    {
      pubkey: DEMO_SHARE_PK,
      manual_override: null,
      remote_observation: null,
      effective_policy: {
        sign: "allow",
        ecdh: "allow",
        ping: "allow",
        onboard: "deny",
      },
    },
    {
      pubkey: "02d7e1b9f3a4c5d6e7f8a9b0c1d2e33b9e7d",
      manual_override: null,
      remote_observation: null,
      effective_policy: {
        sign: "allow",
        ecdh: "ask",
        ping: "allow",
        onboard: "allow",
      },
    },
    {
      pubkey: "029c4a8e2f3b4c5d6e7f8a9b0c1d26a1f5e",
      manual_override: null,
      remote_observation: null,
      effective_policy: {
        sign: "ask",
        ecdh: "deny",
        ping: "allow",
        onboard: "deny",
      },
    },
  ],
  pending_operations: [],
};

export function createDemoAppState(
  overrides: Partial<AppStateValue> = {},
): AppStateValue {
  const state: AppStateValue = {
    profiles: [],
    activeProfile: null,
    runtimeStatus: null,
    runtimeRelays: [],
    signerPaused: false,
    createSession: null,
    importSession: null,
    onboardSession: null,
    rotateKeysetSession: null,
    replaceShareSession: null,
    recoverSession: null,
    reloadProfiles: async () => undefined,
    createKeyset: async () => undefined,
    createProfile: async () => DEMO_PROFILE_ID,
    updatePackageState: () => undefined,
    finishDistribution: async () => DEMO_PROFILE_ID,
    clearCreateSession: () => undefined,
    beginImport: () => undefined,
    decryptImportBackup: async () => undefined,
    saveImportedProfile: async () => DEMO_PROFILE_ID,
    clearImportSession: () => undefined,
    decodeOnboardPackage: async () => undefined,
    startOnboardHandshake: async () => undefined,
    saveOnboardedProfile: async () => DEMO_PROFILE_ID,
    clearOnboardSession: () => undefined,
    validateRotateKeysetSources: async () => undefined,
    generateRotatedKeyset: async () => undefined,
    createRotatedProfile: async () => DEMO_PROFILE_ID,
    updateRotatePackageState: () => undefined,
    finishRotateDistribution: async () => DEMO_PROFILE_ID,
    clearRotateKeysetSession: () => undefined,
    decodeReplaceSharePackage: async () => undefined,
    applyReplaceShareUpdate: async () => undefined,
    clearReplaceShareSession: () => undefined,
    validateRecoverSources: async () => undefined,
    recoverNsec: async () => ({
      nsec: PAPER_RECOVERED_NSEC,
      signing_key_hex: "0".repeat(64),
    }),
    clearRecoverSession: () => undefined,
    expireRecoveredNsec: () => undefined,
    unlockProfile: async () => undefined,
    changeProfilePassword: async () => undefined,
    lockProfile: () => undefined,
    clearCredentials: async () => undefined,
    exportRuntimePackages: async () => ({
      profilePackage: "bfprofile1demo",
      sharePackage: "bfshare1demo",
      metadata: {
        profileId: DEMO_PROFILE_ID,
        groupName: "My Signing Key",
        deviceName: "Igloo Web",
        shareIdx: 0,
        relayCount: 2,
        peerCount: 3,
      },
    }),
    createProfileBackup: async () => ({
      backup: { ciphertext: "mock", nonce: "mock", version: 1 },
      event: { id: "mock", pubkey: "mock", created_at: 0, kind: 30078, tags: [], content: "mock", sig: "mock" },
    }),
    setSignerPaused: () => undefined,
    refreshRuntime: () => undefined,
    restartRuntimeConnections: async () => undefined,
    runtimeCompletions: [],
    runtimeFailures: [],
    lifecycleEvents: [],
    signDispatchLog: {},
    signLifecycleLog: [],
    pendingDispatchIndex: {},
    peerDenialQueue: [],
    enqueuePeerDenial: () => undefined,
    resolvePeerDenial: async () => undefined,
    handleRuntimeCommand: createMockHandleRuntimeCommand(),
  };

  return { ...state, ...overrides };
}

/**
 * Per-instance mock implementation of `handleRuntimeCommand`. Emits
 * monotonically-increasing `mock-request-N` ids and honours a 300ms debounce
 * window so tests can assert the rapid-fire contract (VAL-OPS-019) without
 * booting a WASM runtime. Each call to `createMockHandleRuntimeCommand`
 * returns a fresh closure with isolated counter state.
 */
function createMockHandleRuntimeCommand(): AppStateValue["handleRuntimeCommand"] {
  let seq = 0;
  let lastDispatch: { key: string; at: number } | null = null;
  return async (cmd) => {
    const key = serializeCommand(cmd);
    const now = Date.now();
    if (lastDispatch && lastDispatch.key === key && now - lastDispatch.at < 300) {
      return { requestId: null, debounced: true };
    }
    lastDispatch = { key, at: now };
    seq += 1;
    return { requestId: `mock-request-${seq}`, debounced: false };
  };
}

function serializeCommand(
  cmd: Parameters<AppStateValue["handleRuntimeCommand"]>[0],
): string {
  switch (cmd.type) {
    case "sign":
      return `sign:${cmd.message_hex_32}`;
    case "ecdh":
      return `ecdh:${cmd.pubkey32_hex}`;
    case "ping":
      return `ping:${cmd.peer_pubkey32_hex}`;
    case "refresh_peer":
      return `refresh_peer:${cmd.peer_pubkey32_hex}`;
    case "refresh_all_peers":
      return "refresh_all_peers";
    case "onboard":
      return `onboard:${cmd.peer_pubkey32_hex}`;
  }
}
