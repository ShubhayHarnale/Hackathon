import { describe, expect, it } from "vitest";
import { visionFromQuery } from "./server";

describe("patient source selection", () => {
  it("keeps persisted live and replay modes authoritative", () => {
    expect(visionFromQuery({ vision: "scripted" }, "live")).toEqual({ kind: "server" });
    expect(visionFromQuery({ vision: "server" }, "replay")).toEqual({ kind: "replay" });
  });
  it("lets new demo sessions choose camera, replay, or a valid script", () => {
    expect(visionFromQuery({ vision: "replay" }, "mock")).toEqual({ kind: "replay" });
    expect(visionFromQuery({ vision: "server" }, "mock")).toEqual({ kind: "server" });
    expect(visionFromQuery({ scenario: "skip-critical" }, "mock")).toEqual({
      kind: "scripted",
      scenario: "skip-critical",
    });
    expect(visionFromQuery({ scenario: "constructor" }, "mock")).toEqual({
      kind: "scripted",
      scenario: "happy",
    });
  });
});
