export const MOCK_SOURCE_SHARE_1 = {
  label: "My Signing Key",
  deviceName: "Igloo Web",
  sharePubkey: "02a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4c5d6e7f8a9b0c1d28f2c",
  sharePubkeyDisplay: "02a3f8...8f2c",
  profileId: "prof_8f2c4a",
  relays: 3
};

export const MOCK_ROTATE_MEMBERS = [
  { idx: 0, label: "Peer #0 (Local)" },
  { idx: 1, label: "Peer #1" },
  { idx: 2, label: "Peer #2" }
];

export const MOCK_REMOTE_PACKAGES = [
  {
    idx: 1,
    memberPubkey:
      "03b7d2e4f1a8c9054f6a2e83d7b1094c5e8f3a6d2b7e4c19085f6d3a2b8ea91e",
    packageText: "",
    password: "",
    packageCreated: false,
    peerOnline: false,
    manuallyMarkedDistributed: false,
    packageCopied: false,
    passwordCopied: false,
    copied: false,
    qrShown: false
  },
  {
    idx: 2,
    memberPubkey:
      "02c4e8f9a1d3b5c7e9f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c3d7",
    packageText: "",
    password: "",
    packageCreated: false,
    peerOnline: false,
    manuallyMarkedDistributed: false,
    packageCopied: false,
    passwordCopied: false,
    copied: false,
    qrShown: false
  }
];

/**
 * VAL-RTK-006 — Paper-quoted member rows for the rotate-keyset Distribution
 * Completion screen. Mirrors the Shared flow's paperRow preset (see
 * DistributionCompleteScreen.tsx) so both adaptations ship identical member
 * summary rows with their respective status chips.
 */
export const ROTATE_COMPLETION_ROWS: { title: string; statuses: string[] }[] = [
  { title: "Member #2 — Igloo Mobile", statuses: ["Marked distributed"] },
  { title: "Member #3 — Igloo Desktop", statuses: ["Echo received"] }
];
