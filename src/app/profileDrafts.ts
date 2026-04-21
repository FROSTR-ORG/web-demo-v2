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
  return {
    ...defaultProfileDraft(),
    distributionPassword: "",
    confirmDistributionPassword: "",
    peerPermissions: {},
  };
}
