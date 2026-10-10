/**
 * Frame capture from a <video> element (live camera or a replayed video file: the same
 * code path, which is what makes replay mode a faithful backup demo).
 */

export interface CapturedFrame {
  readonly seq: number;
  readonly capturedAt: number;
  /** JPEG, base64 without the data: prefix. */
  readonly base64: string;
  readonly width: number;
  readonly height: number;
}

/** Scales (w, h) down to fit within maxSide, preserving aspect ratio. Never upscales. */
export function scaleToFit(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Keeps the last N captured frames so evidence can be uploaded after the engine confirms. */
export class FrameBuffer {
  private readonly frames: CapturedFrame[] = [];

  constructor(private readonly size = 5) {}

  push(frame: CapturedFrame): void {
    this.frames.push(frame);
    if (this.frames.length > this.size) this.frames.shift();
  }

  get(seq: number): CapturedFrame | null {
    return this.frames.find((f) => f.seq === seq) ?? null;
  }

  latest(): CapturedFrame | null {
    return this.frames.at(-1) ?? null;
  }
}

export interface CaptureOptions {
  readonly maxSide?: number;
  readonly quality?: number;
}

/**
 * Draws the current video frame to a canvas and encodes it as JPEG. Returns null when
 * the video has no frame yet (still loading, or the camera is off).
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: CaptureOptions = {},
): Promise<Omit<CapturedFrame, "seq" | "capturedAt"> | null> {
  const { maxSide = 640, quality = 0.7 } = options;
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const { width, height } = scaleToFit(video.videoWidth, video.videoHeight, maxSide);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Draw unmirrored even if the preview is mirrored: the model sees the real scene.
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return null;
  return { base64: await blobToBase64(blob), width, height };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
