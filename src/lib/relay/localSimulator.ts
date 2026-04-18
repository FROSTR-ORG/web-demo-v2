import { runtimeBootstrapFromParts } from "../bifrost/format";
import { RuntimeClient } from "../bifrost/runtimeClient";
import type { GroupPackageWire, RuntimeStatusSummary, SharePackageWire } from "../bifrost/types";

export interface LocalSimulatorInput {
  group: GroupPackageWire;
  localShare: SharePackageWire;
  remoteShares: SharePackageWire[];
}

export class LocalRuntimeSimulator {
  private peers: RuntimeClient[] = [];
  private running = false;

  constructor(private readonly local: RuntimeClient) {}

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
    this.local.handleCommand({ type: "refresh_all_peers" });
  }

  pump(iterations = 3): RuntimeStatusSummary {
    if (!this.running) {
      return this.local.runtimeStatus();
    }

    for (let i = 0; i < iterations; i += 1) {
      const now = Date.now() + i;
      this.local.tick(now);
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
      this.local.drainCompletions();
      this.local.drainFailures();
      this.local.drainRuntimeEvents();
    }

    return this.local.runtimeStatus();
  }
}

