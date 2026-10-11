import { describe, expect, it, vi } from "vitest";
import { captureVideoFrame } from "@/vision";
import { PatientMedia } from "./capture";

vi.mock("@/vision", () => ({
  captureVideoFrame: vi.fn(async () => ({ base64: "frame", width: 640, height: 480 })),
}));

function camera() {
  let decoded = 1;
  const video = {
    paused: false,
    ended: false,
    readyState: 2,
    videoWidth: 640,
    currentTime: 0,
    srcObject: null,
    play: vi.fn(async () => {
      video.paused = false;
    }),
    load: vi.fn(),
    getVideoPlaybackQuality: () => ({ totalVideoFrames: decoded }),
  };
  const media = new PatientMedia(false);
  media.setVideo(video as unknown as HTMLVideoElement);
  media.setCanvas({} as HTMLCanvasElement);
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  return {
    media,
    video,
    stream,
    nextFrame: () => {
      decoded += 1;
    },
  };
}

describe("camera freshness", () => {
  it("tracks presented frames when both playback time and quality counters stay unchanged", async () => {
    const { media, video, stream } = camera();
    let callback: VideoFrameRequestCallback | undefined;
    const request = vi.fn((fn: VideoFrameRequestCallback) => {
      callback = fn;
      return 1;
    });
    const cancel = vi.fn();
    Object.assign(video, {
      requestVideoFrameCallback: request,
      cancelVideoFrameCallback: cancel,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 0 }),
    });
    media.setVideo(video as unknown as HTMLVideoElement);
    await media.setStream(stream);
    callback!(0, { presentedFrames: 1 } as VideoFrameCallbackMetadata);
    expect(await media.capture()).not.toBeNull();
    expect(await media.capture()).toBeNull();
    callback!(0, { presentedFrames: 2 } as VideoFrameCallbackMetadata);
    expect(await media.capture()).not.toBeNull();
    media.setVideo(null);
    expect(cancel).toHaveBeenCalledWith(1);
  });
  it("accepts new decoded camera frames even when a live stream's playback time stays at zero", async () => {
    const { media, stream, nextFrame } = camera();
    await media.setStream(stream);
    expect(await media.capture()).not.toBeNull();
    nextFrame();
    expect(await media.capture()).not.toBeNull();
  });

  it("rejects repeated frames from a frozen camera", async () => {
    const { media, stream } = camera();
    await media.setStream(stream);
    expect(await media.capture()).not.toBeNull();
    expect(await media.capture()).toBeNull();
  });

  it("does not treat dropped frames as fresh visual evidence", async () => {
    const { media, video, stream } = camera();
    let total = 1;
    let dropped = 0;
    Object.assign(video, {
      getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
    });
    await media.setStream(stream);
    expect(await media.capture()).not.toBeNull();
    total = 2;
    dropped = 1;
    expect(await media.capture()).toBeNull();
  });

  it("restarts browser-suspended live playback before capturing", async () => {
    const { media, video, stream } = camera();
    await media.setStream(stream);
    video.play.mockClear();
    video.paused = true;
    await media.capture();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("only rechecks a frozen replay frame to probe a system pause, never during an active hold", async () => {
    const { media, video } = camera();
    await media.setReplay(new File(["test"], "test.webm"));
    video.paused = true;
    expect(await media.capture()).not.toBeNull();
    expect(await media.capture()).toBeNull();
    media.checkPausedReplay = () => true;
    expect(await media.capture()).not.toBeNull();
    media.checkPausedReplay = () => false;
    expect(await media.capture()).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
    media.clearReplay();
    expect(captureVideoFrame).toHaveBeenCalled();
  });
});
