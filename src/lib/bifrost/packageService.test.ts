import { describe, expect, it } from "vitest";
import { packagePasswordForShare, runtimeBootstrapFromParts } from "./format";
import {
  BifrostPackageError,
  createKeysetBundle,
  createKeysetBundleFromNsec,
  createProfilePackagePair,
  defaultManualPeerPolicyOverrides,
  decodeBfonboardPackage,
  decodeBfsharePackage,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
  encodeBfsharePackage,
  encodeOnboardPackage,
  generateNsec,
  onboardPayloadForRemoteShare,
  profilePayloadForShare,
  recoverNsecFromShares,
  resolveShareIndex,
  rotateKeysetBundle
} from "./packageService";
import { RuntimeClient } from "./runtimeClient";

describe("bifrost wasm package service", () => {
  it("generates an nsec and splits that exact key", async () => {
    const generated = await generateNsec();
    const second = await generateNsec();
    expect(generated.nsec.startsWith("nsec1")).toBe(true);
    expect(generated.signing_key_hex).toHaveLength(64);
    expect(second.nsec).not.toBe(generated.nsec);

    const keyset = await createKeysetBundleFromNsec({
      nsec: generated.nsec,
      groupName: "Generated NSEC Key",
      threshold: 2,
      count: 3
    });
    const recovered = await recoverNsecFromShares({
      group: keyset.group,
      shares: keyset.shares.slice(0, keyset.group.threshold)
    });

    expect(recovered.nsec).toBe(generated.nsec);
    expect(recovered.signing_key_hex).toBe(generated.signing_key_hex);
    await expect(
      createKeysetBundleFromNsec({
        nsec: "not-a-valid-nsec",
        groupName: "Invalid",
        threshold: 2,
        count: 2
      })
    ).rejects.toThrow();
  }, 30_000);

  it("creates a keyset, round-trips a profile package, and initializes runtime status", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Test Signing Key",
      threshold: 2,
      count: 3
    });
    const localShare = keyset.shares[0];
    const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);
    const policyOverrides = defaultManualPeerPolicyOverrides(keyset.group, localShare.idx);
    expect(policyOverrides).toHaveLength(2);
    expect(policyOverrides[0].policy.request).toEqual({
      echo: "allow",
      ping: "allow",
      onboard: "allow",
      sign: "allow",
      ecdh: "allow"
    });
    expect(policyOverrides[0].policy.respond).toEqual({
      echo: "allow",
      ping: "allow",
      onboard: "allow",
      sign: "allow",
      ecdh: "allow"
    });
    const payload = profilePayloadForShare({
      profileId,
      deviceName: "Igloo Web",
      share: localShare,
      group: keyset.group,
      relays: ["wss://relay.example.test"],
      manualPeerPolicyOverrides: policyOverrides
    });

    const pair = await createProfilePackagePair(payload, "test-password");
    expect(pair.profile_string.startsWith("bfprofile1")).toBe(true);
    expect(pair.share_string.startsWith("bfshare1")).toBe(true);

    const decoded = await decodeProfilePackage(pair.profile_string, "test-password");
    expect(decoded.profile_id).toBe(profileId);
    expect(decoded.device.name).toBe("Igloo Web");
    expect(decoded.device.manual_peer_policy_overrides).toEqual(policyOverrides);
    await expect(resolveShareIndex(keyset.group, decoded.device.share_secret)).resolves.toBe(localShare.idx);

    const decodedShare = await decodeBfsharePackage(pair.share_string, "test-password");
    expect(decodedShare.share_secret).toBe(localShare.seckey);

    const remoteShare = keyset.shares[1];
    const onboardPayload = onboardPayloadForRemoteShare({
      remoteShare,
      localShare,
      group: keyset.group,
      relays: ["wss://relay.example.test"]
    });
    const distributionPassword = "remote-distribution-password";
    const onboardPackage = await encodeOnboardPackage(onboardPayload, distributionPassword);
    expect(onboardPackage.startsWith("bfonboard1")).toBe(true);
    const decodedOnboard = await decodeBfonboardPackage(onboardPackage, distributionPassword);
    expect(decodedOnboard.share_secret).toBe(remoteShare.seckey);
    await expect(
      decodeBfonboardPackage(onboardPackage, packagePasswordForShare(keyset.group.group_name, remoteShare.idx))
    ).rejects.toMatchObject({
      name: "BifrostPackageError",
      code: "wrong_password"
    });
    await expect(decodeBfonboardPackage("not-a-package", distributionPassword)).rejects.toBeInstanceOf(BifrostPackageError);
    await expect(decodeBfonboardPackage("not-a-package", distributionPassword)).rejects.toMatchObject({
      code: expect.stringMatching(/malformed_package|unsupported_package|invalid_payload/)
    });

    const standaloneShare = await encodeBfsharePackage(
      {
        share_secret: keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"]
      },
      "test-password"
    );
    await expect(decodeBfsharePackage(standaloneShare, "test-password")).resolves.toMatchObject({
      share_secret: keyset.shares[1].seckey
    });

    const recovered = await recoverNsecFromShares({
      group: keyset.group,
      shares: keyset.shares.slice(0, keyset.group.threshold)
    });
    expect(recovered.nsec.startsWith("nsec1")).toBe(true);
    expect(recovered.signing_key_hex).toHaveLength(64);
    await expect(
      recoverNsecFromShares({
        group: keyset.group,
        shares: [keyset.shares[0]]
      })
    ).rejects.toThrow();
    await expect(
      recoverNsecFromShares({
        group: keyset.group,
        shares: [keyset.shares[0], keyset.shares[0]]
      })
    ).rejects.toThrow();

    const rotated = await rotateKeysetBundle({
      group: keyset.group,
      shares: keyset.shares.slice(0, keyset.group.threshold),
      threshold: 2,
      count: 3
    });
    expect(rotated.next.group.group_pk).toBe(keyset.group.group_pk);
    expect(rotated.next.shares).toHaveLength(3);

    const runtime = new RuntimeClient();
    await runtime.init({}, runtimeBootstrapFromParts(keyset.group, localShare));
    const status = runtime.runtimeStatus();
    expect(status.metadata.member_idx).toBe(localShare.idx);
    expect(status.metadata.peers).toHaveLength(2);
  }, 30_000);
});
