import { describe, expect, it } from "vitest";
import {
  createKeysetBundle,
  defaultManualPeerPolicyOverrides,
  profilePayloadForShare,
} from "../../lib/bifrost/packageService";
import {
  ONBOARD_RUNTIME_TIMEOUT_SECS,
} from "../onboardingTiming";
import {
  createRuntimeFromProfilePayload,
  createRuntimeFromSnapshot,
} from "../profileRuntime";

describe("profileRuntime onboarding config", () => {
  it("creates and restores runtimes with a liberal onboard timeout", async () => {
    const keyset = await createKeysetBundle({
      groupName: "Runtime Config Keyset",
      threshold: 2,
      count: 2,
    });
    const payload = profilePayloadForShare({
      profileId: "runtime-config-profile",
      deviceName: "Igloo Web",
      share: keyset.shares[0],
      group: keyset.group,
      relays: ["wss://relay.example.test"],
      manualPeerPolicyOverrides: defaultManualPeerPolicyOverrides(
        keyset.group,
        keyset.shares[0].idx,
      ),
    });

    const runtime = await createRuntimeFromProfilePayload(
      payload,
      keyset.shares[0].idx,
    );
    expect(runtime.readConfig()).toMatchObject({
      sign_timeout_secs: 30,
      ping_timeout_secs: 15,
      onboard_timeout_secs: ONBOARD_RUNTIME_TIMEOUT_SECS,
      event_kind: 20_000,
    });

    const restored = await createRuntimeFromSnapshot(runtime.snapshot());
    expect(restored.readConfig()).toMatchObject({
      onboard_timeout_secs: ONBOARD_RUNTIME_TIMEOUT_SECS,
    });
  });
});
