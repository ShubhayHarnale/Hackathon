import { captureVideoFrame, type CapturedFrame } from "@/vision";

type Frame = Omit<CapturedFrame, "seq" | "capturedAt">;

/**
 * The camera elements and stream for the patient app, outside React state: the page
 * hands over elements with callback refs and the vision loop reads frames from here.
 *
 * A live camera frame when there is one. In scripted demo mode without a camera, a small
 * labelled placeholder instead, so the evidence upload path still runs end to end (the
 * scripted provider ignores the image anyway).
 */
export class PatientMedia {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  /** What the placeholder frame is labelled with (the current step id). */
  label: () => string = () => "";

  constructor(private readonly scripted: boolean) {}

  setVideo = (el: HTMLVideoElement | null): void => {
    this.video = el;
    if (el && this.stream && el.srcObject !== this.stream) el.srcObject = this.stream;
  };

  setCanvas = (el: HTMLCanvasElement | null): void => {
    this.canvas = el;
  };

  /** Shows a new camera stream (stopping any previous one). */
  async setStream(stream: MediaStream | null): Promise<void> {
    if (this.stream !== stream) this.stopStream();
    this.stream = stream;
    if (this.video && stream) {
      this.video.srcObject = stream;
      await this.video.play().catch(() => undefined);
    }
  }

  stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  capture = async (): Promise<Frame | null> => {
    const { video, canvas } = this;
    if (!canvas) return null;
    if (this.stream && video && video.readyState >= 2 && video.videoWidth > 0) {
      return captureVideoFrame(video, canvas);
    }
    return this.scripted ? placeholderFrame(canvas, this.label()) : null;
  };
}

async function placeholderFrame(canvas: HTMLCanvasElement, label: string): Promise<Frame | null> {
  const width = 320;
  const height = 240;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#1c1c1f";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f5f5f5";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("Scripted demo frame", 16, 40);
  ctx.font = "14px sans-serif";
  ctx.fillText(label.slice(0, 40), 16, 72);
  ctx.fillText(new Date().toISOString(), 16, 100);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.6),
  );
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { base64: btoa(binary), width, height };
}
