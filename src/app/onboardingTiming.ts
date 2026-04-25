import type { RuntimeConfigInput } from "../lib/bifrost/types";
import { ONBOARDING_RELAY_HANDSHAKE_TIMEOUT_MS } from "../lib/relay/browserRelayClient";

export const ONBOARD_HANDSHAKE_TIMEOUT_MS =
  ONBOARDING_RELAY_HANDSHAKE_TIMEOUT_MS;
export const ONBOARD_RUNTIME_TIMEOUT_SECS = 180;

export const ONBOARD_RUNTIME_DEVICE_CONFIG: NonNullable<
  RuntimeConfigInput["device"]
> = {
  sign_timeout_secs: 30,
  ecdh_timeout_secs: 30,
  ping_timeout_secs: 15,
  onboard_timeout_secs: ONBOARD_RUNTIME_TIMEOUT_SECS,
  request_ttl_secs: 300,
  max_future_skew_secs: 30,
  request_cache_limit: 2048,
  state_save_interval_secs: 30,
  event_kind: 20_000,
  peer_selection_strategy: "deterministic_sorted",
  ecdh_cache_capacity: 256,
  ecdh_cache_ttl_secs: 300,
  sig_cache_capacity: 256,
  sig_cache_ttl_secs: 120,
};

export const ONBOARD_RUNTIME_CONFIG: RuntimeConfigInput = {
  device: ONBOARD_RUNTIME_DEVICE_CONFIG,
};
