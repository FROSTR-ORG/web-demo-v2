import { describe, expect, it } from "vitest";
import {
  createKeysetBundle,
  decodeBfsharePackage,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
} from "../lib/bifrost/packageService";
import type { RuntimeSnapshotExport, StoredProfileSummary } from "../lib/bifrost/types";
import { exportRuntimePackagesFromSnapshot } from "./runtimeExports";

describe("runtime exports", () => {
  it("exports real bfprofile and bfshare packages from a runtime snapshot", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Runtime Export Key",
      threshold: 2,
      count: 3,
    });
    const share = keyset.shares[0];
    const profileId = await deriveProfileIdFromShareSecret(share.seckey);
    const profile: StoredProfileSummary = {
      id: profileId,
      label: "Runtime Export Key",
      deviceName: "Igloo Browser",
      groupName: "Runtime Export Key",
      threshold: 2,
      memberCount: 3,
      localShareIdx: share.idx,
      groupPublicKey: keyset.group.group_pk,
      relays: ["wss://relay.one", "wss://relay.two"],
      createdAt: 1,
      lastUsedAt: 1,
    };
    const snapshot: RuntimeSnapshotExport = {
      bootstrap: {
        group: keyset.group,
        share,
        peers: keyset.group.members
          .filter((member) => member.idx !== share.idx)
          .map((member) => member.pubkey),
      },
      state_hex: "00",
      status: {
        device_id: "device",
        pending_ops: 0,
        last_active: 1,
        known_peers: 2,
        request_seq: 1,
      },
      state: {
        version: 1,
        last_active: 1,
        request_seq: 1,
        replay_cache_size: 0,
        ecdh_cache_size: 0,
        sig_cache_size: 0,
        nonce_pool: { peers: [] },
      },
    };

    const exported = await exportRuntimePackagesFromSnapshot({
      profile,
      snapshot,
      password: "export-password",
      peerCount: 2,
    });

    expect(exported.profilePackage.startsWith("bfprofile1")).toBe(true);
    expect(exported.sharePackage.startsWith("bfshare1")).toBe(true);
    expect(exported.metadata).toMatchObject({
      profileId,
      groupName: "Runtime Export Key",
      deviceName: "Igloo Browser",
      shareIdx: share.idx,
      relayCount: 2,
      peerCount: 2,
    });

    const decodedProfile = await decodeProfilePackage(exported.profilePackage, "export-password");
    expect(decodedProfile.profile_id).toBe(profileId);
    expect(decodedProfile.device.name).toBe("Igloo Browser");
    expect(decodedProfile.device.relays).toEqual(profile.relays);
    expect(decodedProfile.group_package.group_name).toBe("Runtime Export Key");

    const decodedShare = await decodeBfsharePackage(exported.sharePackage, "export-password");
    expect(decodedShare.share_secret).toBe(share.seckey);
    expect(decodedShare.relays).toEqual(profile.relays);
  }, 30_000);
});
