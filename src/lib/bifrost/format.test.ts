import { describe, expect, it } from "vitest";
import { assertNoRawShareMaterial, memberPubkeyXOnly, peersForLocalShare, runtimeBootstrapFromParts } from "./format";
import type { GroupPackageWire, SharePackageWire } from "./types";

const group: GroupPackageWire = {
  group_name: "Test Group",
  group_pk: "aa".repeat(32),
  threshold: 2,
  members: [
    { idx: 1, pubkey: `02${"11".repeat(32)}` },
    { idx: 2, pubkey: `03${"22".repeat(32)}` },
    { idx: 3, pubkey: "33".repeat(32) }
  ]
};

const share: SharePackageWire = {
  idx: 1,
  seckey: "44".repeat(32)
};

describe("bifrost format helpers", () => {
  it("normalizes compressed member pubkeys to x-only peer keys", () => {
    expect(memberPubkeyXOnly(group.members[0])).toBe("11".repeat(32));
    expect(memberPubkeyXOnly(group.members[2])).toBe("33".repeat(32));
  });

  it("builds runtime bootstrap with all non-local peers", () => {
    expect(peersForLocalShare(group, 1)).toEqual(["22".repeat(32), "33".repeat(32)]);
    expect(runtimeBootstrapFromParts(group, share)).toEqual({
      group,
      share,
      peers: ["22".repeat(32), "33".repeat(32)],
      initial_peer_nonces: []
    });
  });

  it("guards browser storage summaries against raw share material", () => {
    expect(() => assertNoRawShareMaterial({ summary: { localShareIdx: 1 } })).not.toThrow();
    expect(() => assertNoRawShareMaterial({ share_secret: "44".repeat(32) })).toThrow(/raw share material/);
    expect(() => assertNoRawShareMaterial({ seckey: "44".repeat(32) })).toThrow(/raw share material/);
  });
});

