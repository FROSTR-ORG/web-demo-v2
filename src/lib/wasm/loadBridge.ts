export class BifrostError extends Error {
  constructor(
    message: string,
    public readonly causeValue?: unknown
  ) {
    super(message);
    this.name = "BifrostError";
  }
}

export interface WasmBridgeRuntimeLike {
  init_runtime(configJson: string, bootstrapJson: string): void;
  restore_runtime(configJson: string, snapshotJson: string): void;
  handle_command(commandJson: string): void;
  handle_inbound_event(eventJson: string): void;
  tick(nowUnixMs: bigint): void;
  drain_outbound_events(): string;
  drain_completions(): string;
  drain_failures(): string;
  snapshot_state(): string;
  status(): string;
  peer_permission_states(): string;
  read_config(): string;
  update_config(configPatchJson: string): void;
  peer_status(): string;
  readiness(): string;
  runtime_status(): string;
  runtime_diagnostics(): string;
  drain_runtime_events(): string;
  wipe_state(): void;
  runtime_metadata(): string;
  set_policy_override(policyJson: string): void;
  clear_policy_overrides(): void;
}

export interface BifrostBridgeModule {
  default: (
    moduleOrPath?:
      | { module_or_path: string | URL | Request | Response | BufferSource | WebAssembly.Module | Promise<string | URL | Request | Response | BufferSource | WebAssembly.Module> }
      | string
      | URL
      | Request
      | Response
      | BufferSource
      | WebAssembly.Module
  ) => Promise<unknown>;
  WasmBridgeRuntime: new () => WasmBridgeRuntimeLike;
  bf_package_version(): number;
  bfshare_prefix(): string;
  bfonboard_prefix(): string;
  bfprofile_prefix(): string;
  default_event_kind(): bigint;
  encode_bfshare_package(payloadJson: string, password: string): string;
  decode_bfshare_package(packageText: string, password: string): string;
  decode_bfshare_package_result(packageText: string, password: string): string;
  encode_bfonboard_package(payloadJson: string, password: string): string;
  decode_bfonboard_package(packageText: string, password: string): string;
  decode_bfonboard_package_result(packageText: string, password: string): string;
  encode_bfprofile_package(payloadJson: string, password: string): string;
  decode_bfprofile_package(packageText: string, password: string): string;
  decode_bfprofile_package_result(packageText: string, password: string): string;
  derive_profile_id_from_share_secret(shareSecret: string): string;
  derive_profile_id_from_share_pubkey(sharePubkey: string): string;
  create_profile_package_pair(payloadJson: string, password: string): string;
  create_keyset_bundle(configJson: string): string;
  generate_nsec(): string;
  create_keyset_bundle_from_nsec(inputJson: string): string;
  rotate_keyset_bundle(inputJson: string): string;
  recover_nsec_from_shares(inputJson: string): string;
  derive_group_id(groupJson: string): string;
  resolve_share_index(groupJson: string, shareSecret: string): number;
  create_encrypted_profile_backup(profileJson: string): string;
  encrypt_profile_backup_content(backupJson: string, shareSecret: string): string;
  decrypt_profile_backup_content(ciphertext: string, shareSecret: string): string;
  build_profile_backup_event(shareSecret: string, backupJson: string, createdAtSeconds?: number | null): string;
  parse_profile_backup_event(eventJson: string, shareSecret: string): string;
  profile_backup_event_kind(): number;
  profile_backup_key_domain(): string;
  derive_profile_backup_conversation_key_hex(shareSecret: string): string;
  create_onboarding_request_bundle(
    shareSecret: string,
    peerPubkey32Hex: string,
    eventKind: bigint | number,
    sentAtSeconds?: number
  ): string;
  decode_onboarding_response_event_result(
    eventJson: string,
    shareSecret: string,
    expectedPeerPubkey32Hex: string,
    expectedLocalPubkey32Hex: string,
    requestId: string
  ): string;
  build_onboarding_runtime_snapshot(
    groupJson: string,
    shareSecret: string,
    peerPubkey32Hex: string,
    responseNoncesJson: string,
    bootstrapStateHex: string
  ): string;
}

let bridgePromise: Promise<BifrostBridgeModule> | null = null;

export function normalizeBifrostError(error: unknown): BifrostError {
  if (error instanceof BifrostError) {
    return error;
  }
  if (error instanceof Error) {
    return new BifrostError(error.message, error);
  }
  if (typeof error === "string") {
    return new BifrostError(error, error);
  }
  return new BifrostError("Bifrost runtime call failed", error);
}

export async function loadBridge(): Promise<BifrostBridgeModule> {
  bridgePromise ??= (async () => {
    const module = (await import("../../vendor/bifrost-bridge-wasm/bifrost_bridge_wasm.js")) as unknown as BifrostBridgeModule;
    if (import.meta.env.MODE === "test") {
      const { readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const wasmBytes = await readFile(resolve(process.cwd(), "src/vendor/bifrost-bridge-wasm/bifrost_bridge_wasm_bg.wasm"));
      await module.default({ module_or_path: wasmBytes });
    } else {
      const wasmUrl = (await import("../../vendor/bifrost-bridge-wasm/bifrost_bridge_wasm_bg.wasm?url")).default;
      await module.default({ module_or_path: wasmUrl });
    }
    return module;
  })();
  return bridgePromise;
}

export function parseJsonResult<T>(json: string): T {
  return JSON.parse(json) as T;
}
