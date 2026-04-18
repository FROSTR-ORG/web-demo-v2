import type {
  CompletedOperation,
  OperationFailure,
  RuntimeBootstrapInput,
  RuntimeConfigInput,
  RuntimeEvent,
  RuntimeMetadata,
  RuntimeSnapshotExport,
  RuntimeStatusSummary
} from "./types";
import { loadBridge, normalizeBifrostError, parseJsonResult, type WasmBridgeRuntimeLike } from "../wasm/loadBridge";

export type RuntimeCommand =
  | { type: "sign"; message_hex_32: string }
  | { type: "ecdh"; pubkey32_hex: string }
  | { type: "ping"; peer_pubkey32_hex: string }
  | { type: "refresh_peer"; peer_pubkey32_hex: string }
  | { type: "refresh_all_peers" }
  | { type: "onboard"; peer_pubkey32_hex: string };

export class RuntimeClient {
  private runtime: WasmBridgeRuntimeLike | null = null;

  async init(config: RuntimeConfigInput, bootstrap: RuntimeBootstrapInput): Promise<void> {
    try {
      const bridge = await loadBridge();
      this.runtime = new bridge.WasmBridgeRuntime();
      this.runtime.init_runtime(JSON.stringify(config), JSON.stringify(bootstrap));
    } catch (error) {
      throw normalizeBifrostError(error);
    }
  }

  async restore(config: RuntimeConfigInput, snapshot: RuntimeSnapshotExport): Promise<void> {
    try {
      const bridge = await loadBridge();
      this.runtime = new bridge.WasmBridgeRuntime();
      this.runtime.restore_runtime(JSON.stringify(config), JSON.stringify(snapshot));
    } catch (error) {
      throw normalizeBifrostError(error);
    }
  }

  handleCommand(command: RuntimeCommand): void {
    this.call((runtime) => runtime.handle_command(JSON.stringify(command)));
  }

  handleInboundEvent(event: unknown): void {
    this.call((runtime) => runtime.handle_inbound_event(typeof event === "string" ? event : JSON.stringify(event)));
  }

  tick(nowUnixMs = Date.now()): void {
    this.call((runtime) => runtime.tick(BigInt(Math.floor(nowUnixMs))));
  }

  drainOutboundEvents(): unknown[] {
    return this.call((runtime) => parseJsonResult<unknown[]>(runtime.drain_outbound_events()));
  }

  drainCompletions(): CompletedOperation[] {
    return this.call((runtime) => parseJsonResult<CompletedOperation[]>(runtime.drain_completions()));
  }

  drainFailures(): OperationFailure[] {
    return this.call((runtime) => parseJsonResult<OperationFailure[]>(runtime.drain_failures()));
  }

  drainRuntimeEvents(): RuntimeEvent[] {
    return this.call((runtime) => parseJsonResult<RuntimeEvent[]>(runtime.drain_runtime_events()));
  }

  snapshot(): RuntimeSnapshotExport {
    return this.call((runtime) => parseJsonResult<RuntimeSnapshotExport>(runtime.snapshot_state()));
  }

  runtimeStatus(): RuntimeStatusSummary {
    return this.call((runtime) => parseJsonResult<RuntimeStatusSummary>(runtime.runtime_status()));
  }

  metadata(): RuntimeMetadata {
    return this.call((runtime) => parseJsonResult<RuntimeMetadata>(runtime.runtime_metadata()));
  }

  setPolicyOverride(input: {
    peer: string;
    direction: "request" | "respond";
    method: "ping" | "onboard" | "sign" | "ecdh";
    value: "unset" | "allow" | "deny";
  }): void {
    this.call((runtime) => runtime.set_policy_override(JSON.stringify(input)));
  }

  clearPolicyOverrides(): void {
    this.call((runtime) => runtime.clear_policy_overrides());
  }

  wipeState(): void {
    this.call((runtime) => runtime.wipe_state());
  }

  private call<T>(fn: (runtime: WasmBridgeRuntimeLike) => T): T {
    if (!this.runtime) {
      throw new Error("runtime not initialized");
    }
    try {
      return fn(this.runtime);
    } catch (error) {
      throw normalizeBifrostError(error);
    }
  }
}
