import type { GroupPackageWire, MemberPackageWire, RuntimeBootstrapInput, SharePackageWire } from "./types";

export function shortHex(value: string, left = 8, right = 6): string {
  if (value.length <= left + right + 3) {
    return value;
  }
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

export function memberPubkeyXOnly(member: MemberPackageWire): string {
  const pubkey = member.pubkey.toLowerCase();
  if (pubkey.length === 66) {
    return pubkey.slice(2);
  }
  return pubkey;
}

export function peersForLocalShare(group: GroupPackageWire, localShareIdx: number): string[] {
  return group.members
    .filter((member) => member.idx !== localShareIdx)
    .map(memberPubkeyXOnly)
    .sort();
}

export function memberForShare(group: GroupPackageWire, share: SharePackageWire): MemberPackageWire {
  const member = group.members.find((entry) => entry.idx === share.idx);
  if (!member) {
    throw new Error(`group is missing member for share ${share.idx}`);
  }
  return member;
}

export function runtimeBootstrapFromParts(
  group: GroupPackageWire,
  share: SharePackageWire
): RuntimeBootstrapInput {
  return {
    group,
    share,
    peers: peersForLocalShare(group, share.idx),
    initial_peer_nonces: []
  };
}

export function packagePasswordForShare(groupName: string, idx: number): string {
  const normalized = groupName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${normalized || "igloo"}-share-${idx}`;
}

export function assertNoRawShareMaterial(value: unknown): void {
  const text = JSON.stringify(value);
  if (/"seckey"\s*:/.test(text) || /"share_secret"\s*:/.test(text)) {
    throw new Error("raw share material must not be persisted");
  }
}

