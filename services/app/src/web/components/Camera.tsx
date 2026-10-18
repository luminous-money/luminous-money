/**
 * The camera, for receipts and attachments (M16): whether there is one, its live view (the back
 * camera, on a phone), and taking a photo, shrunk to at most 2,000 px a side as a JPEG so a
 * receipt is well under the 5 MB an attachment may be.
 */
import { useEffect, useRef, useState } from "react";

const MAX_SIDE = 2000;

/** Whether the device has a camera: null until known. */
export function useHasCamera(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices?.enumerateDevices || !devices.getUserMedia) return setHas(false);
    devices
      .enumerateDevices()
      .then((all) => setHas(all.some((d) => d.kind === "videoinput")))
      .catch(() => setHas(false));
  }, []);
  return has;
}

/** A picture (a video frame, or an image file) as a JPEG of at most MAX_SIDE a side. */
async function shrunk(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("couldn't take the photo"))),
      "image/jpeg",
      0.85
    )
  );
}

/** An image file shrunk the same way (a PDF, or anything else, as it is). */
export async function prepared(file: File): Promise<{ blob: Blob; name: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000)
    return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const blob = await shrunk(bitmap, bitmap.width, bitmap.height);
    return { blob, name: file.name.replace(/\.\w+$/, "") + ".jpg" };
  } catch {
    return { blob: file, name: file.name };
  }
}

/** The camera's live view, filling its box, with a shutter. */
export function CameraView({
  onShot,
  label = "Take photo",
}: {
  onShot: (photo: Blob) => void;
  label?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch(() => setError("The camera isn't available: allow it, or upload instead."));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const shoot = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    onShot(await shrunk(v, v.videoWidth, v.videoHeight));
  };
  return (
    <div className="camera">
      {error ? (
        <p className="camera-error small">{error}</p>
      ) : (
        <video ref={video} playsInline muted aria-label="Camera" />
      )}
      {!error && (
        <button type="button" className="shutter" aria-label={label} onClick={() => void shoot()}>
          <span aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
