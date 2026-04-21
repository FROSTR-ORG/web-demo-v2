import {
  createProfilePackagePair,
  defaultManualPeerPolicyOverrides,
  encodeBfsharePackage,
  profilePayloadForShare,
} from "../lib/bifrost/packageService";
import type {
  RuntimeSnapshotExport,
  StoredProfileSummary,
} from "../lib/bifrost/types";

export interface RuntimeExportMetadata {
  profileId: string;
  groupName: string;
  deviceName: string;
  shareIdx: number;
  relayCount: number;
  peerCount: number;
}

export interface RuntimeExportPackages {
  profilePackage: string;
  sharePackage: string;
  metadata: RuntimeExportMetadata;
}

export async function exportRuntimePackagesFromSnapshot(input: {
  profile: StoredProfileSummary;
  snapshot: RuntimeSnapshotExport;
  password: string;
  peerCount: number;
}): Promise<RuntimeExportPackages> {
  const relays = input.profile.relays.map((relay) => relay.trim()).filter(Boolean);
  const { group, share } = input.snapshot.bootstrap;
  const profilePayload = profilePayloadForShare({
    profileId: input.profile.id,
    deviceName: input.profile.deviceName,
    share,
    group,
    relays,
    manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(group, share.idx),
  });
  const [profilePair, sharePackage] = await Promise.all([
    createProfilePackagePair(profilePayload, input.password),
    encodeBfsharePackage(
      {
        share_secret: share.seckey,
        relays,
      },
      input.password,
    ),
  ]);

  return {
    profilePackage: profilePair.profile_string,
    sharePackage,
    metadata: {
      profileId: input.profile.id,
      groupName: group.group_name,
      deviceName: input.profile.deviceName,
      shareIdx: share.idx,
      relayCount: relays.length,
      peerCount: input.peerCount,
    },
  };
}
