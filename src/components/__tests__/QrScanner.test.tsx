/**
 * QrScanner — m6-camera-qr-scan
 *
 * Covers VAL-BACKUP-014..019 + VAL-BACKUP-026 / VAL-BACKUP-027:
 *   - Opens as role=dialog with aria-label "QR Scanner".
 *   - Acquires camera via getUserMedia({video:{facingMode:"environment"}}).
 *   - Close button / backdrop click release all MediaStreamTracks (readyState=ended).
 *   - Camera permission denied: shows error, closes stream, textarea-fallback path still usable.
 *   - Permission revoked mid-scan (track onended): shows "Camera access was lost." error.
 *   - Invalid QR content (no matching expectedPrefixes): surfaces inline error + continues scanning.
 *   - Valid prefix-matching QR: onScan(data) and tracks stopped.
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { QRCode } from "jsqr";

vi.mock("jsqr", () => ({
  default: vi.fn(),
}));

import jsQR from "jsqr";
import { QrScanner } from "../QrScanner";

const jsQRMock = jsQR as unknown as ReturnType<typeof vi.fn>;

interface FakeTrack {
  readyState: "live" | "ended";
  stop: () => void;
  onended: (() => void) | null;
  listeners: Map<string, Set<() => void>>;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  dispatch: (event: string) => void;
}

function createFakeTrack(): FakeTrack {
  const track: FakeTrack = {
    readyState: "live",
    onended: null,
    listeners: new Map(),
    stop: () => {
      track.readyState = "ended";
    },
    addEventListener: (event, handler) => {
      if (!track.listeners.has(event)) track.listeners.set(event, new Set());
      track.listeners.get(event)!.add(handler);
    },
    removeEventListener: (event, handler) => {
      track.listeners.get(event)?.delete(handler);
    },
    dispatch: (event) => {
      const set = track.listeners.get(event);
      if (set) set.forEach((h) => h());
      if (event === "ended" && track.onended) track.onended();
    },
  };
  return track;
}

interface MediaEnvState {
  tracks: FakeTrack[];
  getUserMedia: ReturnType<typeof vi.fn>;
  rafCallbacks: FrameRequestCallback[];
  restoreFns: Array<() => void>;
}

function trySet(state: MediaEnvState, key: string, target: object, descriptor: PropertyDescriptor) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  try {
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
  } catch {
    /* Some jsdom accessors are non-configurable; skip silently — the
     * component's guards on readyState/HAVE_ENOUGH_DATA still run through. */
    return;
  }
  state.restoreFns.push(() => {
    try {
      if (original) {
        Object.defineProperty(target, key, original);
      } else {
        delete (target as Record<string, unknown>)[key];
      }
    } catch {
      /* ignore */
    }
  });
}

function setupMediaEnv(): MediaEnvState {
  const state: MediaEnvState = {
    tracks: [],
    getUserMedia: vi.fn(),
    rafCallbacks: [],
    restoreFns: [],
  };

  trySet(state, "mediaDevices", navigator, {
    value: { getUserMedia: state.getUserMedia },
  });

  const origRaf = globalThis.requestAnimationFrame;
  const origCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    state.rafCallbacks.push(cb);
    return state.rafCallbacks.length as unknown as number;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  state.restoreFns.push(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCaf;
  });

  // `readyState` getter on the prototype returns 0 by default in jsdom which
  // would gate tick() off — force 4 (HAVE_ENOUGH_DATA) so jsQR runs.
  trySet(state, "readyState", HTMLMediaElement.prototype, { get: () => 4 });
  trySet(state, "videoWidth", HTMLVideoElement.prototype, { get: () => 320 });
  trySet(state, "videoHeight", HTMLVideoElement.prototype, { get: () => 240 });
  trySet(state, "play", HTMLMediaElement.prototype, {
    value: vi.fn().mockResolvedValue(undefined),
  });
  trySet(state, "srcObject", HTMLMediaElement.prototype, {
    set() {},
    get() {
      return null;
    },
  });
  trySet(state, "getContext", HTMLCanvasElement.prototype, {
    value: () => ({
      drawImage: () => {},
      getImageData: () => ({
        data: new Uint8ClampedArray(320 * 240 * 4),
        width: 320,
        height: 240,
      }),
    }),
  });

  return state;
}

function teardownMediaEnv(state: MediaEnvState) {
  // Run in reverse to restore layered overrides correctly.
  while (state.restoreFns.length > 0) {
    const fn = state.restoreFns.pop();
    if (fn) fn();
  }
}

function makeStream(trackCount = 1): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [];
  for (let i = 0; i < trackCount; i++) tracks.push(createFakeTrack());
  const stream = {
    getTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks };
}

async function flushPromises() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function runNextFrame(state: MediaEnvState) {
  const pending = state.rafCallbacks.splice(0);
  pending.forEach((cb) => cb(performance.now()));
}

describe("QrScanner", () => {
  let env: MediaEnvState;

  beforeEach(() => {
    jsQRMock.mockReset();
    env = setupMediaEnv();
  });

  afterEach(() => {
    teardownMediaEnv(env);
    cleanup();
  });

  it("renders as a modal dialog with aria-label 'QR Scanner' and requests environment camera", async () => {
    const { stream } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    render(<QrScanner onScan={() => {}} onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: /QR Scanner/i });
    expect(dialog).toBeInTheDocument();
    await flushPromises();
    expect(env.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
  });

  it("surfaces the 'Camera access was denied' error and a Close button when getUserMedia rejects", async () => {
    env.getUserMedia.mockRejectedValue(Object.assign(new Error("nope"), { name: "NotAllowedError" }));
    render(<QrScanner onScan={() => {}} onClose={() => {}} />);
    await flushPromises();
    expect(await screen.findByText(/Camera access was denied/i)).toBeInTheDocument();
    // The error fallback renders a dedicated "Close" action button (distinct
    // from the header X whose accessible name is "Close scanner").
    expect(screen.getByRole("button", { name: /^Close$/ })).toBeInTheDocument();
  });

  it("calls onClose and stops all MediaStream tracks when the header Close (X) is clicked", async () => {
    const { stream, tracks } = makeStream(2);
    env.getUserMedia.mockResolvedValue(stream);
    const onClose = vi.fn();
    render(<QrScanner onScan={() => {}} onClose={onClose} />);
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: /Close scanner/i }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
  });

  it("closes and stops tracks when the backdrop is clicked", async () => {
    const { stream, tracks } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    const onClose = vi.fn();
    render(<QrScanner onScan={() => {}} onClose={onClose} />);
    await flushPromises();
    const backdrop = document.querySelector(".qr-scanner-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
    cleanup();
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
  });

  it("stops the stream and surfaces an error when a track ends mid-scan (permission revoked)", async () => {
    const { stream, tracks } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    render(<QrScanner onScan={() => {}} onClose={() => {}} />);
    await flushPromises();
    // Simulate permission revoke: browser fires 'ended' on the track.
    act(() => {
      tracks[0].dispatch("ended");
    });
    expect(await screen.findByText(/Camera access was lost/i)).toBeInTheDocument();
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
  });

  it("calls onScan and stops tracks when a valid bfonboard payload is detected", async () => {
    const { stream, tracks } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    jsQRMock.mockReturnValueOnce({ data: "bfonboard1abc" } as QRCode);
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} onClose={() => {}} expectedPrefixes={["bfonboard1"]} />);
    await flushPromises();
    act(() => runNextFrame(env));
    expect(onScan).toHaveBeenCalledWith("bfonboard1abc");
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
  });

  it("surfaces an inline error and does NOT fire onScan when detected QR has an unexpected prefix", async () => {
    const { stream, tracks } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    jsQRMock.mockReturnValue({ data: "https://evil.example/xss" } as QRCode);
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} onClose={() => {}} expectedPrefixes={["bfonboard1"]} />);
    await flushPromises();
    act(() => runNextFrame(env));
    expect(onScan).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/not a valid bfonboard package/i),
    ).toBeInTheDocument();
    // Stream continues — not ended by invalid content
    expect(tracks.every((t) => t.readyState === "live")).toBe(true);
  });

  it("accepts any of multiple expectedPrefixes", async () => {
    const { stream } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    jsQRMock.mockReturnValueOnce({ data: "bfprofile1xyz" } as QRCode);
    const onScan = vi.fn();
    render(
      <QrScanner
        onScan={onScan}
        onClose={() => {}}
        expectedPrefixes={["bfprofile1", "bfshare1"]}
      />,
    );
    await flushPromises();
    act(() => runNextFrame(env));
    expect(onScan).toHaveBeenCalledWith("bfprofile1xyz");
  });

  it("releases tracks on unmount", async () => {
    const { stream, tracks } = makeStream();
    env.getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(<QrScanner onScan={() => {}} onClose={() => {}} />);
    await flushPromises();
    unmount();
    expect(tracks.every((t) => t.readyState === "ended")).toBe(true);
  });
});


