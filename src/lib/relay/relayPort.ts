export interface RelayFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface RelaySubscription {
  close(): void;
}

export interface RelayPort {
  publish(event: unknown): Promise<void>;
  subscribe(filter: RelayFilter, onEvent: (event: unknown) => void): RelaySubscription;
  close(): void;
}

