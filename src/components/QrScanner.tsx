/**
 * QrScanner — m6-camera-qr-scan.
 *
 * Modal dialog that acquires the environment-facing camera via
 * `getUserMedia({ video: { facingMode: "environment" } })`, renders the live
 * video into a hidden canvas, and runs `jsQR` against every frame. Detected
 * QR payloads are validated against the caller's `expectedPrefixes` — anything
 * that doesn't match (e.g. a random URL) surfaces as an inline error while
 * the scanner keeps scanning. A valid detection closes the stream and fires
 * `onScan`.
 *
 * Failure modes (all exercised by src/components/__tests__/QrScanner.test.tsx):
 *   - `getUserMedia` rejects → "Camera access was denied" fallback + Close
 *     button; the caller's textarea remains editable so pasting still works
 *     (VAL-BACKUP-017).
 *   - Permission revoked mid-scan → MediaStreamTrack fires `ended` → we stop
 *     the stream and surface "Camera access was lost" (VAL-BACKUP-026).
 *   - Detected QR has an unexpected prefix → inline error, stream continues
 *     scanning (VAL-BACKUP-018).
 *
 * Cleanup (VAL-BACKUP-027):
 *   - Close (X), backdrop click, navigation-driven unmount all run
 *     `stopCamera()` which cancels the RAF loop and calls `track.stop()` on
 *     every track. Tests assert `readyState === "ended"` on every close path.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import jsQR from "jsqr";

interface QrScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
  /**
   * If provided, detected QR data must start with one of these prefixes
   * (case-sensitive) to be accepted. Non-matching detections surface an
   * inline error and the scanner keeps running so the user can reposition.
   * When omitted, any non-empty QR payload is accepted (legacy behaviour).
   */
  expectedPrefixes?: readonly string[];
}

/**
 * Turn raw bech32-style prefixes like "bfonboard1" into the human-facing
 * short label ("bfonboard") used in inline errors, matching the copy
 * called out in VAL-BACKUP-018 ("Not a valid bfonboard package.").
 */
function prefixLabel(prefixes: readonly string[]): string {
  const pretty = prefixes.map((p) => p.replace(/1$/, ""));
  if (pretty.length === 0) return "package";
  if (pretty.length === 1) return `${pretty[0]} package`;
  const head = pretty.slice(0, -1).join(", ");
  return `${head} or ${pretty[pretty.length - 1]} package`;
}

export function QrScanner({ onScan, onClose, expectedPrefixes }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackListenersRef = useRef<Array<{ track: MediaStreamTrack; handler: () => void }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const rafRef = useRef<number>(0);
  const stoppedRef = useRef(false);

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    for (const { track, handler } of trackListenersRef.current) {
      try {
        track.removeEventListener("ended", handler);
      } catch {
        /* ignore — track may already be gone */
      }
    }
    trackListenersRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore — track may already be stopped */
        }
      });
      streamRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [onClose, stopCamera]);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        stoppedRef.current = false;
        // Wire a track-ended handler on every track so we notice the user
        // revoking camera permission mid-scan (browsers fire `ended` on the
        // track when the permission is withdrawn).
        stream.getTracks().forEach((track) => {
          const handler = () => {
            if (stoppedRef.current) return;
            setError("Camera access was lost. Please re-enable camera permission and try again.");
            stopCamera();
          };
          track.addEventListener("ended", handler);
          trackListenersRef.current.push({ track, handler });
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {
            /* autoplay may be prevented; tick() will no-op until ready */
          }
          if (!cancelled && !stoppedRef.current) {
            rafRef.current = requestAnimationFrame(tick);
          }
        }
      } catch {
        if (!cancelled) {
          setError("Camera access was denied or the camera is unavailable.");
        }
      }
    }

    function tick() {
      if (stoppedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      if (code && code.data) {
        const data = code.data.trim();
        if (expectedPrefixes && expectedPrefixes.length > 0) {
          const matched = expectedPrefixes.some((p) => data.startsWith(p));
          if (!matched) {
            setInvalidMessage(
              `Not a valid ${prefixLabel(expectedPrefixes)}. Align a valid QR code within the frame.`,
            );
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
        }
        stopCamera();
        onScan(data);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [expectedPrefixes, onScan, stopCamera]);

  return (
    <div
      className="qr-scanner-backdrop"
      role="dialog"
      aria-label="QR Scanner"
      aria-modal="true"
      onClick={(event) => {
        // Only treat bare backdrop clicks as "close" — clicks on the inner
        // modal shouldn't bubble here because of stopPropagation below, but
        // keep a target check as a belt-and-braces guard.
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className="qr-scanner-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="qr-scanner-header">
          <h3 className="qr-scanner-title">Scan QR Code</h3>
          <button
            type="button"
            className="qr-scanner-close"
            onClick={handleClose}
            aria-label="Close scanner"
          >
            <X size={18} />
          </button>
        </div>
        <div className="qr-scanner-body">
          {error ? (
            <div className="qr-scanner-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="button button-primary button-md"
                onClick={handleClose}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="qr-scanner-video-wrapper">
                <video
                  ref={videoRef}
                  className="qr-scanner-video"
                  muted
                  playsInline
                />
                <canvas ref={canvasRef} className="qr-scanner-canvas" />
                <div className="qr-scanner-overlay" />
              </div>
              <p className="qr-scanner-hint">Point your camera at a QR code to scan.</p>
              {invalidMessage ? (
                <p className="qr-scanner-invalid" role="alert">
                  {invalidMessage}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
