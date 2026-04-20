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
  { idx: 1, memberPubkey: "03b7d2...a91e", packageText: "bfonboard1qxy7...mock", password: "rotate-pkg-1", packageCopied: false, passwordCopied: false },
  { idx: 2, memberPubkey: "02c4e8...f3b7", packageText: "bfonboard1qzw9...mock", password: "rotate-pkg-2", packageCopied: false, passwordCopied: false }
];

/**
 * VAL-RTK-006 — Paper-quoted member rows for the rotate-keyset Distribution
 * Completion screen. Mirrors the Shared flow's paperRow preset (see
 * DistributionCompleteScreen.tsx) so both adaptations ship identical member
 * summary rows with their respective status chips.
 */
export const ROTATE_COMPLETION_ROWS: { title: string; device: string; statuses: string[] }[] = [
  { title: "Member #1 — Igloo Mobile", device: "Existing Device", statuses: ["Copied", "QR shown"] },
  { title: "Member #2 — Igloo Desktop", device: "New Device", statuses: ["QR shown"] }
];
