import { runtimeBootstrapFromParts } from "../bifrost/format";
import { RuntimeClient } from "../bifrost/runtimeClient";
import type {
  CompletedOperation,
  GroupPackageWire,
  OperationFailure,
  RuntimeEvent,
  RuntimeStatusSummary,
  SharePackageWire,
} from "../bifrost/types";
import type { RuntimeDrainBatch } from "./runtimeRelayPump";

export interface LocalSimulatorInput {
  group: GroupPackageWire;
  localShare: SharePackageWire;
  remoteShares: SharePackageWire[];
}

export class LocalRuntimeSimulator {
  private peers: RuntimeClient[] = [];
  private running = false;
  private onDrains?: (drains: RuntimeDrainBatch) => void;
  private onRefreshPingRequestIds?: (requestIds: string[]) => void;
  private refreshAllBaselineIds: Set<string> | null = null;

  constructor(private readonly local: RuntimeClient) {}

  setOnDrains(onDrains: ((drains: RuntimeDrainBatch) => void) | undefined): void {
    this.onDrains = onDrains;
  }

  setOnRefreshPingRequestIds(
    onRefreshPingRequestIds: ((requestIds: string[]) => void) | undefined,
  ): void {
    this.onRefreshPingRequestIds = onRefreshPingRequestIds;
  }

  async attachVirtualPeers(input: LocalSimulatorInput): Promise<void> {
    this.peers = [];
    for (const share of input.remoteShares) {
      const peer = new RuntimeClient();
      await peer.init({}, runtimeBootstrapFromParts(input.group, share));
      this.peers.push(peer);
    }
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  refreshAll(): void {
    this.refreshAllBaselineIds = new Set(
      this.local.runtimeStatus().pending_operations.map((op) => op.request_id),
    );
    this.local.handleCommand({ type: "refresh_all_peers" });
  }

  pump(iterations = 3): RuntimeStatusSummary {
    if (!this.running) {
      return this.local.runtimeStatus();
    }

    const accumulatedCompletions: CompletedOperation[] = [];
    const accumulatedFailures: OperationFailure[] = [];
    const accumulatedEvents: RuntimeEvent[] = [];

    for (let i = 0; i < iterations; i += 1) {
      const now = Date.now() + i;
      this.local.tick(now);
      if (this.refreshAllBaselineIds) {
        const baseline = this.refreshAllBaselineIds;
        const pingOps = this.local
          .runtimeStatus()
          .pending_operations.filter(
            (op) => op.op_type === "Ping" && !baseline.has(op.request_id),
          );
        const requestIds = pingOps.map((op) => op.request_id);
        if (requestIds.length > 0) {
          this.onRefreshPingRequestIds?.(requestIds);
          this.refreshAllBaselineIds = null;
        } else if (this.local.runtimeStatus().pending_operations.length === 0) {
          this.refreshAllBaselineIds = null;
        }
      }
      const localOutbound = this.local.drainOutboundEvents();
      for (const event of localOutbound) {
        for (const peer of this.peers) {
          try {
            peer.handleInboundEvent(event);
          } catch {
            // Events are recipient-tagged; non-recipients are allowed to reject them.
          }
        }
      }

      for (const peer of this.peers) {
        peer.tick(now + 1);
        const peerOutbound = peer.drainOutboundEvents();
        for (const event of peerOutbound) {
          try {
            this.local.handleInboundEvent(event);
          } catch {
            // The local runtime ignores events not addressed to it.
          }
          for (const other of this.peers) {
            if (other !== peer) {
              try {
                other.handleInboundEvent(event);
              } catch {
                // Recipient filtering is runtime-owned.
              }
            }
          }
        }
      }

      this.local.tick(now + 2);
      accumulatedCompletions.push(...this.local.drainCompletions());
      accumulatedFailures.push(...this.local.drainFailures());
      accumulatedEvents.push(...this.local.drainRuntimeEvents());
    }

    if (
      this.onDrains &&
      (accumulatedCompletions.length > 0 ||
        accumulatedFailures.length > 0 ||
        accumulatedEvents.length > 0)
    ) {
      try {
        this.onDrains({
          completions: accumulatedCompletions,
          failures: accumulatedFailures,
          events: accumulatedEvents,
        });
      } catch {
        // Callback must not break pumping.
      }
    }

    return this.local.runtimeStatus();
  }
}
