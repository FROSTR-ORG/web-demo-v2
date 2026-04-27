import {
  normalizeRelayKey,
  validateRelayUrl,
} from "./relayUrl";

export const LOCAL_DEMO_RELAY_URL = "ws://127.0.0.1:8194";

export function isLocalDemoRelayEnabled(): boolean {
  if (import.meta.env.DEV !== true) {
    return false;
  }
  const envValue = import.meta.env.VITE_IGLOO_USE_LOCAL_RELAY;
  if (envValue === "1") {
    return true;
  }
  if (envValue === "0" || import.meta.env.MODE === "test") {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost"
  );
}

export function isAllowedLocalDemoRelayUrl(value: string): boolean {
  return isLocalDemoRelayEnabled() && value.trim() === LOCAL_DEMO_RELAY_URL;
}

export function validateRelayUrlWithLocalDemo(value: string): string {
  const trimmed = value.trim();
  if (isAllowedLocalDemoRelayUrl(trimmed)) {
    return trimmed;
  }
  return validateRelayUrl(value);
}

export function appendLocalDemoRelay(
  relays: readonly string[],
): string[] {
  const result = [...relays];
  if (!isLocalDemoRelayEnabled()) {
    return result;
  }
  const localKey = normalizeRelayKey(LOCAL_DEMO_RELAY_URL);
  if (!result.some((relay) => normalizeRelayKey(relay) === localKey)) {
    result.push(LOCAL_DEMO_RELAY_URL);
  }
  return result;
}
