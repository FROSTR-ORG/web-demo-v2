import { describe, expect, it } from "vitest";
import { demoKeyset, DEMO_PASSWORD } from "../fixtures";
import {
  createProfilePackagePair,
  deriveProfileIdFromShareSecret,
  encodeOnboardPackage,
  onboardPayloadForRemoteShare,
  profilePayloadForShare
} from "../../lib/bifrost/packageService";
import { RuntimeClient } from "../../lib/bifrost/runtimeClient";
import { memberForShare, runtimeBootstrapFromParts } from "../../lib/bifrost/format";

/*
 * Regression test for `fix-create-profile-group-package-bytes`.
 *
 * Round-2 user-testing for the `create-and-shared-create` milestone
 * observed that the demo-seeded `createSession.keyset` produced a group
 * package with 19-byte member pubkeys, triggering the bifrost WASM bridge's
 * "invalid byte length: expected 33, got 19" validation failure when
 * `/create/profile` submitted the profile draft. The fix widens the
 * synthetic hex values in `demoKeyset` to real 33-byte compressed-pubkey /
 * 32-byte x-only shapes so the downstream flow succeeds.
 *
 * This test exercises the exact code path that the happy-path flow
 * `/demo/create-keyset → /create/progress → /create/profile → /create/distribute`
 * traverses in the running app:
 *
 *   1. `deriveProfileIdFromShareSecret(localShare.seckey)` — WASM
 *   2. `profilePayloadForShare({ ... group: demoKeyset.group ... })`
 *   3. `createProfilePackagePair(payload, password)` — WASM, this is
 *      what raised "Invalid group package: invalid byte length" before.
 *   4. `encodeOnboardPackage(onboardPayload, password)` for each remote
 *      share — WASM, exercises `peer_pk` length validation too.
 *   5. `RuntimeClient.init({}, bootstrap)` — WASM `init_runtime`.
 */

describe("demoKeyset validates against bifrost WASM — fix-create-profile-group-package-bytes", () => {
  it("every member pubkey is 33 bytes of hex (66 chars) and group_pk is 32 bytes (64 chars)", () => {
    expect(demoKeyset.group.group_pk).toHaveLength(64);
    for (const member of demoKeyset.group.members) {
      expect(member.pubkey).toHaveLength(66);
    }
  });

  it("member pubkeys are unique (bridge rejects duplicates)", () => {
    const pubkeys = demoKeyset.group.members.map((m) => m.pubkey);
    expect(new Set(pubkeys).size).toBe(pubkeys.length);
  });

  it(
    "createProfilePackagePair succeeds — no 'Invalid group package' error on the full create-profile → distribute path",
    async () => {
      const localShare = demoKeyset.shares[0];
      const remoteShares = demoKeyset.shares.slice(1);
      const group = demoKeyset.group;

      const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);

      const payload = profilePayloadForShare({
        profileId,
        deviceName: "Igloo Web",
        share: localShare,
        group,
        relays: ["wss://relay.primal.net", "wss://relay.damus.io"]
      });

      /* The original failure surfaced here. */
      await expect(
        createProfilePackagePair(payload, DEMO_PASSWORD)
      ).resolves.toMatchObject({
        profile_string: expect.stringMatching(/^bfprofile1/),
        share_string: expect.stringMatching(/^bfshare1/)
      });

      /* Exercise the onboarding package encoding for every remote share. */
      for (const remoteShare of remoteShares) {
        const onboardPayload = onboardPayloadForRemoteShare({
          remoteShare,
          localShare,
          group,
          relays: ["wss://relay.primal.net"]
        });
        await expect(encodeOnboardPackage(onboardPayload, DEMO_PASSWORD)).resolves.toMatch(
          /^bfonboard1/
        );
      }

      /* Exercise runtime init — `createProfile` fires this immediately after
         encoding the onboarding packages, and it is the next place the
         synthetic fixture could have broken. */
      const runtime = new RuntimeClient();
      await runtime.init({}, runtimeBootstrapFromParts(group, localShare));
      const status = runtime.runtimeStatus();
      expect(status.metadata.member_idx).toBe(localShare.idx);

      void memberForShare(group, localShare); // sanity: lookup still resolves
    },
    30_000
  );
});
