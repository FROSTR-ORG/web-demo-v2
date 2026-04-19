# AppState demo-to-real bridge

## Purpose

Demo scenarios run under `MockAppStateProvider` at `/demo/*`, but real app routes (`/dashboard/:profileId`, `/create`, etc.) are mounted under the root `AppStateProvider`. To preserve scenario state when a demo action navigates into a real route, the app uses a one-shot sessionStorage handoff.

## Mechanism

- Key: `igloo.web-demo-v2.app-state-bridge` (`BRIDGE_STORAGE_KEY`)
- Event: `igloo:app-state-bridge-update` (`BRIDGE_EVENT`)
- Writer: `MockAppStateProvider` writes snapshots via `writeBridgeSnapshot(snapshotFromAppState(value))` when `bridge=true` (default).
- Reader: `AppStateProvider` calls `consumeBridgeSnapshot()` on mount and on `BRIDGE_EVENT`.

`consumeBridgeSnapshot()` removes the key after reading, so the bridge state does not persist across reloads or unrelated sessions.

## Fallback behavior

If no bridge snapshot exists, `AppStateProvider` uses the original IndexedDB path (`reloadProfiles()`).

This keeps non-demo behavior unchanged.
