import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import jsQR from "jsqr";

interface QrScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const rafRef = useRef<number>(0);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          tick();
        }
      } catch (err) {
        setError("Camera access denied or unavailable.");
        setScanning(false);
      }
    }

    function tick() {
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
        stopCamera();
        setScanning(false);
        onScan(code.data);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    startCamera();
    return () => stopCamera();
  }, [onScan, stopCamera]);

  return (
    <div className="qr-scanner-backdrop" role="dialog" aria-label="QR Scanner">
      <div className="qr-scanner-modal">
        <div className="qr-scanner-header">
          <h3 className="qr-scanner-title">Scan QR Code</h3>
          <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="Close scanner">
            <X size={18} />
          </button>
        </div>
        <div className="qr-scanner-body">
          {error ? (
            <div className="qr-scanner-error">
              <p>{error}</p>
              <button type="button" className="button button-primary button-md" onClick={onClose}>
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="qr-scanner-video-wrapper">
                <video ref={videoRef} className="qr-scanner-video" muted playsInline />
                <canvas ref={canvasRef} className="qr-scanner-canvas" />
                {scanning && <div className="qr-scanner-overlay" />}
              </div>
              <p className="qr-scanner-hint">Point your camera at a QR code to scan.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
