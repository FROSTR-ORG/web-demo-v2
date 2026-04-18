import { describe, expect, it } from "vitest";
import { runtimeBootstrapFromParts } from "./format";
import {
  createKeysetBundle,
  createProfilePackagePair,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
  profilePayloadForShare
} from "./packageService";
import { RuntimeClient } from "./runtimeClient";

describe("bifrost wasm package service", () => {
  it("creates a keyset, round-trips a profile package, and initializes runtime status", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Test Signing Key",
      threshold: 2,
      count: 3
    });
    const localShare = keyset.shares[0];
    const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);
    const payload = profilePayloadForShare({
      profileId,
      deviceName: "Igloo Web",
      share: localShare,
      group: keyset.group,
      relays: ["wss://relay.example.test"]
    });

    const pair = await createProfilePackagePair(payload, "test-password");
    expect(pair.profile_string.startsWith("bfprofile1")).toBe(true);
    expect(pair.share_string.startsWith("bfshare1")).toBe(true);

    const decoded = await decodeProfilePackage(pair.profile_string, "test-password");
    expect(decoded.profile_id).toBe(profileId);
    expect(decoded.device.name).toBe("Igloo Web");

    const runtime = new RuntimeClient();
    await runtime.init({}, runtimeBootstrapFromParts(keyset.group, localShare));
    const status = runtime.runtimeStatus();
    expect(status.metadata.member_idx).toBe(localShare.idx);
    expect(status.metadata.peers).toHaveLength(2);
  }, 30_000);
});

