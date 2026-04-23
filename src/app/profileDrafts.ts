import type { CreateProfileDraft, ProfileDraft } from "./AppStateTypes";

export const DEFAULT_RELAYS: readonly string[] = [
  "wss://relay.primal.net",
  "wss://relay.damus.io",
];

export function defaultProfileDraft(): ProfileDraft {
  return {
    deviceName: "Igloo Web",
    password: "",
    confirmPassword: "",
    relays: [...DEFAULT_RELAYS],
  };
}

export function defaultPeerPermissions(): import("./AppStateTypes").PeerPermissionMap {
  return { sign: true, ecdh: true, ping: true, onboard: true };
}

export function defaultCreateProfileDraft(): CreateProfileDraft {
  // fix-followup-distribute-2a — migration-drop: earlier releases stored
  // `distributionPassword` / `confirmDistributionPassword` on the
  // CreateProfileDraft. Those fields have been removed — distribution
  // passwords are now collected per-share on the Distribute Shares
  // screen via `encodeDistributionPackage(idx, password)`. Stored
  // drafts that carry the old fields are silently dropped: the draft
  // type no longer exposes them, so consumers loading an old
  // serialised draft will destructure only the supported keys.
  return {
    ...defaultProfileDraft(),
    peerPermissions: {},
  };
}
